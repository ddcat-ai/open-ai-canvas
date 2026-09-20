package app

import (
	"encoding/csv"
	"strconv"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAnalyticsFinanceAggregatesKnownAndUnknownCosts(t *testing.T) {
	cost := int64(300_000)
	zero := int64(0)
	for _, test := range []struct {
		name    string
		records []analyticsFinancialRecord
		costed  int
		revenue int64
		cost    int64
		profit  *int64
	}{
		{name: "no orders"},
		{name: "explicit zero", records: []analyticsFinancialRecord{{Cost: &zero}}, costed: 1, profit: &zero},
		{name: "break even", records: []analyticsFinancialRecord{{Revenue: 300_000, Cost: &cost}}, costed: 1, revenue: 300_000, cost: 300_000, profit: &zero},
		{name: "partial cost last", records: []analyticsFinancialRecord{{Revenue: 900_000, Cost: &cost}, {Revenue: 400_000}}, costed: 1, revenue: 1_300_000, cost: 300_000},
		{name: "partial cost first", records: []analyticsFinancialRecord{{Revenue: 400_000}, {Revenue: 900_000, Cost: &cost}}, costed: 1, revenue: 1_300_000, cost: 300_000},
	} {
		t.Run(test.name, func(t *testing.T) {
			var finance AnalyticsFinance
			for _, record := range test.records {
				finance.add(record)
			}
			if finance.SettledOrders != len(test.records) || finance.CostedOrders != test.costed || finance.RevenueMicrocredits != test.revenue || finance.CostMicrocredits != test.cost {
				t.Fatalf("finance = %+v", finance)
			}
			if test.profit == nil {
				if finance.ProfitMicrocredits != nil || finance.ProfitMargin != nil {
					t.Fatalf("unknown profit = %+v", finance)
				}
				return
			}
			if finance.ProfitMicrocredits == nil || *finance.ProfitMicrocredits != *test.profit {
				t.Fatalf("profit = %+v", finance)
			}
			if test.revenue == 0 {
				if finance.ProfitMargin != nil {
					t.Fatalf("zero revenue margin = %v", *finance.ProfitMargin)
				}
			} else if finance.ProfitMargin == nil || *finance.ProfitMargin != float64(*test.profit)*100/float64(test.revenue) {
				t.Fatalf("margin = %+v", finance)
			}
		})
	}
}

func TestAdminAnalyticsFinanceUsesSettledSnapshotsAndDeduplicates(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.BillingOrder{}, &model.ApiCallLog{}, &model.Task{}, &model.UserDailyActivity{}, &model.User{}); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	now := time.Now().UTC()
	orders := []model.BillingOrder{
		{ID: "paid", Status: model.BillingStatusSettled, ActualAmountMicrocredits: 900_000, BillingCostSnapshot: model.BillingCostSnapshot{CostBillingMode: "fixed_request", CostQuantity: 1, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 300_000}}},
		{ID: "free", Status: model.BillingStatusSettled, BillingCostSnapshot: model.BillingCostSnapshot{CostBillingMode: "fixed_request", CostQuantity: 1, CostPricing: model.CreditCostPricing{Configured: true}}},
		{ID: "unknown", Status: model.BillingStatusSettled, ActualAmountMicrocredits: 400_000},
		{ID: "reserved", Status: model.BillingStatusReserved, ReservedAmountMicrocredits: 1_000_000},
		{ID: "refunded", Status: model.BillingStatusRefunded, ActualAmountMicrocredits: 800_000},
		{ID: "loss", Status: model.BillingStatusSettled, ActualAmountMicrocredits: 100_000, BillingCostSnapshot: model.BillingCostSnapshot{CostBillingMode: "per_second", CostQuantity: 3, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 100_000}}},
	}
	logs := make([]model.ApiCallLog, 0)
	for index := range orders {
		order := &orders[index]
		order.UserID, order.ChannelID, order.IdempotencyKey = "user", "channel", order.ID
		logs = append(logs, model.ApiCallLog{ID: order.ID, BillingOrderID: order.ID, UserID: "user", ChannelID: "channel", Model: order.ID, Capability: "text", Billable: true, RequestKind: "create", Status: model.ApiCallStatusSucceeded, CreatedAt: now})
	}
	for _, id := range []string{"retry", "poll", "download", "upload", "workflow-schema", "cancel-query", "cancel", "wrong-user", "old-channel"} {
		item := logs[0]
		item.ID = id
		item.CreatedAt = now.Add(time.Second)
		switch id {
		case "poll", "download", "upload", "workflow-schema", "cancel-query", "cancel":
			item.RequestKind = id
			item.Model = "auxiliary"
			item.CreatedAt = now.Add(-time.Second)
		case "wrong-user":
			item.UserID = "other"
		case "old-channel":
			item.ChannelID = "previous"
		}
		logs = append(logs, item)
	}
	if err := db.Create(&orders).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&logs).Error; err != nil {
		t.Fatal(err)
	}
	query := AnalyticsQuery{From: now.Add(-time.Hour).Format(time.RFC3339), To: now.Add(time.Hour).Format(time.RFC3339)}
	result, err := svc.AdminAnalytics(admin, query)
	if err != nil {
		t.Fatal(err)
	}
	finance := result.KPI.Finance
	if finance.SettledOrders != 4 || finance.CostedOrders != 3 || finance.RevenueMicrocredits != 1_400_000 || finance.CostMicrocredits != 600_000 || finance.ProfitMicrocredits != nil || finance.ProfitMargin != nil {
		t.Fatalf("partial finance = %+v", finance)
	}
	for _, row := range result.Models {
		f := row.Finance
		switch row.Model {
		case "paid":
			if f.SettledOrders != 1 || f.ProfitMicrocredits == nil || *f.ProfitMicrocredits != 600_000 || f.ProfitMargin == nil || *f.ProfitMargin < 66.6 || *f.ProfitMargin > 66.7 {
				t.Fatalf("paid = %+v", f)
			}
		case "free":
			if f.CostedOrders != 1 || f.ProfitMicrocredits == nil || *f.ProfitMicrocredits != 0 || f.ProfitMargin != nil {
				t.Fatalf("free = %+v", f)
			}
		case "loss":
			if f.ProfitMicrocredits == nil || *f.ProfitMicrocredits != -200_000 || f.ProfitMargin == nil || *f.ProfitMargin != -200 {
				t.Fatalf("loss = %+v", f)
			}
		}
	}
	data, err := svc.AdminAnalyticsCSV(admin, query)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(string(data), "\xEF\xBB\xBF"))).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	var revenue, cost int64
	for _, row := range rows[1:] {
		if row[6] == "auxiliary" && (row[15] != "" || row[16] != "" || row[17] != "") {
			t.Fatalf("auxiliary request must not carry order finances: %v", row)
		}
		for index, target := range map[int]*int64{15: &revenue, 16: &cost} {
			if row[index] != "" {
				value, err := strconv.ParseInt(row[index], 10, 64)
				if err != nil {
					t.Fatal(err)
				}
				*target += value
			}
		}
	}
	if revenue != finance.RevenueMicrocredits || cost != finance.CostMicrocredits {
		t.Fatalf("CSV mismatch: revenue=%d cost=%d", revenue, cost)
	}
	query.Model = "paid"
	filtered, err := svc.AdminAnalytics(admin, query)
	if err != nil || filtered.KPI.Finance.SettledOrders != 1 || filtered.KPI.Finance.ProfitMicrocredits == nil || *filtered.KPI.Finance.ProfitMicrocredits != 600_000 {
		t.Fatalf("model filter = %+v, %v", filtered, err)
	}
	query.ChannelID = "previous"
	filtered, err = svc.AdminAnalytics(admin, query)
	if err != nil || filtered.KPI.Finance.SettledOrders != 0 {
		t.Fatalf("previous channel finance = %+v, %v", filtered, err)
	}
	query.Model, query.ChannelID = "auxiliary", ""
	filtered, err = svc.AdminAnalytics(admin, query)
	if err != nil || filtered.KPI.Finance.SettledOrders != 0 {
		t.Fatalf("auxiliary request finance = %+v, %v", filtered, err)
	}
	if _, err := svc.AdminAnalytics(&model.User{Role: model.UserRoleUser}, query); err == nil {
		t.Fatal("non-admin must not read costs")
	}
}

