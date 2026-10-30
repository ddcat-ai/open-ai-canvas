package app

import (
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDecorateAPICallLogsUsesBillingOrderSnapshot(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := db.AutoMigrate(&model.User{}, &model.ModelChannel{}, &model.BillingOrder{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{ID: "user-1", Username: "creator", DisplayName: "创作者"}).Error; err != nil {
		t.Fatal(err)
	}

	orders := []model.BillingOrder{
		{ID: "settled", UserID: "user-1", IdempotencyKey: "settled", Status: model.BillingStatusSettled, ReservedAmountMicrocredits: 1_000_000, ActualAmountMicrocredits: 780_000, BillingCostSnapshot: model.BillingCostSnapshot{CostBillingMode: "fixed_request", CostQuantity: 1, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 456_789}}},
		{ID: "reserved", UserID: "user-1", IdempotencyKey: "reserved", Status: model.BillingStatusReserved, ReservedAmountMicrocredits: 900_000},
		{ID: "uncertain", UserID: "user-1", IdempotencyKey: "uncertain", Status: model.BillingStatusUncertain, ReservedAmountMicrocredits: 1_200_000},
		{ID: "refunded", UserID: "user-1", IdempotencyKey: "refunded", Status: model.BillingStatusRefunded, ReservedAmountMicrocredits: 650_000, RefundedAmountMicrocredits: 650_000},
		{ID: "other-user", UserID: "user-2", IdempotencyKey: "other-user", Status: model.BillingStatusSettled, ActualAmountMicrocredits: 500_000},
	}
	if err := db.Create(&orders).Error; err != nil {
		t.Fatal(err)
	}

	logs := []model.ApiCallLog{
		{ID: "log-settled", UserID: "user-1", BillingOrderID: "settled", Capability: "text", Billable: true},
		{ID: "log-reserved", UserID: "user-1", BillingOrderID: "reserved", Capability: "text", Billable: true},
		{ID: "log-uncertain", UserID: "user-1", BillingOrderID: "uncertain", Capability: "text", Billable: true},
		{ID: "log-refunded", UserID: "user-1", BillingOrderID: "refunded", Capability: "text", Billable: true},
		{ID: "log-missing", UserID: "user-1", BillingOrderID: "missing", Capability: "text", Billable: true},
		{ID: "log-other-user", UserID: "user-1", BillingOrderID: "other-user", Capability: "text", Billable: true},
		{ID: "log-download", UserID: "user-1", BillingOrderID: "settled", Capability: "image", RequestKind: "download", Billable: false},
	}

	svc := &Service{repo: repository.New(db)}
	if err := svc.decorateAPICallLogs(logs); err != nil {
		t.Fatal(err)
	}

	settled := int64(780_000)
	assertBillingSnapshot(t, logs[0], true, model.BillingStatusSettled, 1_000_000, &settled)
	assertBillingSnapshot(t, logs[1], true, model.BillingStatusReserved, 900_000, nil)
	assertBillingSnapshot(t, logs[2], true, model.BillingStatusUncertain, 1_200_000, nil)
	assertBillingSnapshot(t, logs[3], true, model.BillingStatusRefunded, 650_000, nil)
	assertBillingSnapshot(t, logs[4], false, "", 0, nil)
	assertBillingSnapshot(t, logs[5], false, "", 0, nil)
	assertBillingSnapshot(t, logs[6], false, "", 0, nil)
	if !logs[0].CreditCostConfigured || logs[0].CreditCostMicrocredits == nil || *logs[0].CreditCostMicrocredits != 456_789 {
		t.Fatalf("request cost missing: %#v", logs[0])
	}
	for _, log := range logs[1:] {
		if log.CreditCostConfigured || log.CreditCostMicrocredits != nil {
			t.Fatalf("fabricated cost for %s", log.ID)
		}
	}
}

func assertBillingSnapshot(t *testing.T, log model.ApiCallLog, available bool, status model.BillingStatus, reserved int64, settled *int64) {
	t.Helper()
	settledMatches := (log.BillingSettledAmount == nil) == (settled == nil) && (settled == nil || *log.BillingSettledAmount == *settled)
	if log.BillingAvailable != available || log.BillingStatus != status || log.BillingReservedAmount != reserved || !settledMatches {
		t.Fatalf("billing snapshot for %s = {available:%v status:%q reserved:%d settled:%v}, want {available:%v status:%q reserved:%d settled:%v}", log.ID, log.BillingAvailable, log.BillingStatus, log.BillingReservedAmount, log.BillingSettledAmount, available, status, reserved, settled)
	}
}
