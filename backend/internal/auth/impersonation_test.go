package auth

import (
	"errors"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newImpersonationTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.UserIdentity{}, &model.AuthSession{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { sqlDB.Close() })
	return db
}

func TestUserImpersonationOnlyAllowsActiveNormalUsers(t *testing.T) {
	db := newImpersonationTestDB(t)
	createdAt := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	actor := model.User{ID: "admin-1", Username: "admin-one", DisplayName: "Admin One", Role: model.UserRoleAdmin, Status: model.UserStatusActive, CreatedAt: createdAt, UpdatedAt: createdAt}
	target := model.User{ID: "user-1", Username: "user-one", DisplayName: "User One", Role: model.UserRoleUser, Status: model.UserStatusActive, CreatedAt: createdAt.Add(time.Second), UpdatedAt: createdAt.Add(time.Second)}
	otherAdmin := model.User{ID: "admin-2", Username: "admin-two", Role: model.UserRoleAdmin, Status: model.UserStatusActive, CreatedAt: createdAt.Add(2 * time.Second), UpdatedAt: createdAt.Add(2 * time.Second)}
	disabledUser := model.User{ID: "user-2", Username: "user-two", Role: model.UserRoleUser, Status: model.UserStatusDisabled, CreatedAt: createdAt.Add(3 * time.Second), UpdatedAt: createdAt.Add(3 * time.Second)}
	if err := db.Create(&[]model.User{actor, target, otherAdmin, disabledUser}).Error; err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	if allowed, err := svc.CanImpersonateUsers(&actor); err != nil || !allowed {
		t.Fatalf("primary admin capability = %t, %v", allowed, err)
	}
	if allowed, err := svc.CanImpersonateUsers(&otherAdmin); err != nil || allowed {
		t.Fatalf("secondary admin capability = %t, %v", allowed, err)
	}

	adminSession, err := svc.createAuthSession(&actor)
	if err != nil {
		t.Fatal(err)
	}
	impersonation, err := svc.StartUserImpersonation(adminSession.Session, target.ID)
	if err != nil {
		t.Fatal(err)
	}
	context, err := svc.CurrentAuthSession(impersonation.Session)
	if err != nil {
		t.Fatal(err)
	}
	if context.User.ID != target.ID || context.Impersonator == nil || context.Impersonator.ID != actor.ID {
		t.Fatalf("impersonation context = %#v", context)
	}
	if _, err := svc.StartUserImpersonation(impersonation.Session, target.ID); err == nil {
		t.Fatal("nested impersonation allowed")
	}
	if _, err := svc.StartUserImpersonation(adminSession.Session, target.ID); err == nil {
		t.Fatal("consumed admin cookie reused")
	}
	originalSessionID, _ := parseSessionCookie(adminSession.Session)
	if _, err := svc.repo.AuthSession(originalSessionID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("original admin session error = %v, want record not found", err)
	}

	returned, err := svc.ExitUserImpersonation(impersonation.Session)
	if err != nil {
		t.Fatal(err)
	}
	returnedContext, err := svc.CurrentAuthSession(returned.Session)
	if err != nil {
		t.Fatal(err)
	}
	if returnedContext.User.ID != actor.ID || returnedContext.Impersonator != nil {
		t.Fatalf("returned context = %#v", returnedContext)
	}
	if _, err := svc.CurrentUser(impersonation.Session); err == nil {
		t.Fatal("consumed impersonation cookie reused")
	}
	if _, err := svc.ExitUserImpersonation(returned.Session); err == nil {
		t.Fatal("normal session allowed to exit impersonation")
	}

	for _, targetID := range []string{actor.ID, otherAdmin.ID, disabledUser.ID, "", "missing"} {
		freshAdminSession, err := svc.createAuthSession(&actor)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := svc.StartUserImpersonation(freshAdminSession.Session, targetID); err == nil {
			t.Fatalf("StartUserImpersonation(%q) error = nil", targetID)
		}
	}
	secondaryAdminSession, err := svc.createAuthSession(&otherAdmin)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.StartUserImpersonation(secondaryAdminSession.Session, target.ID); err == nil {
		t.Fatal("secondary admin was allowed to impersonate a user")
	}
	userSession, err := svc.createAuthSession(&target)
	if err != nil {
		t.Fatal(err)
	}
	for _, cookie := range []string{"", "invalid", userSession.Session} {
		if _, err := svc.StartUserImpersonation(cookie, target.ID); err == nil {
			t.Fatal("unauthorized actor allowed")
		}
	}

	var events []model.AdminAuditEvent
	if err := db.Where("target_type = ? AND target_id = ?", "user", target.ID).Find(&events).Error; err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].ActorUserID != actor.ID || events[1].ActorUserID != actor.ID {
		t.Fatalf("audit events = %#v", events)
	}
	actions := map[string]bool{}
	for _, event := range events {
		actions[event.Action] = true
	}
	if !actions["user.impersonation.start"] || !actions["user.impersonation.exit"] {
		t.Fatalf("audit actions = %#v", actions)
	}
}

func TestImpersonationRevocationAndAuditRollback(t *testing.T) {
	for _, scenario := range []string{"actor-disabled", "actor-demoted", "target-promoted", "actor-sessions-revoked", "target-sessions-revoked", "audit-failure"} {
		t.Run(scenario, func(t *testing.T) {
			db := newImpersonationTestDB(t)
			actor := model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive, CreatedAt: time.Now().Add(-time.Hour)}
			target := model.User{ID: "user", Username: "user", Role: model.UserRoleUser, Status: model.UserStatusActive, CreatedAt: time.Now()}
			if err := db.Create(&[]model.User{actor, target}).Error; err != nil {
				t.Fatal(err)
			}
			svc := New(repository.New(db), nil, nil)
			original, err := svc.createAuthSession(&actor)
			if err != nil {
				t.Fatal(err)
			}
			if scenario == "audit-failure" {
				if err := db.Migrator().DropTable(&model.AdminAuditEvent{}); err != nil {
					t.Fatal(err)
				}
				if _, err := svc.StartUserImpersonation(original.Session, target.ID); err == nil {
					t.Fatal("switch succeeded without audit")
				}
				if _, err := svc.CurrentUser(original.Session); err != nil {
					t.Fatalf("original session not restored: %v", err)
				}
				var count int64
				if err := db.Model(&model.AuthSession{}).Count(&count).Error; err != nil || count != 1 {
					t.Fatalf("leaked session: %d, %v", count, err)
				}
				return
			}
			entered, err := svc.StartUserImpersonation(original.Session, target.ID)
			if err != nil {
				t.Fatal(err)
			}
			switch scenario {
			case "actor-disabled":
				err = db.Model(&actor).Update("status", model.UserStatusDisabled).Error
			case "actor-demoted":
				err = db.Model(&actor).Update("role", model.UserRoleUser).Error
			case "target-promoted":
				err = db.Model(&target).Update("role", model.UserRoleAdmin).Error
			case "actor-sessions-revoked":
				err = svc.repo.DeleteUserAuthSessions(actor.ID)
			case "target-sessions-revoked":
				err = svc.repo.DeleteUserAuthSessions(target.ID)
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := svc.CurrentUser(entered.Session); err == nil {
				t.Fatal("revoked impersonation still valid")
			}
			if _, err := svc.ExitUserImpersonation(entered.Session); err == nil {
				t.Fatal("revoked impersonation restored admin")
			}
		})
	}
}
