package app

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPaymentCSVEncodingAndPrecision(t *testing.T) {
	id := "000123456789012345678901234567890"
	rows := [][]string{{"名称", "订单号", "金额", "积分", "备注"}, {"中文,\"名称\"", paymentCSVIdentifier(id), paymentDecimal(1001, 2, false), paymentDecimal(999999999999999, 6, true), "换行\n说明"}, {" \t=HYPERLINK(\"evil\")", paymentCSVIdentifier("12E20"), "", "", "@SUM(1)"}}
	data, err := paymentCSV(rows)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(data), "\xEF\xBB\xBF") || !strings.Contains(string(data), "\r\n") {
		t.Fatalf("missing BOM/CRLF: %q", data)
	}
	parsed, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(string(data), "\xEF\xBB\xBF"))).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if parsed[1][0] != "中文,\"名称\"" || parsed[1][1] != "'"+id || parsed[1][2] != "10.01" || parsed[1][3] != "999999999.999999" {
		t.Fatalf("lost precision or escaping: %#v", parsed[1])
	}
	if !strings.HasPrefix(parsed[2][0], "'") || parsed[2][1] != "'12E20" || parsed[2][4] != "'@SUM(1)" {
		t.Fatalf("unsafe cell: %#v", parsed[2])
	}
	for _, dangerous := range []string{"=1", "+1", "-1", "@SUM(1)", " \r=1", "\uFEFF=1", "\x00=1"} {
		if !strings.HasPrefix(paymentCSVText(dangerous), "'") {
			t.Fatalf("unsafe: %q", dangerous)
		}
	}
	if paymentDecimal(1, 6, true) != "0.000001" || paymentDecimal(1000000, 6, true) != "1" || paymentDecimal(0, 2, false) != "0.00" {
		t.Fatal("invalid decimal formatting")
	}
	if paymentCSVTime(nil) != "" {
		t.Fatal("nil date should be empty")
	}
}

func TestPaymentExportDateValidation(t *testing.T) {
	f, err := (PaymentOrderQuery{From: "2026-09-01", To: "2026-09-01", TimeField: "paid"}).filter()
	if err != nil {
		t.Fatal(err)
	}
	if f.From.UTC().Format(time.RFC3339) != "2026-08-31T16:00:00Z" || f.Until.Sub(f.From) != 24*time.Hour {
		t.Fatalf("wrong date bounds: %#v", f)
	}
	for _, query := range []PaymentOrderQuery{{From: "2026-02-30"}, {To: "2026-9-1"}, {From: "2026-09-02", To: "2026-09-01"}, {TimeField: "created_at; DELETE"}, {Status: "unknown"}} {
		if _, err := query.filter(); err == nil {
			t.Fatalf("accepted invalid query: %#v", query)
		}
	}
	if _, err := (PaymentReconciliationQuery{Status: "unknown"}).filter(); err == nil {
		t.Fatal("accepted invalid run status")
	}
	if validatePaymentResult("abnormal") != nil || validatePaymentResult("unknown") == nil {
		t.Fatal("invalid result validation")
	}
	if checkPaymentExportSize(10000) != nil || checkPaymentExportSize(10001) == nil {
		t.Fatal("export limit is not enforced")
	}
}

func TestPaymentExportsRequireAdmin(t *testing.T) {
	s := &Service{}
	for _, actor := range []*model.User{nil, {Role: model.UserRoleUser}} {
		for _, export := range []func() ([]byte, error){
			func() ([]byte, error) {
				return s.AdminPaymentOrdersCSV(context.Background(), actor, PaymentOrderQuery{})
			},
			func() ([]byte, error) {
				return s.AdminPaymentReconciliationsCSV(context.Background(), actor, PaymentReconciliationQuery{})
			},
			func() ([]byte, error) {
				return s.AdminPaymentReconciliationItemsCSV(context.Background(), actor, "run", "")
			},
		} {
			if _, err := export(); err == nil {
				t.Fatal("non-admin export accepted")
			}
		}
	}
}

