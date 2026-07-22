package service

import (
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestBulkDisableUsersDisablesUsersSessionsAndWritesAudits(t *testing.T) {
	db := newBulkUserTestDB(t)
	actor := model.User{ID: "admin-1", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	users := []model.User{
		actor,
		{ID: "user-1", Username: "user-one", Role: model.UserRoleUser, Status: model.UserStatusActive},
		{ID: "user-2", Username: "user-two", Role: model.UserRoleUser, Status: model.UserStatusActive},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatal(err)
	}
	sessions := []model.AuthSession{{ID: "session-1", UserID: "user-1"}, {ID: "session-2", UserID: "user-2"}}
	if err := db.Create(&sessions).Error; err != nil {
		t.Fatal(err)
	}

	result, err := (&Service{repo: repository.New(db)}).BulkDisableUsers(&actor, BulkDisableUsersRequest{UserIDs: []string{"user-1", "user-2"}})
	if err != nil {
		t.Fatal(err)
	}
	if result.DisabledCount != 2 {
		t.Fatalf("DisabledCount = %d, want 2", result.DisabledCount)
	}
	var activeUsers int64
	if err := db.Model(&model.User{}).Where("id IN ? AND status = ?", []string{"user-1", "user-2"}, model.UserStatusActive).Count(&activeUsers).Error; err != nil {
		t.Fatal(err)
	}
	if activeUsers != 0 {
		t.Fatalf("active users = %d, want 0", activeUsers)
	}
	var sessionCount int64
	if err := db.Model(&model.AuthSession{}).Count(&sessionCount).Error; err != nil {
		t.Fatal(err)
	}
	if sessionCount != 0 {
		t.Fatalf("sessions = %d, want 0", sessionCount)
	}
	var auditCount int64
	if err := db.Model(&model.AdminAuditEvent{}).Where("action = ?", "user.bulk_disable").Count(&auditCount).Error; err != nil {
		t.Fatal(err)
	}
	if auditCount != 2 {
		t.Fatalf("audits = %d, want 2", auditCount)
	}
}

func TestBulkDisableUsersRollsBackWhenAnyUserIsMissing(t *testing.T) {
	db := newBulkUserTestDB(t)
	actor := model.User{ID: "admin-1", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	user := model.User{ID: "user-1", Username: "user-one", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(&[]model.User{actor, user}).Error; err != nil {
		t.Fatal(err)
	}

	_, err := (&Service{repo: repository.New(db)}).BulkDisableUsers(&actor, BulkDisableUsersRequest{UserIDs: []string{"user-1", "missing"}})
	if err == nil {
		t.Fatal("BulkDisableUsers() error = nil")
	}
	var stored model.User
	if err := db.First(&stored, "id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.UserStatusActive {
		t.Fatalf("user status = %q, want active", stored.Status)
	}
}

func TestBulkDisableUsersRejectsCurrentAdmin(t *testing.T) {
	db := newBulkUserTestDB(t)
	actor := model.User{ID: "admin-1", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	otherAdmin := model.User{ID: "admin-2", Username: "admin-two", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(&[]model.User{actor, otherAdmin}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := (&Service{repo: repository.New(db)}).BulkDisableUsers(&actor, BulkDisableUsersRequest{UserIDs: []string{actor.ID}}); err == nil {
		t.Fatal("BulkDisableUsers() error = nil")
	}
}

func newBulkUserTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	return db
}
