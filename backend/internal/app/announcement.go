package app

import (
	"errors"
	"fmt"
	"log"
	"mime/multipart"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

const AnnouncementImageMaxBytes int64 = 10 << 20
const announcementImageDraftTTL = 24 * time.Hour

type CreateAnnouncementRequest struct {
	Title           string                  `json:"title"`
	Content         string                  `json:"content"`
	ImageResourceID string                  `json:"imageResourceId"`
	Level           model.AnnouncementLevel `json:"level"`
	Pinned          bool                    `json:"pinned"`
}

type UpdateAnnouncementRequest = CreateAnnouncementRequest

type AnnouncementPage struct {
	Announcements []model.Announcement `json:"announcements"`
	Total         int64                `json:"total"`
	Page          int                  `json:"page"`
	Limit         int                  `json:"pageSize"`
}

type UserAnnouncementFeed struct {
	Announcements []model.Announcement `json:"announcements"`
	UnreadCount   int64                `json:"unreadCount"`
}

func (s *Service) AdminAnnouncementPage(actor *model.User, query AdminListQuery) (*AnnouncementPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, limit := normalizeAdminPage(query.Page, query.Limit)
	announcements, total, err := s.repo.AdminAnnouncements(query.Keyword, model.AnnouncementStatus(query.Status), limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	for index := range announcements {
		decorateAnnouncement(&announcements[index])
	}
	return &AnnouncementPage{Announcements: announcements, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) CreateAnnouncement(actor *model.User, req CreateAnnouncementRequest) (*model.Announcement, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	title, content, level, err := normalizeAnnouncementInput(req)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.ImageResourceID) != "" {
		s.storageMu.Lock()
		defer s.storageMu.Unlock()
	}
	imageResourceID, err := s.validateAnnouncementImageDraft(actor, req.ImageResourceID)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	announcement := &model.Announcement{
		ID: newID(), Title: title, Content: content, ImageResourceID: imageResourceID, Level: level, Pinned: req.Pinned,
		Status: model.AnnouncementStatusActive, CreatedBy: actor.ID, PublishedAt: now, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.CreateAnnouncementWithImage(announcement); err != nil {
		if errors.Is(err, repository.ErrAnnouncementImageDraftUnavailable) {
			return nil, BadAuthRequest("公告配图草稿已失效，请重新上传")
		}
		return nil, err
	}
	decorateAnnouncement(announcement)
	return announcement, nil
}

func (s *Service) UpdateAnnouncement(actor *model.User, id string, req UpdateAnnouncementRequest) (*model.Announcement, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	announcement, err := s.repo.Announcement(strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, BadAuthRequest("公告不存在")
		}
		return nil, err
	}
	title, content, level, err := normalizeAnnouncementInput(req)
	if err != nil {
		return nil, err
	}
	imageResourceID := strings.TrimSpace(req.ImageResourceID)
	newDraftResourceID := ""
	if imageResourceID != announcement.ImageResourceID {
		if imageResourceID != "" {
			imageResourceID, err = s.validateAnnouncementImageDraft(actor, imageResourceID)
			if err != nil {
				return nil, err
			}
			newDraftResourceID = imageResourceID
		}
	}
	var oldResource *model.Resource
	var deletionJob *model.ResourceDeletionJob
	if announcement.ImageResourceID != "" && announcement.ImageResourceID != imageResourceID {
		oldResource, err = s.repo.Resource(announcement.ImageResourceID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, BadAuthRequest("原公告配图资源不存在，已停止更新以避免数据不一致")
			}
			return nil, err
		}
		if err := s.ensureResourceHasNoBusinessReferences(oldResource, repository.ResourceDirectReference{Kind: "公告", ID: announcement.ID}); err != nil {
			return nil, err
		}
		sharedCount, countErr := s.repo.ResourceStorageReferenceCount(oldResource, []string{oldResource.ID})
		if countErr != nil {
			return nil, countErr
		}
		if sharedCount == 0 {
			jobs := resourceDeletionJobs(oldResource.UserID, map[string]*model.Resource{resourceStorageIdentity(oldResource): oldResource})
			if len(jobs) != 1 {
				return nil, errors.New("无法创建公告配图删除任务")
			}
			deletionJob = &jobs[0]
		}
	}
	now := time.Now()
	announcement.Title = title
	announcement.Content = content
	announcement.ImageResourceID = imageResourceID
	announcement.Level = level
	announcement.Pinned = req.Pinned
	announcement.Status = model.AnnouncementStatusActive
	announcement.ClosedAt = nil
	announcement.PublishedAt = now
	announcement.UpdatedAt = now
	if err := s.repo.UpdateAnnouncementWithImage(announcement, actor.ID, newDraftResourceID, oldResource, deletionJob); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, BadAuthRequest("公告状态已变化，请刷新后重试")
		}
		if errors.Is(err, repository.ErrAnnouncementImageDraftUnavailable) {
			return nil, BadAuthRequest("公告配图草稿已失效，请重新上传")
		}
		if errors.Is(err, repository.ErrAnnouncementImageReferenced) {
			return nil, BadAuthRequest("原公告配图仍被其他公告引用，已停止更新")
		}
		return nil, err
	}
	decorateAnnouncement(announcement)
	return announcement, nil
}

