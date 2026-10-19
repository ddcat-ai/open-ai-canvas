package repository

import (
	"errors"
	"testing"

	"yingce/backend/internal/model"
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

func TestDirectModelReplacementUpdatesIdentityAtomicallyWithinAuthorization(t *testing.T) {
	for _, logical := range []bool{false, true} {
		repo, db := newRefundedBillingRecoveryRepository(t)
		if err := db.AutoMigrate(&model.Task{}); err != nil {
			t.Fatal(err)
		}
		task := model.Task{ID: "generation", UserID: "user", Status: model.TaskStatusRunning, RouteID: "original", Model: "original-model", BillingOrderID: "order"}
		if logical {
			task.LogicalModelID = "public-product"
		}
		order := model.BillingOrder{ID: "order", TaskID: task.ID, UserID: task.UserID, Model: task.Model, Status: model.BillingStatusRunning, BillingMode: "fixed_request", AmountMicrocredits: 100, ReservedAmountMicrocredits: 100, ChargeLimitSet: true, ChargeLimitMicrocredits: 100}
		for _, item := range []any{&task, &order, &model.CreditAccount{UserID: "user", AvailableMicrocredits: 1000, ReservedMicrocredits: 100}} {
			if err := db.Create(item).Error; err != nil {
				t.Fatal(err)
			}
		}
		replacement := order
		replacement.AmountMicrocredits = 101
		err := repo.SwitchTaskLogicalRoute(task.ID, "original", "backup", "{}", order.ID, "backup-channel", "backup-model-id", &replacement, model.BillingCostSnapshot{}, "backup-model")
		if logical && !errors.Is(err, ErrTaskStateConflict) || !logical && !errors.Is(err, ErrBillingChargeLimit) {
			t.Fatalf("unsafe replacement allowed: logical=%v err=%v", logical, err)
		}
		stored, _ := repo.Task(task.ID)
		storedOrder, _ := repo.BillingOrder(order.ID)
		if stored.Model != task.Model || stored.RouteID != task.RouteID || storedOrder.Model != order.Model {
			t.Fatalf("rejected replacement changed identity: %+v %+v", stored, storedOrder)
		}
		if logical {
			continue
		}
		replacement.AmountMicrocredits = 90
		if err := repo.SwitchTaskLogicalRoute(task.ID, "original", "backup", "{}", order.ID, "backup-channel", "backup-model-id", &replacement, model.BillingCostSnapshot{}, "backup-model"); err != nil {
			t.Fatal(err)
		}
		stored, _ = repo.Task(task.ID)
		storedOrder, _ = repo.BillingOrder(order.ID)
		if stored.Model != "backup-model" || storedOrder.Model != stored.Model || storedOrder.ChargeLimitMicrocredits != 100 {
			t.Fatalf("actual model or approved cap not preserved: %+v %+v", stored, storedOrder)
		}
		var entry model.CreditLedgerEntry
		if err := db.First(&entry, "billing_order_id = ?", order.ID).Error; err != nil || entry.Model != "backup-model" {
			t.Fatalf("price adjustment ledger used stale model: %+v %v", entry, err)
		}
	}
}
