package repository

import (
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newDramaBillingRepository(t *testing.T) (*Repository, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CreditAccount{}, &model.BillingOrder{}, &model.ApiCallLog{}, &model.CreditLedgerEntry{}, &model.Task{}, &model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	return &Repository{db: db}, db
}

func seedDramaBillingTask(t *testing.T, db *gorm.DB, userID, projectID, taskID string, order model.BillingOrder) {
	t.Helper()
	order.ID, order.UserID, order.TaskID = "order-"+taskID, userID, taskID
	if order.IdempotencyKey == "" {
		order.IdempotencyKey = "task:" + taskID
	}
	if order.MultiplierBasisPoints == 0 {
		order.MultiplierBasisPoints = 10_000
	}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: taskID, UserID: userID, ProjectID: projectID, Type: "canvas_text", Status: model.TaskStatusRunning, BillingOrderID: order.ID, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
}

func dramaTotalsFor(t *testing.T, repo *Repository, userID string, projectIDs ...string) map[string]DramaBillingTotals {
	t.Helper()
	totals, err := repo.DramaBillingTotals(userID, projectIDs)
	if err != nil {
		t.Fatal(err)
	}
	return totals
}

// 作品花费按订单当前状态计：冻结 1.0 → Token 结算实收 0.6 → 只计 0.6；整笔退回计 0；未结算计冻结额。
func TestDramaBillingTotalsUseSettledActualAndSeparateHolds(t *testing.T) {
	repo, db := newDramaBillingRepository(t)
	const user, drama = "user-1", "drama-1"
	if err := db.Create(&model.CreditAccount{UserID: user, ReservedMicrocredits: 2_500_000}).Error; err != nil {
		t.Fatal(err)
	}
	seedDramaBillingTask(t, db, user, drama, "settle", model.BillingOrder{
		Capability: "text", BillingMode: "token", AmountMicrocredits: 1_000_000, ReservedAmountMicrocredits: 1_000_000,
		OutputTokenPriceMicrocredits: 1_000_000, Status: model.BillingStatusRunning,
	})
	if got := dramaTotalsFor(t, repo, user, drama)[drama]; got.ChargedMicrocredits() != 0 || got.HeldMicrocredits() != 1_000_000 {
		t.Fatalf("running order must be held, not charged: %+v", got)
	}
	if err := db.Create(&model.ApiCallLog{ID: "log-settle", BillingOrderID: "order-settle", Status: model.ApiCallStatusSucceeded, UsageAvailable: true, OutputTokens: 600_000}).Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.SettleBillingOrder("order-settle", ""); err != nil {
		t.Fatalf("SettleBillingOrder() error = %v", err)
	}
	if got := dramaTotalsFor(t, repo, user, drama)[drama]; got != (DramaBillingTotals{PipelineChargedMicrocredits: 600_000}) {
		t.Fatalf("settled order counts the actual amount after the difference refund: %+v", got)
	}

	seedDramaBillingTask(t, db, user, drama, "refund", model.BillingOrder{Capability: "image", BillingMode: "fixed_request", AmountMicrocredits: 500_000, ReservedAmountMicrocredits: 500_000, Status: model.BillingStatusReserved})
	if err := repo.RefundBillingOrder("order-refund", "上游失败"); err != nil {
		t.Fatalf("RefundBillingOrder() error = %v", err)
	}
	if got := dramaTotalsFor(t, repo, user, drama)[drama]; got != (DramaBillingTotals{PipelineChargedMicrocredits: 600_000}) {
		t.Fatalf("refunded order must not count: %+v", got)
	}

	seedDramaBillingTask(t, db, user, drama, "reserved", model.BillingOrder{Capability: "video", BillingMode: "per_second", AmountMicrocredits: 1_000_000, ReservedAmountMicrocredits: 1_000_000, Status: model.BillingStatusReserved})
	if got := dramaTotalsFor(t, repo, user, drama)[drama]; got.PipelineChargedMicrocredits != 600_000 || got.PipelineHeldMicrocredits != 1_000_000 {
		t.Fatalf("reserved order is held at the reservation amount: %+v", got)
	}
}

func TestDramaBillingTotalsGroupPipelineAndCanvasPerProject(t *testing.T) {
	repo, db := newDramaBillingRepository(t)
	const user = "user-1"
	for _, canvas := range []model.CanvasProject{
		{ID: "canvas-1", UserID: user, ProjectID: "drama-1", Title: "精修", PayloadJSON: "{}"},
		{ID: "canvas-other-user", UserID: "user-2", ProjectID: "drama-1", Title: "他人", PayloadJSON: "{}"},
	} {
		if err := db.Create(&canvas).Error; err != nil {
			t.Fatal(err)
		}
	}
	seedDramaBillingTask(t, db, user, "drama-1", "pipeline-settled", model.BillingOrder{AmountMicrocredits: 300_000, ActualAmountMicrocredits: 250_000, RefundedAmountMicrocredits: 50_000, Status: model.BillingStatusSettled})
	seedDramaBillingTask(t, db, user, "canvas-1", "canvas-settled", model.BillingOrder{AmountMicrocredits: 300_000, ActualAmountMicrocredits: 200_000, Status: model.BillingStatusSettled})
	seedDramaBillingTask(t, db, user, "canvas-1", "canvas-uncertain", model.BillingOrder{AmountMicrocredits: 100_000, Status: model.BillingStatusUncertain})
	seedDramaBillingTask(t, db, user, "drama-2", "second-drama", model.BillingOrder{AmountMicrocredits: 80_000, Status: model.BillingStatusRunning})
	// 其他用户的任务即使 project_id 相同也不计入。
	seedDramaBillingTask(t, db, "user-2", "drama-1", "other-user", model.BillingOrder{AmountMicrocredits: 999_000, ActualAmountMicrocredits: 999_000, Status: model.BillingStatusSettled})
	seedDramaBillingTask(t, db, "user-2", "canvas-other-user", "other-user-canvas", model.BillingOrder{AmountMicrocredits: 999_000, Status: model.BillingStatusReserved})

	totals := dramaTotalsFor(t, repo, user, "drama-1", "drama-2", "drama-empty")
	if got := totals["drama-1"]; got != (DramaBillingTotals{PipelineChargedMicrocredits: 250_000, CanvasChargedMicrocredits: 200_000, CanvasHeldMicrocredits: 100_000}) {
		t.Fatalf("drama-1 totals = %+v", got)
	}
	if got := totals["drama-1"]; got.ChargedMicrocredits() != 450_000 || got.HeldMicrocredits() != 100_000 {
		t.Fatalf("drama-1 sums = charged %d held %d", got.ChargedMicrocredits(), got.HeldMicrocredits())
	}
	if got := totals["drama-2"]; got != (DramaBillingTotals{PipelineHeldMicrocredits: 80_000}) {
		t.Fatalf("drama-2 totals = %+v", got)
	}
	if got, ok := totals["drama-empty"]; ok && got != (DramaBillingTotals{}) {
		t.Fatalf("project without orders = %+v", got)
	}
	if empty := dramaTotalsFor(t, repo, user); len(empty) != 0 {
		t.Fatalf("no project IDs must not query: %+v", empty)
	}
}
