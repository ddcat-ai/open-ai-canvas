package service

import (
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

const (
	skillStatusEnabled = 1
	skillSourceUser    = 1
)

var skillCategoryLabels = map[string]string{
	"drama":     "短剧影视",
	"ecommerce": "电商营销",
	"creative":  "创意设计",
	"social":    "社媒内容",
	"others":    "其他",
}

type SkillShowcaseMedia struct {
	Type        string `json:"type"`
	ShowcaseURI string `json:"showcase_uri"`
	ShowcaseURL string `json:"showcase_url"`
}

type SkillEffectiveUser struct {
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	UID       string `json:"uid"`
}

type SkillItem struct {
	SkillID         string               `json:"skill_id"`
	SkillName       string               `json:"skill_name"`
	Description     string               `json:"description"`
	Instruction     string               `json:"instruction,omitempty"`
	VersionID       string               `json:"version_id"`
	Version         string               `json:"version"`
	ContentHash     string               `json:"content_hash"`
	FileCount       int                  `json:"file_count"`
	TotalBytes      int64                `json:"total_bytes"`
	SourceType      string               `json:"source_type"`
	SourceURL       string               `json:"source_url"`
	SourceRef       string               `json:"source_ref"`
	SourceSubdir    string               `json:"source_subdir"`
	SourceCommit    string               `json:"source_commit"`
	SyncStatus      string               `json:"sync_status"`
	SyncError       string               `json:"sync_error,omitempty"`
	AutoUpdate      bool                 `json:"auto_update"`
	LastCheckedAt   int64                `json:"last_checked_at"`
	LastSyncedAt    int64                `json:"last_synced_at"`
	Status          int                  `json:"status"`
	MarkdownURL     string               `json:"markdown_url"`
	CreateTime      int64                `json:"create_time"`
	UpdateTime      int64                `json:"update_time"`
	Source          int                  `json:"source"`
	Tag             string               `json:"tag"`
	SortWeight      int                  `json:"sort_weight"`
	IsPrivate       bool                 `json:"is_private"`
	LikeCount       int64                `json:"like_count"`
	IsLike          bool                 `json:"is_like"`
	OwnerUID        string               `json:"owner_uid"`
	EffectiveUser   SkillEffectiveUser   `json:"effective_user"`
	OriginalSkillID *string              `json:"original_skill_id"`
	ShowcaseMedia   []SkillShowcaseMedia `json:"showcase_media"`
	AddedCount      int64                `json:"added_count"`
	IsTest          bool                 `json:"is_test"`
	ExtraInfo       string               `json:"extra_info"`
	IsAdded         bool                 `json:"is_added"`
	IsOwner         bool                 `json:"is_owner"`
}

type SkillCategory struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type SkillListRequest struct {
	Page     int
	PageSize int
	Scope    string
	Search   string
	Tag      string
	Sort     string
}

type SkillList struct {
	Skills     []SkillItem     `json:"skills"`
	TotalCount int64           `json:"total_count"`
	HasMore    bool            `json:"has_more"`
	NextOffset int             `json:"next_offset"`
	Page       int             `json:"page"`
	PageSize   int             `json:"page_size"`
	Categories []SkillCategory `json:"categories"`
}

type SkillMutationRequest struct {
	SkillName     string               `json:"skill_name"`
	Description   string               `json:"description"`
	Instruction   string               `json:"instruction"`
	Tag           string               `json:"tag"`
	IsPrivate     bool                 `json:"is_private"`
	MarkdownURL   string               `json:"markdown_url"`
	ShowcaseMedia []SkillShowcaseMedia `json:"showcase_media"`
	ExtraInfo     string               `json:"extra_info"`
}

func (s *Service) Skills(userID string, req SkillListRequest) (*SkillList, error) {
	req = normalizeSkillListRequest(req)
	rows, total, err := s.repo.Skills(repository.SkillListFilter{
		UserID: userID,
		Scope:  req.Scope,
		Search: req.Search,
		Tag:    req.Tag,
		Sort:   req.Sort,
		Limit:  req.PageSize,
		Offset: (req.Page - 1) * req.PageSize,
	})
	if err != nil {
		return nil, err
	}
	items, err := s.skillItems(userID, rows, false)
	if err != nil {
		return nil, err
	}
	nextOffset := req.Page * req.PageSize
	if int64(nextOffset) >= total {
		nextOffset = 0
	}
	return &SkillList{
		Skills:     items,
		TotalCount: total,
		HasMore:    int64(req.Page*req.PageSize) < total,
		NextOffset: nextOffset,
		Page:       req.Page,
		PageSize:   req.PageSize,
		Categories: skillCategories(),
	}, nil
}

func (s *Service) AddedSkills(userID string) ([]SkillItem, error) {
	rows, _, err := s.repo.Skills(repository.SkillListFilter{UserID: userID, Scope: "mine", Sort: "updated", Limit: -1})
	if err != nil {
		return nil, err
	}
	return s.skillItems(userID, rows, false)
}

func (s *Service) SkillDetail(userID string, id string) (*SkillItem, error) {
	skill, err := s.visibleSkill(userID, id)
	if err != nil {
		return nil, err
	}
	items, err := s.skillItems(userID, []model.Skill{*skill}, true)
	if err != nil {
		return nil, err
	}
	return &items[0], nil
}

func (s *Service) CreateSkill(userID string, req SkillMutationRequest) (*SkillItem, error) {
	normalized, mediaJSON, err := normalizeSkillMutationRequest(req, true)
	if err != nil {
		return nil, err
	}
	created, err := s.createSingleMarkdownSkill(userID, normalized)
	if err != nil {
		return nil, err
	}
	skill, err := s.ownedSkill(userID, created.SkillID)
	if err != nil {
		return nil, err
	}
	skill.ShowcaseMediaJSON = mediaJSON
	skill.ExtraInfo = normalized.ExtraInfo
	if err := s.repo.SaveSkill(skill); err != nil {
		return nil, err
	}
	return s.SkillDetail(userID, skill.ID)
}

func (s *Service) UpdateSkill(userID string, id string, req SkillMutationRequest) (*SkillItem, error) {
	skill, err := s.ownedSkill(userID, id)
	if err != nil {
		return nil, err
	}
	requireInstruction := skill.SourceType == "markdown" || skill.SourceType == "builtin" || skill.SourceType == ""
	normalized, mediaJSON, err := normalizeSkillMutationRequest(req, requireInstruction)
	if err != nil {
		return nil, err
	}
	skill.Name = normalized.SkillName
	skill.Description = normalized.Description
	skill.Tag = normalized.Tag
	skill.IsPrivate = normalized.IsPrivate
	skill.MarkdownURL = normalized.MarkdownURL
	skill.ShowcaseMediaJSON = mediaJSON
	skill.ExtraInfo = normalized.ExtraInfo
	if skill.SourceType == "markdown" || skill.SourceType == "builtin" || skill.SourceType == "" {
		if err := s.updateSingleMarkdownSkill(skill, normalized); err != nil {
			return nil, err
		}
	} else if err := s.repo.SaveSkill(skill); err != nil {
		return nil, err
	}
	return s.SkillDetail(userID, skill.ID)
}

func (s *Service) DeleteSkill(userID string, id string) error {
	skill, err := s.ownedSkill(userID, id)
	if err != nil {
		return err
	}
	if err := s.repo.DeleteSkill(skill.ID); err != nil {
		return err
	}
	return os.RemoveAll(filepath.Join(s.dataDir, "skill-packages", skill.ID))
}

func (s *Service) SetSkillAdded(userID string, id string, added bool) (*SkillItem, error) {
	skill, err := s.visibleSkill(userID, id)
	if err != nil {
		return nil, err
	}
	if skill.OwnerID == userID {
		if !added {
			return nil, BadAuthRequest("自己创建的技能始终保留在我的技能中")
		}
		return s.SkillDetail(userID, id)
	}
	state, err := s.skillState(userID, id)
	if err != nil {
		return nil, err
	}
	state.Added = added
	state.InstalledVersionID = skill.CurrentVersionID
	state.AutoUpdate = skill.AutoUpdate
	if err := s.repo.SetUserSkillAdded(state); err != nil {
		return nil, err
	}
	return s.SkillDetail(userID, id)
}

func (s *Service) SetSkillLiked(userID string, id string, liked bool) (*SkillItem, error) {
	if _, err := s.visibleSkill(userID, id); err != nil {
		return nil, err
	}
	state, err := s.skillState(userID, id)
	if err != nil {
		return nil, err
	}
	state.Liked = liked
	if err := s.repo.SetUserSkillLiked(state); err != nil {
		return nil, err
	}
	return s.SkillDetail(userID, id)
}

func (s *Service) skillItems(userID string, skills []model.Skill, includeInstruction bool) ([]SkillItem, error) {
	ids := make([]string, 0, len(skills))
	ownerIDs := make([]string, 0, len(skills))
	for _, skill := range skills {
		ids = append(ids, skill.ID)
		ownerIDs = append(ownerIDs, skill.OwnerID)
	}
	states, err := s.repo.UserSkillStatesBySkillIDs(userID, ids)
	if err != nil {
		return nil, err
	}
	metrics, err := s.repo.SkillMetrics(ids)
	if err != nil {
		return nil, err
	}
	owners, err := s.repo.SkillOwners(ownerIDs)
	if err != nil {
		return nil, err
	}
	ownerAvatars, err := s.repo.SkillOwnerAvatars(ownerIDs)
	if err != nil {
		return nil, err
	}
	stateBySkillID := make(map[string]model.UserSkillState, len(states))
	for _, state := range states {
		stateBySkillID[state.SkillID] = state
	}
	items := make([]SkillItem, 0, len(skills))
	for _, skill := range skills {
		var showcaseMedia []SkillShowcaseMedia
		if err := json.Unmarshal([]byte(skill.ShowcaseMediaJSON), &showcaseMedia); err != nil {
			return nil, errors.New("技能展示媒体数据格式错误")
		}
		owner := owners[skill.OwnerID]
		ownerName := strings.TrimSpace(skill.AuthorName)
		ownerAvatarURL := strings.TrimSpace(skill.AuthorAvatarURL)
		if strings.TrimSpace(owner.DisplayName) != "" {
			ownerName = strings.TrimSpace(owner.DisplayName)
		} else if strings.TrimSpace(owner.Username) != "" {
			ownerName = strings.TrimSpace(owner.Username)
		}
		if ownerAvatars[skill.OwnerID] != "" {
			ownerAvatarURL = ownerAvatars[skill.OwnerID]
		}
		state := stateBySkillID[skill.ID]
		metric := metrics[skill.ID]
		metric.LikeCount += skill.InitialLikeCount
		metric.AddedCount += skill.InitialAddedCount
		instruction := ""
		if includeInstruction {
			instruction = skill.Instruction
		}
		items = append(items, SkillItem{
			SkillID: skill.ID, SkillName: skill.Name, Description: skill.Description, Instruction: instruction,
			VersionID: skill.CurrentVersionID, Version: skill.VersionLabel, ContentHash: skill.ContentHash, FileCount: skill.FileCount, TotalBytes: skill.TotalBytes,
			SourceType: skill.SourceType, SourceURL: skill.SourceURL, SourceRef: skill.SourceRef, SourceSubdir: skill.SourceSubdir, SourceCommit: skill.SourceCommit,
			SyncStatus: skill.SyncStatus, SyncError: skill.SyncError, AutoUpdate: skill.AutoUpdate, LastCheckedAt: unixMillis(skill.LastCheckedAt), LastSyncedAt: unixMillis(skill.LastSyncedAt),
			Status: skill.Status, MarkdownURL: skill.MarkdownURL, CreateTime: skill.CreatedAt.UnixMilli(), UpdateTime: skill.UpdatedAt.UnixMilli(),
			Source: skill.Source, Tag: skill.Tag, SortWeight: skill.SortWeight, IsPrivate: skill.IsPrivate,
			LikeCount: metric.LikeCount, IsLike: state.Liked, OwnerUID: skill.OwnerID,
			EffectiveUser: SkillEffectiveUser{Name: ownerName, AvatarURL: ownerAvatarURL, UID: skill.OwnerID}, ShowcaseMedia: showcaseMedia,
			AddedCount: metric.AddedCount, ExtraInfo: skill.ExtraInfo, IsAdded: state.Added || skill.OwnerID == userID, IsOwner: skill.OwnerID == userID,
		})
	}
	return items, nil
}

// 所有详情和关系写入都先经过同一可见性边界，避免私有技能通过加入、收藏或画布接口泄露正文。
func (s *Service) visibleSkill(userID string, id string) (*model.Skill, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, BadAuthRequest("技能 ID 不能为空")
	}
	skill, err := s.repo.Skill(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, BadAuthRequest("技能不存在或已删除")
	}
	if err != nil {
		return nil, err
	}
	if skill.IsPrivate && skill.OwnerID != userID {
		return nil, Forbidden("该技能未公开")
	}
	return skill, nil
}