func (s *Service) CloseAnnouncement(actor *model.User, id string) (*model.Announcement, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	announcement, err := s.repo.Announcement(strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, BadAuthRequest("公告不存在")
		}
		return nil, err
	}
	if announcement.Status == model.AnnouncementStatusClosed {
		return nil, BadAuthRequest("公告已经关闭")
	}
	updated, err := s.repo.CloseAnnouncement(announcement.ID, time.Now())
	if err != nil {
		return nil, err
	}
	if !updated {
		return nil, BadAuthRequest("公告状态已变化，请刷新后重试")
	}
	closed, err := s.repo.Announcement(announcement.ID)
	if err != nil {
		return nil, err
	}
	decorateAnnouncement(closed)
	return closed, nil
}

func (s *Service) UserAnnouncements(user *model.User) (*UserAnnouncementFeed, error) {
	if user == nil {
		return nil, Unauthorized("请先登录")
	}
	announcements, unreadCount, err := s.repo.AnnouncementFeed(user.ID)
	if err != nil {
		return nil, err
	}
	for index := range announcements {
		decorateAnnouncement(&announcements[index])
	}
	return &UserAnnouncementFeed{Announcements: announcements, UnreadCount: unreadCount}, nil
}

func (s *Service) UploadAnnouncementImage(actor *model.User, header *multipart.FileHeader) (*model.Resource, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if err := validateAnnouncementImageUpload(header); err != nil {
		return nil, err
	}
	resource, err := s.UploadResource(actor.ID, header, "image", 0, 0, 0)
	if err != nil {
		return nil, err
	}
	draft := &model.AnnouncementImageDraft{ResourceID: resource.ID, UserID: actor.ID, CreatedAt: time.Now()}
	if err := s.repo.CreateAnnouncementImageDraft(draft); err != nil {
		cleanupErr := s.deleteFreshAnnouncementImageResource(resource)
		if cleanupErr != nil {
			return nil, errors.Join(err, fmt.Errorf("清理未登记的公告配图失败：%w", cleanupErr))
		}
		return nil, err
	}
	resource.PublicURL = ""
	return resource, nil
}

func (s *Service) DiscardAnnouncementImage(actor *model.User, resourceID string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	return s.discardAnnouncementImageDraft(actor.ID, resourceID)
}

func (s *Service) OpenAnnouncementImage(actor *model.User, announcementID string, rangeHeader string) (*ResourceStream, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	announcement, err := s.repo.Announcement(strings.TrimSpace(announcementID))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("公告不存在")
		}
		return nil, err
	}
	if actor.Role != model.UserRoleAdmin && announcement.Status != model.AnnouncementStatusActive {
		return nil, Forbidden("公告不可访问")
	}
	if announcement.ImageResourceID == "" {
		return nil, NotFound("公告配图不存在")
	}
	resource, err := s.repo.Resource(announcement.ImageResourceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("公告配图不存在")
		}
		return nil, err
	}
	if resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
		return nil, BadAuthRequest("公告配图资源不可用")
	}
	return s.openResourceRange(resource.UserID, resource, rangeHeader)
}

