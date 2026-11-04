package repository

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
	"yingce/backend/internal/model"
)

func ecommerceAgentTestRepository(t *testing.T) *Repository {
	t.Helper()
	db, err := gorm.Open(sqlite.Dialector{DriverName: "sqlite", DSN: "file:" + t.Name() + "?mode=memory&cache=shared"}, &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.BillingOrder{}, &model.EcommerceProject{}, &model.EcommerceAgentRun{}, &model.EcommerceAgentPage{}, &model.EcommerceAgentCanvasVersion{}); err != nil {
		t.Fatal(err)
	}
	if err = db.Create(&model.CreditAccount{UserID: "owner", AvailableMicrocredits: 1_000_000}).Error; err != nil {
		t.Fatal(err)
	}
	return New(db)
}

func TestLatestEcommerceAgentRunByProjectIsOwnerScoped(t *testing.T) {
	repo := ecommerceAgentTestRepository(t)
	for _, run := range []model.EcommerceAgentRun{
		{ID: "older", UserID: "owner", ProjectID: "project", IdempotencyKey: "older", Status: "completed", CreatedAt: time.Now().Add(-time.Hour)},
		{ID: "latest", UserID: "owner", ProjectID: "project", IdempotencyKey: "latest", Status: "completed", CreatedAt: time.Now()},
		{ID: "other-project", UserID: "owner", ProjectID: "elsewhere", IdempotencyKey: "elsewhere", Status: "completed", CreatedAt: time.Now().Add(time.Hour)},
	} {
		if err := repo.db.Create(&run).Error; err != nil {
			t.Fatal(err)
		}
	}
	latest, err := repo.LatestEcommerceAgentRunByProject("owner", "project")
	if err != nil || latest.ID != "latest" {
		t.Fatalf("latest=%+v err=%v", latest, err)
	}
	if _, err := repo.LatestEcommerceAgentRunByProject("another-user", "project"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("cross-account project read: %v", err)
	}
}

func TestEcommerceAgentReservationPartialSettlementAndIdempotency(t *testing.T) {
	repo := ecommerceAgentTestRepository(t)
	run := &model.EcommerceAgentRun{ID: "run-1", UserID: "owner", IdempotencyKey: "same", ProjectID: "project-1", BillingOrderID: "order-1", Status: "running", Mode: "mock", PageCount: 10, UnitMicrocredits: 32_000}
	project := &model.EcommerceProject{ID: "project-1", UserID: "owner", Name: "商品", Status: "draft", DraftJSON: "{}", PlanJSON: "{}", Revision: 1}
	order := &model.BillingOrder{ID: "order-1", UserID: "owner", TaskID: run.ID, IdempotencyKey: "ecommerce:same", Scene: "ecommerce_agent", Model: "mock", Capability: "image", BillingMode: "fixed_request", UnitPriceMicrocredits: 32_000, Quantity: 10, AmountMicrocredits: 320_000, ReservedAmountMicrocredits: 320_000, Status: model.BillingStatusReserved}
	if err := repo.CreateEcommerceAgentRun(run, project, order); err != nil {
		t.Fatal(err)
	}
	account, err := repo.CreditAccount("owner")
	if err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 680_000 || account.ReservedMicrocredits != 320_000 {
		t.Fatalf("reservation=%+v", account)
	}
	for i := 1; i <= 3; i++ {
		if err := repo.SaveEcommerceAgentPage("owner", &model.EcommerceAgentPage{ID: fmt.Sprintf("page-%d", i), RunID: run.ID, Index: i, Status: "completed", URL: "data:image/svg+xml,..."}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := repo.FinishEcommerceAgentRun("owner", run.ID, "completed", ""); err != nil {
		t.Fatal(err)
	}
	account, err = repo.CreditAccount("owner")
	if err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 904_000 || account.ReservedMicrocredits != 0 {
		t.Fatalf("settled account=%+v", account)
	}
	settled, err := repo.BillingOrder(order.ID)
	if err != nil {
		t.Fatal(err)
	}
	if settled.Status != model.BillingStatusSettled || settled.ActualAmountMicrocredits != 96_000 || settled.RefundedAmountMicrocredits != 224_000 {
		t.Fatalf("settled order=%+v", settled)
	}
	if _, err := repo.FinishEcommerceAgentRun("owner", run.ID, "completed", ""); err != nil {
		t.Fatal(err)
	}
	account, _ = repo.CreditAccount("owner")
	if account.AvailableMicrocredits != 904_000 {
		t.Fatal("duplicate settlement changed balance")
	}
	duplicate := *run
	duplicate.ID = "run-2"
	duplicate.BillingOrderID = "order-2"
	if err := repo.CreateEcommerceAgentRun(&duplicate, nil, nil); err == nil {
		t.Fatal("duplicate idempotency key accepted")
	}
	account, _ = repo.CreditAccount("owner")
	if account.AvailableMicrocredits != 904_000 {
		t.Fatal("duplicate request changed balance")
	}
	if _, err := repo.EcommerceAgentRun("other", run.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("other user read run: %v", err)
	}
}

func TestEcommerceAgentZeroSuccessRefundsFullReservation(t *testing.T) {
	repo := ecommerceAgentTestRepository(t)
	run := &model.EcommerceAgentRun{ID: "run-3", UserID: "owner", IdempotencyKey: "zero", ProjectID: "project-3", BillingOrderID: "order-3", Status: "running", PageCount: 5, UnitMicrocredits: 32_000}
	project := &model.EcommerceProject{ID: "project-3", UserID: "owner", Name: "商品", Status: "draft", DraftJSON: "{}", PlanJSON: "{}", Revision: 1}
	order := &model.BillingOrder{ID: "order-3", UserID: "owner", TaskID: run.ID, IdempotencyKey: "ecommerce:zero", Scene: "ecommerce_agent", BillingMode: "fixed_request", AmountMicrocredits: 160_000, ReservedAmountMicrocredits: 160_000, Status: model.BillingStatusReserved}
	if err := repo.CreateEcommerceAgentRun(run, project, order); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.FinishEcommerceAgentRun("owner", run.ID, "cancelled", "CANCELLED"); err != nil {
		t.Fatal(err)
	}
	account, _ := repo.CreditAccount("owner")
	if account.AvailableMicrocredits != 1_000_000 || account.ReservedMicrocredits != 0 {
		t.Fatalf("refund account=%+v", account)
	}
	refunded, _ := repo.BillingOrder(order.ID)
	if refunded.Status != model.BillingStatusRefunded {
		t.Fatalf("order=%+v", refunded)
	}
}