func (s *Service) ownedSkill(userID string, id string) (*model.Skill, error) {
	skill, err := s.visibleSkill(userID, id)
	if err != nil {
		return nil, err
	}
	if skill.OwnerID != userID {
		return nil, Forbidden("只有作者可以修改或删除该技能")
	}
	return skill, nil
}

func (s *Service) skillState(userID string, skillID string) (*model.UserSkillState, error) {
	state, err := s.repo.UserSkillState(userID, skillID)
	if err != nil {
		return nil, err
	}
	if state != nil {
		return state, nil
	}
	return &model.UserSkillState{ID: newID(), UserID: userID, SkillID: skillID}, nil
}

func normalizeSkillListRequest(req SkillListRequest) SkillListRequest {
	if req.Page <= 0 {
		req.Page = 1
	}
	if req.PageSize <= 0 {
		req.PageSize = 20
	}
	if req.PageSize > 80 {
		req.PageSize = 80
	}
	switch req.Scope {
	case "public", "mine", "created", "favorites":
	default:
		req.Scope = "public"
	}
	switch req.Sort {
	case "popular", "new", "updated":
	default:
		req.Sort = "popular"
	}
	req.Search = strings.TrimSpace(req.Search)
	req.Tag = strings.TrimSpace(req.Tag)
	if req.Tag != "" {
		if _, ok := skillCategoryLabels[req.Tag]; !ok {
			req.Tag = ""
		}
	}
	return req
}

