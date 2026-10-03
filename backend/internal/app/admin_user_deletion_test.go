package app

import (
	"encoding/json"
	"errors"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func deletionFixture(t *testing.T) (*Service, *gorm.DB, *model.User, *model.User) {
	t.Helper()
	db, e := deletionPostgresDB(t)
	if db == nil && e == nil {
		db, e = gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "delete.db")+"?_busy_timeout=5000&_journal_mode=WAL"), &gorm.Config{})
	}
	if e != nil {
		t.Fatal(e)
	}
	if e = db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.UserIdentity{}, &model.AdminAuditEvent{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.BillingOrder{}, &model.PaymentOrder{}, &model.PaymentNotification{}, &model.TopupProduct{}, &model.Task{}, &model.TaskTextDelta{}, &model.Asset{}, &model.CanvasProject{}, &model.CloudAgentExecution{}, &model.AgentSession{}); e != nil {
		t.Fatal(e)
	}
	actor := &model.User{ID: "admin-1", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	target := &model.User{ID: "user-1", Username: "old-user", Email: "old@example.com", DisplayName: "Old Name", Role: model.UserRoleUser, Status: model.UserStatusActive, PasswordHash: "secret"}
	if e = db.Create(&[]*model.User{actor, target}).Error; e != nil {
		t.Fatal(e)
	}
	return &Service{repo: repository.New(db)}, db, actor, target
}
func TestDeleteUserRemovesIdentityAndPseudonymizesRetention(t *testing.T) {
	svc, db, actor, target := deletionFixture(t)
	values := []any{&model.AuthSession{ID: "session", UserID: target.ID}, &model.UserIdentity{ID: "identity", UserID: target.ID, Provider: "github", Subject: "subject"}, &model.CreditAccount{UserID: target.ID}, &model.CreditLedgerEntry{ID: "ledger", UserID: target.ID, ActorUserID: target.ID, Note: "old@example.com Old Name user-1"}, &model.BillingOrder{ID: "billing", UserID: target.ID, Status: model.BillingStatusSettled, IdempotencyKey: "user-1"}, &model.PaymentOrder{ID: "payment", UserID: target.ID, MerchantOrderNo: "merchant", ProviderID: "provider", Status: model.PaymentOrderCredited, ExpiresAt: time.Now()}, &model.PaymentNotification{ID: "notice", ProviderID: "provider", ProviderEventID: "event", MerchantOrderNo: "merchant", Status: model.PaymentNotificationProcessed, PayloadCipher: target.Email, NormalizedJSON: `{"user":"user-1"}`}, &model.AdminAuditEvent{ID: "audit", ActorUserID: target.ID, TargetType: "user", TargetID: target.ID, Summary: "Old Name", MetadataJSON: `{"email":"old@example.com","id":"user-1"}`}}
	for _, v := range values {
		if e := db.Create(v).Error; e != nil {
			t.Fatal(e)
		}
	}
	if e := svc.DeleteUser(actor, target.ID); e != nil {
		t.Fatal(e)
	}
	for _, table := range []string{"users", "auth_sessions", "user_identities"} {
		where := "user_id = ?"
		if table == "users" {
			where = "id = ?"
		}
		var n int64
		if e := db.Table(table).Where(where, target.ID).Count(&n).Error; e != nil {
			t.Fatal(e)
		}
		if n != 0 {
			t.Fatalf("%s retained: %d", table, n)
		}
	}
	var ledger model.CreditLedgerEntry
	var billing model.BillingOrder
	var payment model.PaymentOrder
	var audit model.AdminAuditEvent
	for _, v := range []struct {
		id  string
		dst any
	}{{"ledger", &ledger}, {"billing", &billing}, {"payment", &payment}, {"audit", &audit}} {
		if e := db.First(v.dst, "id = ?", v.id).Error; e != nil {
			t.Fatal(e)
		}
	}
	pseudo := ledger.UserID
	if pseudo == "" || pseudo == target.ID || billing.UserID != pseudo || payment.UserID != pseudo || audit.ActorUserID != pseudo || audit.TargetID != pseudo || ledger.ActorUserID != pseudo {
		t.Fatalf("pseudonyms disagree: %q %q %q %q %q", pseudo, billing.UserID, payment.UserID, audit.ActorUserID, audit.TargetID)
	}
	for _, value := range []string{ledger.Note, billing.IdempotencyKey, audit.Summary, audit.MetadataJSON} {
		for _, forbidden := range []string{target.ID, target.Email, target.Username, target.DisplayName} {
			if strings.Contains(value, forbidden) {
				t.Fatalf("retained PII %q in %q", forbidden, value)
			}
		}
	}
	audit = model.AdminAuditEvent{}
	if e := db.Where("action = ? AND target_id = ?", "user.delete", pseudo).First(&audit).Error; e != nil {
		t.Fatal("delete audit missing:", e)
	}
	var notice model.PaymentNotification
	if e := db.First(&notice, "id = ?", "notice").Error; e != nil {
		t.Fatal(e)
	}
	if notice.PayloadCipher != "" || notice.NormalizedJSON != "{}" {
		t.Fatalf("payment callback payload retained: %+v", notice)
	}
}

