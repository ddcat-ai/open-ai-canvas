package tools

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

const (
	ToolSourceBuiltin = "builtin"
	ToolSourceUser    = "user"

	ToolVisibilityPublic  = "public"
	ToolVisibilityPrivate = "private"

	// 查询范围
	ToolScopePublic    = "public"
	ToolScopeFavorites = "favorites"
	ToolScopeCustom    = "custom"

	toolMaxPageSize     = 80
	toolMaxPromptLength = 8000
)

var validToolTypes = map[string]struct{}{
	ToolTypeStyle:    {},
	ToolTypeMotion:   {},
	ToolTypeNineGrid: {},
	ToolTypeEffect:   {},
}

// ToolListRequest 工具列表查询参数。
type ToolListRequest struct {
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
	Scope    string `json:"scope"` // public | favorites | custom
	Type     string `json:"type"`  // style | motion | nine_grid | effect
	Tag      string `json:"tag"`
	Search   string `json:"search"`
}

// ToolItem 工具列表项；ExtraInfo 为样本图路径数组。
type ToolItem struct {
	ID         int64     `json:"id"`
	Type       string    `json:"type"`
	LabelEn    string    `json:"labelEn"`
	Label      string    `json:"label"`
	Desc       string    `json:"desc"`
	Tag        string    `json:"tag"`
	Cover      string    `json:"cover"`
	ExtraInfo  []string  `json:"extraInfo"`
	Prompt     string    `json:"prompt"`
	Ratio      string    `json:"ratio"`
	MediaURL   string    `json:"mediaUrl"`
	OwnerID    string    `json:"ownerId"`
	Source     string    `json:"source"`
	Enabled    bool      `json:"enabled"`
	Visibility string    `json:"visibility"`
	SortWeight int       `json:"sortWeight"`
	Favorited  bool      `json:"favorited"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// ToolSummary 工具列表摘要项；不含 prompt、extraInfo 等大字段，详情/收藏结果才返回完整 ToolItem。
type ToolSummary struct {
	ID         int64     `json:"id"`
	Type       string    `json:"type"`
	LabelEn    string    `json:"labelEn"`
	Label      string    `json:"label"`
	Desc       string    `json:"desc"`
	Tag        string    `json:"tag"`
	Cover      string    `json:"cover"`
	Ratio      string    `json:"ratio"`
	MediaURL   string    `json:"mediaUrl"`
	OwnerID    string    `json:"ownerId"`
	Source     string    `json:"source"`
	Enabled    bool      `json:"enabled"`
	Visibility string    `json:"visibility"`
	SortWeight int       `json:"sortWeight"`
	Favorited  bool      `json:"favorited"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// ToolList 分页结果。
type ToolList struct {
	Tools      []ToolSummary `json:"tools"`
	TotalCount int64         `json:"totalCount"`
	Page       int           `json:"page"`
	PageSize   int           `json:"pageSize"`
	HasMore    bool          `json:"hasMore"`
}

// ToolMutationRequest 新增/更新自定义工具的请求体。
type ToolMutationRequest struct {
	Type       string   `json:"type"`
	Label      string   `json:"label"`
	Desc       string   `json:"desc"`
	Tag        string   `json:"tag"`
	Cover      string   `json:"cover"`
	ExtraInfo  []string `json:"extraInfo"`
	Prompt     string   `json:"prompt"`
	Ratio      string   `json:"ratio"`
	MediaURL   string   `json:"mediaUrl"`
	Visibility string   `json:"visibility"`
}

// Service 工具域服务。
type Service struct {
	repo Repository
}

func New(repo Repository) *Service {
	return &Service{repo: repo}
}

// List 按范围分页查询工具列表。
func (s *Service) List(userID string, req ToolListRequest) (*ToolList, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	if err := normalizeToolListRequest(&req); err != nil {
		return nil, err
	}
	items, total, err := s.repo.ListTools(userID, req)
	if err != nil {
		return nil, err
	}
	tools := make([]ToolSummary, 0, len(items))
	for _, item := range items {
		tools = append(tools, buildToolSummary(item.Tool, item.Favorited))
	}
	return &ToolList{
		Tools:      tools,
		TotalCount: total,
		Page:       req.Page,
		PageSize:   req.PageSize,
		HasMore:    int64(req.Page*req.PageSize) < total,
	}, nil
}

// Detail 返回单个工具详情（含提示词），供工具栏快捷调用。
func (s *Service) Detail(userID string, toolID int64) (*ToolItem, error) {
	if userID == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	if toolID <= 0 {
		return nil, kernel.BadAuthRequest("工具 ID 无效")
	}
	tool, err := s.repo.ToolForUser(userID, toolID)
	if err != nil {
		return nil, err
	}
	return buildToolItemPtr(tool, false, nil), nil
}

// SetFavorite 添加/取消收藏；同一用户对同一工具仅一条记录。
func (s *Service) SetFavorite(userID string, toolID int64, favorite bool) (*ToolItem, error) {
	if userID == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	if toolID <= 0 {
		return nil, kernel.BadAuthRequest("工具 ID 无效")
	}
	if _, err := s.repo.ToolForUser(userID, toolID); err != nil {
		return nil, err
	}
	if favorite {
		if err := s.repo.AddToolFavorite(userID, toolID); err != nil {
			return nil, err
		}
	} else {
		if err := s.repo.RemoveToolFavorite(userID, toolID); err != nil {
			return nil, err
		}
	}
	updated, favoritedAt, err := s.repo.ToolFavorited(userID, toolID)
	if err != nil {
		return nil, err
	}
	return buildToolItemPtr(updated, true, favoritedAt), nil
}

// Create 创建用户自定义工具。
func (s *Service) Create(userID string, req ToolMutationRequest) (*ToolItem, error) {
	if userID == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	normalized, err := normalizeToolMutationRequest(req)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	tool := model.Tool{
		Type:          normalized.Type,
		LabelEn:       normalized.LabelEn,
		Label:         normalized.Label,
		Desc:          normalized.Desc,
		Tag:           normalized.Tag,
		Cover:         normalized.Cover,
		ExtraInfoJSON: normalized.ExtraInfoJSON,
		Prompt:        normalized.Prompt,
		Ratio:         normalized.Ratio,
		MediaURL:      normalized.MediaURL,
		OwnerID:       userID,
		Source:        ToolSourceUser,
		Enabled:       true,
		Visibility:    normalized.Visibility,
		SortWeight:    0,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	created, err := s.repo.CreateTool(&tool)
	if err != nil {
		return nil, err
	}
	item := buildToolItem(*created, false, nil)
	return &item, nil
}

// Delete 删除用户自定义工具；内置工具不可删除，同步清理收藏记录。
func (s *Service) Delete(userID string, toolID int64) error {
	if userID == "" {
		return kernel.Unauthorized("请先登录")
	}
	if toolID <= 0 {
		return kernel.BadAuthRequest("工具 ID 无效")
	}
	return s.repo.DeleteUserTool(userID, toolID)
}

func normalizeToolListRequest(req *ToolListRequest) error {
	if req.Scope == "" {
		req.Scope = ToolScopePublic
	}
	if req.Page <= 0 {
		req.Page = 1
	}
	if req.PageSize <= 0 {
		req.PageSize = 20
	}
	if req.PageSize > toolMaxPageSize {
		req.PageSize = toolMaxPageSize
	}
	switch req.Scope {
	case ToolScopePublic, ToolScopeFavorites, ToolScopeCustom:
	default:
		return kernel.BadAuthRequest(fmt.Sprintf("不支持的范围: %s", req.Scope))
	}
	if req.Type != "" {
		if _, ok := validToolTypes[req.Type]; !ok {
			return kernel.BadAuthRequest(fmt.Sprintf("不支持的工具类型: %s", req.Type))
		}
	}
	req.Search = strings.TrimSpace(req.Search)
	req.Tag = strings.TrimSpace(req.Tag)
	return nil
}

func normalizeToolMutationRequest(req ToolMutationRequest) (*model.Tool, error) {
	toolType := strings.TrimSpace(req.Type)
	if _, ok := validToolTypes[toolType]; !ok {
		return nil, kernel.BadAuthRequest("工具类型无效，仅支持 style、motion、nine_grid、effect")
	}
	label := strings.TrimSpace(req.Label)
	if label == "" {
		return nil, kernel.BadAuthRequest("工具名称不能为空")
	}
	if len(label) > 120 {
		return nil, kernel.BadAuthRequest("工具名称过长")
	}
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return nil, kernel.BadAuthRequest("工具提示词不能为空")
	}
	if strings.Contains(prompt, "@[tool:") {
		return nil, kernel.BadAuthRequest("不支持嵌套工具标签")
	}
	if len(prompt) > toolMaxPromptLength {
		return nil, kernel.BadAuthRequest("工具提示词过长")
	}
	desc := strings.TrimSpace(req.Desc)
	if len(desc) > 500 {
		return nil, kernel.BadAuthRequest("工具描述过长")
	}
	tag := strings.TrimSpace(req.Tag)
	if len(tag) > 64 {
		return nil, kernel.BadAuthRequest("标签过长")
	}
	visibility := strings.TrimSpace(req.Visibility)
	if visibility == "" {
		visibility = ToolVisibilityPrivate
	}
	if visibility != ToolVisibilityPublic && visibility != ToolVisibilityPrivate {
		return nil, kernel.BadAuthRequest("可见性仅支持 public 或 private")
	}
	cover := strings.TrimSpace(req.Cover)
	if len(cover) > 500 {
		return nil, kernel.BadAuthRequest("封面路径过长")
	}
	mediaURL := strings.TrimSpace(req.MediaURL)
	if len(mediaURL) > 500 {
		return nil, kernel.BadAuthRequest("媒体路径过长")
	}
	ratio := strings.TrimSpace(req.Ratio)
	if len(ratio) > 32 {
		return nil, kernel.BadAuthRequest("比例参数过长")
	}
	extraInfo := make([]string, 0, len(req.ExtraInfo))
	for _, item := range req.ExtraInfo {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		if len(trimmed) > 500 {
			return nil, kernel.BadAuthRequest("扩展信息路径过长")
		}
		extraInfo = append(extraInfo, trimmed)
	}
	extraInfoJSON := ""
	if len(extraInfo) > 0 {
		data, err := marshalExtraInfo(extraInfo)
		if err != nil {
			return nil, kernel.BadAuthRequest("扩展信息格式无效")
		}
		extraInfoJSON = string(data)
	}
	labelEn := sanitizeLabelEn(label)
	return &model.Tool{
		Type:          toolType,
		LabelEn:       labelEn,
		Label:         label,
		Desc:          desc,
		Tag:           tag,
		Cover:         cover,
		ExtraInfoJSON: extraInfoJSON,
		Prompt:        prompt,
		Ratio:         ratio,
		MediaURL:      mediaURL,
		Visibility:    visibility,
	}, nil
}

func buildToolSummary(tool model.Tool, favorited bool) ToolSummary {
	return ToolSummary{
		ID:         tool.ID,
		Type:       tool.Type,
		LabelEn:    tool.LabelEn,
		Label:      tool.Label,
		Desc:       tool.Desc,
		Tag:        tool.Tag,
		Cover:      tool.Cover,
		Ratio:      tool.Ratio,
		MediaURL:   tool.MediaURL,
		OwnerID:    tool.OwnerID,
		Source:     tool.Source,
		Enabled:    tool.Enabled,
		Visibility: tool.Visibility,
		SortWeight: tool.SortWeight,
		Favorited:  favorited,
		CreatedAt:  tool.CreatedAt,
		UpdatedAt:  tool.UpdatedAt,
	}
}

func buildToolItem(tool model.Tool, favorited bool, favoritedAt *time.Time) ToolItem {
	return ToolItem{
		ID:         tool.ID,
		Type:       tool.Type,
		LabelEn:    tool.LabelEn,
		Label:      tool.Label,
		Desc:       tool.Desc,
		Tag:        tool.Tag,
		Cover:      tool.Cover,
		ExtraInfo:  decodeExtraInfo(tool.ExtraInfoJSON),
		Prompt:     tool.Prompt,
		Ratio:      tool.Ratio,
		MediaURL:   tool.MediaURL,
		OwnerID:    tool.OwnerID,
		Source:     tool.Source,
		Enabled:    tool.Enabled,
		Visibility: tool.Visibility,
		SortWeight: tool.SortWeight,
		Favorited:  favorited,
		CreatedAt:  tool.CreatedAt,
		UpdatedAt:  tool.UpdatedAt,
	}
}

func buildToolItemPtr(tool model.Tool, favorited bool, favoritedAt *time.Time) *ToolItem {
	item := buildToolItem(tool, favorited, favoritedAt)
	return &item
}

// IsToolNotFound 判断是否为工具不存在（含他人私有工具不可见）。
func IsToolNotFound(err error) bool {
	var appErr *kernel.AppError
	if errors.As(err, &appErr) {
		return appErr.Status == 404
	}
	return false
}