func TestAdminReferencesIncludeExistingDisplayNameGroups(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.User{}); err != nil {
		t.Fatal(err)
	}
	channels := []model.ModelChannel{
		{ID: "one", Scope: model.ChannelScopeSystem, Enabled: true},
		{ID: "two", Scope: model.ChannelScopeSystem, Enabled: false},
	}
	if err := db.Create(&channels).Error; err != nil {
		t.Fatal(err)
	}
	items := []model.ChannelModel{
		{ID: "a", ChannelID: "one", ModelKey: "a", DisplayName: "Shared", Enabled: true},
		{ID: "b", ChannelID: "one", ModelKey: "b", DisplayName: "Shared", Enabled: false},
		{ID: "c", ChannelID: "two", ModelKey: "c", DisplayName: "Other", Enabled: false},
		{ID: "d", ChannelID: "two", ModelKey: "d"},
	}
	if err := db.Create(&items).Error; err != nil {
		t.Fatal(err)
	}
	result, err := svc.AdminReferences(&model.User{Role: model.UserRoleAdmin})
	if err != nil {
		t.Fatal(err)
	}
	groups := map[string]int{}
	for _, channel := range result.Channels {
		for _, name := range channel.ModelDisplayNames {
			groups[name]++
		}
	}
	if len(groups) != 3 || groups["Shared"] != 1 || groups["Other"] != 1 || groups["d"] != 1 {
		t.Fatalf("groups = %#v", groups)
	}
}
