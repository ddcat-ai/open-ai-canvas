package service

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const (
	maxSkillPackageBytes       = 20 << 20
	maxSkillFileBytes          = 8 << 20
	maxSkillPackageFiles       = 512
	maxSkillPreviewBytes       = 512 << 10
	SkillPackageUploadMaxBytes = maxSkillPackageBytes + (1 << 20)
)

type SkillInstallRequest struct {
	Name        string
	Description string
	Tag         string
	IsPrivate   bool
}

type SkillGitHubInstallRequest struct {
	URL        string `json:"url"`
	Ref        string `json:"ref"`
	Subdir     string `json:"subdir"`
	Tag        string `json:"tag"`
	IsPrivate  bool   `json:"is_private"`
	AutoUpdate bool   `json:"auto_update"`
}

type SkillPackageFileItem struct {
	Path     string `json:"path"`
	Kind     string `json:"kind"`
	MimeType string `json:"mime_type"`
	Size     int64  `json:"size"`
	SHA256   string `json:"sha256"`
}

type SkillPackageFileContent struct {
	File    SkillPackageFileItem `json:"file"`
	Content string               `json:"content"`
	Binary  bool                 `json:"binary"`
}

type SkillPackageBundleFile struct {
	Path          string `json:"path"`
	MimeType      string `json:"mime_type"`
	ContentBase64 string `json:"content_base64"`
}

type SkillPackageBundle struct {
	SkillID     string                   `json:"skill_id"`
	Name        string                   `json:"name"`
	Description string                   `json:"description"`
	VersionID   string                   `json:"version_id"`
	Version     string                   `json:"version"`
	ContentHash string                   `json:"content_hash"`
	Files       []SkillPackageBundleFile `json:"files"`
}

type SkillFileSearchResult struct {
	Path    string `json:"path"`
	Line    int    `json:"line"`
	Snippet string `json:"snippet"`
}

type skillPackageMetadata struct {
	Name        string
	Description string
	Version     string
}

type skillPackageArchive struct {
	Files       map[string][]byte
	Metadata    skillPackageMetadata
	ContentHash string
	TotalBytes  int64
}

type githubSkillSpec struct {
	Owner  string
	Repo   string
	Ref    string
	Subdir string
}

func (s *Service) EnsureSkillPackages() error {
	skills, err := s.repo.SkillsForPackageEnsure(skillSourceUser)
	if err != nil {
		return err
	}
	for index := range skills {
		skill := &skills[index]
		archive, err := archiveFromMarkdown([]byte(skill.Instruction), skill.Name, skill.Description)
		if err != nil {
			return fmt.Errorf("迁移技能 %s 文件包失败: %w", skill.ID, err)
		}
		if skill.CurrentVersionID != "" && skill.ContentHash == archive.ContentHash {
			continue
		}
		sourceType := "builtin"
		if skill.Source == skillSourceUser {
			sourceType = "markdown"
		}
		if err := s.addSkillArchiveVersion(skill, archive, sourceType, "", "", "", "", false); err != nil {
			return fmt.Errorf("保存技能 %s 文件包失败: %w", skill.ID, err)
		}
	}
	return nil
}

func (s *Service) InstallSkillUpload(userID string, sourceType string, header *multipart.FileHeader, req SkillInstallRequest) (*SkillItem, error) {
	sourceType = strings.ToLower(strings.TrimSpace(sourceType))
	if sourceType == "" && header != nil {
		switch strings.ToLower(path.Ext(header.Filename)) {
		case ".md", ".markdown":
			sourceType = "markdown"
		case ".zip":
			sourceType = "zip"
		}
	}
	if sourceType != "markdown" && sourceType != "zip" {
		return nil, BadAuthRequest("技能文件仅支持 Markdown 或 ZIP")
	}
	if header == nil || header.Size <= 0 || header.Size > maxSkillPackageBytes {
		return nil, BadAuthRequest("技能文件大小必须在 1B-20MB 之间")
	}
	file, err := header.Open()
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxSkillPackageBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxSkillPackageBytes {
		return nil, BadAuthRequest("技能文件不能超过 20MB")
	}
	var archive skillPackageArchive
	if sourceType == "markdown" {
		archive, err = archiveFromMarkdown(data, req.Name, req.Description)
	} else {
		archive, err = archiveFromZip(data, "")
	}
	if err != nil {
		return nil, err
	}
	return s.createSkillFromArchive(userID, archive, req, sourceType, "", "", "", "", false)
}

