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
	Title   string                  `json:"title"`
	Content string                  `json:"content"`
	Level   model.AnnouncementLevel `json:"level"`
}

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
	return &AnnouncementPage{Announcements: announcements, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) CreateAnnouncement(actor *model.User, req CreateAnnouncementRequest) (*model.Announcement, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	title := strings.TrimSpace(req.Title)
	content := strings.TrimSpace(req.Content)
	if title == "" || content == "" {
		return nil, BadAuthRequest("请填写公告标题和正文")
	}
	if utf8.RuneCountInString(title) > 120 {
		return nil, BadAuthRequest("公告标题不能超过 120 个字符")
	}
	if utf8.RuneCountInString(content) > 4000 {
		return nil, BadAuthRequest("公告正文不能超过 4000 个字符")
	}
	level := req.Level
	if !validAnnouncementLevel(level) {
		return nil, BadAuthRequest("公告级别无效")
	}
	now := time.Now()
	announcement := &model.Announcement{
		ID:          newID(),
		Title:       title,
		Content:     content,
		Level:       level,
		Status:      model.AnnouncementStatusActive,
		CreatedBy:   actor.ID,
		PublishedAt: now,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.repo.Create(announcement); err != nil {
		return nil, err
	}
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
	return s.repo.Announcement(announcement.ID)
}

func (s *Service) UserAnnouncements(user *model.User) (*UserAnnouncementFeed, error) {
	if user == nil {
		return nil, Unauthorized("请先登录")
	}
	announcements, unreadCount, err := s.repo.AnnouncementFeed(user.ID)
	if err != nil {
		return nil, err
	}
	return &UserAnnouncementFeed{Announcements: announcements, UnreadCount: unreadCount}, nil
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