func TestDeletedUserCannotCreateOwnedRecords(t *testing.T) {
	for _, tc := range []struct {
		name, table string
		write       func(*repository.Repository, string) error
	}{
		{"resource", "resources", func(r *repository.Repository, id string) error {
			return r.CreateResource(&model.Resource{ID: "resource-after-delete", UserID: id, Status: model.ResourceStatusPending})
		}},
		{"canvas", "canvas_projects", func(r *repository.Repository, id string) error {
			return r.UpsertCanvasProject(&model.CanvasProject{ID: "canvas-after-delete", UserID: id, CreatedAt: time.Now(), UpdatedAt: time.Now()})
		}},
		{"task", "tasks", func(r *repository.Repository, id string) error {
			return r.CreateTaskWithActiveLimit(&model.Task{ID: "task-after-delete", UserID: id, Status: model.TaskStatusQueued}, 5)
		}},
		{"billed-task", "tasks", func(r *repository.Repository, id string) error {
			return r.CreateTaskWithCreditReservation(
				&model.Task{ID: "billed-task-after-delete", UserID: id, Status: model.TaskStatusQueued},
				&model.BillingOrder{ID: "billing-after-delete", UserID: id, IdempotencyKey: "billed-task-after-delete", AmountMicrocredits: 100}, 5)
		}},
		{"asset-upsert", "assets", func(r *repository.Repository, id string) error {
			return r.UpsertAsset(&model.Asset{ID: "asset-after-delete", UserID: id})
		}},
		{"asset-replace", "assets", func(r *repository.Repository, id string) error {
			return r.ReplaceAssets(id, []model.Asset{{ID: "asset-after-delete", UserID: id}})
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, db, actor, target := deletionFixture(t)
			if err := db.AutoMigrate(&model.Resource{}); err != nil {
				t.Fatal(err)
			}
			if err := svc.DeleteUser(actor, target.ID); err != nil {
				t.Fatal(err)
			}
			if err := tc.write(repository.New(db), target.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
				t.Fatalf("write error = %v, want missing user", err)
			}
			var rows int64
			if err := db.Table(tc.table).Where("user_id = ?", target.ID).Count(&rows).Error; err != nil {
				t.Fatal(err)
			}
			if rows != 0 {
				t.Fatalf("orphan rows = %d", rows)
			}
		})
	}
}

func TestDeleteUserSerializesOwnedWrites(t *testing.T) {
	for _, mode := range []string{"resource", "credits"} {
		t.Run(mode, func(t *testing.T) {
			svc, db, actor, target := deletionFixture(t)
			if err := db.AutoMigrate(&model.Resource{}); err != nil {
				t.Fatal(err)
			}
			tx := db.Begin()
			if tx.Error != nil {
				t.Fatal(tx.Error)
			}
			defer tx.Rollback()
			writer := repository.New(tx)
			if mode == "resource" {
				if err := writer.CreateResource(&model.Resource{ID: "concurrent-resource", UserID: target.ID, Status: model.ResourceStatusPending}); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := writer.AdjustCredits(target.ID, actor.ID, 100, "concurrent adjustment"); err != nil {
					t.Fatal(err)
				}
			}
			deleteDone := make(chan error, 1)
			go func() { deleteDone <- svc.DeleteUser(actor, target.ID) }()
			select {
			case err := <-deleteDone:
				t.Fatalf("deletion completed while owned write was uncommitted: %v", err)
			case <-time.After(100 * time.Millisecond):
			}
			if err := tx.Commit().Error; err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-deleteDone:
				if err == nil {
					t.Fatal("deletion ignored committed owned write")
				}
			case <-time.After(5 * time.Second):
				t.Fatal("deletion did not complete after writer commit")
			}
			var users int64
			if err := db.Model(&model.User{}).Where("id = ?", target.ID).Count(&users).Error; err != nil {
				t.Fatal(err)
			}
			if users != 1 {
				t.Fatal("blocked deletion removed owner")
			}
		})
	}
}

