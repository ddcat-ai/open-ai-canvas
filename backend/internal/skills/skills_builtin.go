package skills

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"path"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	builtinAssets "yingce/backend/builtin"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

var builtinSkillFiles = builtinAssets.FS

type builtinSkillMetadata struct {
	Name             string
	Description      string
	SkillID          string
	Version          string
	Author           string
	Owner            string
	AuthorAvatarURL  string
	Tag              string
	SortWeight       int
	Source           int
	CreatedAt        time.Time
	UpdatedAt        time.Time
	InitialLike      int64
	InitialAdded     int64
	ExtraInfo        string
	ShowcaseMediaRaw string
}

type builtinSkillPackage struct {
	skill   model.Skill
	archive skillPackageArchive
}

// EnsureBuiltinSkills syncs embedded Markdown packages to the catalog and version tables.
// User relationships remain in their own table and are not changed by catalog updates.
func (s *Service) EnsureBuiltinSkills() error {
	packages, err := loadBuiltinSkillPackages(s.repo)
	if err != nil {
		return err
	}
	if len(packages) == 0 {
		return fmt.Errorf("内置技能目录为空")
	}
	if s.repo == nil {
		return nil
	}

	rows := make([]model.Skill, 0, len(packages))
	for _, item := range packages {
		rows = append(rows, item.skill)
	}
	if err := s.repo.UpsertBuiltinSkills(rows); err != nil {
		return fmt.Errorf("同步内置技能目录失败: %w", err)
	}
	for _, item := range packages {
		current, err := s.repo.Skill(item.skill.ID)
		if err != nil {
			return fmt.Errorf("读取内置技能 %s 同步结果失败: %w", item.skill.ID, err)
		}
		if current.ContentHash == item.archive.ContentHash && current.CurrentVersionID != "" {
			continue
		}
		if err := s.addSkillArchiveVersion(current, item.archive, "builtin", "", "", "", "", false); err != nil {
			return fmt.Errorf("同步内置技能 %s 文件包失败: %w", item.skill.ID, err)
		}
	}
	return nil
}

func loadBuiltinSkillPackages(tombstones interface {
	BuiltinSkillTombstoned(string) (bool, error)
}) ([]builtinSkillPackage, error) {
	return loadBuiltinSkillPackagesFromFS(builtinSkillFiles, tombstones)
}