func (s *Service) PrepareAnnouncementImageDelivery(actor *model.User, announcementID string, options ResourceAccessOptions, rangeHeader string) (*ResourceDelivery, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	announcement, err := s.repo.Announcement(strings.TrimSpace(announcementID))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("公告不存在")
		}
		return nil, err
	}
	if actor.Role != model.UserRoleAdmin && announcement.Status != model.AnnouncementStatusActive {
		return nil, Forbidden("公告不可访问")
	}
	if announcement.ImageResourceID == "" {
		return nil, NotFound("公告配图不存在")
	}
	resource, err := s.repo.Resource(announcement.ImageResourceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("公告配图不存在")
		}
		return nil, err
	}
	if resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
		return nil, BadAuthRequest("公告配图资源不可用")
	}
	if options.Purpose == "" {
		options.Purpose = assets.PurposeDisplay
	}
	return s.prepareResourceDelivery(resource.UserID, resource, options, rangeHeader)
}

func (s *Service) cleanupStaleAnnouncementImageDrafts() {
	for {
		drafts, err := s.repo.StaleAnnouncementImageDrafts(time.Now().Add(-announcementImageDraftTTL), 50)
		if err != nil {
			log.Printf("announcement image draft cleanup query failed: %v", err)
			return
		}
		if len(drafts) == 0 {
			return
		}
		cleaned := 0
		for _, draft := range drafts {
			if err := s.discardAnnouncementImageDraft(draft.UserID, draft.ResourceID); err != nil {
				log.Printf("announcement image draft cleanup failed for %s: %v", draft.ResourceID, err)
				continue
			}
			cleaned++
		}
		if len(drafts) < 50 || cleaned == 0 {
			return
		}
	}
}

func (s *Service) discardAnnouncementImageDraft(userID string, resourceID string) error {
	resourceID = strings.TrimSpace(resourceID)
	if resourceID == "" || len(resourceID) > 64 {
		return BadAuthRequest("公告配图资源 ID 无效")
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	if _, err := s.repo.AnnouncementImageDraftForUser(userID, resourceID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return NotFound("公告配图草稿不存在")
		}
		return err
	}
	resource, err := s.repo.ResourceForUser(userID, resourceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if deleteErr := s.repo.DeleteAnnouncementImageDraft(userID, resourceID); deleteErr != nil {
				return errors.Join(err, fmt.Errorf("清理失效公告配图草稿失败：%w", deleteErr))
			}
			return nil
		}
		return err
	}
	if err := s.ensureResourceHasNoBusinessReferences(resource, repository.ResourceDirectReference{Kind: "公告草稿", ID: resource.ID}); err != nil {
		return err
	}
	sharedCount, err := s.repo.ResourceStorageReferenceCount(resource, []string{resource.ID})
	if err != nil {
		return err
	}
	var deletionJob *model.ResourceDeletionJob
	if sharedCount == 0 {
		jobs := resourceDeletionJobs(userID, map[string]*model.Resource{resourceStorageIdentity(resource): resource})
		if len(jobs) != 1 {
			return errors.New("无法创建公告配图删除任务")
		}
		deletionJob = &jobs[0]
	}
	if err := s.repo.DiscardAnnouncementImageDraft(userID, resource, deletionJob); err != nil {
		if errors.Is(err, repository.ErrAnnouncementImageReferenced) {
			return BadAuthRequest("公告配图已经发布，不能按草稿删除")
		}
		return err
	}
	return nil
}

