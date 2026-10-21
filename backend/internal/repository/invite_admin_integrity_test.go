package repository

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"yingce/backend/internal/invite"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type inviteIntegritySnapshot struct {
	Account    model.RewardAccount
	Invite     model.InviteRecord
	Reward     model.InviteRewardRecord
	Withdrawal model.WithdrawRequest
	Policy     model.SystemSetting
}

func readInviteIntegritySnapshot(t *testing.T, db *gorm.DB) inviteIntegritySnapshot {
	t.Helper()
	var snapshot inviteIntegritySnapshot
	for _, target := range []any{&snapshot.Account, &snapshot.Invite, &snapshot.Reward, &snapshot.Withdrawal, &snapshot.Policy} {
		if err := db.First(target).Error; err != nil {
			t.Fatal(err)
		}
	}
	return snapshot
}

func TestInviteAdministrativeChangesAndAuditAreAtomic(t *testing.T) {
	operations := []struct {
		name string
		run  func(*Repository, model.AdminAuditEvent) error
	}{
		{name: "approve_invite", run: func(repo *Repository, audit model.AdminAuditEvent) error {
			_, err := repo.ApproveInviteRecord("invitee", audit)
			return err
		}},
		{name: "freeze_invite", run: func(repo *Repository, audit model.AdminAuditEvent) error {
			_, err := repo.FreezeInviteRecord("invitee", audit)
			return err
		}},
		{name: "delete_invite", run: func(repo *Repository, audit model.AdminAuditEvent) error {
			return repo.DeleteInviteRecord("invitee", audit)
		}},
		{name: "change_inviters", run: func(repo *Repository, audit model.AdminAuditEvent) error {
			_, err := repo.UpdateInviteInviters("invitee", "replacement", "", audit)
			return err
		}},
		{name: "disable_audit_policy", run: func(repo *Repository, audit model.AdminAuditEvent) error {
			policy := invite.DefaultInvitePolicy()
			policy.Enabled = true
			encoded, err := json.Marshal(policy)
			if err != nil {
				return err
			}
			return repo.UpdateInvitePolicy(&model.SystemSetting{Key: invite.SettingKey, ValueJSON: string(encoded)}, policy, audit)
		}},
		{name: "approve_withdrawal", run: func(repo *Repository, audit model.AdminAuditEvent) error {
			_, err := repo.ReviewWithdrawRequest("withdrawal", true, "admin", "", audit)
			return err
		}},
		{name: "reject_withdrawal", run: func(repo *Repository, audit model.AdminAuditEvent) error {
			_, err := repo.ReviewWithdrawRequest("withdrawal", false, "admin", "Invalid payment account", audit)
			return err
		}},
	}
	for _, operation := range operations {
		for _, auditFails := range []bool{false, true} {
			mode := "commit"
			if auditFails {
				mode = "audit_failure"
			}
			t.Run(operation.name+"/"+mode, func(t *testing.T) {
				db := openInviteTestDB(t)
				if err := db.AutoMigrate(&model.AdminAuditEvent{}); err != nil {
					t.Fatal(err)
				}
				createInviteUser(t, db, "inviter", "inviter", "AAAA2345")
				createInviteUser(t, db, "invitee", "invitee", "BBBB2345")
				createInviteUser(t, db, "replacement", "replacement", "CCCC2345")
				policy := invite.DefaultInvitePolicy()
				policy.Enabled = true
				policy.AuditEnabled = true
				encoded, err := json.Marshal(policy)
				if err != nil {
					t.Fatal(err)
				}
				for _, value := range []any{
					&model.SystemSetting{Key: invite.SettingKey, ValueJSON: string(encoded)},
					&model.InviteRecord{UserID: "invitee", L1InviterID: "inviter", Status: model.InviteRecordPending},
					&model.RewardAccount{UserID: "inviter", TotalMicroYuan: 2_000_000, FrozenMicroYuan: 2_000_000},
					&model.InviteRewardRecord{ID: "reward", InviterID: "inviter", InviteeID: "invitee", Level: 1,
						AmountMicroYuan: 1_000_000, Status: model.InviteRewardPending, ReferenceKey: "reward:fixture"},
					&model.WithdrawRequest{ID: "withdrawal", UserID: "inviter", AmountMicroYuan: 1_000_000,
						ActualMicroYuan: 1_000_000, Status: model.WithdrawStatusPending},
				} {
					if err := db.Create(value).Error; err != nil {
						t.Fatal(err)
					}
				}
				before := readInviteIntegritySnapshot(t, db)
				if auditFails {
					if err := db.Exec("CREATE TRIGGER reject_invite_audit BEFORE INSERT ON admin_audit_events BEGIN SELECT RAISE(ABORT, 'audit storage unavailable'); END").Error; err != nil {
						t.Fatal(err)
					}
				}
				audit := model.AdminAuditEvent{ID: "audit", ActorUserID: "admin", Action: operation.name,
					TargetType: "invite", TargetID: "invitee", CreatedAt: time.Now()}
				err = operation.run(New(db), audit)
				var auditCount int64
				if countErr := db.Model(&model.AdminAuditEvent{}).Count(&auditCount).Error; countErr != nil {
					t.Fatal(countErr)
				}
				if auditFails {
					if err == nil {
						t.Fatal("administrative change succeeded despite audit failure")
					}
					if after := readInviteIntegritySnapshot(t, db); !reflect.DeepEqual(before, after) {
						t.Fatalf("audit failure committed financial or relationship changes:\nbefore=%+v\nafter=%+v", before, after)
					}
					var replacementBalance int64
					if err := db.Model(&model.RewardAccount{}).Where("user_id = ?", "replacement").Count(&replacementBalance).Error; err != nil || replacementBalance != 0 {
						t.Fatalf("audit failure created recipient balance: count=%d err=%v", replacementBalance, err)
					}
					if auditCount != 0 {
						t.Fatalf("failed operation wrote %d audits", auditCount)
					}
				} else if err != nil || auditCount != 1 {
					t.Fatalf("administrative change and audit did not commit together: audits=%d err=%v", auditCount, err)
				}
			})
		}
	}
}