func loadBuiltinSkillPackagesFromFS(filesystem fs.FS, tombstones interface {
	BuiltinSkillTombstoned(string) (bool, error)
}) ([]builtinSkillPackage, error) {
	entries, err := fs.ReadDir(filesystem, ".")
	if err != nil {
		return nil, fmt.Errorf("读取内置技能目录失败: %w", err)
	}
	packages := make([]builtinSkillPackage, 0, len(entries))
	seen := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		skillID := strings.TrimSpace(entry.Name())
		if skillID == "" || utf8.RuneCountInString(skillID) > 80 || strings.ContainsAny(skillID, `/\\`) {
			return nil, fmt.Errorf("内置技能目录名非法: %q", entry.Name())
		}
		if _, exists := seen[skillID]; exists {
			return nil, fmt.Errorf("内置技能目录重复: %s", skillID)
		}
		seen[skillID] = struct{}{}

		base := skillID
		body, err := fs.ReadFile(filesystem, path.Join(base, "SKILL.md"))
		if err != nil {
			return nil, fmt.Errorf("读取内置技能 %s 入口文件失败: %w", skillID, err)
		}
		metadata, err := parseBuiltinSkillMetadata(body)
		if err != nil {
			return nil, fmt.Errorf("内置技能 %s 元数据无效: %w", skillID, err)
		}
		if metadata.SkillID != "" && metadata.SkillID != skillID {
			// The directory is a readable slug; skillId is the stable database key.
			stableID := metadata.SkillID
			if len(stableID) > 36 {
				return nil, fmt.Errorf("内置技能 %s 的 skillId 过长", skillID)
			}
			if _, exists := seen[stableID]; exists {
				return nil, fmt.Errorf("内置技能稳定 ID 重复: %s", stableID)
			}
			seen[stableID] = struct{}{}
			skillID = stableID
		}
		if tombstones != nil {
			deleted, err := tombstones.BuiltinSkillTombstoned(skillID)
			if err != nil {
				return nil, fmt.Errorf("检查内置技能 %s 删除记录失败: %w", skillID, err)
			}
			if deleted {
				continue
			}
		}
		metadata, err = normalizeBuiltinSkillMetadata(skillID, metadata)
		if err != nil {
			return nil, err
		}

		files := make(map[string][]byte)
		if err := fs.WalkDir(filesystem, base, func(filePath string, item fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if item.IsDir() {
				return nil
			}
			relative := strings.TrimPrefix(filePath, base+"/")
			filePath, err := normalizeSkillPath(relative)
			if err != nil {
				return err
			}
			content, err := fs.ReadFile(filesystem, path.Join(base, relative))
			if err != nil {
				return err
			}
			files[filePath] = content
			return nil
		}); err != nil {
			return nil, fmt.Errorf("读取内置技能 %s 文件失败: %w", skillID, err)
		}
		archive, err := finalizeSkillArchive(files, skillPackageMetadata{Name: metadata.Name, Description: metadata.Description, Version: metadata.Version})
		if err != nil {
			return nil, fmt.Errorf("内置技能 %s 文件包无效: %w", skillID, err)
		}

		showcaseMedia, err := parseBuiltinShowcaseMedia(metadata.ShowcaseMediaRaw)
		if err != nil {
			log.Printf("内置技能 %s 展示媒体无效，跳过加载: %v", skillID, err)
			continue
		}
		mediaJSON, err := json.Marshal(showcaseMedia)
		if err != nil {
			return nil, err
		}
		packages = append(packages, builtinSkillPackage{
			skill: model.Skill{
				ID: skillID, OwnerID: metadata.Owner, AuthorName: metadata.Author, AuthorAvatarURL: metadata.AuthorAvatarURL,
				Name: metadata.Name, Description: metadata.Description, Instruction: string(body),
				SourceType: "builtin", Status: skillStatusEnabled, Source: metadata.Source, Tag: metadata.Tag, SortWeight: metadata.SortWeight,
				IsPrivate: false, MarkdownURL: base + "/SKILL.md", ShowcaseMediaJSON: string(mediaJSON), ExtraInfo: metadata.ExtraInfo,
				InitialLikeCount: metadata.InitialLike, InitialAddedCount: metadata.InitialAdded,
				CreatedAt: metadata.CreatedAt, UpdatedAt: metadata.UpdatedAt,
			},
			archive: archive,
		})
	}
	return packages, nil
}