func (s *Service) ensureResourceHasNoBusinessReferences(resource *model.Resource, ignoredDirect ...repository.ResourceDirectReference) error {
	if resource == nil {
		return NotFound("资源不存在")
	}
	snapshot, err := s.repo.ResourceReferenceSnapshot(resource.UserID, "", []string{resource.ID})
	if err != nil {
		return err
	}
	hasBlocking := false
DirectLoop:
	for _, direct := range snapshot.Direct {
		for _, ignored := range ignoredDirect {
			if direct.Kind == ignored.Kind && direct.ID == ignored.ID {
				continue DirectLoop
			}
		}
		hasBlocking = true
		break
	}
	if hasBlocking {
		return BadAuthRequest("公告配图仍被其他业务数据引用，已停止删除")
	}
	resourceIDs := map[string]struct{}{resource.ID: {}}
	for _, document := range snapshot.Documents {
		if documentReferencesResources(document.PrimaryJSON, resourceIDs) || documentReferencesResources(document.SecondaryJSON, resourceIDs) {
			return BadAuthRequest("公告配图仍被其他业务数据引用，已停止删除")
		}
	}
	return nil
}

func (s *Service) validateAnnouncementImageDraft(actor *model.User, resourceID string) (string, error) {
	resourceID = strings.TrimSpace(resourceID)
	if resourceID == "" {
		return "", nil
	}
	if len(resourceID) > 64 {
		return "", BadAuthRequest("公告配图资源 ID 无效")
	}
	if _, err := s.repo.AnnouncementImageDraftForUser(actor.ID, resourceID); err != nil {
		return "", BadAuthRequest("公告配图草稿不存在或不属于当前管理员")
	}
	resource, err := s.repo.ResourceForUser(actor.ID, resourceID)
	if err != nil {
		return "", BadAuthRequest("公告配图资源不存在或不属于当前管理员")
	}
	if resource.Kind != "image" || resource.Status != model.ResourceStatusReady || !strings.HasPrefix(strings.ToLower(resource.MimeType), "image/") {
		return "", BadAuthRequest("公告配图必须是上传完成的图片")
	}
	return resourceID, nil
}

func validateAnnouncementImageUpload(header *multipart.FileHeader) error {
	if header == nil {
		return BadAuthRequest("请选择公告配图")
	}
	if header.Size <= 0 || header.Size > AnnouncementImageMaxBytes {
		return BadAuthRequest("公告配图大小必须在 10MB 以内")
	}
	file, err := header.Open()
	if err != nil {
		return err
	}
	defer file.Close()
	buffer := make([]byte, 512)
	read, err := file.Read(buffer)
	if err != nil && read == 0 {
		return BadAuthRequest("公告配图内容无法读取")
	}
	if detected := http.DetectContentType(buffer[:read]); !strings.HasPrefix(strings.ToLower(detected), "image/") {
		return BadAuthRequest("公告配图必须是真实图片文件")
	}
	return nil
}

func (s *Service) deleteFreshAnnouncementImageResource(resource *model.Resource) error {
	if resource == nil {
		return nil
	}
	if err := s.deleteStoredResourceObject(resource.UserID, resource); err != nil {
		return err
	}
	return s.repo.DeleteResource(resource.UserID, resource.ID)
}

func decorateAnnouncement(announcement *model.Announcement) {
	if announcement == nil || strings.TrimSpace(announcement.ImageResourceID) == "" {
		return
	}
	announcement.ImageURL = "/api/announcements/" + announcement.ID + "/image"
}

func (s *Service) MarkAnnouncementsRead(user *model.User, announcementIDs []string) (int64, error) {
	if user == nil {
		return 0, Unauthorized("请先登录")
	}
	if len(announcementIDs) > 5000 {
		return 0, BadAuthRequest("单次已读公告数量过多")
	}
	ids := uniqueNonEmpty(announcementIDs)
	for _, id := range ids {
		if len(id) > 64 {
			return 0, BadAuthRequest("公告 ID 无效")
		}
	}
	if err := s.repo.MarkAnnouncementsRead(user.ID, ids, time.Now()); err != nil {
		return 0, err
	}
	_, unreadCount, err := s.repo.AnnouncementFeed(user.ID)
	return unreadCount, err
}

func validAnnouncementLevel(level model.AnnouncementLevel) bool {
	return level == model.AnnouncementLevelInfo || level == model.AnnouncementLevelSuccess || level == model.AnnouncementLevelWarning || level == model.AnnouncementLevelCritical
}