func (s *Service) InstallGitHubSkill(userID string, req SkillGitHubInstallRequest) (*SkillItem, error) {
	spec, err := parseGitHubSkillURL(req.URL, req.Ref, req.Subdir)
	if err != nil {
		return nil, err
	}
	archive, commit, canonicalURL, resolvedRef, err := fetchGitHubSkillArchive(context.Background(), spec)
	if err != nil {
		var appErr *AppError
		if errors.As(err, &appErr) {
			return nil, err
		}
		return nil, WrapAppError(http.StatusBadGateway, "GitHub 技能读取失败，请检查仓库地址和网络", err)
	}
	return s.createSkillFromArchive(userID, archive, SkillInstallRequest{Tag: req.Tag, IsPrivate: req.IsPrivate}, "github", canonicalURL, resolvedRef, spec.Subdir, commit, req.AutoUpdate)
}

func (s *Service) SyncGitHubSkill(userID string, skillID string) (*SkillItem, error) {
	skill, err := s.ownedSkill(userID, skillID)
	if err != nil {
		return nil, err
	}
	if skill.SourceType != "github" {
		return nil, BadAuthRequest("只有 GitHub 技能可以同步")
	}
	if err := s.syncGitHubSkill(skill); err != nil {
		var appErr *AppError
		if errors.As(err, &appErr) {
			return nil, err
		}
		return nil, WrapAppError(http.StatusBadGateway, "GitHub 技能同步失败，请稍后重试", err)
	}
	return s.SkillDetail(userID, skill.ID)
}

func (s *Service) startSkillSyncWorker() {
	go func() {
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			skills, err := s.repo.AutoUpdatingGitHubSkills()
			if err != nil {
				continue
			}
			for index := range skills {
				_ = s.syncGitHubSkill(&skills[index])
			}
		}
	}()
}

func (s *Service) syncGitHubSkill(skill *model.Skill) error {
	now := time.Now()
	spec, err := parseGitHubSkillURL(skill.SourceURL, skill.SourceRef, skill.SourceSubdir)
	if err != nil {
		skill.SyncStatus = "failed"
		skill.SyncError = err.Error()
		skill.LastCheckedAt = &now
		_ = s.repo.SaveSkill(skill)
		return err
	}
	archive, commit, canonicalURL, resolvedRef, err := fetchGitHubSkillArchive(context.Background(), spec)
	skill.LastCheckedAt = &now
	if err != nil {
		skill.SyncStatus = "failed"
		skill.SyncError = err.Error()
		_ = s.repo.SaveSkill(skill)
		return err
	}
	if commit == skill.SourceCommit {
		skill.SyncStatus = "synced"
		skill.SyncError = ""
		return s.repo.SaveSkill(skill)
	}
	skill.Name = archive.Metadata.Name
	skill.Description = archive.Metadata.Description
	skill.Instruction = string(archive.Files["SKILL.md"])
	if err := s.addSkillArchiveVersion(skill, archive, "github", canonicalURL, resolvedRef, spec.Subdir, commit, skill.AutoUpdate); err != nil {
		skill.SyncStatus = "failed"
		skill.SyncError = err.Error()
		_ = s.repo.SaveSkill(skill)
		return err
	}
	return nil
}

func (s *Service) createSingleMarkdownSkill(userID string, req SkillMutationRequest) (*SkillItem, error) {
	archive, err := archiveFromMarkdown([]byte(req.Instruction), req.SkillName, req.Description)
	if err != nil {
		return nil, err
	}
	return s.createSkillFromArchive(userID, archive, SkillInstallRequest{Name: req.SkillName, Description: req.Description, Tag: req.Tag, IsPrivate: req.IsPrivate}, "markdown", req.MarkdownURL, "", "", "", false)
}

func (s *Service) updateSingleMarkdownSkill(skill *model.Skill, req SkillMutationRequest) error {
	if strings.TrimSpace(req.Instruction) == "" {
		return s.repo.SaveSkill(skill)
	}
	archive, err := archiveFromMarkdown([]byte(req.Instruction), req.SkillName, req.Description)
	if err != nil {
		return err
	}
	skill.Instruction = req.Instruction
	return s.addSkillArchiveVersion(skill, archive, "markdown", req.MarkdownURL, "", "", "", false)
}