func TestInviteInviterChangesRejectCyclesAcrossBothLevels(t *testing.T) {
	cases := []struct {
		name       string
		l1         string
		l2         string
		ancestors  []model.InviteRecord
		wantStatus int
	}{
		{name: "self_l1", l1: "a", wantStatus: 400},
		{name: "self_l2", l2: "a", wantStatus: 400},
		{name: "duplicate_levels", l1: "b", l2: "b", wantStatus: 400},
		{name: "unknown_inviter", l1: "missing", wantStatus: 404},
		{name: "l1_backlink", l1: "b", ancestors: []model.InviteRecord{{UserID: "b", L1InviterID: "a"}}, wantStatus: 400},
		{name: "l2_backlink", l2: "b", ancestors: []model.InviteRecord{{UserID: "b", L2InviterID: "a"}}, wantStatus: 400},
		{name: "long_cycle", l1: "b", ancestors: []model.InviteRecord{
			{UserID: "b", L1InviterID: "c"}, {UserID: "c", L1InviterID: "d"}, {UserID: "d", L2InviterID: "a"},
		}, wantStatus: 400},
		{name: "shared_ancestor_is_not_cycle", l1: "b", l2: "d", ancestors: []model.InviteRecord{
			{UserID: "b", L1InviterID: "c", L2InviterID: "d"}, {UserID: "d", L1InviterID: "c"},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db := openInviteTestDB(t)
			for _, id := range []string{"a", "b", "c", "d"} {
				createInviteUser(t, db, id, id, "")
			}
			if err := db.Create(&model.InviteRecord{UserID: "a", Status: model.InviteRecordApproved}).Error; err != nil {
				t.Fatal(err)
			}
			for _, record := range tc.ancestors {
				if err := db.Create(&record).Error; err != nil {
					t.Fatal(err)
				}
			}
			repo := New(db)
			_, err := repo.UpdateInviteInviters("a", tc.l1, tc.l2)
			if tc.wantStatus == 0 {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			var appErr *kernel.AppError
			if !errors.As(err, &appErr) || appErr.Status != tc.wantStatus {
				t.Fatalf("expected status %d, got %v", tc.wantStatus, err)
			}
			record, err := repo.InviteRecord("a")
			if err != nil || record.L1InviterID != "" || record.L2InviterID != "" {
				t.Fatalf("rejected inviter change persisted: record=%+v err=%v", record, err)
			}
		})
	}
}

func TestConcurrentInviteInviterEditsCannotCreateCycle(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "invite.db")+"?_busy_timeout=10000&_journal_mode=WAL"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	assertConcurrentInviteInviterEditsCannotCreateCycle(t, db)
}

func TestPostgresConcurrentInviteInviterEditsCannotCreateCycle(t *testing.T) {
	assertConcurrentInviteInviterEditsCannotCreateCycle(t, openInviteIntegrityPostgresDB(t))
}

func openInviteIntegrityPostgresDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
	}
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, err := base.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = baseSQL.Close() })
	schema := fmt.Sprintf("invite_graph_%d", time.Now().UnixNano())
	if err := base.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := base.Exec(`DROP SCHEMA "` + schema + `" CASCADE`).Error; err != nil {
			t.Errorf("drop test schema: %v", err)
		}
	})
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db
}

func assertConcurrentInviteInviterEditsCannotCreateCycle(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&model.User{}, &model.InviteRecord{}, &model.InviteRewardRecord{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	sqlDB.SetMaxOpenConns(4)
	for _, id := range []string{"a", "b"} {
		createInviteUser(t, db, id, id, "")
		if err := db.Create(&model.InviteRecord{UserID: id, Status: model.InviteRecordApproved}).Error; err != nil {
			t.Fatal(err)
		}
	}
	repo := New(db)
	start := make(chan struct{})
	results := make(chan error, 2)
	var group sync.WaitGroup
	for _, pair := range [][2]string{{"a", "b"}, {"b", "a"}} {
		group.Add(1)
		go func(pair [2]string) {
			defer group.Done()
			<-start
			_, err := repo.UpdateInviteInviters(pair[0], pair[1], "")
			results <- err
		}(pair)
	}
	close(start)
	group.Wait()
	close(results)
	successes, rejected := 0, 0
	for err := range results {
		if err == nil {
			successes++
			continue
		}
		var appErr *kernel.AppError
		if !errors.As(err, &appErr) || appErr.Status != 400 {
			t.Fatalf("unexpected concurrent edit error: %v", err)
		}
		rejected++
	}
	if successes != 1 || rejected != 1 {
		t.Fatalf("concurrent graph edits succeeded=%d rejected=%d", successes, rejected)
	}
	a, _ := repo.InviteRecord("a")
	b, _ := repo.InviteRecord("b")
	if a.L1InviterID == "b" && b.L1InviterID == "a" {
		t.Fatal("concurrent edits created invitation cycle")
	}
}

func TestAttachInviteRecordDoesNotCloseExistingAncestorCycle(t *testing.T) {
	db := openInviteTestDB(t)
	createInviteUser(t, db, "a", "a", "AAAA2345")
	createInviteUser(t, db, "b", "b", "BBBB2345")
	if err := db.Create(&model.InviteRecord{UserID: "a", L1InviterID: "b", Status: model.InviteRecordApproved}).Error; err != nil {
		t.Fatal(err)
	}
	policy := invite.DefaultInvitePolicy()
	policy.Enabled = true
	repo := New(db)
	if record, attached, err := repo.AttachInviteRecord("b", "AAAA2345", policy); err != nil || attached || record != nil {
		t.Fatalf("registration closed invitation cycle: record=%+v attached=%v err=%v", record, attached, err)
	}
}

func TestPostgresInviteRewardsLockRecipientsInOrder(t *testing.T) {
	for _, pending := range []bool{false, true} {
		name := "payment"
		if pending {
			name = "approval"
		}
		t.Run(name, func(t *testing.T) {
			db := openInviteIntegrityPostgresDB(t)
			if err := db.AutoMigrate(&model.User{}, &model.InviteRecord{}, &model.InviteRewardRecord{},
				&model.RewardAccount{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.PaymentOrder{}); err != nil {
				t.Fatal(err)
			}
			for _, id := range []string{"a", "b", "u", "v"} {
				createInviteUser(t, db, id, id, "")
			}
			for _, id := range []string{"a", "b"} {
				account := model.RewardAccount{UserID: id}
				if pending {
					account.TotalMicroYuan = 10_000_000
					account.FrozenMicroYuan = 10_000_000
				}
				if err := db.Create(&account).Error; err != nil {
					t.Fatal(err)
				}
			}
			for _, pair := range [][3]string{{"u", "a", "b"}, {"v", "b", "a"}} {
				record := model.InviteRecord{UserID: pair[0], L1InviterID: pair[1], L2InviterID: pair[2], Status: model.InviteRecordApproved}
				if pending {
					record.Status = model.InviteRecordPending
				}
				if err := db.Create(&record).Error; err != nil {
					t.Fatal(err)
				}
				if pending {
					for level, inviterID := range pair[1:] {
						if err := db.Create(&model.InviteRewardRecord{ID: fmt.Sprintf("reward-%s-%d", pair[0], level),
							InviteeID: pair[0], InviterID: inviterID, Level: level + 1, AmountMicroYuan: 5_000_000,
							Status: model.InviteRewardPending, ReferenceKey: fmt.Sprintf("reward:%s:%d", pair[0], level)}).Error; err != nil {
							t.Fatal(err)
						}
					}
				} else {
					order := model.PaymentOrder{ID: "payment-" + pair[0], UserID: pair[0], IdempotencyKey: pair[0],
						MerchantOrderNo: pair[0], ProductID: "product", ProductName: "Credits", ProviderID: "test",
						AmountFen: 10_000, Currency: "CNY", CreditsMicrocredits: 1_000_000, Status: model.PaymentOrderPending}
					if err := db.Create(&order).Error; err != nil {
						t.Fatal(err)
					}
				}
			}
			if err := db.Exec(`CREATE FUNCTION delay_reward_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_sleep(0.05); RETURN NEW; END $$`).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Exec("CREATE TRIGGER delay_reward_update BEFORE UPDATE ON reward_accounts FOR EACH ROW EXECUTE FUNCTION delay_reward_update()").Error; err != nil {
				t.Fatal(err)
			}
			repo := New(db)
			start := make(chan struct{})
			results := make(chan error, 2)
			for _, id := range []string{"u", "v"} {
				go func(id string) {
					<-start
					if pending {
						_, err := repo.ApproveInviteRecord(id)
						results <- err
						return
					}
					_, _, err := repo.CompletePaymentOrder("test", id, PaymentEvidence{ProviderTradeNo: "trade-" + id,
						ProviderStatus: "SUCCESS", AmountFen: 10_000, Currency: "CNY"}, &invite.InviteRewardInstruction{
						InviteeID: id, Source: model.InviteRewardSourceProduct,
						Levels: []invite.RewardLevel{{Level: 1, RateBP: 500}, {Level: 2, RateBP: 500}},
					})
					results <- err
				}(id)
			}
			close(start)
			for range 2 {
				if err := <-results; err != nil {
					t.Fatalf("opposing recipient order caused financial transaction failure: %v", err)
				}
			}
			for _, id := range []string{"a", "b"} {
				account := rewardAccountOf(t, db, id)
				if account.AvailableMicroYuan != 10_000_000 || account.FrozenMicroYuan != 0 {
					t.Fatalf("concurrent financial transaction lost funds: %+v", account)
				}
			}
		})
	}
}

func TestPostgresInviteTransferLocksCreditBeforeReward(t *testing.T) {
	db := openInviteIntegrityPostgresDB(t)
	if err := db.AutoMigrate(&model.User{}, &model.RewardAccount{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.TransferRecord{}); err != nil {
		t.Fatal(err)
	}
	createInviteUser(t, db, "a", "a", "")
	if err := db.Create(&model.CreditAccount{UserID: "a"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.RewardAccount{UserID: "a", TotalMicroYuan: 1_000_000, AvailableMicroYuan: 1_000_000}).Error; err != nil {
		t.Fatal(err)
	}
	payment := db.Begin()
	defer payment.Rollback()
	if payment.Error != nil {
		t.Fatal(payment.Error)
	}
	if err := payment.Exec("SET LOCAL statement_timeout = '2000ms'").Error; err != nil {
		t.Fatal(err)
	}
	if err := payment.Exec("SELECT user_id FROM credit_accounts WHERE user_id = 'a' FOR UPDATE").Error; err != nil {
		t.Fatal(err)
	}
	results := make(chan error, 1)
	go func() {
		_, _, err := New(db).CreateTransfer("a", 1_000_000, 1000, 1_000_000)
		results <- err
	}()
	deadline := time.Now().Add(3 * time.Second)
	waiting := false
	for time.Now().Before(deadline) {
		var count int64
		if err := db.Raw(`SELECT COUNT(*) FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid()
AND wait_event_type = 'Lock' AND query LIKE '%credit_accounts%'`).Scan(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count > 0 {
			waiting = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !waiting {
		t.Fatal("transfer did not wait on the payment credit lock")
	}
	if err := payment.Exec("UPDATE reward_accounts SET updated_at = updated_at WHERE user_id = 'a'").Error; err != nil {
		t.Fatalf("transfer held rewards while waiting on payment credits: %v", err)
	}
	if err := payment.Commit().Error; err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-results:
		if err != nil {
			t.Fatalf("concurrent transfer failed: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("transfer remained blocked after payment committed")
	}
	account := rewardAccountOf(t, db, "a")
	if account.AvailableMicroYuan != 0 || account.UsedMicroYuan != 1_000_000 {
		t.Fatalf("transfer did not move reward funds once: %+v", account)
	}
	var credit model.CreditAccount
	if err := db.Where("user_id = ?", "a").First(&credit).Error; err != nil || credit.AvailableMicrocredits != 1_000_000 {
		t.Fatalf("transfer credits=%+v err=%v", credit, err)
	}
}
