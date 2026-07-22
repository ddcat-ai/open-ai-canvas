package service

import (
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAnnouncementPublishReadAndCloseLifecycle(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&model.User{}, &model.Announcement{}, &model.UserAnnouncementRead{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	user := &model.User{ID: "user", Role: model.UserRoleUser, Status: model.UserStatusActive}

	announcement, err := svc.CreateAnnouncement(admin, CreateAnnouncementRequest{Title: "服务恢复", Content: "视频模型已经恢复正常使用。", Level: model.AnnouncementLevelSuccess})
	if err != nil {
		t.Fatal(err)
	}
	if announcement.Status != model.AnnouncementStatusActive {
		t.Fatalf("status = %q, want active", announcement.Status)
	}

	feed, err := svc.UserAnnouncements(user)
	if err != nil {
		t.Fatal(err)
	}
	if len(feed.Announcements) != 1 || feed.UnreadCount != 1 {
		t.Fatalf("feed = %+v, want one unread announcement", feed)
	}
	if _, err := svc.MarkAnnouncementsRead(user, []string{announcement.ID}); err != nil {
		t.Fatal(err)
	}
	feed, err = svc.UserAnnouncements(user)
	if err != nil {
		t.Fatal(err)
	}
	if feed.UnreadCount != 0 {
		t.Fatalf("unread count = %d, want 0", feed.UnreadCount)
	}

	closed, err := svc.CloseAnnouncement(admin, announcement.ID)
	if err != nil {
		t.Fatal(err)
	}
	if closed.Status != model.AnnouncementStatusClosed || closed.ClosedAt == nil {
		t.Fatalf("closed announcement = %+v", closed)
	}
	feed, err = svc.UserAnnouncements(user)
	if err != nil {
		t.Fatal(err)
	}
	if len(feed.Announcements) != 0 || feed.UnreadCount != 0 {
		t.Fatalf("closed announcement should not remain in user feed: %+v", feed)
	}
}

func TestAnnouncementPublishRejectsInvalidInput(t *testing.T) {
	svc := &Service{}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if _, err := svc.CreateAnnouncement(admin, CreateAnnouncementRequest{Title: "", Content: "正文", Level: model.AnnouncementLevelInfo}); err == nil {
		t.Fatal("expected blank title to be rejected")
	}
	if _, err := svc.CreateAnnouncement(admin, CreateAnnouncementRequest{Title: "标题", Content: "正文", Level: "unknown"}); err == nil {
		t.Fatal("expected invalid level to be rejected")
	}
}