func (s *Service) createSkillFromArchive(userID string, archive skillPackageArchive, req SkillInstallRequest, sourceType string, sourceURL string, sourceRef string, sourceSubdir string, sourceCommit string, autoUpdate bool) (*SkillItem, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = archive.Metadata.Name
	}
	description := strings.TrimSpace(req.Description)
	if description == "" {
		description = archive.Metadata.Description
	}
	if utf8.RuneCountInString(name) == 0 || utf8.RuneCountInString(name) > 80 {
		return nil, BadAuthRequest("技能名称必须为 1-80 个字符")
	}
	if utf8.RuneCountInString(description) == 0 || utf8.RuneCountInString(description) > 500 {
		return nil, BadAuthRequest("技能简介必须为 1-500 个字符")
	}
	tag := strings.TrimSpace(req.Tag)
	if _, ok := skillCategoryLabels[tag]; !ok {
		tag = "others"
	}
	skillID := newID()
	versionID := newID()
	packageKey, version, files, err := s.persistSkillArchive(skillID, versionID, archive, sourceCommit)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	versionLabel := archive.Metadata.Version
	if versionLabel == "" {
		versionLabel = "1"
		if sourceCommit != "" {
			versionLabel = shortCommit(sourceCommit)
		}
	}
	version.VersionLabel = versionLabel
	skill := &model.Skill{
		ID: skillID, OwnerID: userID, Name: name, Description: description, Instruction: string(archive.Files["SKILL.md"]),
		CurrentVersionID: versionID, VersionLabel: versionLabel, ContentHash: archive.ContentHash, FileCount: len(archive.Files), TotalBytes: archive.TotalBytes,
		SourceType: sourceType, SourceURL: sourceURL, SourceRef: sourceRef, SourceSubdir: sourceSubdir, SourceCommit: sourceCommit,
		SyncStatus: "synced", AutoUpdate: autoUpdate, LastCheckedAt: &now, LastSyncedAt: &now,
		Status: skillStatusEnabled, Source: skillSourceUser, Tag: tag, IsPrivate: req.IsPrivate, MarkdownURL: sourceURL, ShowcaseMediaJSON: "[]",
	}
	state := &model.UserSkillState{ID: newID(), UserID: userID, SkillID: skillID, Added: true, InstalledVersionID: versionID, AutoUpdate: autoUpdate}
	if err := s.repo.CreateSkillWithPackage(skill, version, files, state); err != nil {
		_ = os.Remove(filepath.Join(s.dataDir, "skill-packages", filepath.FromSlash(packageKey)))
		return nil, err
	}
	return s.SkillDetail(userID, skillID)
}

func (s *Service) addSkillArchiveVersion(skill *model.Skill, archive skillPackageArchive, sourceType string, sourceURL string, sourceRef string, sourceSubdir string, sourceCommit string, autoUpdate bool) error {
	versionID := newID()
	packageKey, version, files, err := s.persistSkillArchive(skill.ID, versionID, archive, sourceCommit)
	if err != nil {
		return err
	}
	versionLabel := archive.Metadata.Version
	if versionLabel == "" {
		versionLabel = "1"
		if sourceCommit != "" {
			versionLabel = shortCommit(sourceCommit)
		} else if skill.CurrentVersionID != "" {
			versionLabel = time.Now().UTC().Format("20060102-150405")
		}
	}
	version.VersionLabel = versionLabel
	now := time.Now()
	skill.CurrentVersionID = versionID
	skill.VersionLabel = versionLabel
	skill.ContentHash = archive.ContentHash
	skill.FileCount = len(archive.Files)
	skill.TotalBytes = archive.TotalBytes
	skill.SourceType = sourceType
	skill.SourceURL = sourceURL
	skill.SourceRef = sourceRef
	skill.SourceSubdir = sourceSubdir
	skill.SourceCommit = sourceCommit
	skill.SyncStatus = "synced"
	skill.SyncError = ""
	skill.AutoUpdate = autoUpdate
	skill.LastCheckedAt = &now
	skill.LastSyncedAt = &now
	if err := s.repo.AddSkillVersion(skill, version, files); err != nil {
		_ = os.Remove(filepath.Join(s.dataDir, "skill-packages", filepath.FromSlash(packageKey)))
		return err
	}
	return nil
}

