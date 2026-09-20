package tools

import (
	"encoding/json"
	"regexp"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

// ToolWithFavorite 列表查询结果：工具 + 当前用户收藏状态。
type ToolWithFavorite struct {
	Tool        model.Tool
	Favorited   bool
	FavoritedAt *time.Time
}

// Repository 定义 tools 域需要的持久化接口，由 repository.Repository 实现。
type Repository interface {
	UpsertBuiltinTools(tools []model.Tool) error
	ListTools(userID string, req ToolListRequest) ([]ToolWithFavorite, int64, error)
	ToolForUser(userID string, toolID int64) (model.Tool, error)
	ToolFavorited(userID string, toolID int64) (model.Tool, *time.Time, error)
	AddToolFavorite(userID string, toolID int64) error
	RemoveToolFavorite(userID string, toolID int64) error
	CreateTool(tool *model.Tool) (*model.Tool, error)
	DeleteUserTool(userID string, toolID int64) error
}

var labelEnPattern = regexp.MustCompile(`[^a-zA-Z0-9_]+`)

// sanitizeLabelEn 从中文名称生成英文标识：取拼音不可行时用时间戳保证唯一性由数据库自增 ID 兜底。
func sanitizeLabelEn(label string) string {
	normalized := labelEnPattern.ReplaceAllString(strings.ToLower(label), "_")
	normalized = strings.Trim(normalized, "_")
	if normalized == "" {
		normalized = "custom_tool"
	}
	return normalized
}

func marshalExtraInfo(items []string) ([]byte, error) {
	return json.Marshal(items)
}

func decodeExtraInfo(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{}
	}
	var items []string
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return []string{}
	}
	return items
}
