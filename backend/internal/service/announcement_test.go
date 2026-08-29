package service

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/database"
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

func TestAnnouncementImageDraftIsConsumedWhenAnnouncementIsCreated(t *testing.T) {
	svc, db := newAnnouncementImageTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	resource := createAnnouncementImageDraft(t, db, admin.ID, "image-draft")

	announcement, err := svc.CreateAnnouncement(admin, CreateAnnouncementRequest{
		Title: "带图公告", Content: "公告正文", ImageResourceID: resource.ID, Level: model.AnnouncementLevelInfo,
	})
	if err != nil {
		t.Fatal(err)
	}
	if announcement.ImageResourceID != resource.ID || announcement.ImageURL != "/api/announcements/"+announcement.ID+"/image" {
		t.Fatalf("announcement image = %+v", announcement)
	}
	var draftCount int64
	if err := db.Model(&model.AnnouncementImageDraft{}).Where("resource_id = ?", resource.ID).Count(&draftCount).Error; err != nil {
		t.Fatal(err)
	}
	if draftCount != 0 {
		t.Fatalf("draft count = %d, want 0", draftCount)
	}
}

func TestAnnouncementImageReplacementQueuesOldResourceDeletionAtomically(t *testing.T) {
	svc, db := newAnnouncementImageTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	oldResource := createAnnouncementImageDraft(t, db, admin.ID, "old-image")
	announcement, err := svc.CreateAnnouncement(admin, CreateAnnouncementRequest{
		Title: "旧公告", Content: "旧正文", ImageResourceID: oldResource.ID, Level: model.AnnouncementLevelInfo,
	})
	if err != nil {
		t.Fatal(err)
	}
	newResource := createAnnouncementImageDraft(t, db, admin.ID, "new-image")

	updated, err := svc.UpdateAnnouncement(admin, announcement.ID, UpdateAnnouncementRequest{
		Title: "新公告", Content: "新正文", ImageResourceID: newResource.ID, Level: model.AnnouncementLevelWarning, Pinned: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.ImageResourceID != newResource.ID || updated.ImageURL == "" {
		t.Fatalf("updated announcement = %+v", updated)
	}
	var oldResourceCount int64
	if err := db.Model(&model.Resource{}).Where("id = ?", oldResource.ID).Count(&oldResourceCount).Error; err != nil {
		t.Fatal(err)
	}
	if oldResourceCount != 0 {
		t.Fatalf("old resource count = %d, want 0", oldResourceCount)
	}
	var deletionJobs []model.ResourceDeletionJob
	if err := db.Where("resource_id = ?", oldResource.ID).Find(&deletionJobs).Error; err != nil {
		t.Fatal(err)
	}
	if len(deletionJobs) != 1 || deletionJobs[0].ObjectKey != oldResource.ObjectKey {
		t.Fatalf("deletion jobs = %+v", deletionJobs)
	}
	var draftCount int64
	if err := db.Model(&model.AnnouncementImageDraft{}).Where("resource_id = ?", newResource.ID).Count(&draftCount).Error; err != nil {
		t.Fatal(err)
	}
	if draftCount != 0 {
		t.Fatalf("new image draft count = %d, want 0", draftCount)
	}
}

func TestDiscardAnnouncementImageDraftRemovesRecordAndQueuesDeletion(t *testing.T) {
	svc, db := newAnnouncementImageTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	resource := createAnnouncementImageDraft(t, db, admin.ID, "cancelled-image")

	if err := svc.DiscardAnnouncementImage(admin, resource.ID); err != nil {
		t.Fatal(err)
	}
	var resourceCount int64
	if err := db.Model(&model.Resource{}).Where("id = ?", resource.ID).Count(&resourceCount).Error; err != nil {
		t.Fatal(err)
	}
	if resourceCount != 0 {
		t.Fatalf("resource count = %d, want 0", resourceCount)
	}
	var jobCount int64
	if err := db.Model(&model.ResourceDeletionJob{}).Where("resource_id = ?", resource.ID).Count(&jobCount).Error; err != nil {
		t.Fatal(err)
	}
	if jobCount != 1 {
		t.Fatalf("deletion job count = %d, want 1", jobCount)
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

func newAnnouncementImageTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	return New(repository.New(db), t.TempDir()), db
}

func createAnnouncementImageDraft(t *testing.T, db *gorm.DB, userID string, id string) *model.Resource {
	t.Helper()
	resource := &model.Resource{
		ID: id, UserID: userID, Kind: "image", Status: model.ResourceStatusReady, Provider: "local",
		ObjectKey: "users/" + userID + "/image/" + id + ".png", MimeType: "image/png", Size: 128,
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	if err := db.Create(resource).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AnnouncementImageDraft{ResourceID: resource.ID, UserID: userID, CreatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	return resource
}
