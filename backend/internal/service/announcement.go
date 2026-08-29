package service

import (
	"errors"
	"fmt"
	"log"
	"mime/multipart"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

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
	Limit         int                  `json:"limit"`
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
		if err := s.ensureResourceHasNoBusinessReferences(oldResource); err != nil {
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
	if err := s.ensureResourceHasNoBusinessReferences(resource); err != nil {
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

func (s *Service) ensureResourceHasNoBusinessReferences(resource *model.Resource) error {
	if resource == nil {
		return NotFound("资源不存在")
	}
	snapshot, err := s.repo.ResourceReferenceSnapshot(resource.UserID, "", []string{resource.ID})
	if err != nil {
		return err
	}
	if len(snapshot.Direct) > 0 {
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
	if title == "" || content == "" {
		return "", "", "", BadAuthRequest("请填写公告标题和正文")
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
