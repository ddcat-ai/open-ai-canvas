package repository

import (
	"errors"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestAgentRouteReplacementCannotExpandApprovedCharge(t *testing.T) {
	repo, db := newRefundedBillingRecoveryRepository(t)
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: "generation-task", UserID: "user", AgentRunID: "run", GenerationID: "generation", Status: model.TaskStatusRunning, RouteID: "original", BillingOrderID: "order", AuthorizedChargeMicrocredits: 100}
	order := model.BillingOrder{ID: "order", TaskID: task.ID, UserID: task.UserID, Status: model.BillingStatusRunning, BillingMode: "per_second", AmountMicrocredits: 100, ReservedAmountMicrocredits: 100, ChargeLimitSet: true, ChargeLimitMicrocredits: 100}
	for _, item := range []any{&task, &order, &model.CreditAccount{UserID: "user", AvailableMicrocredits: 1000, ReservedMicrocredits: 100}} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	replacement := order
	replacement.AmountMicrocredits = 101
	if err := repo.SwitchTaskLogicalRoute(task.ID, "original", "expensive", "{}", order.ID, "channel", "model", &replacement, model.BillingCostSnapshot{}); !errors.Is(err, ErrBillingChargeLimit) {
		t.Fatalf("expensive fallback accepted: %v", err)
	}
	stored, err := repo.Task(task.ID)
	if err != nil || stored.RouteID != "original" {
		t.Fatalf("route not rolled back: %+v %v", stored, err)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user").Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 1000 || account.ReservedMicrocredits != 100 {
		t.Fatalf("credits changed: %+v", account)
	}
	replacement.AmountMicrocredits = 90
	if err := repo.SwitchTaskLogicalRoute(task.ID, "original", "cheaper", "{}", order.ID, "channel", "model", &replacement, model.BillingCostSnapshot{}); err != nil {
		t.Fatal(err)
	}
	if err := repo.SettleBillingOrder(order.ID, "provider"); err != nil {
		t.Fatal(err)
	}
	var settled model.BillingOrder
	if err := db.First(&settled, "id = ?", order.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !settled.ChargeLimitSet || settled.ChargeLimitMicrocredits != 100 || settled.ActualAmountMicrocredits != 90 {
		t.Fatalf("lost authorization: %+v", settled)
	}
}

func TestBillingSettlementRejectsFixedChargeBeyondAuthorization(t *testing.T) {
	for _, restored := range []bool{false, true} {
		repo, db := newRefundedBillingRecoveryRepository(t)
		status := model.BillingStatusRunning
		if restored {
			status = model.BillingStatusRefunded
		}
		order := model.BillingOrder{ID: "order", UserID: "user", Status: status, BillingMode: "fixed_request", AmountMicrocredits: 10, ChargeLimitSet: true, ChargeLimitMicrocredits: 0}
		if err := db.Create(&order).Error; err != nil {
			t.Fatal(err)
		}
		var err error
		if restored {
			err = repo.RestoreRefundedBillingOrder(order.ID, "")
		} else {
			err = repo.SettleBillingOrder(order.ID, "")
		}
		if !errors.Is(err, ErrBillingChargeLimit) {
			t.Fatalf("zero authorization treated as uncapped: %v", err)
		}
	}
}
