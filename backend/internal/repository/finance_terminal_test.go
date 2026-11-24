package repository

import (
	"context"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func newBillingTerminalDB(t *testing.T, driver string) *gorm.DB {
	t.Helper()
	config := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	var dialector gorm.Dialector = sqlite.Open(filepath.Join(t.TempDir(), "billing.db") + "?_journal_mode=WAL&_busy_timeout=5000")
	if driver == "postgres" {
		dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
		}
		admin, err := gorm.Open(postgres.Open(dsn), config)
		if err != nil {
			t.Fatal(err)
		}
		conn, err := admin.DB()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = conn.Close() })
		schema := "billing_terminal_" + newRepositoryID()
		if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
				t.Error(err)
			}
		})
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatal(err)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		dialector = postgres.Open(parsed.String())
	}
	db, err := gorm.Open(dialector, config)
	if err != nil {
		t.Fatal(err)
	}
	conn, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	conn.SetMaxOpenConns(16)
	t.Cleanup(func() { _ = conn.Close() })
	if err := db.AutoMigrate(&model.Task{}, &model.CreditAccount{}, &model.BillingOrder{}, &model.ApiCallLog{}, &model.CreditLedgerEntry{}, &model.TaskTextDelta{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func seedBillingTerminalOrder(t *testing.T, db *gorm.DB, id string, status model.BillingStatus, taskStatus model.TaskStatus) model.BillingOrder {
	t.Helper()
	old := time.Now().Add(-time.Hour)
	order := model.BillingOrder{ID: id, UserID: id, TaskID: id, IdempotencyKey: id, Status: status,
		BillingMode: "fixed", AmountMicrocredits: 100, ReservedAmountMicrocredits: 100, CreatedAt: old, UpdatedAt: old}
	// 其他订单的预留必须足够大，否则账户余额条件会掩盖重复退款缺陷。
	for _, value := range []any{
		&model.CreditAccount{UserID: id, AvailableMicrocredits: 1000, ReservedMicrocredits: 10000},
		&order,
		&model.Task{ID: id, UserID: id, BillingOrderID: id, Status: taskStatus},
	} {
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}
	return order
}

func TestAutoRefundBillingEligibility(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			db := newBillingTerminalDB(t, driver)
			repo := New(db)
			cases := []struct {
				name                   string
				status                 model.BillingStatus
				taskStatus             model.TaskStatus
				checkpoint, diagnostic string
				eligible               bool
			}{
				{"long-running", model.BillingStatusRunning, model.TaskStatusRunning, "", "", false},
				{"uncertain-running", model.BillingStatusUncertain, model.TaskStatusRunning, "", "", false},
				{"queued", model.BillingStatusUncertain, model.TaskStatusQueued, "", "", false},
				{"delivered", model.BillingStatusUncertain, model.TaskStatusSucceeded, "", "", false},
				{"text-replay", model.BillingStatusUncertain, model.TaskStatusTextReplay, "", "", false},
				{"unknown-task-state", model.BillingStatusUncertain, model.TaskStatus("unknown"), "", "", false},
				{"checkpoint", model.BillingStatusUncertain, model.TaskStatusFailed, "encrypted", "", false},
				{"persistence-failed", model.BillingStatusUncertain, model.TaskStatusFailed, "", `{"code":"result_persistence_failed"}`, false},
				{"failed", model.BillingStatusUncertain, model.TaskStatusFailed, "", "", true},
				{"cancelled-reserved", model.BillingStatusReserved, model.TaskStatusCancelled, "", "", true},
				{"stale-running", model.BillingStatusRunning, model.TaskStatusFailed, "", "", true},
				{"settled", model.BillingStatusSettled, model.TaskStatusFailed, "", "", false},
				{"refunded", model.BillingStatusRefunded, model.TaskStatusFailed, "", "", false},
			}
			for _, tc := range cases {
				t.Run(tc.name, func(t *testing.T) {
					order := seedBillingTerminalOrder(t, db, tc.name, tc.status, tc.taskStatus)
					if err := db.Model(&model.Task{}).Where("id = ?", order.TaskID).Updates(map[string]any{"media_recovery_json": tc.checkpoint, "execution_diagnostic_json": tc.diagnostic}).Error; err != nil {
						t.Fatal(err)
					}
					items, err := repo.AutoRefundableBillingOrders(100, nil)
					if err != nil {
						t.Fatal(err)
					}
					listed := false
					for _, item := range items {
						listed = listed || item.ID == order.ID
					}
					if listed != tc.eligible {
						t.Fatalf("listed=%v want %v", listed, tc.eligible)
					}
					changed, err := repo.AutoRefundBillingOrder(order.ID, "automatic review")
					if err != nil || changed != tc.eligible {
						t.Fatalf("refund=%v err=%v", changed, err)
					}
					changed, err = repo.AutoRefundBillingOrder(order.ID, "second review")
					if err != nil || changed {
						t.Fatalf("repeat refund=%v err=%v", changed, err)
					}
					var account model.CreditAccount
					if err := db.First(&account, "user_id = ?", order.UserID).Error; err != nil {
						t.Fatal(err)
					}
					wantAvailable, wantReserved := int64(1000), int64(10000)
					if tc.eligible {
						wantAvailable += 100
						wantReserved -= 100
					}
					if account.AvailableMicrocredits != wantAvailable || account.ReservedMicrocredits != wantReserved {
						t.Fatalf("account=%+v", account)
					}
					stored, err := repo.BillingOrder(order.ID)
					if err != nil {
						t.Fatal(err)
					}
					if tc.eligible && stored.ResolutionNote != "automatic review" {
						t.Fatalf("resolution=%q", stored.ResolutionNote)
					}
				})
			}
		})
	}
}