func normalizeAnnouncementInput(req CreateAnnouncementRequest) (string, string, model.AnnouncementLevel, error) {
	title := strings.TrimSpace(req.Title)
	content := strings.TrimSpace(req.Content)
	if title == "" {
		return "", "", "", BadAuthRequest("请填写公告标题")
	}
	if utf8.RuneCountInString(title) > 120 {
		return "", "", "", BadAuthRequest("公告标题不能超过 120 个字符")
	}
	if utf8.RuneCountInString(content) > 4000 {
		return "", "", "", BadAuthRequest("公告正文不能超过 4000 个字符")
	}
	if !validAnnouncementLevel(req.Level) {
		return "", "", "", BadAuthRequest("公告级别无效")
	}
	if len(strings.TrimSpace(req.ImageResourceID)) > 64 {
		return "", "", "", BadAuthRequest("公告配图资源 ID 无效")
	}
	return title, content, req.Level, nil
}

type CreateBannerAnnouncementRequest struct {
	Title string `json:"title"`
	// TitleRuns 是标题的样式分段；非空时 Title 由分段文本拼接得出，请求里的 Title 只作兼容兜底。
	TitleRuns []model.BannerTitleRun `json:"titleRuns"`
	// NoticeType 通知类型，决定通知条底色；空值按默认类型（公告）处理。
	// 图标素材（emoji）内嵌在 TitleRuns 的文本里，不单独存字段。
	NoticeType string     `json:"noticeType"`
	Link       string     `json:"link"`
	Status     string     `json:"status"` // "active" | "disabled"
	StartsAt   *time.Time `json:"startsAt"`
	EndsAt     *time.Time `json:"endsAt"`
}

type UpdateBannerAnnouncementRequest = CreateBannerAnnouncementRequest

type BannerAnnouncementPage struct {
	Banners []model.BannerAnnouncement `json:"banners"`
	Total   int64                      `json:"total"`
	Page    int                        `json:"page"`
	Limit   int                        `json:"pageSize"`
}

func (s *Service) ActiveBannerAnnouncements() ([]model.BannerAnnouncement, error) {
	banners, err := s.repo.ActiveBannerAnnouncements(time.Now())
	if err != nil {
		return nil, err
	}
	if banners == nil {
		banners = []model.BannerAnnouncement{}
	}
	return banners, nil
}

