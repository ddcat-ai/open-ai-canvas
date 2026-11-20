package app

import (
	"errors"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// seedDramaBillingOrder 在 taskProjectID 下建一条带计费订单的已完成任务；taskProjectID 是作品 ID（流水线）或画布 ID（精修）。
func seedDramaBillingOrder(t *testing.T, db *gorm.DB, taskProjectID, name string, order model.BillingOrder) *model.Task {
	t.Helper()
	completed := time.Now()
	task := &model.Task{ID: "task-" + name, UserID: "usr-drama", ProjectID: taskProjectID, Type: "canvas_video", Status: model.TaskStatusSucceeded, BillingOrderID: "order-" + name, CompletedAt: &completed}
	order.ID, order.UserID, order.TaskID, order.IdempotencyKey = task.BillingOrderID, task.UserID, task.ID, "task:"+task.ID
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	return task
}

func TestDramaTaskCostFollowsBillingSettlement(t *testing.T) {
	svc, fake := newDramaTestService(t)
	run := &dramaRun{s: svc}
	recent, stale := time.Now(), time.Now().Add(-dramaBillingSettleGrace-time.Minute)
	for _, test := range []struct {
		name     string
		order    *model.BillingOrder
		finished time.Time
		want     int64
		pending  bool
	}{
		{name: "free", want: 0},
		{name: "settled", order: &model.BillingOrder{AmountMicrocredits: 1_000_000, ActualAmountMicrocredits: 600_000, RefundedAmountMicrocredits: 400_000, Status: model.BillingStatusSettled}, finished: recent, want: 600_000},
		{name: "refunded", order: &model.BillingOrder{AmountMicrocredits: 1_000_000, RefundedAmountMicrocredits: 1_000_000, Status: model.BillingStatusRefunded}, finished: recent, want: 0},
		{name: "running", order: &model.BillingOrder{AmountMicrocredits: 1_000_000, Status: model.BillingStatusRunning}, finished: recent, pending: true},
		{name: "reserved", order: &model.BillingOrder{AmountMicrocredits: 1_000_000, Status: model.BillingStatusReserved}, finished: recent, pending: true},
		// 待人工核对不会很快落到终态：按冻结额记，不让作业一直等。
		{name: "uncertain", order: &model.BillingOrder{AmountMicrocredits: 1_000_000, Status: model.BillingStatusUncertain}, finished: recent, want: 1_000_000},
		{name: "stuck", order: &model.BillingOrder{AmountMicrocredits: 1_000_000, Status: model.BillingStatusRunning}, finished: stale, want: 1_000_000},
	} {
		t.Run(test.name, func(t *testing.T) {
			task := &model.Task{ID: "task-" + test.name, UpdatedAt: test.finished}
			if test.order != nil {
				task = seedDramaBillingOrder(t, fake.db, "drama-cost", test.name, *test.order)
				task.CompletedAt = &test.finished
			}
			cost, err := run.taskCost(task)
			var pending *dramaPendingBilling
			if test.pending {
				if !errors.As(err, &pending) {
					t.Fatalf("unsettled order must defer the job: cost=%d err=%v", cost, err)
				}
				return
			}
			if err != nil || cost != test.want {
				t.Fatalf("taskCost = %d, %v; want %d", cost, err, test.want)
			}
		})
	}
	// 订单记录丢失按 0 记，不阻塞作业。
	if cost, err := run.taskCost(&model.Task{ID: "orphan", BillingOrderID: "missing"}); err != nil || cost != 0 {
		t.Fatalf("missing order = %d, %v", cost, err)
	}
}

// 作品花费按订单重算：历史 spent_microcredits 里的冻结额不再影响展示与预算，调度时回写为流水线实收。
func TestDramaSpendFollowsBillingOrders(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	if err := fake.db.Create(&model.CanvasProject{ID: "canvas-drama", UserID: "usr-drama", ProjectID: project, Title: "精修", PayloadJSON: `{"nodes":[],"connections":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	seedDramaBillingOrder(t, fake.db, project, "pipeline-settled", model.BillingOrder{AmountMicrocredits: 100, ActualAmountMicrocredits: 60, RefundedAmountMicrocredits: 40, Status: model.BillingStatusSettled})
	seedDramaBillingOrder(t, fake.db, project, "pipeline-refunded", model.BillingOrder{AmountMicrocredits: 70, RefundedAmountMicrocredits: 70, Status: model.BillingStatusRefunded})
	seedDramaBillingOrder(t, fake.db, project, "pipeline-uncertain", model.BillingOrder{AmountMicrocredits: 30, Status: model.BillingStatusUncertain})
	seedDramaBillingOrder(t, fake.db, "canvas-drama", "canvas-settled", model.BillingOrder{AmountMicrocredits: 50, ActualAmountMicrocredits: 20, RefundedAmountMicrocredits: 30, Status: model.BillingStatusSettled})
	seedDramaBillingOrder(t, fake.db, "canvas-drama", "canvas-running", model.BillingOrder{AmountMicrocredits: 15, Status: model.BillingStatusRunning})
	// 旧版本把冻结额累加进缓存列；budget 1000 足够，按缓存会误判超预算。
	if err := svc.repo.UpdateDramaProduction(project, map[string]any{"budget_microcredits": 1000, "spent_microcredits": 5000}); err != nil {
		t.Fatal(err)
	}
	summary, err := svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatal(err)
	}
	if got := summary.Production; got.SpentMicrocredits != 80 || got.CanvasSpentMicrocredits != 20 || got.HeldMicrocredits != 45 {
		t.Fatalf("summary spend = spent %d canvas %d held %d", got.SpentMicrocredits, got.CanvasSpentMicrocredits, got.HeldMicrocredits)
	}
	list, err := svc.ListDramas("usr-drama", DramaListRequest{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	items, _ := list["items"].([]DramaListItem)
	if len(items) != 1 || items[0].SpentMicrocredits != 80 || items[0].HeldMicrocredits != 45 {
		t.Fatalf("list spend = %+v", items)
	}
	if spent, err := svc.dramaCanvasSpent(mustDramaProduction(t, svc, project)); err != nil || spent != 35 {
		t.Fatalf("canvas budget usage = %d, %v; want charged 20 + held 15", spent, err)
	}
	runDramaTicks(t, svc, project, 1)
	p := mustDramaProduction(t, svc, project)
	if p.Status != model.DramaStatusRunning || len(fake.requests) == 0 {
		t.Fatalf("stale cached spend must not pause the drama: %+v requests=%d", p, len(fake.requests))
	}
	if p.SpentMicrocredits != 60 {
		t.Fatalf("dispatch must rewrite the cache with pipeline charges: %d", p.SpentMicrocredits)
	}
}

func mustDramaProduction(t *testing.T, svc *Service, project string) *model.DramaProduction {
	t.Helper()
	p, err := svc.repo.DramaProduction(project)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestDramaDirectTextTaskRespectsProjectBudget(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	if err := svc.repo.UpdateDramaProduction(project, map[string]any{"budget_microcredits": 100}); err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureTaskProjectActive("usr-drama", project); err != nil {
		t.Fatal(err)
	}
	seedDramaBillingOrder(t, fake.db, project, "prompt-rewrite-held", model.BillingOrder{AmountMicrocredits: 100, Status: model.BillingStatusRunning})
	var appErr *AppError
	if err := svc.ensureTaskProjectActive("usr-drama", project); !errors.As(err, &appErr) || appErr.Reason != ReasonDramaBudget {
		t.Fatalf("direct task must honor budget: %v", err)
	}
}