func (s *Service) persistSkillArchive(skillID string, versionID string, archive skillPackageArchive, sourceCommit string) (string, *model.SkillVersion, []model.SkillFile, error) {
	packageKey := path.Join(skillID, versionID+".zip")
	absolute := filepath.Join(s.dataDir, "skill-packages", filepath.FromSlash(packageKey))
	if err := os.MkdirAll(filepath.Dir(absolute), 0o750); err != nil {
		return "", nil, nil, err
	}
	data, err := encodeSkillArchive(archive.Files)
	if err != nil {
		return "", nil, nil, err
	}
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".skill-*.zip")
	if err != nil {
		return "", nil, nil, err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return "", nil, nil, err
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return "", nil, nil, err
	}
	if err := temporary.Close(); err != nil {
		return "", nil, nil, err
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return "", nil, nil, err
	}
	version := &model.SkillVersion{ID: versionID, SkillID: skillID, ContentHash: archive.ContentHash, EntryPath: "SKILL.md", PackageKey: packageKey, FileCount: len(archive.Files), TotalBytes: archive.TotalBytes, SourceCommit: sourceCommit}
	paths := sortedSkillPaths(archive.Files)
	files := make([]model.SkillFile, 0, len(paths))
	for _, filePath := range paths {
		content := archive.Files[filePath]
		digest := sha256.Sum256(content)
		files = append(files, model.SkillFile{ID: newID(), SkillVersionID: versionID, Path: filePath, Kind: skillFileKind(filePath), MimeType: skillFileMime(filePath, content), Size: int64(len(content)), SHA256: hex.EncodeToString(digest[:])})
	}
	return packageKey, version, files, nil
}

func (s *Service) SkillPackageFiles(userID string, skillID string) ([]SkillPackageFileItem, error) {
	skill, err := s.visibleSkill(userID, skillID)
	if err != nil {
		return nil, err
	}
	files, err := s.repo.SkillFiles(skill.CurrentVersionID)
	if err != nil {
		return nil, err
	}
	items := make([]SkillPackageFileItem, 0, len(files))
	for _, file := range files {
		items = append(items, skillFileItem(file))
	}
	return items, nil
}

func (s *Service) SkillPackageFile(userID string, skillID string, filePath string) (*SkillPackageFileContent, error) {
	skill, version, file, content, err := s.readSkillPackageFile(userID, skillID, filePath)
	_ = skill
	_ = version
	if err != nil {
		return nil, err
	}
	binary := !isPreviewText(file.MimeType, file.Path)
	if binary {
		return &SkillPackageFileContent{File: skillFileItem(*file), Binary: true}, nil
	}
	if len(content) > maxSkillPreviewBytes {
		return nil, BadAuthRequest("文件超过 512KB，请下载后查看")
	}
	return &SkillPackageFileContent{File: skillFileItem(*file), Content: string(content)}, nil
}

func (s *Service) SkillPackageRawFile(userID string, skillID string, filePath string) ([]byte, string, string, error) {
	_, _, file, content, err := s.readSkillPackageFile(userID, skillID, filePath)
	if err != nil {
		return nil, "", "", err
	}
	return content, file.MimeType, path.Base(file.Path), nil
}

func (s *Service) SkillPackageBundle(userID string, skillID string) (*SkillPackageBundle, error) {
	skill, err := s.visibleSkill(userID, skillID)
	if err != nil {
		return nil, err
	}
	version, err := s.repo.SkillVersion(skill.CurrentVersionID)
	if err != nil {
		return nil, err
	}
	files, err := s.repo.SkillFiles(version.ID)
	if err != nil {
		return nil, err
	}
	bundle := &SkillPackageBundle{SkillID: skill.ID, Name: skill.Name, Description: skill.Description, VersionID: version.ID, Version: version.VersionLabel, ContentHash: version.ContentHash, Files: make([]SkillPackageBundleFile, 0, len(files))}
	for _, file := range files {
		content, err := s.readSkillArchiveEntry(version, file.Path)
		if err != nil {
			return nil, err
		}
		bundle.Files = append(bundle.Files, SkillPackageBundleFile{Path: file.Path, MimeType: file.MimeType, ContentBase64: base64.StdEncoding.EncodeToString(content)})
	}
	return bundle, nil
}

func (s *Service) SearchSkillPackage(userID string, skillID string, query string) ([]SkillFileSearchResult, error) {
	skill, err := s.visibleSkill(userID, skillID)
	if err != nil {
		return nil, err
	}
	query = strings.TrimSpace(query)
	if query == "" || utf8.RuneCountInString(query) > 120 {
		return nil, BadAuthRequest("搜索关键词必须为 1-120 个字符")
	}
	version, err := s.repo.SkillVersion(skill.CurrentVersionID)
	if err != nil {
		return nil, err
	}
	files, err := s.repo.SkillFiles(version.ID)
	if err != nil {
		return nil, err
	}
	needle := strings.ToLower(query)
	results := make([]SkillFileSearchResult, 0, 20)
	for _, file := range files {
		if len(results) >= 50 || !isPreviewText(file.MimeType, file.Path) || file.Size > maxSkillPreviewBytes {
			continue
		}
		content, err := s.readSkillArchiveEntry(version, file.Path)
		if err != nil {
			return nil, err
		}
		for lineIndex, line := range strings.Split(string(content), "\n") {
			if strings.Contains(strings.ToLower(line), needle) {
				results = append(results, SkillFileSearchResult{Path: file.Path, Line: lineIndex + 1, Snippet: truncateRunes(strings.TrimSpace(line), 240)})
				if len(results) >= 50 {
					break
				}
			}
		}
	}
	return results, nil
}

