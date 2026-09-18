package repository

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPaymentExportMatchesFiltersAcrossPages(t *testing.T) {
	db := openPaymentTestDB(t)
	if err := db.AutoMigrate(&model.User{}); err != nil {
		t.Fatal(err)
	}
	user := model.User{ID: "user", Username: "alice", Email: "alice@example.com"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 9, 1, 0, 0, 0, 0, time.FixedZone("CST", 8*3600))
	end := start.AddDate(0, 0, 1)
	middle := start.Add(time.Hour)
	orders := []model.PaymentOrder{
		{ID: "a", UserID: user.ID, IdempotencyKey: "a", MerchantOrderNo: "a", ProviderID: "wechat-native", Status: model.PaymentOrderCredited, CreatedAt: start, ProviderPaidAt: &middle, CreditedAt: &end},
		{ID: "b", UserID: user.ID, IdempotencyKey: "b", MerchantOrderNo: "b", ProviderID: "wechat-native", Status: model.PaymentOrderCredited, CreatedAt: middle, ProviderPaidAt: &middle},
		{ID: "c", UserID: user.ID, IdempotencyKey: "c", MerchantOrderNo: "c", ProviderID: "wechat-native", Status: model.PaymentOrderCredited, CreatedAt: end, ProviderPaidAt: &end},
		{ID: "d", UserID: user.ID, IdempotencyKey: "d", MerchantOrderNo: "d", ProviderID: "alipay-page-pay", Status: model.PaymentOrderCredited, CreatedAt: middle},
	}
	if err := db.Create(&orders).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	filter := PaymentOrderFilter{Keyword: "ALICE@EXAMPLE.COM", Status: "credited", ProviderID: "wechat-native", From: start, Until: end}
	page, total, err := repo.AdminPaymentOrders(filter, 1, 0)
	if err != nil || total != 2 || len(page) != 1 {
		t.Fatalf("invalid list: %v %d %v", page, total, err)
	}
	exported, users, err := repo.ExportPaymentOrders(filter, 10001)
	if err != nil || len(exported) != 2 || users[user.ID].Username != "alice" || exported[0].ID != page[0].ID {
		t.Fatalf("export differs from list: %v %v", exported, err)
	}
	filter.TimeField = "paid"
	exported, _, err = repo.ExportPaymentOrders(filter, 10001)
	if err != nil || len(exported) != 2 {
		t.Fatalf("paid bounds: %v %v", exported, err)
	}
	filter.TimeField = "credited"
	exported, _, err = repo.ExportPaymentOrders(filter, 10001)
	if err != nil || len(exported) != 0 {
		t.Fatalf("credited null/end boundary: %v %v", exported, err)
	}
}

func TestPaymentReconciliationExportSnapshotAndRerun(t *testing.T) {
	db := openPaymentTestDB(t)
	if err := db.AutoMigrate(&model.PaymentReconciliationRun{}, &model.PaymentReconciliationItem{}); err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	run := model.PaymentReconciliationRun{ID: "run", ProviderID: "wechat-native", BillDate: "2026-09-01", Status: model.PaymentReconciliationCompleted, TotalItems: 3, MatchItems: 1, RecoveredItems: 1, ErrorItems: 1}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	items := []model.PaymentReconciliationItem{{ID: "a", RunID: run.ID, Result: model.PaymentReconciliationMatched, Resolved: true}, {ID: "b", RunID: run.ID, Result: model.PaymentReconciliationRecovered, Resolved: true}, {ID: "c", RunID: run.ID, Result: model.PaymentReconciliationAmountMismatch}}
	if err := db.Create(&items).Error; err != nil {
		t.Fatal(err)
	}
	_, exported, err := repo.ExportPaymentReconciliationItems(run.ID, "abnormal", 10001)
	if err != nil || len(exported) != 1 || exported[0].ID != "c" {
		t.Fatalf("wrong abnormal items: %v %v", exported, err)
	}
	filter := PaymentReconciliationFilter{ProviderID: run.ProviderID, Status: "completed", From: run.BillDate, To: run.BillDate}
	runs, total, err := repo.AdminPaymentReconciliationRuns(filter, 1, 0)
	if err != nil || total != 1 || len(runs) != 1 {
		t.Fatalf("wrong summary: %v %v", runs, err)
	}
	summaries, err := repo.ExportPaymentReconciliations(filter, 10001)
	if err != nil || len(summaries) != 1 || summaries[0].ErrorItems != 1 {
		t.Fatalf("wrong export: %v %v", summaries, err)
	}
	filter.From = "2026-09-02"
	summaries, err = repo.ExportPaymentReconciliations(filter, 10001)
	if err != nil || len(summaries) != 0 {
		t.Fatalf("ignored date filter: %v %v", summaries, err)
	}
	_, started, err := repo.BeginPaymentReconciliation(&model.PaymentReconciliationRun{ID: "new-run", ProviderID: run.ProviderID, BillDate: run.BillDate})
	if err != nil || !started {
		t.Fatalf("rerun: %v %v", started, err)
	}
	_, _, err = repo.ExportPaymentReconciliationItems(run.ID, "", 10001)
	if !errors.Is(err, ErrPaymentReconciliationRunning) {
		t.Fatalf("running export accepted: %v", err)
	}
}

func TestPaymentExportKeepsSnapshotWhenRerunCompletesBetweenReads(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "payment.db") + "?_journal_mode=WAL&_busy_timeout=5000"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	writer, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	for _, connection := range []*gorm.DB{db, writer} {
		sqlDB, _ := connection.DB()
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	if err := db.AutoMigrate(&model.PaymentReconciliationRun{}, &model.PaymentReconciliationItem{}); err != nil {
		t.Fatal(err)
	}
	run := model.PaymentReconciliationRun{ID: "run", ProviderID: "provider", BillDate: "2026-09-01", Status: model.PaymentReconciliationCompleted, TotalItems: 1, ErrorItems: 1}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.PaymentReconciliationItem{ID: "old", RunID: run.ID, Result: model.PaymentReconciliationAmountMismatch}).Error; err != nil {
		t.Fatal(err)
	}
	replaced := false
	if err := db.Callback().Query().After("gorm:query").Register("test:rerun-between-export-reads", func(tx *gorm.DB) {
		if replaced || tx.Statement.Table != "payment_reconciliation_runs" {
			return
		}
		replaced = true
		writerRepo := New(writer)
		_, started, err := writerRepo.BeginPaymentReconciliation(&model.PaymentReconciliationRun{ID: "unused", ProviderID: run.ProviderID, BillDate: run.BillDate})
		if err != nil || !started {
			t.Fatalf("could not rerun: %v", err)
		}
		if err := writerRepo.CompletePaymentReconciliation(run.ID, []model.PaymentReconciliationItem{{ID: "new", RunID: run.ID, Result: model.PaymentReconciliationRecovered, Resolved: true}}, 0, 1, 0); err != nil {
			t.Fatal(err)
		}
	}); err != nil {
		t.Fatal(err)
	}
	snapshot, items, err := New(db).ExportPaymentReconciliationItems(run.ID, "", 10001)
	if err != nil || !replaced || snapshot.ErrorItems != 1 || len(items) != 1 || items[0].ID != "old" {
		t.Fatalf("mixed snapshot: run=%+v items=%v err=%v", snapshot, items, err)
	}
	latest, newItems, err := New(writer).ExportPaymentReconciliationItems(run.ID, "", 10001)
	if err != nil || latest.RecoveredItems != 1 || len(newItems) != 1 || newItems[0].ID != "new" {
		t.Fatalf("rerun not committed: %+v %v %v", latest, newItems, err)
	}
}
