// 技能包内文件的浏览、读取、打包下载与全文检索。

package skills

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"path"
	"strings"
	"unicode/utf8"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func (s *Service) SkillPackageFiles(userID string, skillID string) ([]SkillPackageFileItem, error) {
	snapshot, err := s.loadSkillPackageSnapshot(userID, skillID)
	if err != nil {
		return nil, err
	}
	items := make([]SkillPackageFileItem, 0, len(snapshot.files))
	for _, file := range snapshot.files {
		items = append(items, skillFileItem(file))
	}
	return items, nil
}

func (s *Service) SkillPackageFile(userID string, skillID string, filePath string) (*SkillPackageFileContent, error) {
	_, file, content, err := s.readSkillPackageSnapshotFile(userID, skillID, filePath)
	if err != nil {
		return nil, err
	}
	binary := !isPreviewText(file.MimeType, file.Path)
	if binary {
		return &SkillPackageFileContent{File: skillFileItem(*file), Binary: true}, nil
	}
	if len(content) > maxSkillPreviewBytes {
		return nil, kernel.BadAuthRequest("文件超过 512KB，请下载后查看")
	}
	return &SkillPackageFileContent{File: skillFileItem(*file), Content: string(content)}, nil
}

func (s *Service) SkillPackageRawFile(userID string, skillID string, filePath string) ([]byte, string, string, error) {
	_, file, content, err := s.readSkillPackageSnapshotFile(userID, skillID, filePath)
	if err != nil {
		return nil, "", "", err
	}
	return content, file.MimeType, path.Base(file.Path), nil
}

func (s *Service) SkillPackageBundle(userID string, skillID string) (*SkillPackageBundle, error) {
	snapshot, err := s.loadSkillPackageSnapshot(userID, skillID)
	if err != nil {
		return nil, err
	}
	bundle := &SkillPackageBundle{SkillID: snapshot.skill.ID, Name: snapshot.skill.Name, Description: snapshot.skill.Description, VersionID: snapshot.version.ID, Version: snapshot.version.VersionLabel, ContentHash: snapshot.version.ContentHash, Files: make([]SkillPackageBundleFile, 0, len(snapshot.files))}
	for _, file := range snapshot.files {
		content, err := s.readSkillPackageSnapshotEntry(snapshot, file.Path)
		if err != nil {
			return nil, err
		}
		bundle.Files = append(bundle.Files, SkillPackageBundleFile{Path: file.Path, MimeType: file.MimeType, ContentBase64: base64.StdEncoding.EncodeToString(content)})
	}
	return bundle, nil
}

func (s *Service) SearchSkillPackage(userID string, skillID string, query string) ([]SkillFileSearchResult, error) {
	snapshot, err := s.loadSkillPackageSnapshot(userID, skillID)
	if err != nil {
		return nil, err
	}
	query = strings.TrimSpace(query)
	if query == "" || utf8.RuneCountInString(query) > 120 {
		return nil, kernel.BadAuthRequest("搜索关键词必须为 1-120 个字符")
	}
	needle := strings.ToLower(query)
	results := make([]SkillFileSearchResult, 0, 20)
	for _, file := range snapshot.files {
		if len(results) >= 50 || !isPreviewText(file.MimeType, file.Path) || file.Size > maxSkillPreviewBytes {
			continue
		}
		content, err := s.readSkillPackageSnapshotEntry(snapshot, file.Path)
		if err != nil {
			return nil, err
		}
		for lineIndex, line := range strings.Split(string(content), "\n") {
			if strings.Contains(strings.ToLower(line), needle) {
				results = append(results, SkillFileSearchResult{Path: file.Path, Line: lineIndex + 1, Snippet: kernel.TruncateRunes(strings.TrimSpace(line), 240)})
				if len(results) >= 50 {
					break
				}
			}
		}
	}
	return results, nil
}