func (s *Service) readSkillPackageFile(userID string, skillID string, filePath string) (*model.Skill, *model.SkillVersion, *model.SkillFile, []byte, error) {
	skill, err := s.visibleSkill(userID, skillID)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	filePath, err = normalizeSkillPath(filePath)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	version, err := s.repo.SkillVersion(skill.CurrentVersionID)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	files, err := s.repo.SkillFiles(version.ID)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	for index := range files {
		if files[index].Path != filePath {
			continue
		}
		content, err := s.readSkillArchiveEntry(version, filePath)
		return skill, version, &files[index], content, err
	}
	return nil, nil, nil, nil, BadAuthRequest("技能文件不存在")
}

func (s *Service) readSkillArchiveEntry(version *model.SkillVersion, filePath string) ([]byte, error) {
	absolute := filepath.Join(s.dataDir, "skill-packages", filepath.FromSlash(version.PackageKey))
	reader, err := zip.OpenReader(absolute)
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	for _, entry := range reader.File {
		if entry.Name != filePath {
			continue
		}
		file, err := entry.Open()
		if err != nil {
			return nil, err
		}
		defer file.Close()
		return io.ReadAll(io.LimitReader(file, maxSkillFileBytes+1))
	}
	return nil, BadAuthRequest("技能文件不存在")
}

func archiveFromMarkdown(data []byte, fallbackName string, fallbackDescription string) (skillPackageArchive, error) {
	if len(data) == 0 || len(data) > maxSkillFileBytes || !utf8.Valid(data) {
		return skillPackageArchive{}, BadAuthRequest("Markdown 文件为空、过大或不是 UTF-8")
	}
	metadata := parseSkillPackageMetadata(data)
	if metadata.Name == "" {
		metadata.Name = strings.TrimSpace(fallbackName)
	}
	if metadata.Description == "" {
		metadata.Description = strings.TrimSpace(fallbackDescription)
	}
	files := map[string][]byte{"SKILL.md": data}
	return finalizeSkillArchive(files, metadata)
}

func archiveFromZip(data []byte, subdir string) (skillPackageArchive, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return skillPackageArchive{}, BadAuthRequest("ZIP 文件无法解析")
	}
	if len(reader.File) > maxSkillPackageFiles+64 {
		return skillPackageArchive{}, BadAuthRequest("技能包文件数量不能超过 512 个")
	}
	raw := make(map[string][]byte)
	var total int64
	for _, entry := range reader.File {
		if entry.FileInfo().IsDir() {
			continue
		}
		if entry.Mode()&os.ModeSymlink != 0 || !entry.Mode().IsRegular() {
			return skillPackageArchive{}, BadAuthRequest("技能包不能包含软链接或特殊文件")
		}
		entryPath, err := normalizeSkillPath(entry.Name)
		if err != nil {
			return skillPackageArchive{}, err
		}
		if strings.HasPrefix(entryPath, "__MACOSX/") || path.Base(entryPath) == ".DS_Store" {
			continue
		}
		if _, exists := raw[entryPath]; exists {
			return skillPackageArchive{}, BadAuthRequest("技能包包含重复文件路径")
		}
		if entry.UncompressedSize64 > maxSkillFileBytes {
			return skillPackageArchive{}, BadAuthRequest("技能包中单个文件不能超过 8MB")
		}
		file, err := entry.Open()
		if err != nil {
			return skillPackageArchive{}, err
		}
		content, readErr := io.ReadAll(io.LimitReader(file, maxSkillFileBytes+1))
		closeErr := file.Close()
		if readErr != nil {
			return skillPackageArchive{}, readErr
		}
		if closeErr != nil {
			return skillPackageArchive{}, closeErr
		}
		if len(content) > maxSkillFileBytes {
			return skillPackageArchive{}, BadAuthRequest("技能包中单个文件不能超过 8MB")
		}
		total += int64(len(content))
		if total > maxSkillPackageBytes {
			return skillPackageArchive{}, BadAuthRequest("技能包解压后不能超过 20MB")
		}
		raw[entryPath] = content
	}
	files, err := normalizeSkillArchiveRoot(raw, subdir)
	if err != nil {
		return skillPackageArchive{}, err
	}
	metadata := parseSkillPackageMetadata(files["SKILL.md"])
	return finalizeSkillArchive(files, metadata)
}