func TestOwnedWriteWaitsForUserDeleteCommit(t *testing.T) {
	for _, mode := range []string{"resource", "credits"} {
		t.Run(mode, func(t *testing.T) {
			_, db, actor, target := deletionFixture(t)
			if err := db.AutoMigrate(&model.Resource{}); err != nil {
				t.Fatal(err)
			}
			tx := db.Begin()
			if tx.Error != nil {
				t.Fatal(tx.Error)
			}
			defer tx.Rollback()
			if err := tx.Delete(&model.User{}, "id = ?", target.ID).Error; err != nil {
				t.Fatal(err)
			}
			writeDone := make(chan error, 1)
			go func() {
				repo := repository.New(db)
				if mode == "resource" {
					writeDone <- repo.CreateResource(&model.Resource{ID: "late-resource", UserID: target.ID, Status: model.ResourceStatusPending})
					return
				}
				_, err := repo.AdjustCredits(target.ID, actor.ID, 100, "late adjustment")
				writeDone <- err
			}()
			select {
			case err := <-writeDone:
				t.Fatalf("owned write completed while user deletion was uncommitted: %v", err)
			case <-time.After(100 * time.Millisecond):
			}
			if err := tx.Commit().Error; err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-writeDone:
				if !errors.Is(err, gorm.ErrRecordNotFound) {
					t.Fatalf("late write error = %v, want missing user", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("owned write did not complete after user deletion")
			}
			var resources, accounts int64
			if err := db.Model(&model.Resource{}).Where("user_id = ?", target.ID).Count(&resources).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.CreditAccount{}).Where("user_id = ?", target.ID).Count(&accounts).Error; err != nil {
				t.Fatal(err)
			}
			if resources != 0 || accounts != 0 {
				t.Fatalf("late write persisted: resources=%d accounts=%d", resources, accounts)
			}
		})
	}
}

func TestDisabledUserCanStillReceiveAdminAdjustment(t *testing.T) {
	_, db, actor, target := deletionFixture(t)
	if err := db.Model(target).Update("status", model.UserStatusDisabled).Error; err != nil {
		t.Fatal(err)
	}
	account, err := repository.New(db).AdjustCredits(target.ID, actor.ID, 100, "adjust disabled user")
	if err != nil || account.AvailableMicrocredits != 100 {
		t.Fatalf("adjust disabled user: account=%+v err=%v", account, err)
	}
}

func TestDeletedUserCannotReceiveCredits(t *testing.T) {
	for _, mode := range []string{"redeem", "adjust"} {
		t.Run(mode, func(t *testing.T) {
			svc, db, actor, target := deletionFixture(t)
			if err := db.AutoMigrate(&model.RedeemCode{}); err != nil {
				t.Fatal(err)
			}
			if mode == "redeem" {
				if err := db.Create(&model.RedeemCode{ID: "code-after-delete", CodeHash: "hash-after-delete", Status: model.RedeemCodeUnused, AmountMicrocredits: 100}).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := svc.DeleteUser(actor, target.ID); err != nil {
				t.Fatal(err)
			}
			repo := repository.New(db)
			var err error
			if mode == "redeem" {
				_, err = repo.RedeemCode(target.ID, "hash-after-delete", "203.0.113.8")
			} else {
				_, err = repo.AdjustCredits(target.ID, actor.ID, 100, "stale request")
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				t.Fatalf("credit write error = %v, want missing user", err)
			}
			var accounts, entries int64
			if err := db.Model(&model.CreditAccount{}).Where("user_id = ?", target.ID).Count(&accounts).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.CreditLedgerEntry{}).Where("user_id = ?", target.ID).Count(&entries).Error; err != nil {
				t.Fatal(err)
			}
			if accounts != 0 || entries != 0 {
				t.Fatalf("recreated account = %d, ledger = %d", accounts, entries)
			}
		})
	}
}

