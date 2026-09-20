package app

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

func TestAnnouncementPublishAllowsEmptyContent(t *testing.T) {
	svc, _ := newAnnouncementImageTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}

	announcement, err := svc.CreateAnnouncement(admin, CreateAnnouncementRequest{Title: "仅标题公告", Content: "   ", Level: model.AnnouncementLevelInfo})
	if err != nil {
		t.Fatal(err)
	}
	if announcement.Title != "仅标题公告" || announcement.Content != "" {
		t.Fatalf("announcement = %+v", announcement)
	}
}

func TestBannerAnnouncementLifecycle(t *testing.T) {
	svc, _ := newAnnouncementImageTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}

	banner, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{
		Title:  "常驻公告1",
		Status: "active",
	})
	if err != nil {
		t.Fatal(err)
	}
	if banner.Title != "常驻公告1" || banner.Status != "active" {
		t.Fatalf("banner = %+v", banner)
	}

	activeBanners, err := svc.ActiveBannerAnnouncements()
	if err != nil {
		t.Fatal(err)
	}
	if len(activeBanners) != 1 || activeBanners[0].ID != banner.ID {
		t.Fatalf("activeBanners = %+v", activeBanners)
	}

	updated, err := svc.UpdateBannerAnnouncement(admin, banner.ID, UpdateBannerAnnouncementRequest{
		Title:  "更新的常驻公告",
		Link:   "/projects",
		Status: "disabled",
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Title != "更新的常驻公告" || updated.Link != "/projects" || updated.Status != "disabled" {
		t.Fatalf("updated = %+v", updated)
	}

	activeAfterDisable, _ := svc.ActiveBannerAnnouncements()
	if len(activeAfterDisable) != 0 {
		t.Fatalf("expected 0 active banners, got %d", len(activeAfterDisable))
	}
}

func TestBannerAnnouncementAcceptsFutureStartAndLinkKinds(t *testing.T) {
	svc, _ := newAnnouncementImageTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}

	future := time.Now().Add(24 * time.Hour)
	banner, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{
		Title:    "预约明天上线",
		Link:     "https://example.com/news/1",
		Status:   "active",
		StartsAt: &future,
	})
	if err != nil {
		t.Fatalf("future start should be accepted: %v", err)
	}
	if banner.Link != "https://example.com/news/1" || banner.StartsAt == nil {
		t.Fatalf("banner = %+v", banner)
	}

	// 未来开始时间未到，不应出现在 active 列表
	active, err := svc.ActiveBannerAnnouncements()
	if err != nil {
		t.Fatal(err)
	}
	if len(active) != 0 {
		t.Fatalf("future banner should not be active yet, got %d", len(active))
	}

	// 内链合法
	if _, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{Title: "内链", Link: "/projects", Status: "active"}); err != nil {
		t.Fatalf("internal link should be accepted: %v", err)
	}
	// 非法链接拒绝
	if _, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{Title: "坏链接", Link: "javascript:alert(1)", Status: "active"}); err == nil {
		t.Fatal("javascript: link should be rejected")
	}
	// 结束早于开始拒绝
	start := time.Now().Add(-time.Hour)
	end := time.Now().Add(-2 * time.Hour)
	if _, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{Title: "倒挂时间", Status: "active", StartsAt: &start, EndsAt: &end}); err == nil {
		t.Fatal("endsAt before startsAt should be rejected")
	}
}