func TestAutoRefundBillingRechecksCandidate(t *testing.T) {
	db := newBillingTerminalDB(t, "sqlite")
	repo := New(db)
	for _, next := range []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning, model.TaskStatusSucceeded} {
		order := seedBillingTerminalOrder(t, db, string(next), model.BillingStatusUncertain, model.TaskStatusFailed)
		items, err := repo.AutoRefundableBillingOrders(100, nil)
		if err != nil || len(items) != 1 {
			t.Fatalf("candidates=%v err=%v", items, err)
		}
		if err := db.Model(&model.Task{}).Where("id = ?", order.TaskID).Update("status", next).Error; err != nil {
			t.Fatal(err)
		}
		changed, err := repo.AutoRefundBillingOrder(order.ID, "stale candidate")
		if err != nil || changed {
			t.Fatalf("status=%s refund=%v err=%v", next, changed, err)
		}
	}
}

func TestAutoRefundBillingWithoutTaskRequiresManualReview(t *testing.T) {
	db := newBillingTerminalDB(t, "sqlite")
	order := seedBillingTerminalOrder(t, db, "ecommerce", model.BillingStatusUncertain, model.TaskStatusFailed)
	if err := db.Delete(&model.Task{}, "id = ?", order.TaskID).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	items, err := repo.AutoRefundableBillingOrders(100, nil)
	if err != nil || len(items) != 0 {
		t.Fatalf("candidates=%v err=%v", items, err)
	}
	changed, err := repo.AutoRefundBillingOrder(order.ID, "automatic")
	if err != nil || changed {
		t.Fatalf("refund=%v err=%v", changed, err)
	}
	// 无通用任务的订单仍可通过既有人工核对路径退款。
	if err := repo.RefundBillingOrder(order.ID, "manual review"); err != nil {
		t.Fatal(err)
	}
}

func TestBillingTerminalConflictRollsBackAccount(t *testing.T) {
	for _, operation := range []string{"refund", "settle"} {
		t.Run(operation, func(t *testing.T) {
			db := newBillingTerminalDB(t, "sqlite")
			order := seedBillingTerminalOrder(t, db, "order", model.BillingStatusRunning, model.TaskStatusFailed)
			// 模拟最终状态写入没有命中，验证前面的账户更新必须整笔回滚。
			if err := db.Exec("CREATE TRIGGER ignore_billing_transition BEFORE UPDATE OF status ON billing_orders BEGIN SELECT RAISE(IGNORE); END").Error; err != nil {
				t.Fatal(err)
			}
			repo := New(db)
			var err error
			if operation == "refund" {
				err = repo.RefundBillingOrder(order.ID, "refund")
			} else {
				err = repo.SettleBillingOrder(order.ID, "provider")
			}
			if !errors.Is(err, ErrBillingStateConflict) {
				t.Fatalf("error=%v", err)
			}
			var account model.CreditAccount
			if err := db.First(&account, "user_id = ?", order.UserID).Error; err != nil {
				t.Fatal(err)
			}
			if account.AvailableMicrocredits != 1000 || account.ReservedMicrocredits != 10000 {
				t.Fatalf("account not rolled back: %+v", account)
			}
			var count int64
			if err := db.Model(&model.CreditLedgerEntry{}).Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("ledger count=%d err=%v", count, err)
			}
		})
	}
}

