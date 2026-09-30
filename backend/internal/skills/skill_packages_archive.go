// 技能包归档的读取与规范化：Markdown / zip 两种来源、根目录识别、元数据解析与内容哈希。
//
// 压缩包条目逐个校验路径与大小（maxSkillFileBytes / maxSkillPackageFiles），防止路径穿越与压缩炸弹。

package skills

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func readSkillArchiveEntries(dataDir string, packageKey string) (map[string][]byte, error) {
	absolute := filepath.Join(dataDir, "skill-packages", filepath.FromSlash(packageKey))
	reader, err := zip.OpenReader(absolute)
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	if len(reader.File) > maxSkillPackageFiles+64 {
		return nil, kernel.BadAuthRequest("技能包文件数量异常")
	}
	contents := make(map[string][]byte, len(reader.File))
	var total int64
	for _, entry := range reader.File {
		if entry.FileInfo().IsDir() {
			continue
		}
		filePath, err := normalizeSkillPath(entry.Name)
		if err != nil {
			return nil, err
		}
		if _, exists := contents[filePath]; exists {
			return nil, kernel.BadAuthRequest("技能包包含重复文件路径")
		}
		if entry.UncompressedSize64 > maxSkillFileBytes {
			return nil, kernel.BadAuthRequest("技能包中单个文件不能超过 8MB")
		}
		file, err := entry.Open()
		if err != nil {
			return nil, err
		}
		content, readErr := io.ReadAll(io.LimitReader(file, maxSkillFileBytes+1))
		closeErr := file.Close()
		if readErr != nil {
			return nil, readErr
		}
		if closeErr != nil {
			return nil, closeErr
		}
		if len(content) > maxSkillFileBytes {
			return nil, kernel.BadAuthRequest("技能包中单个文件不能超过 8MB")
		}
		total += int64(len(content))
		if total > maxSkillPackageBytes {
			return nil, kernel.BadAuthRequest("技能包解压后不能超过 20MB")
		}
		contents[filePath] = content
	}
	return contents, nil
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
	return nil, kernel.BadAuthRequest("技能文件不存在")
}

func archiveFromMarkdown(data []byte, fallbackName string, fallbackDescription string) (skillPackageArchive, error) {
	if len(data) == 0 || len(data) > maxSkillFileBytes || !utf8.Valid(data) {
		return skillPackageArchive{}, kernel.BadAuthRequest("Markdown 文件为空、过大或不是 UTF-8")
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
		return skillPackageArchive{}, kernel.BadAuthRequest("ZIP 文件无法解析")
	}
	if len(reader.File) > maxSkillPackageFiles+64 {
		return skillPackageArchive{}, kernel.BadAuthRequest("技能包文件数量不能超过 512 个")
	}
	raw := make(map[string][]byte)
	var total int64
	for _, entry := range reader.File {
		if entry.FileInfo().IsDir() {
			continue
		}
		if entry.Mode()&os.ModeSymlink != 0 || !entry.Mode().IsRegular() {
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包不能包含软链接或特殊文件")
		}
		entryPath, err := normalizeSkillPath(entry.Name)
		if err != nil {
			return skillPackageArchive{}, err
		}
		if strings.HasPrefix(entryPath, "__MACOSX/") || path.Base(entryPath) == ".DS_Store" {
			continue
		}
		if _, exists := raw[entryPath]; exists {
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包包含重复文件路径")
		}
		if entry.UncompressedSize64 > maxSkillFileBytes {
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包中单个文件不能超过 8MB")
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
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包中单个文件不能超过 8MB")
		}
		total += int64(len(content))
		if total > maxSkillPackageBytes {
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包解压后不能超过 20MB")
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
		return nil, kernel.BadAuthRequest("技能包为空")
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
			return nil, kernel.BadAuthRequest("GitHub 子目录不存在或为空")
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
		return nil, kernel.BadAuthRequest("技能包中缺少 SKILL.md")
	}
	if len(skillRoots) > 1 {
		return nil, kernel.BadAuthRequest("技能包包含多个 SKILL.md，请指定单个技能目录")
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
		return nil, kernel.BadAuthRequest("技能包文件数量不能超过 512 个")
	}
	return files, nil
}

func contentHashAndSize(files map[string][]byte) (string, int64) {
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
	return hex.EncodeToString(hash.Sum(nil)), total
}

func finalizeSkillArchive(files map[string][]byte, metadata skillPackageMetadata) (skillPackageArchive, error) {
	if _, ok := files["SKILL.md"]; !ok {
		return skillPackageArchive{}, kernel.BadAuthRequest("技能包入口必须是 SKILL.md")
	}
	if metadata.Name == "" {
		return skillPackageArchive{}, kernel.BadAuthRequest("SKILL.md 缺少 name，且无法从标题推断")
	}
	if metadata.Description == "" {
		return skillPackageArchive{}, kernel.BadAuthRequest("SKILL.md 缺少 description，且无法从正文推断")
	}
	if utf8.RuneCountInString(metadata.Name) > 80 || utf8.RuneCountInString(metadata.Description) > 500 {
		return skillPackageArchive{}, kernel.BadAuthRequest("技能名称或简介超过长度限制")
	}
	hash, total := contentHashAndSize(files)
	return skillPackageArchive{Files: files, Metadata: metadata, ContentHash: hash, TotalBytes: total}, nil
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
		metadata.Description = strings.Join(paragraph, " ")
	}
	metadata.Name = truncateSkillMetadata(metadata.Name, 80)
	metadata.Description = truncateSkillMetadata(metadata.Description, 500)
	metadata.Version = truncateSkillMetadata(metadata.Version, 64)
	return metadata
}

// truncateSkillMetadata keeps the result within the validation limit. The
// general-purpose TruncateRunes helper appends "...", which is useful for
// display snippets but would make a value exactly at the limit invalid.
func truncateSkillMetadata(value string, limit int) string {
	value = strings.TrimSpace(value)
	if limit <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	if limit <= 3 {
		return string(runes[:limit])
	}
	return string(runes[:limit-3]) + "..."
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