func TestBannerAnnouncementValidityWindowFiltering(t *testing.T) {
	svc, _ := newAnnouncementImageTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}

	now := time.Now()
	past := now.Add(-48 * time.Hour)
	future := now.Add(48 * time.Hour)

	// 已结束：start 在过去、end 已过 → 不展示
	middle := past.Add(24 * time.Hour)
	if _, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{Title: "已过期", Status: "active", StartsAt: &past, EndsAt: &middle}); err != nil {
		t.Fatal(err)
	}
	// 生效中：start 已过、end 在未来 → 展示
	if _, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{Title: "生效中", Status: "active", StartsAt: &past, EndsAt: &future}); err != nil {
		t.Fatal(err)
	}
	// 未开始：start 在未来 → 不展示
	if _, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{Title: "未开始", Status: "active", StartsAt: &future}); err != nil {
		t.Fatal(err)
	}
	// 禁用：即使时间窗口内也不展示
	if _, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{Title: "被禁用", Status: "disabled"}); err != nil {
		t.Fatal(err)
	}

	active, err := svc.ActiveBannerAnnouncements()
	if err != nil {
		t.Fatal(err)
	}
	if len(active) != 1 || active[0].Title != "生效中" {
		t.Fatalf("active = %+v, want only 生效中", active)
	}
}

func TestBannerAnnouncementTitleRuns(t *testing.T) {
	svc, _ := newAnnouncementImageTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}

	size := 16
	weight := 700
	banner, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{
		TitleRuns: []model.BannerTitleRun{
			{Text: "限时", FontSize: &size, FontWeight: &weight, Color: "#ff0000"},
			{Text: "活动", FontSize: &size, FontWeight: &weight, Color: "#FF0000"},
			{Text: "已上线", FontFamily: "mono"},
		},
		Status: "active",
	})
	if err != nil {
		t.Fatal(err)
	}
	// 相邻同样式分段合并，纯文本标题由分段拼接得出，供列表与检索使用。
	if banner.Title != "限时活动已上线" {
		t.Fatalf("title = %q, want 限时活动已上线", banner.Title)
	}
	if len(banner.TitleRuns) != 2 {
		t.Fatalf("titleRuns = %+v, want 2 merged runs", banner.TitleRuns)
	}
	if banner.TitleRuns[0].Text != "限时活动" || banner.TitleRuns[0].Color != "#FF0000" {
		t.Fatalf("first run = %+v", banner.TitleRuns[0])
	}

	// 读回时样式分段必须完整保留（列存储 + 显式编解码的回归点）。
	stored, err := svc.repo.BannerAnnouncement(banner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.TitleRuns) != 2 || stored.TitleRuns[0].FontSize == nil || *stored.TitleRuns[0].FontSize != 16 {
		t.Fatalf("stored = %+v", stored.TitleRuns)
	}
	active, err := svc.ActiveBannerAnnouncements()
	if err != nil {
		t.Fatal(err)
	}
	if len(active) != 1 || len(active[0].TitleRuns) != 2 {
		t.Fatalf("active = %+v", active)
	}

	// 更新走显式 map，样式分段同样不能被丢掉。
	updated, err := svc.UpdateBannerAnnouncement(admin, banner.ID, UpdateBannerAnnouncementRequest{
		TitleRuns: []model.BannerTitleRun{{Text: "更新后的标题", Color: "#00FF00"}},
		Status:    "active",
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Title != "更新后的标题" || len(updated.TitleRuns) != 1 || updated.TitleRuns[0].Color != "#00FF00" {
		t.Fatalf("updated = %+v", updated)
	}

	// 只传纯文本时清空样式分段。
	plain, err := svc.UpdateBannerAnnouncement(admin, banner.ID, UpdateBannerAnnouncementRequest{Title: "纯文本标题", Status: "active"})
	if err != nil {
		t.Fatal(err)
	}
	if len(plain.TitleRuns) != 0 || plain.Title != "纯文本标题" {
		t.Fatalf("plain = %+v", plain)
	}
}

func TestBannerAnnouncementRejectsInvalidTitleRuns(t *testing.T) {
	svc, _ := newAnnouncementImageTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}

	size := func(value int) *int { return &value }
	weight := func(value int) *int { return &value }

	cases := []struct {
		name string
		req  CreateBannerAnnouncementRequest
	}{
		{name: "字号过小", req: CreateBannerAnnouncementRequest{TitleRuns: []model.BannerTitleRun{{Text: "标题", FontSize: size(9)}}, Status: "active"}},
		{name: "字号过大", req: CreateBannerAnnouncementRequest{TitleRuns: []model.BannerTitleRun{{Text: "标题", FontSize: size(21)}}, Status: "active"}},
		{name: "字重非法", req: CreateBannerAnnouncementRequest{TitleRuns: []model.BannerTitleRun{{Text: "标题", FontWeight: weight(6000)}}, Status: "active"}},
		{name: "字体非法", req: CreateBannerAnnouncementRequest{TitleRuns: []model.BannerTitleRun{{Text: "标题", FontFamily: "comic-sans"}}, Status: "active"}},
		{name: "颜色非法", req: CreateBannerAnnouncementRequest{TitleRuns: []model.BannerTitleRun{{Text: "标题", Color: "red"}}, Status: "active"}},
		{name: "颜色注入", req: CreateBannerAnnouncementRequest{TitleRuns: []model.BannerTitleRun{{Text: "标题", Color: "#fff;background:url(x)"}}, Status: "active"}},
		{name: "分段文本为空", req: CreateBannerAnnouncementRequest{TitleRuns: []model.BannerTitleRun{{Text: "", FontSize: size(14)}}, Status: "active"}},
	}
	for _, testCase := range cases {
		if _, err := svc.CreateBannerAnnouncement(admin, testCase.req); err == nil {
			t.Fatalf("%s: expected rejection", testCase.name)
		}
	}

	long := ""
	for range 121 {
		long += "字"
	}
	if _, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{TitleRuns: []model.BannerTitleRun{{Text: long}}, Status: "active"}); err == nil {
		t.Fatal("over-long run text should be rejected")
	}
	// 边界值可接受：10 与 20、四种字重、三种字体。
	for _, value := range []int{10, 20} {
		if _, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{TitleRuns: []model.BannerTitleRun{{Text: "标题", FontSize: size(value)}}, Status: "active"}); err != nil {
			t.Fatalf("font size %d should be accepted: %v", value, err)
		}
	}
	for _, value := range []int{400, 500, 600, 700} {
		if _, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{TitleRuns: []model.BannerTitleRun{{Text: "标题", FontWeight: weight(value)}}, Status: "active"}); err != nil {
			t.Fatalf("font weight %d should be accepted: %v", value, err)
		}
	}
	for _, value := range []string{"sans", "serif", "mono"} {
		if _, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{TitleRuns: []model.BannerTitleRun{{Text: "标题", FontFamily: value}}, Status: "active"}); err != nil {
			t.Fatalf("font family %q should be accepted: %v", value, err)
		}
	}
}

