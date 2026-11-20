package repository

import (
	"errors"
	"sync"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func newTeamWalletTestRepo(t *testing.T) (*Repository, *gorm.DB) {
	t.Helper()
	db := newBillingTerminalDB(t, "sqlite")
	if err := db.AutoMigrate(&model.User{}, &model.Team{}, &model.TeamMembership{}, &model.CreditTransfer{}); err != nil {
		t.Fatal(err)
	}
	for _, value := range []any{
		&model.User{ID: "owner", Username: "owner", Status: model.UserStatusActive},
		&model.User{ID: "member", Username: "member", Status: model.UserStatusActive},
		&model.Team{ID: "team", Name: "团队", OwnerUserID: "owner", Status: model.TeamActive},
		&model.TeamMembership{ID: "owner-member", TeamID: "team", UserID: "owner", Role: model.TeamOwner, Status: model.TeamActive},
		&model.TeamMembership{ID: "member-1", TeamID: "team", UserID: "member", Role: model.TeamMember, Status: model.TeamActive},
		&model.CreditAccount{UserID: "owner", AvailableMicrocredits: 2000},
		&model.CreditAccount{UserID: "member", AvailableMicrocredits: 500},
	} {
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}
	repo := New(db)
	if err := repo.OpenTeamWallets("team", "owner-member", true); err != nil {
		t.Fatal(err)
	}
	if err := repo.OpenTeamWallets("team", "member-1", false); err != nil {
		t.Fatal(err)
	}
	return repo, db
}

func requireTeamBalance(t *testing.T, repo *Repository, id string, available, reserved int64) {
	t.Helper()
	account, err := repo.CreditAccountByID(id)
	if err != nil || account.AvailableMicrocredits != available || account.ReservedMicrocredits != reserved {
		t.Fatalf("account %s=%+v, want available=%d reserved=%d: %v", id, account, available, reserved, err)
	}
}

func TestTeamCreditOverviewKeepsHoldsSeparateAndFailsOnMissingTeamAccount(t *testing.T) {
	repo, db := newTeamWalletTestRepo(t)
	if err := db.Model(&model.CreditAccount{}).Where("id = ?", model.TeamMemberCreditAccountID("member-1")).Updates(map[string]any{"available_microcredits": 22, "reserved_microcredits": 31}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CreditAccount{}).Where("id = ?", model.TeamPoolCreditAccountID("team")).Update("available_microcredits", 85).Error; err != nil {
		t.Fatal(err)
	}
	result, err := repo.MySpaceCredits("member")
	if err != nil || len(result.Spaces) != 1 {
		t.Fatalf("overview: %+v, %v", result, err)
	}
	row := result.Spaces[0]
	if result.Personal.AvailableMicrocredits != 500 || row.AvailableMicrocredits != 22 || row.ReservedMicrocredits != 31 || row.PoolAvailableMicrocredits != 85 {
		t.Fatalf("mixed scopes: %+v", result)
	}
	if err := db.Delete(&model.CreditAccount{}, "id = ?", model.TeamPoolCreditAccountID("team")).Error; err != nil {
		t.Fatal(err)
	}
	if result, err = repo.MySpaceCredits("member"); result != nil || err == nil {
		t.Fatalf("missing pool shown as a real zero: %+v, %v", result, err)
	}
}

func TestTeamWalletTransfersAreAtomicAndIdempotent(t *testing.T) {
	repo, db := newTeamWalletTestRepo(t)
	for _, step := range []struct {
		operation, member string
		amount            int64
	}{{"fund", "", 1000}, {"allocate", "member-1", 700}, {"reclaim", "member-1", 200}, {"withdraw", "", 400}} {
		if _, err := repo.TransferTeamCredits("owner", "team", step.member, step.operation, step.amount, step.operation); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := repo.TransferTeamCredits("owner", "team", "member-1", "allocate", 700, "allocate"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.TransferTeamCredits("owner", "team", "member-1", "allocate", 701, "allocate"); !errors.Is(err, ErrTeamWalletConflict) {
		t.Fatalf("conflicting replay: %v", err)
	}
	if _, err := repo.TransferTeamCredits("member", "team", "", "fund", 1, "forbidden"); !errors.Is(err, ErrTeamWalletForbidden) {
		t.Fatalf("ordinary member transfer: %v", err)
	}
	if _, err := repo.TransferTeamCredits("owner", "team", "another-team-member", "allocate", 1, "cross-team"); !errors.Is(err, ErrTeamWalletForbidden) {
		t.Fatalf("cross-team allocation: %v", err)
	}
	requireTeamBalance(t, repo, model.PersonalCreditAccountID("owner"), 1400, 0)
	requireTeamBalance(t, repo, model.PersonalCreditAccountID("member"), 500, 0)
	requireTeamBalance(t, repo, model.TeamPoolCreditAccountID("team"), 100, 0)
	requireTeamBalance(t, repo, model.TeamMemberCreditAccountID("member-1"), 500, 0)
	var transfers int64
	if err := db.Model(&model.CreditTransfer{}).Count(&transfers).Error; err != nil || transfers != 4 {
		t.Fatalf("transfers=%d err=%v", transfers, err)
	}
	var legs []model.CreditLedgerEntry
	if err := db.Find(&legs).Error; err != nil || len(legs) != 8 {
		t.Fatalf("ledger count=%d err=%v", len(legs), err)
	}
	var sum int64
	for _, leg := range legs {
		if leg.AccountID == "" || leg.TransferID == "" || leg.TeamID != "team" {
			t.Fatalf("missing audit identity: %+v", leg)
		}
		sum += leg.AvailableDeltaMicrocredits
	}
	if sum != 0 {
		t.Fatalf("transfers created or lost credits: %d", sum)
	}
	personal, total, err := repo.CreditLedger("member", "", 20, 0)
	if err != nil || total != 0 || len(personal) != 0 {
		t.Fatalf("team ledger leaked into personal history: %+v %d %v", personal, total, err)
	}
	if err := db.AutoMigrate(&model.PaymentOrder{}); err != nil {
		t.Fatal(err)
	}
	for tab, want := range map[string]int64{"income": 400, "expenses": -1000} {
		page, total, err := repo.WalletHistory("owner", tab, 20, 0)
		if err != nil || total != 1 || len(page) != 1 || page[0].Type != string(model.CreditLedgerTeamTransfer) || page[0].AmountMicrocredits != want {
			t.Fatalf("personal %s must show only its own transfer leg: %v, total=%d err=%v", tab, page, total, err)
		}
	}
}

func TestTeamWalletConcurrentAllocationCannotOverspend(t *testing.T) {
	repo, _ := newTeamWalletTestRepo(t)
	if _, err := repo.TransferTeamCredits("owner", "team", "", "fund", 1000, "fund"); err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, key := range []string{"a", "b"} {
		wg.Add(1)
		go func(key string) {
			defer wg.Done()
			<-start
			_, err := repo.TransferTeamCredits("owner", "team", "member-1", "allocate", 800, key)
			results <- err
		}(key)
	}
	close(start)
	wg.Wait()
	close(results)
	succeeded, insufficient := 0, 0
	for err := range results {
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, ErrInsufficientCredits):
			insufficient++
		default:
			t.Fatalf("allocation failed unexpectedly: %v", err)
		}
	}
	if succeeded != 1 || insufficient != 1 {
		t.Fatalf("succeeded=%d insufficient=%d", succeeded, insufficient)
	}
	requireTeamBalance(t, repo, model.TeamPoolCreditAccountID("team"), 200, 0)
	requireTeamBalance(t, repo, model.TeamMemberCreditAccountID("member-1"), 800, 0)
}

func seedTeamBillingOrder(t *testing.T, repo *Repository, amount int64) *model.BillingOrder {
	t.Helper()
	if _, err := repo.TransferTeamCredits("owner", "team", "", "fund", 1000, "fund"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.TransferTeamCredits("owner", "team", "member-1", "allocate", 800, "allocate"); err != nil {
		t.Fatal(err)
	}
	order := &model.BillingOrder{ID: "team-bill", UserID: "member", TeamID: "team", MembershipID: "member-1", BillingAccountID: model.TeamMemberCreditAccountID("member-1"), IdempotencyKey: "team-bill", Capability: "text", Scene: "team_text", BillingMode: "token", AmountMicrocredits: amount, ChargeLimitSet: true, ChargeLimitMicrocredits: amount, OutputTokenPriceMicrocredits: 1_000_000, MultiplierBasisPoints: 10_000, Status: model.BillingStatusReserved}
	if err := repo.ReserveBillingOrder(order); err != nil {
		t.Fatal(err)
	}
	return order
}

func TestTeamWalletBillingNeverChargesPersonalOrBeyondCap(t *testing.T) {
	repo, db := newTeamWalletTestRepo(t)
	order := seedTeamBillingOrder(t, repo, 100)
	if err := db.Create(&model.ApiCallLog{ID: "usage", UserID: "member", BillingOrderID: order.ID, RequestKind: "generate", Billable: true, Status: model.ApiCallStatusSucceeded, UsageAvailable: true, OutputTokens: 200}).Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.SettleBillingOrder(order.ID, "upstream"); err != nil {
		t.Fatal(err)
	}
	if err := repo.SettleBillingOrder(order.ID, "upstream"); err != nil {
		t.Fatal(err)
	}
	requireTeamBalance(t, repo, model.TeamMemberCreditAccountID("member-1"), 700, 0)
	requireTeamBalance(t, repo, model.PersonalCreditAccountID("member"), 500, 0)
	settled, err := repo.BillingOrder(order.ID)
	if err != nil || settled.ActualAmountMicrocredits != 100 || settled.UncappedAmountMicrocredits != 200 || settled.OutputTokens != 200 {
		t.Fatalf("capped order=%+v err=%v", settled, err)
	}
	var consume model.CreditLedgerEntry
	if err := db.First(&consume, "billing_order_id = ? AND type = ?", order.ID, model.CreditLedgerConsume).Error; err != nil {
		t.Fatal(err)
	}
	if consume.AccountID != order.BillingAccountID || consume.TeamID != "team" || consume.MembershipID != "member-1" {
		t.Fatalf("lost settlement identity: %+v", consume)
	}
	logs, err := repo.ApiCallLogs("member", false, 20)
	if err != nil || len(logs) != 0 {
		t.Fatalf("team calls leaked into personal logs: %+v %v", logs, err)
	}
}

func TestTeamWalletLeavingPreservesFreezeAndRefundReturnsToPool(t *testing.T) {
	repo, db := newTeamWalletTestRepo(t)
	order := seedTeamBillingOrder(t, repo, 200)
	if err := repo.Transaction(func(tx *Repository) error {
		if _, err := tx.LockTeam("team"); err != nil {
			return err
		}
		if err := tx.ReclaimDepartingTeamMember("team", "member-1", "owner"); err != nil {
			return err
		}
		return tx.db.Model(&model.TeamMembership{}).Where("id = ?", "member-1").Update("status", model.TeamLeft).Error
	}); err != nil {
		t.Fatal(err)
	}
	requireTeamBalance(t, repo, model.TeamMemberCreditAccountID("member-1"), 0, 200)
	requireTeamBalance(t, repo, model.TeamPoolCreditAccountID("team"), 800, 0)
	if err := db.Create(&model.TeamMembership{ID: "member-2", TeamID: "team", UserID: "member", Role: model.TeamMember, Status: model.TeamActive}).Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.OpenTeamWallets("team", "member-2", false); err != nil {
		t.Fatal(err)
	}
	if err := repo.RefundBillingOrder(order.ID, "upstream rejected"); err != nil {
		t.Fatal(err)
	}
	requireTeamBalance(t, repo, model.TeamMemberCreditAccountID("member-1"), 0, 0)
	requireTeamBalance(t, repo, model.TeamMemberCreditAccountID("member-2"), 0, 0)
	requireTeamBalance(t, repo, model.TeamPoolCreditAccountID("team"), 1000, 0)
	requireTeamBalance(t, repo, model.PersonalCreditAccountID("member"), 500, 0)
	if err := repo.RestoreRefundedBillingOrder(order.ID, "late-result"); err == nil {
		t.Fatal("refunded team order was charged again")
	}
}

func TestTeamWalletLateSettlementReturnsUnusedHoldToPool(t *testing.T) {
	repo, db := newTeamWalletTestRepo(t)
	order := seedTeamBillingOrder(t, repo, 200)
	if err := repo.Transaction(func(tx *Repository) error {
		if _, err := tx.LockTeam("team"); err != nil {
			return err
		}
		if err := tx.ReclaimDepartingTeamMember("team", "member-1", "owner"); err != nil {
			return err
		}
		return tx.db.Model(&model.TeamMembership{}).Where("id = ?", "member-1").Update("status", model.TeamLeft).Error
	}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ApiCallLog{ID: "late-usage", BillingOrderID: order.ID, RequestKind: "generate", Billable: true, Status: model.ApiCallStatusSucceeded, UsageAvailable: true, OutputTokens: 50}).Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.SettleBillingOrder(order.ID, "late-provider-result"); err != nil {
		t.Fatal(err)
	}
	requireTeamBalance(t, repo, model.TeamMemberCreditAccountID("member-1"), 0, 0)
	requireTeamBalance(t, repo, model.TeamPoolCreditAccountID("team"), 950, 0)
	requireTeamBalance(t, repo, model.PersonalCreditAccountID("member"), 500, 0)
}