func TestPaymentExportsAllRowsAndReconciliationSemantics(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.PaymentOrder{}, &model.PaymentReconciliationRun{}, &model.PaymentReconciliationItem{}); err != nil {
		t.Fatal(err)
	}
	s := &Service{repo: repository.New(db)}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	now := time.Date(2026, 9, 17, 8, 0, 0, 0, time.UTC)
	orders := make([]model.PaymentOrder, 31)
	for i := range orders {
		orders[i] = model.PaymentOrder{ID: fmt.Sprint(i), UserID: "missing", IdempotencyKey: fmt.Sprint(i), MerchantOrderNo: fmt.Sprintf("000000000000000000%02d", i), AmountFen: 1001, CreditsMicrocredits: 1000001, CreatedAt: now}
	}
	if err := db.Create(&orders).Error; err != nil {
		t.Fatal(err)
	}
	data, err := s.AdminPaymentOrdersCSV(context.Background(), admin, PaymentOrderQuery{})
	if err != nil {
		t.Fatal(err)
	}
	rows := readPaymentTestCSV(t, data)
	if len(rows) != 32 || rows[1][3] != "missing" || rows[1][4] != "" || rows[1][9] != "10.01" || rows[1][11] != "1.000001" || rows[1][14] != "2026-09-17 16:00:00" {
		t.Fatalf("wrong order export: count=%d row=%#v", len(rows), rows[1])
	}
	run := model.PaymentReconciliationRun{ID: "run", ProviderID: "wechat-native", BillDate: "2026-09-17", Status: model.PaymentReconciliationCompleted, TotalItems: 2, MatchItems: 1, ErrorItems: 1, StartedBy: "system", StartedAt: now, CompletedAt: &now}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	items := []model.PaymentReconciliationItem{{ID: "matched", RunID: run.ID, Result: model.PaymentReconciliationMatched, Resolved: true}, {ID: "missing", RunID: run.ID, Result: model.PaymentReconciliationProviderRecordMissing, AmountFen: 1001, Detail: "本地已入账"}}
	if err := db.Create(&items).Error; err != nil {
		t.Fatal(err)
	}
	data, err = s.AdminPaymentReconciliationItemsCSV(context.Background(), admin, run.ID, "abnormal")
	if err != nil {
		t.Fatal(err)
	}
	rows = readPaymentTestCSV(t, data)
	if len(rows) != 2 || rows[1][7] != "本地订单" || rows[1][9] != "渠道记录缺失" || rows[1][10] != "否" {
		t.Fatalf("wrong detail export: %#v", rows)
	}
	data, err = s.AdminPaymentReconciliationsCSV(context.Background(), admin, PaymentReconciliationQuery{})
	if err != nil {
		t.Fatal(err)
	}
	rows = readPaymentTestCSV(t, data)
	if rows[1][3] != "已完成" || rows[1][7] != "1" || rows[1][9] != "系统" {
		t.Fatalf("completed must retain anomalies: %#v", rows)
	}
	for _, status := range []model.PaymentReconciliationStatus{model.PaymentReconciliationRunning, model.PaymentReconciliationFailed} {
		if err := db.Model(&run).Updates(map[string]any{"status": status, "error": "BILL_ERROR"}).Error; err != nil {
			t.Fatal(err)
		}
		_, err = s.AdminPaymentReconciliationItemsCSV(context.Background(), admin, run.ID, "")
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Status != 409 {
			t.Fatalf("unfinished detail export: %v", err)
		}
	}
	data, err = s.AdminPaymentReconciliationsCSV(context.Background(), admin, PaymentReconciliationQuery{Status: "failed"})
	if err != nil {
		t.Fatal(err)
	}
	rows = readPaymentTestCSV(t, data)
	if len(rows) != 2 || rows[1][8] != "BILL_ERROR" {
		t.Fatal("failed run lost its error")
	}
}

func TestPaymentExportRejectsTruncation(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.PaymentOrder{}); err != nil {
		t.Fatal(err)
	}
	s := &Service{repo: repository.New(db)}
	admin := &model.User{Role: model.UserRoleAdmin}
	orders := make([]model.PaymentOrder, paymentExportLimit)
	for i := range orders {
		id := fmt.Sprintf("order-%05d", i)
		orders[i] = model.PaymentOrder{ID: id, UserID: "missing", IdempotencyKey: id, MerchantOrderNo: id}
	}
	if err := db.CreateInBatches(orders, 100).Error; err != nil {
		t.Fatal(err)
	}
	data, err := s.AdminPaymentOrdersCSV(context.Background(), admin, PaymentOrderQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if rows := readPaymentTestCSV(t, data); len(rows) != paymentExportLimit+1 {
		t.Fatalf("truncated export: %d", len(rows))
	}
	if err := db.Create(&model.PaymentOrder{ID: "overflow", UserID: "missing", IdempotencyKey: "overflow", MerchantOrderNo: "overflow"}).Error; err != nil {
		t.Fatal(err)
	}
	data, err = s.AdminPaymentOrdersCSV(context.Background(), admin, PaymentOrderQuery{})
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Status != 400 || len(data) != 0 {
		t.Fatalf("oversize returned file: bytes=%d err=%v", len(data), err)
	}
	data, err = s.AdminPaymentOrdersCSV(context.Background(), admin, PaymentOrderQuery{Keyword: "no-such-order"})
	if err != nil {
		t.Fatal(err)
	}
	if rows := readPaymentTestCSV(t, data); len(rows) != 1 {
		t.Fatalf("empty export: %d", len(rows))
	}
}

func readPaymentTestCSV(t *testing.T, data []byte) [][]string {
	t.Helper()
	rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(string(data), "\xEF\xBB\xBF"))).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	return rows
}