func TestAutoRefundBillingResolutionFailureRollsBack(t *testing.T) {
	db := newBillingTerminalDB(t, "sqlite")
	order := seedBillingTerminalOrder(t, db, "order", model.BillingStatusUncertain, model.TaskStatusFailed)
	if err := db.Exec("CREATE TRIGGER reject_resolution BEFORE UPDATE OF resolution_note ON billing_orders BEGIN SELECT RAISE(ABORT, 'resolution unavailable'); END").Error; err != nil {
		t.Fatal(err)
	}
	changed, err := New(db).AutoRefundBillingOrder(order.ID, "automatic")
	if err == nil || changed {
		t.Fatalf("refund=%v err=%v", changed, err)
	}
	stored, err := New(db).BillingOrder(order.ID)
	if err != nil || stored.Status != model.BillingStatusUncertain {
		t.Fatalf("order=%+v err=%v", stored, err)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", order.UserID).Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 1000 || account.ReservedMicrocredits != 10000 {
		t.Fatalf("account not rolled back: %+v", account)
	}
	var count int64
	if err := db.Model(&model.CreditLedgerEntry{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("ledger count=%d err=%v", count, err)
	}
}

func TestRetryTaskRejectsBeforeNewReservation(t *testing.T) {
	db := newBillingTerminalDB(t, "sqlite")
	original := seedBillingTerminalOrder(t, db, "order", model.BillingStatusRunning, model.TaskStatusRunning)
	next := model.BillingOrder{ID: "retry", UserID: original.UserID, TaskID: original.TaskID, IdempotencyKey: "retry", Status: model.BillingStatusReserved, AmountMicrocredits: 100}
	_, err := New(db).RetryTaskWithBilling(original.UserID, &model.Task{ID: original.TaskID}, &next, 100)
	if !errors.Is(err, ErrTaskNotRetryable) {
		t.Fatalf("error=%v", err)
	}
	var count int64
	if err := db.Model(&model.BillingOrder{}).Where("id = ?", next.ID).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("retry order count=%d err=%v", count, err)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", original.UserID).Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 1000 || account.ReservedMicrocredits != 10000 {
		t.Fatalf("account changed: %+v", account)
	}
}

func TestBillingTerminalConcurrencyPostgres(t *testing.T) {
	db := newBillingTerminalDB(t, "postgres")
	for _, mode := range []string{"refund", "settle", "mixed", "automatic", "restore"} {
		t.Run(mode, func(t *testing.T) {
			status := model.BillingStatusUncertain
			if mode == "restore" {
				status = model.BillingStatusRefunded
			}
			order := seedBillingTerminalOrder(t, db, mode, status, model.TaskStatusFailed)
			ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
			defer cancel()
			start := make(chan struct{})
			errs := make(chan error, 12)
			var workers sync.WaitGroup
			for i := range 12 {
				workers.Add(1)
				go func(i int) {
					defer workers.Done()
					<-start
					repo := New(db.WithContext(ctx))
					var err error
					switch {
					case mode == "restore":
						err = repo.RestoreRefundedBillingOrder(order.ID, "provider")
					case mode == "automatic":
						_, err = repo.AutoRefundBillingOrder(order.ID, "automatic")
					case mode == "settle" || (mode == "mixed" && i%2 == 0):
						err = repo.SettleBillingOrder(order.ID, "provider")
					default:
						err = repo.RefundBillingOrder(order.ID, "refund")
					}
					errs <- err
				}(i)
			}
			close(start)
			workers.Wait()
			close(errs)
			for err := range errs {
				if err == nil {
					continue
				}
				if mode == "mixed" && (err.Error() == "billing order already refunded" || err.Error() == "settled billing order requires a manual refund") {
					continue
				}
				t.Error(err)
			}
			var account model.CreditAccount
			if err := db.First(&account, "user_id = ?", order.UserID).Error; err != nil {
				t.Fatal(err)
			}
			stored, err := New(db).BillingOrder(order.ID)
			if err != nil {
				t.Fatal(err)
			}
			wantAvailable, wantReserved := int64(1000), int64(9900)
			if stored.Status == model.BillingStatusRefunded {
				wantAvailable += 100
			} else if stored.Status != model.BillingStatusSettled {
				t.Fatalf("status=%s", stored.Status)
			}
			if mode == "restore" {
				wantAvailable, wantReserved = 900, 10000
			}
			if account.AvailableMicrocredits != wantAvailable || account.ReservedMicrocredits != wantReserved {
				t.Fatalf("account=%+v", account)
			}
			var count int64
			if err := db.Model(&model.CreditLedgerEntry{}).Where("billing_order_id = ?", order.ID).Count(&count).Error; err != nil || count != 1 {
				t.Fatalf("ledger count=%d err=%v", count, err)
			}
		})
	}
}