func (s *Service) readSkillPackageSnapshotFile(userID string, skillID string, filePath string) (*skillPackageSnapshot, *model.SkillFile, []byte, error) {
	snapshot, err := s.loadSkillPackageSnapshot(userID, skillID)
	if err != nil {
		return nil, nil, nil, err
	}
	filePath, err = normalizeSkillPath(filePath)
	if err != nil {
		return nil, nil, nil, err
	}
	for index := range snapshot.files {
		if snapshot.files[index].Path != filePath {
			continue
		}
		content, err := s.readSkillPackageSnapshotEntry(snapshot, filePath)
		return snapshot, &snapshot.files[index], content, err
	}
	return nil, nil, nil, kernel.BadAuthRequest("技能文件不存在")
}

func (s *Service) loadSkillPackageSnapshot(userID string, skillID string) (*skillPackageSnapshot, error) {
	skill, err := s.visibleSkill(userID, skillID)
	if err != nil {
		return nil, err
	}
	version, err := s.repo.SkillVersion(skill.CurrentVersionID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return legacySkillPackageSnapshot(skill)
	}
	if err != nil {
		return nil, err
	}
	if version.SkillID != skill.ID {
		return nil, fmt.Errorf("技能 %s 当前版本归属不一致", skill.ID)
	}
	files, err := s.repo.SkillFiles(version.ID)
	if err != nil {
		return nil, err
	}
	if len(files) == 0 {
		return legacySkillPackageSnapshot(skill)
	}
	if err := validateSkillPackageSnapshot(s, skill, version, files); err != nil {
		return nil, err
	}
	return &skillPackageSnapshot{skill: skill, version: version, files: files}, nil
}

func (s *Service) readSkillPackageSnapshotEntry(snapshot *skillPackageSnapshot, filePath string) ([]byte, error) {
	if snapshot.contents != nil {
		content, ok := snapshot.contents[filePath]
		if !ok {
			return nil, kernel.BadAuthRequest("技能文件不存在")
		}
		return content, nil
	}
	return s.readSkillArchiveEntry(snapshot.version, filePath)
}

func legacySkillPackageSnapshot(skill *model.Skill) (*skillPackageSnapshot, error) {
	if strings.TrimSpace(skill.Instruction) == "" {
		return nil, fmt.Errorf("技能 %s 缺少当前版本、文件清单和 legacy instruction", skill.ID)
	}
	content := []byte(skill.Instruction)
	files := map[string][]byte{"SKILL.md": content}
	digest := sha256.Sum256(content)
	hash, total := contentHashAndSize(files)
	versionID := strings.TrimSpace(skill.CurrentVersionID)
	versionLabel := strings.TrimSpace(skill.VersionLabel)
	if versionLabel == "" {
		versionLabel = "legacy"
	}
	version := &model.SkillVersion{ID: versionID, SkillID: skill.ID, VersionLabel: versionLabel, ContentHash: hash, EntryPath: "SKILL.md", FileCount: 1, TotalBytes: total}
	file := model.SkillFile{SkillVersionID: versionID, Path: "SKILL.md", Kind: "markdown", MimeType: skillFileMime("SKILL.md", content), Size: int64(len(content)), SHA256: hex.EncodeToString(digest[:])}
	return &skillPackageSnapshot{skill: skill, version: version, files: []model.SkillFile{file}, legacy: true, contents: files}, nil
}

func skillSourceTypeForRepair(skill *model.Skill) string {
	if value := strings.TrimSpace(skill.SourceType); value != "" {
		return value
	}
	if skill.Source == skillSourceUser {
		return "markdown"
	}
	return "builtin"
}

func (s *Service) skillPackageHealth(skill *model.Skill) (*model.SkillVersion, []model.SkillFile, error) {
	if strings.TrimSpace(skill.CurrentVersionID) == "" {
		return nil, nil, gorm.ErrRecordNotFound
	}
	version, err := s.repo.SkillVersion(skill.CurrentVersionID)
	if err != nil {
		return nil, nil, err
	}
	if version.SkillID != skill.ID {
		return nil, nil, fmt.Errorf("当前版本归属技能不一致")
	}
	files, err := s.repo.SkillFiles(version.ID)
	if err != nil {
		return nil, nil, err
	}
	if err := validateSkillPackageSnapshot(s, skill, version, files); err != nil {
		return nil, nil, err
	}
	return version, files, nil
}