func parseBuiltinShowcaseMedia(raw string) ([]SkillShowcaseMedia, error) {
	items := []SkillShowcaseMedia{}
	if strings.TrimSpace(raw) == "" {
		return items, nil
	}
	if !strings.HasPrefix(strings.TrimSpace(raw), "[") {
		return nil, fmt.Errorf("showcaseMedia 必须是数组")
	}
	var entries []map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &entries); err != nil {
		return nil, err
	}
	for index, entry := range entries {
		for _, field := range []struct{ snake, camel string }{
			{"showcase_uri", "showcaseUri"}, {"showcase_url", "showcaseUrl"},
		} {
			legacy, exists := entry[field.snake]
			if !exists {
				continue
			}
			if current, exists := entry[field.camel]; exists {
				var a, b string
				if err := json.Unmarshal(legacy, &a); err != nil {
					return nil, err
				}
				if err := json.Unmarshal(current, &b); err != nil {
					return nil, err
				}
				if a != b {
					return nil, fmt.Errorf("showcaseMedia[%d] 的 %s 与 %s 冲突", index, field.snake, field.camel)
				}
			}
			entry[field.camel] = legacy
		}
		data, err := json.Marshal(entry)
		if err != nil {
			return nil, err
		}
		var item SkillShowcaseMedia
		if err := json.Unmarshal(data, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func normalizeBuiltinSkillMetadata(skillID string, metadata builtinSkillMetadata) (builtinSkillMetadata, error) {
	if metadata.Owner == "" {
		metadata.Owner = "yingce-system"
	}
	if metadata.Author == "" {
		metadata.Author = "影策"
	}
	if metadata.Tag == "" {
		metadata.Tag = "others"
	}
	if metadata.Source == 0 {
		metadata.Source = 3
	}
	if metadata.Version == "" {
		metadata.Version = "1.0.0"
	}
	if metadata.CreatedAt.IsZero() {
		metadata.CreatedAt = time.Now().UTC()
	}
	if metadata.UpdatedAt.IsZero() {
		metadata.UpdatedAt = metadata.CreatedAt
	}
	if metadata.Name == "" || metadata.Description == "" {
		return metadata, fmt.Errorf("内置技能 %s 缺少 name 或 description", skillID)
	}
	if _, ok := skillCategoryLabels[metadata.Tag]; !ok {
		return metadata, fmt.Errorf("内置技能 %s 分类无效: %s", skillID, metadata.Tag)
	}
	if metadata.AuthorAvatarURL != "" && !validSkillURL(metadata.AuthorAvatarURL) {
		return metadata, fmt.Errorf("内置技能 %s 作者头像地址无效", skillID)
	}
	return metadata, nil
}

func parseBuiltinSkillMetadata(body []byte) (builtinSkillMetadata, error) {
	lines := strings.Split(strings.ReplaceAll(string(body), "\r\n", "\n"), "\n")
	if len(lines) < 3 || strings.TrimSpace(lines[0]) != "---" {
		return builtinSkillMetadata{}, fmt.Errorf("缺少 frontmatter")
	}
	metadata := builtinSkillMetadata{}
	inMetadata := false
	closed := false
	for index := 1; index < len(lines); index++ {
		line := lines[index]
		if strings.TrimSpace(line) == "---" {
			closed = true
			break
		}
		trimmed := strings.TrimSpace(line)
		key, value, ok := strings.Cut(trimmed, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = yamlScalar(value)
		indent := len(line) - len(strings.TrimLeft(line, " \t"))
		if indent == 0 {
			inMetadata = key == "metadata"
			switch key {
			case "name":
				metadata.Name = value
			case "description":
				metadata.Description = value
			case "skillId":
				metadata.SkillID = value
			}
			continue
		}
		if !inMetadata {
			continue
		}
		switch key {
		case "skillId":
			metadata.SkillID = value
		case "version":
			metadata.Version = value
		case "author":
			metadata.Author = value
		case "owner":
			metadata.Owner = value
		case "authorAvatarUrl":
			metadata.AuthorAvatarURL = value
		case "tag":
			metadata.Tag = value
		case "sortWeight":
			metadata.SortWeight, _ = strconv.Atoi(value)
		case "source":
			metadata.Source, _ = strconv.Atoi(value)
		case "createdAt":
			metadata.CreatedAt = parseBuiltinTime(value)
		case "updatedAt":
			metadata.UpdatedAt = parseBuiltinTime(value)
		case "initialLikeCount":
			metadata.InitialLike, _ = strconv.ParseInt(value, 10, 64)
		case "initialAddedCount":
			metadata.InitialAdded, _ = strconv.ParseInt(value, 10, 64)
		case "extraInfo":
			metadata.ExtraInfo = value
		case "showcaseMedia":
			metadata.ShowcaseMediaRaw = value
		}
	}
	if !closed {
		return builtinSkillMetadata{}, fmt.Errorf("frontmatter 未闭合")
	}
	return metadata, nil
}

func parseBuiltinTime(value string) time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}
	}
	if milliseconds, err := strconv.ParseInt(value, 10, 64); err == nil {
		return time.UnixMilli(milliseconds)
	}
	parsed, _ := time.Parse(time.RFC3339, value)
	return parsed
}

func builtinSeedSkillIDs() ([]string, error) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(packages))
	for _, item := range packages {
		ids = append(ids, item.skill.ID)
	}
	if len(ids) == 0 {
		return nil, kernel.BadAuthRequest("内置技能不能为空")
	}
	return ids, nil
}