func TestDeleteUserClearsOnlyTargetRedeemIP(t *testing.T) {
	svc, db, actor, target := deletionFixture(t)
	if err := db.AutoMigrate(&model.RedeemCode{}); err != nil {
		t.Fatal(err)
	}
	codes := []model.RedeemCode{
		{ID: "target-code", CodeHash: "target-code-hash", RedeemedBy: target.ID, RedeemedIP: "203.0.113.8", Status: model.RedeemCodeRedeemed},
		{ID: "other-code", CodeHash: "other-code-hash", RedeemedBy: actor.ID, RedeemedIP: "198.51.100.9", Status: model.RedeemCodeRedeemed},
	}
	if err := db.Create(&codes).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteUser(actor, target.ID); err != nil {
		t.Fatal(err)
	}
	var retained, other model.RedeemCode
	if err := db.First(&retained, "id = ?", "target-code").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&other, "id = ?", "other-code").Error; err != nil {
		t.Fatal(err)
	}
	if retained.RedeemedBy == target.ID || retained.RedeemedBy == "" || retained.RedeemedIP != "" {
		t.Fatalf("target redemption not deidentified: %+v", retained)
	}
	if other.RedeemedBy != actor.ID || other.RedeemedIP != "198.51.100.9" {
		t.Fatalf("unrelated redemption changed: %+v", other)
	}
}
func TestDeleteDisabledUserAndKeepDisableRecoverable(t *testing.T) {
	svc, db, actor, target := deletionFixture(t)
	if e := svc.DisableUser(actor, target.ID); e != nil {
		t.Fatal(e)
	}
	var user model.User
	if e := db.First(&user, "id = ?", target.ID).Error; e != nil {
		t.Fatal(e)
	}
	if user.Status != model.UserStatusDisabled {
		t.Fatal(user.Status)
	}
	if _, e := svc.UpdateUser(actor, target.ID, UpdateUserRequest{Status: model.UserStatusActive}); e != nil {
		t.Fatal(e)
	}
	if e := svc.DisableUser(actor, target.ID); e != nil {
		t.Fatal(e)
	}
	if e := svc.DeleteUser(actor, target.ID); e != nil {
		t.Fatal(e)
	}
	if e := db.First(&user, "id = ?", target.ID).Error; !errors.Is(e, gorm.ErrRecordNotFound) {
		t.Fatalf("disabled user retained: %v", e)
	}
}
func TestDeleteUserPreflightBlocksWithoutSideEffects(t *testing.T) {
	cases := []struct {
		name string
		seed func(*gorm.DB, *model.User) error
		want string
	}{
		{"balance", func(db *gorm.DB, u *model.User) error {
			return db.Create(&model.CreditAccount{UserID: u.ID, AvailableMicrocredits: -1}).Error
		}, "余额"},
		{"payment", func(db *gorm.DB, u *model.User) error {
			return db.Create(&model.PaymentOrder{ID: "pay", UserID: u.ID, MerchantOrderNo: "merchant", ProviderID: "provider", Status: model.PaymentOrderPending}).Error
		}, "支付"},
		{"task", func(db *gorm.DB, u *model.User) error {
			return db.Create(&model.Task{ID: "task", UserID: u.ID, Status: model.TaskStatusRunning}).Error
		}, "任务"},
		{"asset", func(db *gorm.DB, u *model.User) error {
			return db.Create(&model.Asset{ID: "asset", UserID: u.ID}).Error
		}, "关联"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, db, actor, target := deletionFixture(t)
			if e := tc.seed(db, target); e != nil {
				t.Fatal(e)
			}
			p, e := svc.UserDeletePreflight(actor, target.ID)
			if e != nil {
				t.Fatal(e)
			}
			if p.CanDelete || !strings.Contains(strings.Join(p.Blockers, " "), tc.want) {
				t.Fatalf("preflight=%+v", p)
			}
			if e := svc.DeleteUser(actor, target.ID); e == nil || !strings.Contains(e.Error(), tc.want) {
				t.Fatalf("delete error=%v", e)
			}
			var n int64
			db.Model(&model.User{}).Where("id = ?", target.ID).Count(&n)
			if n != 1 {
				t.Fatal("blocked user removed")
			}
		})
	}
}
func TestDeleteUserRejectsSelfAndDisabledAdmin(t *testing.T) {
	svc, db, actor, target := deletionFixture(t)
	if e := svc.DeleteUser(actor, actor.ID); e == nil {
		t.Fatal("self deleted")
	}
	if e := db.Model(actor).Update("status", model.UserStatusDisabled).Error; e != nil {
		t.Fatal(e)
	}
	if e := svc.DeleteUser(actor, target.ID); e == nil {
		t.Fatal("disabled actor deleted target")
	}
}