func normalizeSkillArchiveRoot(raw map[string][]byte, subdir string) (map[string][]byte, error) {
	if len(raw) == 0 {
		return nil, BadAuthRequest("技能包为空")
	}
	paths := sortedSkillPaths(raw)
	firstParts := strings.SplitN(paths[0], "/", 2)
	if len(firstParts) == 2 {
		wrapper := firstParts[0] + "/"
		allWrapped := true
		for _, filePath := range paths {
			if !strings.HasPrefix(filePath, wrapper) {
				allWrapped = false
				break
			}
		}
		if allWrapped {
			next := make(map[string][]byte, len(raw))
			for filePath, content := range raw {
				next[strings.TrimPrefix(filePath, wrapper)] = content
			}
			raw = next
		}
	}
	subdir = strings.Trim(strings.ReplaceAll(strings.TrimSpace(subdir), "\\", "/"), "/")
	if subdir != "" {
		normalized, err := normalizeSkillPath(subdir)
		if err != nil {
			return nil, err
		}
		prefix := normalized + "/"
		filtered := make(map[string][]byte)
		for filePath, content := range raw {
			if strings.HasPrefix(filePath, prefix) {
				filtered[strings.TrimPrefix(filePath, prefix)] = content
			}
		}
		if len(filtered) == 0 {
			return nil, BadAuthRequest("GitHub 子目录不存在或为空")
		}
		raw = filtered
	}
	skillRoots := make([]string, 0, 2)
	for filePath := range raw {
		if filePath == "SKILL.md" {
			skillRoots = []string{""}
			break
		}
		if path.Base(filePath) == "SKILL.md" {
			skillRoots = append(skillRoots, path.Dir(filePath))
		}
	}
	if len(skillRoots) == 0 {
		return nil, BadAuthRequest("技能包中缺少 SKILL.md")
	}
	if len(skillRoots) > 1 {
		return nil, BadAuthRequest("技能包包含多个 SKILL.md，请指定单个技能目录")
	}
	root := skillRoots[0]
	files := make(map[string][]byte)
	for filePath, content := range raw {
		if root != "" {
			prefix := root + "/"
			if !strings.HasPrefix(filePath, prefix) {
				continue
			}
			filePath = strings.TrimPrefix(filePath, prefix)
		}
		files[filePath] = content
	}
	if len(files) > maxSkillPackageFiles {
		return nil, BadAuthRequest("技能包文件数量不能超过 512 个")
	}
	return files, nil
}

func finalizeSkillArchive(files map[string][]byte, metadata skillPackageMetadata) (skillPackageArchive, error) {
	if _, ok := files["SKILL.md"]; !ok {
		return skillPackageArchive{}, BadAuthRequest("技能包入口必须是 SKILL.md")
	}
	if metadata.Name == "" {
		return skillPackageArchive{}, BadAuthRequest("SKILL.md 缺少 name，且无法从标题推断")
	}
	if metadata.Description == "" {
		return skillPackageArchive{}, BadAuthRequest("SKILL.md 缺少 description，且无法从正文推断")
	}
	if utf8.RuneCountInString(metadata.Name) > 80 || utf8.RuneCountInString(metadata.Description) > 500 {
		return skillPackageArchive{}, BadAuthRequest("技能名称或简介超过长度限制")
	}
	hash := sha256.New()
	var total int64
	for _, filePath := range sortedSkillPaths(files) {
		content := files[filePath]
		total += int64(len(content))
		hash.Write([]byte(filePath))
		hash.Write([]byte{0})
		hash.Write(content)
		hash.Write([]byte{0})
	}
	return skillPackageArchive{Files: files, Metadata: metadata, ContentHash: hex.EncodeToString(hash.Sum(nil)), TotalBytes: total}, nil
}

