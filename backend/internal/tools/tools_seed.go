package tools

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

//go:embed seed/tools.json
var builtinToolsJSON []byte

type toolSeedItem struct {
	ID         int64    `json:"id"`
	LabelEn    string   `json:"label_en"`
	Label      string   `json:"label"`
	Desc       string   `json:"desc"`
	Tag        string   `json:"tag"`
	Cover      string   `json:"cover"`
	ExtraInfo  []string `json:"extra_info"`
	Prompt     string   `json:"prompt"`
	Ratio      string   `json:"ratio"`
	MediaURL   string   `json:"media_url"`
	OwnerID    string   `json:"owner_id"`
	Enabled    bool     `json:"enabled"`
	Visibility string   `json:"visibility"`
	CreateAt   string   `json:"create_at"`
	UpdateAt   string   `json:"update_at"`
}

type toolSeedGroup struct {
	Title string            `json:"title"`
	Tags  map[string]string `json:"tags"`
	List  []toolSeedItem    `json:"list"`
}

type builtinToolsFile struct {
	Style    toolSeedGroup `json:"style"`
	Motion   toolSeedGroup `json:"motion"`
	NineGrid toolSeedGroup `json:"nine_grid"`
}

const (
	ToolTypeStyle    = "style"
	ToolTypeMotion   = "motion"
	ToolTypeNineGrid = "nine_grid"
	ToolTypeEffect   = "effect"
)

const seedTimeLayout = "2006-01-02 15:04:05"

// EnsureBuiltinTools 将预设工具列表幂等写入数据库；重复启动只更新内容字段，不删除已有数据。
// 初始化不下载第三方媒体，避免启动依赖外部 CDN 或产生无归属资源。
func EnsureBuiltinTools(repo Repository) error {
	var file builtinToolsFile
	if err := json.Unmarshal(builtinToolsJSON, &file); err != nil {
		return fmt.Errorf("解析内置工具失败: %w", err)
	}

	var tools []model.Tool
	sortWeight := 0

	groups := []struct {
		typ   string
		group toolSeedGroup
	}{
		{ToolTypeStyle, file.Style},
		{ToolTypeMotion, file.Motion},
		{ToolTypeNineGrid, file.NineGrid},
	}

	seen := make(map[int64]struct{})
	for _, g := range groups {
		for _, item := range g.group.List {
			if item.ID <= 0 {
				return fmt.Errorf("内置工具 ID 无效: type=%s label_en=%q", g.typ, item.LabelEn)
			}
			if _, exists := seen[item.ID]; exists {
				return fmt.Errorf("内置工具 ID 重复: %d", item.ID)
			}
			seen[item.ID] = struct{}{}
			uniqueKey := fmt.Sprintf("%s:%d", g.typ, item.ID)

			labelEn := strings.TrimSpace(item.LabelEn)
			if labelEn == "" {
				return fmt.Errorf("内置工具英文标识为空: %s", uniqueKey)
			}
			label := strings.TrimSpace(item.Label)
			if label == "" {
				return fmt.Errorf("内置工具名称为空: %s", uniqueKey)
			}
			prompt := strings.TrimSpace(item.Prompt)
			if prompt == "" {
				return fmt.Errorf("内置工具提示词为空: %s", uniqueKey)
			}
			visibility := strings.TrimSpace(item.Visibility)
			if visibility != "public" && visibility != "private" {
				return fmt.Errorf("内置工具可见性无效: %s visibility=%q", uniqueKey, item.Visibility)
			}

			createdAt, err := parseSeedTime(item.CreateAt)
			if err != nil {
				return fmt.Errorf("内置工具创建时间无效: %s: %w", uniqueKey, err)
			}
			updatedAt, err := parseSeedTime(item.UpdateAt)
			if err != nil {
				return fmt.Errorf("内置工具更新时间无效: %s: %w", uniqueKey, err)
			}

			extraInfoJSON := ""
			if len(item.ExtraInfo) > 0 {
				data, err := json.Marshal(item.ExtraInfo)
				if err != nil {
					return fmt.Errorf("序列化工具 %s 扩展信息失败: %w", uniqueKey, err)
				}
				extraInfoJSON = string(data)
			}

			cover := strings.TrimSpace(item.Cover)
			mediaURL := strings.TrimSpace(item.MediaURL)
			sortWeight++
			tools = append(tools, model.Tool{
				ID:            item.ID,
				Type:          g.typ,
				LabelEn:       labelEn,
				Label:         label,
				Desc:          strings.TrimSpace(item.Desc),
				Tag:           strings.TrimSpace(item.Tag),
				Cover:         cover,
				ExtraInfoJSON: extraInfoJSON,
				Prompt:        prompt,
				Ratio:         strings.TrimSpace(item.Ratio),
				MediaURL:      mediaURL,
				OwnerID:       item.OwnerID,
				Source:        ToolSourceBuiltin,
				Enabled:       item.Enabled,
				Visibility:    visibility,
				SortWeight:    sortWeight,
				CreatedAt:     createdAt,
				UpdatedAt:     updatedAt,
			})
		}
	}

	if len(tools) == 0 {
		return fmt.Errorf("内置工具列表为空")
	}
	if err := repo.UpsertBuiltinTools(tools); err != nil {
		return fmt.Errorf("同步内置工具失败: %w", err)
	}
	return nil
}

func parseSeedTime(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, fmt.Errorf("时间为空")
	}
	return time.ParseInLocation(seedTimeLayout, value, time.Local)
}