func TestAdminMutationsRejectDisabledActor(t *testing.T) {
	svc, db, actor, target := deletionFixture(t)
	if err := db.Model(actor).Update("status", model.UserStatusDisabled).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.DisableUser(actor, target.ID); err == nil {
		t.Fatal("disabled actor disabled user")
	}
	if _, err := svc.UpdateUser(actor, target.ID, UpdateUserRequest{Status: model.UserStatusDisabled}); err == nil {
		t.Fatal("disabled actor updated user")
	}
	var user model.User
	if err := db.First(&user, "id = ?", target.ID).Error; err != nil {
		t.Fatal(err)
	}
	if user.Status != model.UserStatusActive {
		t.Fatalf("target status = %q", user.Status)
	}
}
func TestDeleteUserRollsBackOnDeleteFailure(t *testing.T) {
	svc, db, actor, target := deletionFixture(t)
	if e := db.Create(&model.CreditLedgerEntry{ID: "ledger", UserID: target.ID, Note: target.Email}).Error; e != nil {
		t.Fatal(e)
	}
	triggerSQL := `CREATE TRIGGER prevent_delete BEFORE DELETE ON users WHEN OLD.id = 'user-1' BEGIN SELECT RAISE(ABORT,'blocked'); END`
	if db.Dialector.Name() == "postgres" {
		if e := db.Exec(`CREATE FUNCTION prevent_user_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id = 'user-1' THEN RAISE EXCEPTION 'blocked'; END IF; RETURN OLD; END $$`).Error; e != nil {
			t.Fatal(e)
		}
		triggerSQL = `CREATE TRIGGER prevent_delete BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION prevent_user_delete()`
	}
	if e := db.Exec(triggerSQL).Error; e != nil {
		t.Fatal(e)
	}
	if e := svc.DeleteUser(actor, target.ID); e == nil {
		t.Fatal("expected failure")
	}
	var ledger model.CreditLedgerEntry
	if e := db.First(&ledger, "id = ?", "ledger").Error; e != nil {
		t.Fatal(e)
	}
	if ledger.UserID != target.ID || ledger.Note != target.Email {
		t.Fatalf("partial commit: %+v", ledger)
	}
}

func TestDeletedUserLatePaymentCallbackCannotRecreateCreditAccount(t *testing.T) {
	svc, db, actor, target := deletionFixture(t)
	order := &model.PaymentOrder{ID: "payment", UserID: target.ID, MerchantOrderNo: "merchant", ProviderID: "provider", ProductID: "product", Status: model.PaymentOrderClosed, AmountFen: 100, Currency: "CNY", CreditsMicrocredits: 1000}
	if err := db.Create(order).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteUser(actor, target.ID); err != nil {
		t.Fatal(err)
	}
	if _, granted, err := svc.repo.CompletePaymentOrder("provider", "merchant", repository.PaymentEvidence{ProviderTradeNo: "late-trade", AmountFen: 100, Currency: "CNY"}); err == nil || granted {
		t.Fatalf("late callback credited deleted account: granted=%v err=%v", granted, err)
	}
	var count int64
	if err := db.Model(&model.CreditAccount{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("late callback created %d credit accounts", count)
	}
}

func TestDeletedUserCannotCreatePaymentOrderFromStaleRequest(t *testing.T) {
	svc, db, actor, target := deletionFixture(t)
	if err := db.Create(&model.TopupProduct{ID: "product", Name: "积分", Enabled: true, AmountFen: 100, CreditsMicrocredits: 1000}).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteUser(actor, target.ID); err != nil {
		t.Fatal(err)
	}
	_, created, err := svc.repo.CreatePaymentOrderWithProductReservation(&model.PaymentOrder{ID: "late", UserID: target.ID, ProductID: "product", ProviderID: "provider", IdempotencyKey: "late", MerchantOrderNo: "late"})
	if err == nil || created {
		t.Fatalf("stale request created order: created=%v err=%v", created, err)
	}
	var count int64
	if err := db.Model(&model.PaymentOrder{}).Where("id = ?", "late").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("orphan payment order created")
	}
}

