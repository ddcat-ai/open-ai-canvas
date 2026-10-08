package app

import (
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestUpdateUserDisableRevokesSessions(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	actor := &model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	user := model.User{ID: "member", Username: "member", Role: model.UserRoleUser, Status: model.UserStatusActive}
	other := model.User{ID: "other", Username: "other", Role: model.UserRoleUser, Status: model.UserStatusActive}
	for _, u := range []*model.User{actor, &user, &other} {
		if err := db.Create(u).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, session := range []model.AuthSession{
		{ID: "one", UserID: user.ID, TokenHash: hashToken("token-one"), ExpiresAt: time.Now().Add(time.Hour)},
		{ID: "two", UserID: user.ID, TokenHash: hashToken("token-two"), ExpiresAt: time.Now().Add(time.Hour)},
		{ID: "other", UserID: other.ID, TokenHash: hashToken("token-other"), ExpiresAt: time.Now().Add(time.Hour)},
	} {
		if err := db.Create(&session).Error; err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.UpdateUser(actor, user.ID, UpdateUserRequest{DisplayName: "Creator"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CurrentUser("one.token-one"); err != nil {
		t.Fatalf("profile edit revoked session: %v", err)
	}
	if _, err := svc.UpdateUser(actor, user.ID, UpdateUserRequest{Status: model.UserStatusDisabled}); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.AuthSession{}).Where("user_id = ?", user.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Errorf("disabled user session count = %d, want 0", count)
	}
	if _, err := svc.UpdateUser(actor, user.ID, UpdateUserRequest{Status: model.UserStatusActive}); err != nil {
		t.Fatal(err)
	}
	for _, cookie := range []string{"one.token-one", "two.token-two"} {
		if _, err := svc.CurrentUser(cookie); err == nil {
			t.Errorf("old cookie revived after re-enable: %s", cookie)
		}
	}
	if _, err := svc.CurrentUser("other.token-other"); err != nil {
		t.Fatalf("other user's session revoked: %v", err)
	}
}