func TestBannerAnnouncementNoticeType(t *testing.T) {
	svc, _ := newAnnouncementImageTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}

	// 未传类型时补成默认值，行数据始终是可直接渲染的具体取值。
	def, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{Title: "默认外观", Status: "active"})
	if err != nil {
		t.Fatal(err)
	}
	if def.NoticeType != bannerNoticeDefaultType {
		t.Fatalf("default noticeType = %q", def.NoticeType)
	}

	banner, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{
		Title:      "限时活动通知",
		NoticeType: "activity",
		Status:     "active",
	})
	if err != nil {
		t.Fatal(err)
	}
	if banner.NoticeType != "activity" {
		t.Fatalf("banner = %+v", banner)
	}

	// 读回路径（仓储 + 公开接口）都要保留类型。
	stored, err := svc.repo.BannerAnnouncement(banner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.NoticeType != "activity" {
		t.Fatalf("stored = %+v", stored)
	}
	active, err := svc.ActiveBannerAnnouncements()
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range active {
		if item.ID == banner.ID && item.NoticeType == "activity" {
			found = true
		}
	}
	if !found {
		t.Fatalf("active = %+v, want activity", active)
	}

	// 更新走显式字段表，漏字段会被静默清空的回归点。
	updated, err := svc.UpdateBannerAnnouncement(admin, banner.ID, UpdateBannerAnnouncementRequest{
		Title:      "改成警告",
		NoticeType: "warning",
		Status:     "active",
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.NoticeType != "warning" {
		t.Fatalf("updated = %+v", updated)
	}
	reloaded, err := svc.repo.BannerAnnouncement(banner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.NoticeType != "warning" {
		t.Fatalf("reloaded = %+v", reloaded)
	}

	// 边界：全部合法取值都必须被接受，否则后台选了却被静默丢弃。
	for value := range bannerNoticeTypes {
		created, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{Title: "类型 " + value, NoticeType: value, Status: "active"})
		if err != nil {
			t.Fatalf("notice type %q should be accepted: %v", value, err)
		}
		if created.NoticeType != value {
			t.Fatalf("notice type %q normalized to %q", value, created.NoticeType)
		}
	}

	// 大小写与空格归一化。
	normalized, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{Title: "归一化", NoticeType: " ACTIVITY ", Status: "active"})
	if err != nil {
		t.Fatal(err)
	}
	if normalized.NoticeType != "activity" {
		t.Fatalf("normalized = %+v", normalized)
	}
}

func TestBannerAnnouncementRejectsUnknownNoticeType(t *testing.T) {
	svc, _ := newAnnouncementImageTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}

	cases := []struct {
		name string
		req  CreateBannerAnnouncementRequest
	}{
		{name: "类型不在白名单", req: CreateBannerAnnouncementRequest{Title: "标题", NoticeType: "danger", Status: "active"}},
		{name: "类型注入", req: CreateBannerAnnouncementRequest{Title: "标题", NoticeType: "notice;--x:1", Status: "active"}},
	}
	for _, testCase := range cases {
		if _, err := svc.CreateBannerAnnouncement(admin, testCase.req); err == nil {
			t.Fatalf("%s: expected rejection", testCase.name)
		}
	}

	// 更新路径同样受白名单约束，不能绕过校验改坏已存在的行。
	created, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{Title: "已有通知", Status: "active"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateBannerAnnouncement(admin, created.ID, UpdateBannerAnnouncementRequest{Title: "改坏", NoticeType: "rainbow", Status: "active"}); err == nil {
		t.Fatal("update with unknown notice type should be rejected")
	}
}

// emoji 图标素材就是普通文本分段：不需要独立字段或白名单，但必须能完整往返、并入纯文本标题参与检索。
func TestBannerAnnouncementTitleRunsWithEmoji(t *testing.T) {
	svc, _ := newAnnouncementImageTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}

	banner, err := svc.CreateBannerAnnouncement(admin, CreateBannerAnnouncementRequest{
		TitleRuns: []model.BannerTitleRun{
			{Text: "💰"},
			{Text: "双 11 预售开启，全场"},
			{Text: "5 折", Color: "#FFE58F", FontWeight: func() *int { v := 700; return &v }()},
			{Text: "🚀"},
		},
		NoticeType: "activity",
		Status:     "active",
	})
	if err != nil {
		t.Fatal(err)
	}
	if banner.Title != "💰双 11 预售开启，全场5 折🚀" {
		t.Fatalf("title = %q", banner.Title)
	}
	if len(banner.TitleRuns) != 3 {
		t.Fatalf("titleRuns = %+v, want 3（开头 emoji 与正文同为默认样式应合并）", banner.TitleRuns)
	}

	stored, err := svc.repo.BannerAnnouncement(banner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.TitleRuns) != 3 {
		t.Fatalf("stored = %+v", stored.TitleRuns)
	}
	active, err := svc.ActiveBannerAnnouncements()
	if err != nil {
		t.Fatal(err)
	}
	if len(active) != 1 || active[0].Title != banner.Title {
		t.Fatalf("active = %+v", active)
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
