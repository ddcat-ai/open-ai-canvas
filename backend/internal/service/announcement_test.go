package service

import (
	"testing"
	"time"

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

func TestAnnouncementUpdateRepublishesAndResetsReads(t *testing.T) {
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

	announcement, err := svc.CreateAnnouncement(admin, CreateAnnouncementRequest{Title: "旧标题", Content: "旧正文", Level: model.AnnouncementLevelInfo})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.MarkAnnouncementsRead(user, []string{announcement.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CloseAnnouncement(admin, announcement.ID); err != nil {
		t.Fatal(err)
	}

	updated, err := svc.UpdateAnnouncement(admin, announcement.ID, UpdateAnnouncementRequest{Title: "新标题", Content: "新正文", Level: model.AnnouncementLevelWarning, Pinned: true})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != model.AnnouncementStatusActive || updated.ClosedAt != nil || updated.Title != "新标题" || updated.Content != "新正文" || updated.Level != model.AnnouncementLevelWarning || !updated.Pinned {
		t.Fatalf("updated announcement = %+v", updated)
	}
	feed, err := svc.UserAnnouncements(user)
	if err != nil {
		t.Fatal(err)
	}
	if len(feed.Announcements) != 1 || feed.UnreadCount != 1 || feed.Announcements[0].Content != "新正文" {
		t.Fatalf("feed after republish = %+v, want one unread updated announcement", feed)
	}
}

func TestPinnedAnnouncementsAreReturnedBeforeNewerRegularAnnouncements(t *testing.T) {
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

	pinned, err := svc.CreateAnnouncement(admin, CreateAnnouncementRequest{Title: "置顶", Content: "置顶公告", Level: model.AnnouncementLevelWarning, Pinned: true})
	if err != nil {
		t.Fatal(err)
	}
	regular, err := svc.CreateAnnouncement(admin, CreateAnnouncementRequest{Title: "普通", Content: "较新的普通公告", Level: model.AnnouncementLevelInfo})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Announcement{}).Where("id = ?", pinned.ID).Update("published_at", regular.PublishedAt.Add(-time.Hour)).Error; err != nil {
		t.Fatal(err)
	}

	feed, err := svc.UserAnnouncements(user)
	if err != nil {
		t.Fatal(err)
	}
	if len(feed.Announcements) != 2 || feed.Announcements[0].ID != pinned.ID || !feed.Announcements[0].Pinned {
		t.Fatalf("feed = %+v, want pinned announcement first", feed.Announcements)
	}
	page, err := svc.AdminAnnouncementPage(admin, AdminListQuery{Page: 1, Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Announcements) != 2 || page.Announcements[0].ID != pinned.ID {
		t.Fatalf("admin page = %+v, want pinned announcement first", page.Announcements)
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
