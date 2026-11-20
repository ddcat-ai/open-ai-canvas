package app

import (
	"context"
	"fmt"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

func TestBillingAutoRefundDefaultsDisabled(t *testing.T) {
	svc := newResourceTestService(t)
	setting, err := svc.billingAutoRefundSetting(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if setting.Enabled {
		t.Fatal("自动退回默认必须关闭")
	}
	// 关闭时在读取订单之前就返回；测试库未迁移 billing_orders，若误查询会记录告警但仍返回 0。
	if refunded := svc.autoRefundReviewBilling(t.Context()); refunded != 0 {
		t.Fatalf("关闭时不应退回订单，实际退回 %d", refunded)
	}
}

func TestBillingAutoRefundWorkerKeepsLiveTasksAndCountsChanges(t *testing.T) {
	db := newSQLiteTestDB(t)
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.Task{}, &model.BillingOrder{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	if err := db.Create(&model.SystemSetting{Key: billingAutoRefundSettingKey, ValueJSON: `{"enabled":true}`}).Error; err != nil {
		t.Fatal(err)
	}
	for _, status := range []model.TaskStatus{model.TaskStatusRunning, model.TaskStatusFailed} {
		id := string(status)
		for _, value := range []any{
			&model.Task{ID: id, UserID: id, Status: status, BillingOrderID: id},
			&model.CreditAccount{UserID: id, ReservedMicrocredits: 100},
			&model.BillingOrder{ID: id, UserID: id, TaskID: id, IdempotencyKey: id, Status: model.BillingStatusRunning, AmountMicrocredits: 100, UpdatedAt: time.Now().Add(-time.Hour)},
		} {
			if err := db.Create(value).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	if got := svc.autoRefundReviewBilling(t.Context()); got != 1 {
		t.Fatalf("refunded=%d want 1", got)
	}
	if got := svc.autoRefundReviewBilling(t.Context()); got != 0 {
		t.Fatalf("repeat refunded=%d want 0", got)
	}
	live, err := svc.repo.BillingOrder(string(model.TaskStatusRunning))
	if err != nil || live.Status != model.BillingStatusRunning {
		t.Fatalf("live order=%+v err=%v", live, err)
	}
	refunded, err := svc.repo.BillingOrder(string(model.TaskStatusFailed))
	if err != nil || refunded.Status != model.BillingStatusRefunded || refunded.ResolutionNote != billingAutoRefundNote {
		t.Fatalf("refunded order=%+v err=%v", refunded, err)
	}
}

func TestBillingAutoRefundRequiresAdmin(t *testing.T) {
	svc := newResourceTestService(t)
	if _, err := svc.UpdateBillingAutoRefundSetting(&model.User{ID: "user-1", Role: model.UserRoleUser}, BillingAutoRefundSetting{Enabled: true}); err == nil {
		t.Fatal("非管理员不能修改自动退回")
	}
	setting, err := svc.billingAutoRefundSetting(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if setting.Enabled {
		t.Fatal("被拒绝的请求不能写入开关")
	}
}

func TestBillingAutoRefundScanAdvancesPastFailuresAndBacksOff(t *testing.T) {
	db := newSQLiteTestDB(t)
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.Task{}, &model.BillingOrder{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: billingAutoRefundSettingKey, ValueJSON: `{"enabled":true}`}).Error; err != nil {
		t.Fatal(err)
	}
	// 相同时间戳覆盖稳定 ID 排序；第一页全部失败，最后一个订单必须仍可被扫描到。
	created := time.Now().Add(-time.Hour)
	for i := 0; i <= billingAutoRefundBatch; i++ {
		id := fmt.Sprintf("order-%03d", i)
		reserved := int64(0)
		if i == 0 {
			reserved = 100
		}
		for _, value := range []any{
			&model.Task{ID: id, UserID: id, Status: model.TaskStatusFailed},
			&model.CreditAccount{UserID: id, ReservedMicrocredits: reserved},
			&model.BillingOrder{ID: id, UserID: id, TaskID: id, IdempotencyKey: id, Status: model.BillingStatusUncertain, AmountMicrocredits: 100, CreatedAt: created},
		} {
			if err := db.Create(value).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	attempts := 0
	if err := db.Callback().Update().Before("gorm:update").Register("test:refund_attempts", func(tx *gorm.DB) {
		if tx.Statement.Table == "credit_accounts" {
			attempts++
		}
	}); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	if got := svc.autoRefundReviewBilling(t.Context()); got != 0 || attempts != billingAutoRefundBatch {
		t.Fatalf("first page refunded=%d attempts=%d", got, attempts)
	}
	if got := svc.autoRefundReviewBilling(t.Context()); got != 1 || attempts != billingAutoRefundBatch+1 {
		t.Fatalf("second page refunded=%d attempts=%d", got, attempts)
	}
	if svc.billingAutoRefund.cursor != nil {
		t.Fatal("completed scan must wrap to newest orders")
	}
	if got := svc.autoRefundReviewBilling(t.Context()); got != 0 || attempts != billingAutoRefundBatch+1 {
		t.Fatalf("cooling page refunded=%d attempts=%d", got, attempts)
	}
	// 冷却到期后允许重试，而非永久跳过；顺便验证最末页为空时复位。
	for id, failure := range svc.billingAutoRefund.failures {
		failure.retryAt = time.Now().Add(-time.Second)
		svc.billingAutoRefund.failures[id] = failure
	}
	svc.autoRefundReviewBilling(t.Context())
	svc.autoRefundReviewBilling(t.Context())
	if attempts != 2*billingAutoRefundBatch+1 {
		t.Fatalf("retry attempts=%d", attempts)
	}
}

func TestBillingAutoRefundScanSkipsOverlappingRun(t *testing.T) {
	svc := &Service{}
	svc.billingAutoRefund.mu.Lock()
	defer svc.billingAutoRefund.mu.Unlock()
	// repo 故意留空：重叠调用必须在访问数据库前返回。
	if got := svc.autoRefundReviewBilling(t.Context()); got != 0 {
		t.Fatalf("overlapping run refunded=%d", got)
	}
}

func TestBillingAutoRefundBackoffIsBounded(t *testing.T) {
	var scan billingAutoRefundScan
	now := time.Now()
	for i := 0; i < 20; i++ {
		scan.recordFailure("persistent", now)
	}
	if got := scan.failures["persistent"].delay; got != time.Hour {
		t.Fatalf("maximum delay=%s", got)
	}
	for i := 0; i < billingAutoRefundBatch*20; i++ {
		scan.recordFailure(fmt.Sprint(i), now)
	}
	if len(scan.failures) != billingAutoRefundBatch*10 {
		t.Fatalf("failure entries=%d", len(scan.failures))
	}
}

func TestBillingAutoRefundCancelledScanDoesNotAdvance(t *testing.T) {
	db := newSQLiteTestDB(t)
	svc := &Service{repo: repository.New(db)}
	cursor := &repository.BillingAutoRefundCursor{CreatedAt: time.Now(), ID: "previous"}
	svc.billingAutoRefund.cursor = cursor
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if got := svc.autoRefundReviewBilling(ctx); got != 0 || svc.billingAutoRefund.cursor != cursor {
		t.Fatalf("cancelled scan refunded=%d cursor=%+v", got, svc.billingAutoRefund.cursor)
	}
}