func encodeSkillArchive(files map[string][]byte) ([]byte, error) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, filePath := range sortedSkillPaths(files) {
		header := &zip.FileHeader{Name: filePath, Method: zip.Deflate}
		header.SetMode(0o600)
		header.SetModTime(time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC))
		entry, err := writer.CreateHeader(header)
		if err != nil {
			return nil, err
		}
		if _, err := entry.Write(files[filePath]); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func parseSkillPackageMetadata(data []byte) skillPackageMetadata {
	text := string(data)
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	metadata := skillPackageMetadata{}
	bodyStart := 0
	if len(lines) > 2 && strings.TrimSpace(lines[0]) == "---" {
		metadataIndent := -1
		for index := 1; index < len(lines); index++ {
			line := lines[index]
			if strings.TrimSpace(line) == "---" {
				bodyStart = index + 1
				break
			}
			trimmed := strings.TrimSpace(line)
			indent := len(line) - len(strings.TrimLeft(line, " \t"))
			if indent == 0 {
				metadataIndent = -1
			}
			key, value, ok := strings.Cut(trimmed, ":")
			if !ok {
				continue
			}
			key = strings.TrimSpace(key)
			value = yamlScalar(value)
			switch {
			case indent == 0 && key == "name":
				metadata.Name = value
			case indent == 0 && key == "description":
				metadata.Description = value
			case indent == 0 && key == "metadata":
				metadataIndent = indent
			case metadataIndent >= 0 && indent > metadataIndent && key == "version":
				metadata.Version = value
			}
		}
	}
	body := lines[bodyStart:]
	if metadata.Name == "" {
		for _, line := range body {
			if strings.HasPrefix(strings.TrimSpace(line), "# ") {
				metadata.Name = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "# "))
				break
			}
		}
	}
	if metadata.Description == "" {
		paragraph := make([]string, 0, 4)
		for _, line := range body {
			trimmed := strings.TrimSpace(line)
			if trimmed == "" {
				if len(paragraph) > 0 {
					break
				}
				continue
			}
			if strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "```") {
				continue
			}
			paragraph = append(paragraph, trimmed)
		}
		metadata.Description = truncateRunes(strings.Join(paragraph, " "), 500)
	}
	metadata.Name = truncateRunes(strings.TrimSpace(metadata.Name), 80)
	metadata.Description = truncateRunes(strings.TrimSpace(metadata.Description), 500)
	metadata.Version = truncateRunes(strings.TrimSpace(metadata.Version), 64)
	return metadata
}

func yamlScalar(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 2 && value[0] == '"' {
		if decoded, err := strconv.Unquote(value); err == nil {
			return strings.TrimSpace(decoded)
		}
	}
	if len(value) >= 2 && value[0] == '\'' && value[len(value)-1] == '\'' {
		return strings.TrimSpace(value[1 : len(value)-1])
	}
	return value
}

func parseGitHubSkillURL(rawURL string, requestedRef string, requestedSubdir string) (githubSkillSpec, error) {
	target, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || target.Scheme != "https" || !strings.EqualFold(target.Hostname(), "github.com") || target.User != nil {
		return githubSkillSpec{}, BadAuthRequest("请输入公开的 https://github.com 仓库地址")
	}
	parts := strings.Split(strings.Trim(target.Path, "/"), "/")
	if len(parts) < 2 {
		return githubSkillSpec{}, BadAuthRequest("GitHub 地址必须包含 owner/repository")
	}
	spec := githubSkillSpec{Owner: parts[0], Repo: strings.TrimSuffix(parts[1], ".git"), Ref: strings.TrimSpace(requestedRef), Subdir: strings.Trim(strings.ReplaceAll(strings.TrimSpace(requestedSubdir), "\\", "/"), "/")}
	if len(parts) >= 4 && parts[2] == "tree" {
		if spec.Ref == "" {
			spec.Ref = parts[3]
		}
		if spec.Subdir == "" && len(parts) > 4 {
			spec.Subdir = strings.Join(parts[4:], "/")
		}
	}
	if len(parts) > 2 && parts[2] != "tree" {
		return githubSkillSpec{}, BadAuthRequest("GitHub 地址必须指向仓库根目录或 tree 子目录")
	}
	if spec.Owner == "" || spec.Repo == "" {
		return githubSkillSpec{}, BadAuthRequest("GitHub 仓库地址无效")
	}
	return spec, nil
}