func TestRetryTaskAndAutoRefundConcurrencyPostgres(t *testing.T) {
	db := newBillingTerminalDB(t, "postgres")
	order := seedBillingTerminalOrder(t, db, "retry-race", model.BillingStatusRunning, model.TaskStatusFailed)
	if err := db.Model(&model.Task{}).Where("id = ?", order.TaskID).Update("execution_diagnostic_json", `{"submissionOutcome":"not_submitted"}`).Error; err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	start := make(chan struct{})
	retried := make(chan error, 1)
	refunded := make(chan bool, 1)
	refundErrors := make(chan error, 1)
	next := model.BillingOrder{ID: "retry", UserID: order.UserID, TaskID: order.TaskID, IdempotencyKey: "retry", Status: model.BillingStatusReserved, AmountMicrocredits: 100}
	go func() {
		<-start
		_, err := New(db.WithContext(ctx)).RetryTaskWithBilling(order.UserID, &model.Task{ID: order.TaskID}, &next, 100, func(_ *Repository, task *model.Task, previous *model.BillingOrder) error {
			if task.ExecutionDiagnosticJSON != `{"submissionOutcome":"not_submitted"}` || previous.ID != order.ID {
				return ErrTaskBillingReview
			}
			return nil
		})
		retried <- err
	}()
	go func() {
		<-start
		changed, err := New(db.WithContext(ctx)).AutoRefundBillingOrder(order.ID, "automatic")
		refunded <- changed
		refundErrors <- err
	}()
	close(start)
	retryErr, _, refundErr := <-retried, <-refunded, <-refundErrors
	if retryErr != nil || refundErr != nil {
		t.Fatalf("retry error=%v refund error=%v", retryErr, refundErr)
	}
	var task model.Task
	if err := db.First(&task, "id = ?", order.TaskID).Error; err != nil {
		t.Fatal(err)
	}
	if task.Status != model.TaskStatusQueued || task.BillingOrderID != next.ID {
		t.Fatalf("task status=%s billing order=%s", task.Status, task.BillingOrderID)
	}
	// 无论扫描还是重试先取得任务锁，旧预留都必须只释放一次。
	wantStatus := model.BillingStatusRefunded
	wantAvailable, wantReserved, wantEntries := int64(1000), int64(10000), int64(2)
	stored, err := New(db).BillingOrder(order.ID)
	if err != nil || stored.Status != wantStatus {
		t.Fatalf("old order=%+v err=%v", stored, err)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", order.UserID).Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != wantAvailable || account.ReservedMicrocredits != wantReserved {
		t.Fatalf("account=%+v", account)
	}
	var count int64
	if err := db.Model(&model.CreditLedgerEntry{}).Where("user_id = ?", order.UserID).Count(&count).Error; err != nil || count != wantEntries {
		t.Fatalf("ledger count=%d want=%d err=%v", count, wantEntries, err)
	}
}

func TestAutoRefundBillingCursorAdvancesWithIdenticalTimestamps(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			db := newBillingTerminalDB(t, driver)
			created := time.Now().Add(-time.Hour).Truncate(time.Second)
			for _, id := range []string{"a", "b", "c"} {
				order := seedBillingTerminalOrder(t, db, id, model.BillingStatusUncertain, model.TaskStatusFailed)
				if err := db.Model(&model.BillingOrder{}).Where("id = ?", order.ID).Update("created_at", created).Error; err != nil {
					t.Fatal(err)
				}
			}
			repo := New(db)
			first, err := repo.AutoRefundableBillingOrders(2, nil)
			if err != nil || len(first) != 2 || first[0].ID != "c" || first[1].ID != "b" {
				t.Fatalf("first page=%+v err=%v", first, err)
			}
			second, err := repo.AutoRefundableBillingOrders(2, &first[1])
			if err != nil || len(second) != 1 || second[0].ID != "a" {
				t.Fatalf("second page=%+v err=%v", second, err)
			}
		})
	}
}

func TestRetryTaskRejectsUncertainOrderUnderLock(t *testing.T) {
	db := newBillingTerminalDB(t, "sqlite")
	order := seedBillingTerminalOrder(t, db, "uncertain-retry", model.BillingStatusUncertain, model.TaskStatusFailed)
	called := false
	_, err := New(db).RetryTaskWithBilling(order.UserID, &model.Task{ID: order.TaskID}, nil, 100, func(*Repository, *model.Task, *model.BillingOrder) error {
		called = true
		return nil
	})
	if !errors.Is(err, ErrTaskBillingReview) || called {
		t.Fatalf("error=%v authorization called=%v", err, called)
	}
	task, err := New(db).Task(order.TaskID)
	if err != nil || task.Status != model.TaskStatusFailed || task.BillingOrderID != order.ID {
		t.Fatalf("task=%+v err=%v", task, err)
	}
}