func (s *Service) AdminBannerAnnouncementPage(actor *model.User, query AdminListQuery) (*BannerAnnouncementPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, limit := normalizeAdminPage(query.Page, query.Limit)
	banners, total, err := s.repo.AdminBannerAnnouncements(query.Keyword, query.Status, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	if banners == nil {
		banners = []model.BannerAnnouncement{}
	}
	return &BannerAnnouncementPage{Banners: banners, Total: total, Page: page, Limit: limit}, nil
}

// 标题样式分段的边界：字号与字重只接受固定档位，字体与颜色进白名单，避免把任意 CSS 写进通知条。
const (
	bannerTitleMinFontSize  = 10
	bannerTitleMaxFontSize  = 20
	bannerTitleMaxRuns      = 60
	bannerTitleMaxTextRunes = 120
)

var bannerTitleFontWeights = map[int]struct{}{400: {}, 500: {}, 600: {}, 700: {}}
var bannerTitleFontFamilies = map[string]struct{}{"sans": {}, "serif": {}, "mono": {}}

// normalizeBannerTitle 统一处理标题与样式分段：分段非空时以分段文本为准，分段为空时回落到纯文本标题。
func normalizeBannerTitle(title string, runs []model.BannerTitleRun) (string, []model.BannerTitleRun, error) {
	normalized, err := normalizeBannerTitleRuns(runs)
	if err != nil {
		return "", nil, err
	}
	if len(normalized) == 0 {
		plain := strings.TrimSpace(title)
		if plain == "" {
			return "", nil, BadAuthRequest("请填写通知标题")
		}
		if utf8.RuneCountInString(plain) > bannerTitleMaxTextRunes {
			return "", nil, BadAuthRequest("通知标题不能超过 120 个字符")
		}
		return plain, nil, nil
	}
	plain := strings.TrimSpace(bannerTitleRunsText(normalized))
	if plain == "" {
		return "", nil, BadAuthRequest("请填写通知标题")
	}
	if utf8.RuneCountInString(plain) > bannerTitleMaxTextRunes {
		return "", nil, BadAuthRequest("通知标题不能超过 120 个字符")
	}
	return plain, normalized, nil
}

func normalizeBannerTitleRuns(runs []model.BannerTitleRun) ([]model.BannerTitleRun, error) {
	if len(runs) == 0 {
		return nil, nil
	}
	if len(runs) > bannerTitleMaxRuns {
		return nil, BadAuthRequest("通知标题样式片段过多")
	}
	normalized := make([]model.BannerTitleRun, 0, len(runs))
	for _, run := range runs {
		if run.FontSize != nil {
			value := *run.FontSize
			if value < bannerTitleMinFontSize || value > bannerTitleMaxFontSize {
				return nil, BadAuthRequest("标题字号需在 10 到 20 之间")
			}
			run.FontSize = &value
		}
		if run.FontWeight != nil {
			value := *run.FontWeight
			if _, ok := bannerTitleFontWeights[value]; !ok {
				return nil, BadAuthRequest("标题字重仅支持 400 / 500 / 600 / 700")
			}
			run.FontWeight = &value
		}
		family := strings.TrimSpace(run.FontFamily)
		if family != "" {
			if _, ok := bannerTitleFontFamilies[family]; !ok {
				return nil, BadAuthRequest("标题字体仅支持默认、衬线或等宽")
			}
		}
		run.FontFamily = family
		color := strings.ToUpper(strings.TrimSpace(run.Color))
		if color != "" && !isBannerTitleHexColor(color) {
			return nil, BadAuthRequest("标题颜色需为 #RRGGBB 格式")
		}
		run.Color = color
		if run.Text == "" {
			continue
		}
		normalized = append(normalized, run)
	}
	return mergeBannerTitleRuns(normalized), nil
}

// mergeBannerTitleRuns 合并相邻的同样式分段，避免前端反复编辑后存下大量零碎片段。
func mergeBannerTitleRuns(runs []model.BannerTitleRun) []model.BannerTitleRun {
	merged := make([]model.BannerTitleRun, 0, len(runs))
	for _, run := range runs {
		if len(merged) > 0 && sameBannerTitleRunStyle(merged[len(merged)-1], run) {
			merged[len(merged)-1].Text += run.Text
			continue
		}
		merged = append(merged, run)
	}
	return merged
}

func sameBannerTitleRunStyle(left model.BannerTitleRun, right model.BannerTitleRun) bool {
	return equalIntPointer(left.FontSize, right.FontSize) &&
		equalIntPointer(left.FontWeight, right.FontWeight) &&
		left.FontFamily == right.FontFamily &&
		left.Color == right.Color
}

func equalIntPointer(left *int, right *int) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func isBannerTitleHexColor(value string) bool {
	if len(value) != 7 || value[0] != '#' {
		return false
	}
	for _, char := range value[1:] {
		if (char >= '0' && char <= '9') || (char >= 'A' && char <= 'F') {
			continue
		}
		return false
	}
	return true
}

func bannerTitleRunsText(runs []model.BannerTitleRun) string {
	var text strings.Builder
	for _, run := range runs {
		text.WriteString(run.Text)
	}
	return text.String()
}

func normalizeBannerLink(link string) (string, error) {
	link = strings.TrimSpace(link)
	if link == "" {
		return "", nil
	}
	lower := strings.ToLower(link)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		if utf8.RuneCountInString(link) > 500 {
			return "", BadAuthRequest("跳转链接不能超过 500 个字符")
		}
		return link, nil
	}
	if strings.HasPrefix(link, "/") {
		if utf8.RuneCountInString(link) > 500 {
			return "", BadAuthRequest("站内路径不能超过 500 个字符")
		}
		return link, nil
	}
	return "", BadAuthRequest("跳转链接仅支持 http(s) 外链或以 / 开头的站内路径")
}