func fetchGitHubSkillArchive(ctx context.Context, spec githubSkillSpec) (skillPackageArchive, string, string, string, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	resolvedRef := spec.Ref
	if resolvedRef == "" {
		var repoInfo struct {
			DefaultBranch string `json:"default_branch"`
		}
		if err := githubJSON(ctx, client, fmt.Sprintf("https://api.github.com/repos/%s/%s", url.PathEscape(spec.Owner), url.PathEscape(spec.Repo)), &repoInfo); err != nil {
			return skillPackageArchive{}, "", "", "", err
		}
		resolvedRef = repoInfo.DefaultBranch
	}
	var commitInfo struct {
		SHA string `json:"sha"`
	}
	if err := githubJSON(ctx, client, fmt.Sprintf("https://api.github.com/repos/%s/%s/commits/%s", url.PathEscape(spec.Owner), url.PathEscape(spec.Repo), url.PathEscape(resolvedRef)), &commitInfo); err != nil {
		return skillPackageArchive{}, "", "", "", err
	}
	if commitInfo.SHA == "" {
		return skillPackageArchive{}, "", "", "", errors.New("GitHub 未返回提交版本")
	}
	downloadURL := fmt.Sprintf("https://codeload.github.com/%s/%s/zip/%s", url.PathEscape(spec.Owner), url.PathEscape(spec.Repo), url.PathEscape(commitInfo.SHA))
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	request.Header.Set("User-Agent", DefaultOutboundUserAgent)
	response, err := client.Do(request)
	if err != nil {
		return skillPackageArchive{}, "", "", "", fmt.Errorf("下载 GitHub 技能失败: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return skillPackageArchive{}, "", "", "", fmt.Errorf("下载 GitHub 技能失败: HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxSkillPackageBytes+1))
	if err != nil {
		return skillPackageArchive{}, "", "", "", err
	}
	if len(data) > maxSkillPackageBytes {
		return skillPackageArchive{}, "", "", "", BadAuthRequest("GitHub 技能包超过 20MB")
	}
	archive, err := archiveFromZip(data, spec.Subdir)
	if err != nil {
		return skillPackageArchive{}, "", "", "", err
	}
	canonicalURL := fmt.Sprintf("https://github.com/%s/%s", spec.Owner, spec.Repo)
	return archive, commitInfo.SHA, canonicalURL, resolvedRef, nil
}

func githubJSON(ctx context.Context, client *http.Client, target string, output any) error {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", DefaultOutboundUserAgent)
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("读取 GitHub 信息失败: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("读取 GitHub 信息失败: HTTP %d", response.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(output)
}

func normalizeSkillPath(value string) (string, error) {
	value = strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	if value == "" || strings.ContainsRune(value, 0) || strings.HasPrefix(value, "/") {
		return "", BadAuthRequest("技能文件路径无效")
	}
	clean := path.Clean(value)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || strings.Contains(clean, "/../") || strings.HasPrefix(clean, ".git/") || clean == ".git" {
		return "", BadAuthRequest("技能文件路径越界或包含禁止目录")
	}
	if utf8.RuneCountInString(clean) > 1000 {
		return "", BadAuthRequest("技能文件路径过长")
	}
	return clean, nil
}

func skillFileMime(filePath string, content []byte) string {
	if filePath == "SKILL.md" || strings.HasSuffix(strings.ToLower(filePath), ".md") {
		return "text/markdown; charset=utf-8"
	}
	if detected := mime.TypeByExtension(strings.ToLower(path.Ext(filePath))); detected != "" {
		return detected
	}
	return http.DetectContentType(content)
}

func skillFileKind(filePath string) string {
	extension := strings.ToLower(path.Ext(filePath))
	switch extension {
	case ".md", ".mdx":
		return "markdown"
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg":
		return "image"
	case ".mp4", ".webm", ".mov":
		return "video"
	case ".mp3", ".wav", ".m4a", ".ogg":
		return "audio"
	case ".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".sh", ".json", ".yaml", ".yml", ".toml", ".html", ".css":
		return "code"
	case ".txt", ".csv":
		return "text"
	default:
		return "binary"
	}
}

func isPreviewText(mimeType string, filePath string) bool {
	return strings.HasPrefix(mimeType, "text/") || strings.Contains(mimeType, "json") || strings.Contains(mimeType, "yaml") || strings.Contains(mimeType, "toml") || skillFileKind(filePath) == "code"
}

func skillFileItem(file model.SkillFile) SkillPackageFileItem {
	return SkillPackageFileItem{Path: file.Path, Kind: file.Kind, MimeType: file.MimeType, Size: file.Size, SHA256: file.SHA256}
}

func sortedSkillPaths(files map[string][]byte) []string {
	paths := make([]string, 0, len(files))
	for filePath := range files {
		paths = append(paths, filePath)
	}
	sort.Strings(paths)
	return paths
}

func shortCommit(value string) string {
	if len(value) <= 12 {
		return value
	}
	return value[:12]
}

func isSkillPackageNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound) || errors.Is(err, os.ErrNotExist)
}
