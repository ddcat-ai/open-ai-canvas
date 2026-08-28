package service

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

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
	imageResourceID, err := s.validateAnnouncementImage(actor, req.ImageResourceID)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	announcement := &model.Announcement{
		ID: newID(), Title: title, Content: content, ImageResourceID: imageResourceID, Level: level, Pinned: req.Pinned,
		Status: model.AnnouncementStatusActive, CreatedBy: actor.ID, PublishedAt: now, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.Create(announcement); err != nil {
		return nil, err
	}
	decorateAnnouncement(announcement)
	return announcement, nil
}

func (s *Service) UpdateAnnouncement(actor *model.User, id string, req UpdateAnnouncementRequest) (*model.Announcement, error) {
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
	title, content, level, err := normalizeAnnouncementInput(req)
	if err != nil {
		return nil, err
	}
	imageResourceID, err := s.validateAnnouncementImage(actor, req.ImageResourceID)
	if err != nil {
		return nil, err
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
	if err := s.repo.UpdateAnnouncement(announcement); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, BadAuthRequest("公告状态已变化，请刷新后重试")
		}
		return nil, err
	}
	updated, err := s.repo.Announcement(announcement.ID)
	if err != nil {
		return nil, err
	}
	decorateAnnouncement(updated)
	return updated, nil
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
	updated, err := s.repo.Announcement(announcement.ID)
	if err != nil {
		return nil, err
	}
	decorateAnnouncement(updated)
	return updated, nil
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

func (s *Service) OpenAnnouncementImage(actor *model.User, announcementID string, rangeHeader string) (*ResourceStream, error) {
	resource, err := s.announcementImageResource(actor, announcementID)
	if err != nil {
		return nil, err
	}
	return s.openResourceRange(resource.UserID, resource, rangeHeader)
}

func (s *Service) announcementImageResource(actor *model.User, announcementID string) (*model.Resource, error) {
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
	if strings.TrimSpace(announcement.ImageResourceID) == "" {
		return nil, BadAuthRequest("该公告没有配图")
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
	return resource, nil
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
	if strings.TrimSpace(req.ImageResourceID) != "" && len(strings.TrimSpace(req.ImageResourceID)) > 64 {
		return "", "", "", BadAuthRequest("公告配图资源 ID 无效")
	}
	return title, content, req.Level, nil
}

func (s *Service) validateAnnouncementImage(actor *model.User, id string) (string, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return "", nil
	}
	if actor == nil {
		return "", Unauthorized("请先登录")
	}
	resource, err := s.repo.ResourceForUser(actor.ID, id)
	if err != nil {
		return "", BadAuthRequest("公告配图不存在或不属于当前管理员")
	}
	if resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
		return "", BadAuthRequest("公告配图必须是已上传完成的图片")
	}
	return id, nil
}

func decorateAnnouncement(announcement *model.Announcement) {
	if announcement == nil || strings.TrimSpace(announcement.ImageResourceID) == "" {
		return
	}
	announcement.ImageURL = "/api/announcements/" + announcement.ID + "/image"
}