func TestConcurrentAdminDeletionKeepsAnEffectiveAdmin(t *testing.T) {
	svc, db, first, second := deletionFixture(t)
	if err := db.Model(second).Updates(map[string]any{"role": model.UserRoleAdmin, "status": model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make([]error, 2)
	wg.Add(2)
	go func() { defer wg.Done(); errs[0] = svc.DeleteUser(first, second.ID) }()
	go func() { defer wg.Done(); errs[1] = svc.DeleteUser(second, first.ID) }()
	wg.Wait()
	if (errs[0] == nil) == (errs[1] == nil) {
		t.Fatalf("expected exactly one success: %v, %v", errs[0], errs[1])
	}
	var active int64
	if err := db.Model(&model.User{}).Where("role = ? AND status = ?", model.UserRoleAdmin, model.UserStatusActive).Count(&active).Error; err != nil {
		t.Fatal(err)
	}
	if active != 1 {
		t.Fatalf("effective admins = %d", active)
	}
}

func TestDeleteUserDoesNotRewriteUnrelatedRetention(t *testing.T) {
	svc, db, actor, target := deletionFixture(t)
	key := "unrelated-original"
	unrelated := &model.CreditLedgerEntry{ID: "unrelated", UserID: actor.ID, Note: "Original title includes Old Name; do not rewrite another user's record", Model: "Old Name-v1", ReferenceKey: &key}
	if err := db.Create(unrelated).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteUser(actor, target.ID); err != nil {
		t.Fatal(err)
	}
	var got model.CreditLedgerEntry
	if err := db.First(&got, "id = ?", unrelated.ID).Error; err != nil {
		t.Fatal(err)
	}
	if got.Note != unrelated.Note || got.Model != unrelated.Model || got.ReferenceKey == nil || *got.ReferenceKey != *unrelated.ReferenceKey {
		t.Fatalf("unrelated financial record was rewritten: %+v", got)
	}
}

func TestDeleteUserScrubsPhoneWithoutChangingNumericAuditFacts(t *testing.T) {
	svc, db, actor, target := deletionFixture(t)
	target.DisplayName = "10"
	target.Phone = "+8613800009999"
	if err := db.Save(target).Error; err != nil {
		t.Fatal(err)
	}
	audit := &model.AdminAuditEvent{ID: "phone-audit", ActorUserID: actor.ID, TargetType: "user", TargetID: target.ID, MetadataJSON: `{"phone":"+8613800009999","name":"10","count":10}`}
	if err := db.Create(audit).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteUser(actor, target.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.First(audit, "id = ?", audit.ID).Error; err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(audit.MetadataJSON), &value); err != nil {
		t.Fatal("audit JSON corrupted:", err)
	}
	if value["count"] != float64(10) || strings.Contains(audit.MetadataJSON, target.Phone) {
		t.Fatalf("audit facts or phone invalid: %s", audit.MetadataJSON)
	}
}

func TestDeleteUserScrubsBulkAuditReferencesWithoutChangingOtherUsers(t *testing.T) {
	svc, db, actor, target := deletionFixture(t)
	audit := model.AdminAuditEvent{ID: "bulk-other", ActorUserID: actor.ID, TargetType: "user", TargetID: "other-user", Summary: "old-user remains a label on the other account", MetadataJSON: `{"userIds":["user-1","other-user"],"count":2,"otherDisplayName":"Old Name"}`}
	if err := db.Create(&audit).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteUser(actor, target.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&audit, "id = ?", audit.ID).Error; err != nil {
		t.Fatal(err)
	}
	if strings.Contains(audit.MetadataJSON, target.ID) {
		t.Fatalf("bulk audit retained deleted identity: %s", audit.MetadataJSON)
	}
	if !strings.Contains(audit.MetadataJSON, "other-user") || !strings.Contains(audit.MetadataJSON, "Old Name") || audit.Summary != "old-user remains a label on the other account" {
		t.Fatalf("unrelated identity changed: %+v", audit)
	}
}