func normalizeSkillMutationRequest(req SkillMutationRequest, requireInstruction bool) (SkillMutationRequest, string, error) {
	req.SkillName = strings.TrimSpace(req.SkillName)
	req.Description = strings.TrimSpace(req.Description)
	req.Instruction = strings.TrimSpace(req.Instruction)
	req.Tag = strings.TrimSpace(req.Tag)
	req.MarkdownURL = strings.TrimSpace(req.MarkdownURL)
	req.ExtraInfo = strings.TrimSpace(req.ExtraInfo)
	if req.SkillName == "" || utf8.RuneCountInString(req.SkillName) > 80 {
		return req, "", BadAuthRequest("技能名称必须为 1-80 个字符")
	}
	if req.Description == "" || utf8.RuneCountInString(req.Description) > 500 {
		return req, "", BadAuthRequest("技能简介必须为 1-500 个字符")
	}
	if (requireInstruction && req.Instruction == "") || utf8.RuneCountInString(req.Instruction) > 100000 {
		return req, "", BadAuthRequest("技能指令必须为 1-100000 个字符")
	}
	if _, ok := skillCategoryLabels[req.Tag]; !ok {
		return req, "", BadAuthRequest("请选择有效的技能分类")
	}
	if req.MarkdownURL != "" && !validSkillURL(req.MarkdownURL) {
		return req, "", BadAuthRequest("Markdown 地址必须是有效的 HTTP(S) 链接")
	}
	if utf8.RuneCountInString(req.ExtraInfo) > 2000 {
		return req, "", BadAuthRequest("补充信息不能超过 2000 个字符")
	}
	if len(req.ShowcaseMedia) > 8 {
		return req, "", BadAuthRequest("展示媒体最多添加 8 个")
	}
	for index := range req.ShowcaseMedia {
		media := &req.ShowcaseMedia[index]
		media.Type = strings.TrimSpace(media.Type)
		media.ShowcaseURI = strings.TrimSpace(media.ShowcaseURI)
		media.ShowcaseURL = strings.TrimSpace(media.ShowcaseURL)
		if media.Type != "image" && media.Type != "video" {
			return req, "", BadAuthRequest("展示媒体类型仅支持图片或视频")
		}
		if !validSkillURL(media.ShowcaseURL) {
			return req, "", BadAuthRequest("展示媒体必须填写有效的 HTTP(S) 链接")
		}
		if utf8.RuneCountInString(media.ShowcaseURI) > 500 || utf8.RuneCountInString(media.ShowcaseURL) > 2000 {
			return req, "", BadAuthRequest("展示媒体地址过长")
		}
	}
	mediaJSON, err := json.Marshal(req.ShowcaseMedia)
	if err != nil {
		return req, "", err
	}
	return req, string(mediaJSON), nil
}

func validSkillURL(value string) bool {
	target, err := url.ParseRequestURI(value)
	return err == nil && (target.Scheme == "http" || target.Scheme == "https") && target.Host != ""
}

func skillCategories() []SkillCategory {
	return []SkillCategory{
		{Value: "drama", Label: skillCategoryLabels["drama"]},
		{Value: "ecommerce", Label: skillCategoryLabels["ecommerce"]},
		{Value: "creative", Label: skillCategoryLabels["creative"]},
		{Value: "social", Label: skillCategoryLabels["social"]},
		{Value: "others", Label: skillCategoryLabels["others"]},
	}
}

func unixMillis(value *time.Time) int64 {
	if value == nil {
		return 0
	}
	return value.UnixMilli()
}