// 通知类型的取值白名单。
//
// 必须与前端 web/src/lib/announcements/banner-notice.ts 的 BANNER_NOTICE_TYPES 逐项一致：
// 后端多一项会让前端的合法取值被拒，少一项会让前端选中的值被静默丢弃；
// web/test/banner-notice.test.ts 会读本文件做双向校验。
// 图标素材（emoji）是普通文本，随 TitleRuns 走，不需要单独白名单。
var bannerNoticeTypes = map[string]struct{}{
	"notice": {}, "activity": {}, "update": {}, "warning": {},
}

const bannerNoticeDefaultType = "notice"

// normalizeBannerNoticeType 把空值补成默认类型，其余值必须在白名单内，避免存进无法渲染的类型。
func normalizeBannerNoticeType(value string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return bannerNoticeDefaultType, nil
	}
	if _, ok := bannerNoticeTypes[normalized]; !ok {
		return "", BadAuthRequest("通知类型无效，仅支持公告、活动、更新或警告")
	}
	return normalized, nil
}

func (s *Service) CreateBannerAnnouncement(actor *model.User, req CreateBannerAnnouncementRequest) (*model.BannerAnnouncement, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	title, titleRuns, err := normalizeBannerTitle(req.Title, req.TitleRuns)
	if err != nil {
		return nil, err
	}
	link, err := normalizeBannerLink(req.Link)
	if err != nil {
		return nil, err
	}
	noticeType, err := normalizeBannerNoticeType(req.NoticeType)
	if err != nil {
		return nil, err
	}
	status := strings.TrimSpace(req.Status)
	if status != "active" && status != "disabled" {
		return nil, BadAuthRequest("通知状态无效，仅支持 active 或 disabled")
	}
	if req.StartsAt != nil && req.EndsAt != nil && req.EndsAt.Before(*req.StartsAt) {
		return nil, BadAuthRequest("有效期结束时间不能早于开始时间")
	}
	now := time.Now()
	banner := &model.BannerAnnouncement{
		ID:         newID(),
		Title:      title,
		TitleRuns:  titleRuns,
		NoticeType: noticeType,
		Link:       link,
		Status:     status,
		StartsAt:   req.StartsAt,
		EndsAt:     req.EndsAt,
		CreatedBy:  actor.ID,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if err := s.repo.CreateBannerAnnouncement(banner); err != nil {
		return nil, err
	}
	return banner, nil
}

func (s *Service) UpdateBannerAnnouncement(actor *model.User, id string, req UpdateBannerAnnouncementRequest) (*model.BannerAnnouncement, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	banner, err := s.repo.BannerAnnouncement(strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, BadAuthRequest("常驻通知不存在")
		}
		return nil, err
	}
	title, titleRuns, err := normalizeBannerTitle(req.Title, req.TitleRuns)
	if err != nil {
		return nil, err
	}
	link, err := normalizeBannerLink(req.Link)
	if err != nil {
		return nil, err
	}
	noticeType, err := normalizeBannerNoticeType(req.NoticeType)
	if err != nil {
		return nil, err
	}
	status := strings.TrimSpace(req.Status)
	if status != "active" && status != "disabled" {
		return nil, BadAuthRequest("通知状态无效，仅支持 active 或 disabled")
	}
	if req.StartsAt != nil && req.EndsAt != nil && req.EndsAt.Before(*req.StartsAt) {
		return nil, BadAuthRequest("有效期结束时间不能早于开始时间")
	}
	banner.Title = title
	banner.TitleRuns = titleRuns
	banner.NoticeType = noticeType
	banner.Link = link
	banner.Status = status
	banner.StartsAt = req.StartsAt
	banner.EndsAt = req.EndsAt
	banner.UpdatedAt = time.Now()

	if err := s.repo.UpdateBannerAnnouncement(banner); err != nil {
		return nil, err
	}
	return banner, nil
}

func (s *Service) DeleteBannerAnnouncement(actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	_, err := s.repo.BannerAnnouncement(strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return BadAuthRequest("常驻通知不存在")
		}
		return err
	}
	return s.repo.DeleteBannerAnnouncement(strings.TrimSpace(id))
}