func (s *Service) syncSkillPackageMetadata(skill *model.Skill, version *model.SkillVersion, files []model.SkillFile) error {
	changed := skill.CurrentVersionID != version.ID || skill.VersionLabel != version.VersionLabel || skill.ContentHash != version.ContentHash || skill.FileCount != len(files) || skill.TotalBytes != version.TotalBytes
	if !changed {
		return nil
	}
	skill.CurrentVersionID = version.ID
	skill.VersionLabel = version.VersionLabel
	skill.ContentHash = version.ContentHash
	skill.FileCount = len(files)
	skill.TotalBytes = version.TotalBytes
	return s.repo.SaveSkill(skill)
}

func validateSkillPackageSnapshot(s *Service, skill *model.Skill, version *model.SkillVersion, files []model.SkillFile) error {
	if len(files) == 0 || version.FileCount != len(files) || version.TotalBytes < 0 {
		return fmt.Errorf("技能 %s 文件元数据不完整", skill.ID)
	}
	if skill.ContentHash != "" && skill.ContentHash != version.ContentHash {
		return fmt.Errorf("技能 %s 内容摘要与当前版本不一致", skill.ID)
	}
	if skill.FileCount != 0 && skill.FileCount != len(files) {
		return fmt.Errorf("技能 %s 文件数量与当前版本不一致", skill.ID)
	}
	if skill.TotalBytes != 0 && skill.TotalBytes != version.TotalBytes {
		return fmt.Errorf("技能 %s 文件大小与当前版本不一致", skill.ID)
	}
	if version.PackageKey == "" {
		return fmt.Errorf("技能 %s 当前版本缺少 ZIP 包", skill.ID)
	}
	contents, err := readSkillArchiveEntries(s.dataDir, version.PackageKey)
	if err != nil {
		return fmt.Errorf("读取技能 %s ZIP 包失败: %w", skill.ID, err)
	}
	byPath := make(map[string]model.SkillFile, len(files))
	var total int64
	for _, file := range files {
		if strings.TrimSpace(file.Path) == "" {
			return fmt.Errorf("技能 %s 文件清单存在空路径", skill.ID)
		}
		if version.EntryPath != "" && version.EntryPath != "SKILL.md" {
			return fmt.Errorf("技能 %s 当前入口不是 SKILL.md", skill.ID)
		}
		if _, exists := byPath[file.Path]; exists {
			return fmt.Errorf("技能 %s 文件清单包含重复路径 %s", skill.ID, file.Path)
		}
		byPath[file.Path] = file
		content, ok := contents[file.Path]
		if !ok {
			return fmt.Errorf("技能 %s ZIP 缺少数据库文件 %s", skill.ID, file.Path)
		}
		digest := sha256.Sum256(content)
		if file.Size != int64(len(content)) || file.SHA256 != hex.EncodeToString(digest[:]) {
			return fmt.Errorf("技能 %s 文件 %s 元数据与 ZIP 不一致", skill.ID, file.Path)
		}
		total += int64(len(content))
	}
	if _, ok := byPath["SKILL.md"]; !ok {
		return fmt.Errorf("技能 %s 文件清单缺少 SKILL.md", skill.ID)
	}
	if len(contents) != len(files) || total != version.TotalBytes {
		return fmt.Errorf("技能 %s ZIP 文件数量或大小与版本元数据不一致", skill.ID)
	}
	hash, _ := contentHashAndSize(contents)
	if version.ContentHash == "" || hash != version.ContentHash {
		return fmt.Errorf("技能 %s ZIP 内容摘要与版本元数据不一致", skill.ID)
	}
	return nil
}
