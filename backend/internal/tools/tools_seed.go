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
	Enabled    bool     `json:"enabled"`
	Visibility string   `json:"visibility"`
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

// SeedResourceImporter 用于将内置工具的外部 CDN 封面/视频导入本地存储。
// 返回可供前端直接访问的资源 URL（如 /api/public/resources/{id}/file）。
type SeedResourceImporter interface {
	ImportSeedResource(ownerID string, rawURL string, kind string) (string, error)
}

// isLocalResourceURL 判断 URL 是否已经是本地资源路径，避免重复导入。
func isLocalResourceURL(raw string) bool {
	return strings.HasPrefix(raw, "/api/") || strings.HasPrefix(raw, "/resources/")
}

// EnsureBuiltinTools 将预设工具列表幂等写入数据库；重复启动只更新内容字段，不删除已有数据。
// 初始化不下载第三方媒体，避免启动依赖外部 CDN 或产生无归属资源。
// 归属人取系统最早创建的管理员；尚无管理员（全新部署）时先留空，
// 首个管理员注册后下次启动会随幂等更新自动补齐。
func EnsureBuiltinTools(repo Repository, importer SeedResourceImporter) error {
	var file builtinToolsFile
	if err := json.Unmarshal(builtinToolsJSON, &file); err != nil {
		return fmt.Errorf("解析内置工具失败: %w", err)
	}
	adminOwnerID, err := repo.FirstAdminUserID()
	if err != nil {
		return fmt.Errorf("查询系统管理员失败: %w", err)
	}

	var tools []model.Tool
	sortWeight := 0
	// 内置工具时间取本次启动时间：created_at 首次写入后保留，updated_at 每次启动随幂等更新刷新。
	now := time.Now()

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

			extraInfoJSON := ""
			if len(item.ExtraInfo) > 0 {
				data, err := json.Marshal(item.ExtraInfo)
				if err != nil {
					return fmt.Errorf("序列化工具 %s 扩展信息失败: %w", uniqueKey, err)
				}
				extraInfoJSON = string(data)
			}

			// cover 和 media_url 如果不为空，调用存储服务导入到本地，导入失败时降级使用原始 URL
			cover := strings.TrimSpace(item.Cover)
			mediaURL := strings.TrimSpace(item.MediaURL)
			if importer != nil {
				if cover != "" && !isLocalResourceURL(cover) {
					if localURL, err := importer.ImportSeedResource(adminOwnerID, cover, "image"); err == nil && localURL != "" {
						cover = localURL
					}
				}
				if mediaURL != "" && !isLocalResourceURL(mediaURL) {
					if localURL, err := importer.ImportSeedResource(adminOwnerID, mediaURL, "video"); err == nil && localURL != "" {
						mediaURL = localURL
					}
				}
			}
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
				OwnerID:       adminOwnerID,
				Source:        ToolSourceBuiltin,
				Enabled:       item.Enabled,
				Visibility:    visibility,
				SortWeight:    sortWeight,
				CreatedAt:     now,
				UpdatedAt:     now,
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
