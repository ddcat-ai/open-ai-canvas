package service

import (
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

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
		{ID: "settled", UserID: "user-1", IdempotencyKey: "settled", Status: model.BillingStatusSettled, ReservedAmountMicrocredits: 1_000_000, ActualAmountMicrocredits: 780_000},
		{ID: "reserved", UserID: "user-1", IdempotencyKey: "reserved", Status: model.BillingStatusReserved, ReservedAmountMicrocredits: 900_000},
		{ID: "uncertain", UserID: "user-1", IdempotencyKey: "uncertain", Status: model.BillingStatusUncertain, ReservedAmountMicrocredits: 1_200_000},
		{ID: "refunded", UserID: "user-1", IdempotencyKey: "refunded", Status: model.BillingStatusRefunded, ReservedAmountMicrocredits: 650_000, RefundedAmountMicrocredits: 650_000},
		{ID: "other-user", UserID: "user-2", IdempotencyKey: "other-user", Status: model.BillingStatusSettled, ActualAmountMicrocredits: 500_000},
	}
	if err := db.Create(&orders).Error; err != nil {
		t.Fatal(err)
	}

	logs := []model.ApiCallLog{
		{ID: "log-settled", UserID: "user-1", BillingOrderID: "settled", Capability: "text"},
		{ID: "log-reserved", UserID: "user-1", BillingOrderID: "reserved", Capability: "text"},
		{ID: "log-uncertain", UserID: "user-1", BillingOrderID: "uncertain", Capability: "text"},
		{ID: "log-refunded", UserID: "user-1", BillingOrderID: "refunded", Capability: "text"},
		{ID: "log-missing", UserID: "user-1", BillingOrderID: "missing", Capability: "text"},
		{ID: "log-other-user", UserID: "user-1", BillingOrderID: "other-user", Capability: "text"},
	}

	svc := &Service{repo: repository.New(db)}
	if err := svc.decorateAPICallLogs(logs); err != nil {
		t.Fatal(err)
	}

	assertBillingSnapshot(t, logs[0], true, model.BillingStatusSettled, 780_000)
	assertBillingSnapshot(t, logs[1], true, model.BillingStatusReserved, 900_000)
	assertBillingSnapshot(t, logs[2], true, model.BillingStatusUncertain, 1_200_000)
	assertBillingSnapshot(t, logs[3], true, model.BillingStatusRefunded, 0)
	assertBillingSnapshot(t, logs[4], false, "", 0)
	assertBillingSnapshot(t, logs[5], false, "", 0)
}

func assertBillingSnapshot(t *testing.T, log model.ApiCallLog, available bool, status model.BillingStatus, amount int64) {
	t.Helper()
	if log.BillingAvailable != available || log.BillingStatus != status || log.BillingAmount != amount {
		t.Fatalf("billing snapshot for %s = {available:%v status:%q amount:%d}, want {available:%v status:%q amount:%d}", log.ID, log.BillingAvailable, log.BillingStatus, log.BillingAmount, available, status, amount)
	}
}
