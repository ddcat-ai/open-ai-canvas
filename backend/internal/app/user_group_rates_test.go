package app

import (
	"testing"
	"yingce/backend/internal/model"
)

func TestUserGroupRatesOverrideInheritanceAndIsolation(t *testing.T) {
	svc, db, admin := displayGroupFixture(t)
	if err := db.AutoMigrate(&model.User{}, &model.UserGroupRates{}); err != nil {
		t.Fatal(err)
	}
	user := &model.User{ID: "rate-user", Username: "rate-user", Role: model.UserRoleUser}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	view := manualDisplayGroupDraft(t, svc, admin)
	if err := svc.SaveAdminModelDisplayGroups(admin, ModelDisplayGroupsRequest{Groups: view.Groups, ExpectedSnapshot: view.Snapshot}); err != nil {
		t.Fatal(err)
	}
	req := UserGroupRatesRequest{Rates: map[string]int64{"family": 9000, "other": 6000}}
	if err := svc.SaveAdminUserGroupRates(user, user.ID, req); err == nil {
		t.Fatal("non-admin changed rates")
	}
	if err := svc.SaveAdminUserGroupRates(admin, user.ID, req); err != nil {
		t.Fatal(err)
	}
	if err := svc.SaveAdminUserGroupRates(admin, user.ID, req); err == nil {
		t.Fatal("stale write accepted")
	}
	check := func(userID, modelID string, want int64, source string) {
		t.Helper()
		rules, err := svc.billingPricingRules(userID)
		if err != nil {
			t.Fatal(err)
		}
		got, snapshot, err := rules.resolveModel(modelID, "same-provider-key", 11000)
		if err != nil || got != want || snapshot.MultiplierSource != source {
			t.Fatalf("got %d %+v %v", got, snapshot, err)
		}
	}
	check(user.ID, view.Groups[0].ModelIDs[0], 9000, "user")
	check(user.ID, view.Groups[1].ModelIDs[0], 6000, "user")
	check("", view.Groups[0].ModelIDs[0], 10000, "sale")
	check(user.ID, "ungrouped", 11000, "global")
	for _, rates := range []map[string]int64{{"unknown": 8000}, {"family": 0}, {"family": -1}, {"family": 1000001}, {"family": 10001}} {
		if err := svc.SaveAdminUserGroupRates(admin, user.ID, UserGroupRatesRequest{Rates: rates, Version: 1}); err == nil {
			t.Fatalf("invalid rate accepted: %v", rates)
		}
	}
	if err := svc.SaveAdminUserGroupRates(admin, user.ID, UserGroupRatesRequest{Rates: map[string]int64{}, Version: 1}); err != nil {
		t.Fatal(err)
	}
	check(user.ID, view.Groups[0].ModelIDs[0], 10000, "sale")
	check(user.ID, view.Groups[1].ModelIDs[0], 10000, "sale")
	if err := db.Migrator().DropTable(&model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if err := svc.SaveAdminUserGroupRates(admin, user.ID, UserGroupRatesRequest{Rates: map[string]int64{"family": 5000}, Version: 2}); err == nil {
		t.Fatal("unaudited save succeeded")
	}
	check(user.ID, view.Groups[0].ModelIDs[0], 10000, "sale")
}

func TestDisplayGroupRatesNeverDiscountRegularSale(t *testing.T) {
	svc, db, admin := displayGroupFixture(t)
	if err := db.AutoMigrate(&model.UserGroupRates{}); err != nil {
		t.Fatal(err)
	}
	view := manualDisplayGroupDraft(t, svc, admin)
	if err := svc.SaveAdminModelDisplayGroups(admin, ModelDisplayGroupsRequest{Groups: view.Groups, ExpectedSnapshot: view.Snapshot}); err != nil {
		t.Fatal(err)
	}
	rules, err := svc.billingPricingRules("")
	if err != nil {
		t.Fatal(err)
	}
	value, _, err := rules.resolveModel(view.Groups[0].ModelIDs[0], "first", 12000)
	if err != nil || value != 10000 {
		t.Fatal("group did not preserve regular sale price")
	}
	if err := db.Migrator().DropTable(&model.UserGroupRates{}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.billingPricingRules("real-user"); err == nil {
		t.Fatal("database failure fell back to full price")
	}
}

func TestDisplayGroupPricingReservationSnapshots(t *testing.T) {
	for _, mode := range []string{"fixed_request", "per_second", "token"} {
		t.Run(mode, func(t *testing.T) {
			svc, db, admin := displayGroupFixture(t)
			if err := db.AutoMigrate(&model.UserGroupRates{}); err != nil {
				t.Fatal(err)
			}
			view := manualDisplayGroupDraft(t, svc, admin)
			if err := svc.SaveAdminModelDisplayGroups(admin, ModelDisplayGroupsRequest{Groups: view.Groups, ExpectedSnapshot: view.Snapshot}); err != nil {
				t.Fatal(err)
			}
			order := &model.BillingOrder{UserID: "u", ChannelID: "a", ChannelModelID: view.Groups[0].ModelIDs[0], BillingMode: mode, UnitPriceMicrocredits: 1000001, InputTokenPriceMicrocredits: 1000000, OutputTokenPriceMicrocredits: 2000000, MultiplierBasisPoints: 12000, Quantity: 3}
			estimate := tokenBillingEstimate{InputTokens: 1, OutputTokens: 2}
			if err := svc.applyBillingGroupPricing(order, "first", estimate); err != nil {
				t.Fatal(err)
			}
			want := int64(3000003)
			if mode == "token" {
				want = 5
			}
			if order.AmountMicrocredits != want || order.ReservedAmountMicrocredits != want || order.MultiplierBasisPoints != 10000 || order.BillingGroupVersion != 1 {
				t.Fatalf("bad reservation %+v", order)
			}
			current, err := svc.AdminModelDisplayGroups(admin)
			if err != nil {
				t.Fatal(err)
			}
			current.Groups[0].Name = "Renamed"
			if err := svc.SaveAdminModelDisplayGroups(admin, ModelDisplayGroupsRequest{Groups: current.Groups, ExpectedSnapshot: current.Snapshot}); err != nil {
				t.Fatal(err)
			}
			if order.MultiplierBasisPoints != 10000 || order.BillingGroupVersion != 1 {
				t.Fatal("existing order changed")
			}
			next := *order
			if err := svc.applyBillingGroupPricing(&next, "first", estimate); err != nil || next.MultiplierBasisPoints != 10000 || next.BillingGroupVersion != 2 {
				t.Fatalf("new price not applied: %+v %v", next, err)
			}
		})
	}
}

func TestDisplayGroupRatesQuoteMatchesTaskBilling(t *testing.T) {
	svc, db, channel, cm, _ := newVideoTokenQuoteFixture(t)
	if err := db.AutoMigrate(&model.UserGroupRates{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	view, err := svc.AdminModelDisplayGroups(admin)
	if err != nil {
		t.Fatal(err)
	}
	groups := []ModelDisplayGroup{{ID: "video-family", Name: "Video", ModelIDs: []string{cm.ID}}}
	if err := svc.SaveAdminModelDisplayGroups(admin, ModelDisplayGroupsRequest{Groups: groups, ExpectedSnapshot: view.Snapshot}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.UserGroupRates{UserID: "quote-user", RatesJSON: `{"video-family":6000}`, Version: 1}).Error; err != nil {
		t.Fatal(err)
	}
	intent := ModelRequestIntent{Capability: "video", Options: map[string]any{"vquality": "720p", "size": "16:9", "videoSeconds": 5}}
	quote, err := svc.QuoteChannelModel(ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: cm.ModelKey, Intent: intent}, "quote-user")
	if err != nil {
		t.Fatal(err)
	}
	input := quoteInput(intent, cm.ModelKey)
	input["config"].(map[string]any)["channelId"] = channel.ID
	resolved, err := svc.resolveSystemChannelModelSelection(input, "canvas_video", "")
	if err != nil {
		t.Fatal(err)
	}
	order, err := svc.taskBillingOrder("quote-user", &model.Task{ID: "rate-task", Type: "canvas_video"}, resolved)
	if err != nil {
		t.Fatal(err)
	}
	if quote.MultiplierBasisPoints != 6000 || order.MultiplierBasisPoints != 6000 || quote.AmountMicrocredits != order.AmountMicrocredits || order.MultiplierSource != "user" {
		t.Fatalf("quote=%+v order=%+v", quote, order)
	}
	catalog, err := svc.ModelCatalog(nil, "quote-user")
	if err != nil {
		t.Fatal(err)
	}
	for _, ch := range catalog.Channels {
		for _, item := range ch.Models {
			if item.ID == cm.ID && item.MultiplierBasisPoints != 6000 {
				t.Fatal("catalog price differs from reservation")
			}
		}
	}
	assertVideoQuoteHasNoFinancialWrites(t, db)
}
