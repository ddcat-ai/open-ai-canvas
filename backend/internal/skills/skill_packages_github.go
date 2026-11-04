// 从 GitHub 安装与同步技能：解析仓库地址、读取技能目录、按提交号记录版本。

package skills

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"sort"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/outbound"
)

type SkillGitHubDiscoverRequest struct {
	URL    string `json:"url"`
	Ref    string `json:"ref"`
	Subdir string `json:"subdir"`
}

type SkillGitHubCandidate struct {
	Subdir string `json:"subdir"`
	Name   string `json:"name"`
}

type SkillGitHubDiscovery struct {
	SourceURL    string                 `json:"sourceUrl"`
	SourceRef    string                 `json:"sourceRef"`
	SourceCommit string                 `json:"sourceCommit"`
	Skills       []SkillGitHubCandidate `json:"skills"`
}

type githubSkillTree struct {
	Truncated bool                   `json:"truncated"`
	Tree      []githubSkillTreeEntry `json:"tree"`
}

type githubSkillTreeEntry struct {
	Path string `json:"path"`
	Mode string `json:"mode"`
	Type string `json:"type"`
	Size int64  `json:"size"`
}

func (s *Service) DiscoverGitHubSkills(ctx context.Context, userID string, req SkillGitHubDiscoverRequest) (*SkillGitHubDiscovery, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	spec, err := parseGitHubSkillURL(req.URL, req.Ref, req.Subdir)
	if err != nil {
		return nil, err
	}
	result, err := discoverGitHubSkillsWithClient(ctx, &http.Client{Timeout: 2 * time.Minute}, spec)
	if err != nil {
		var appErr *kernel.AppError
		if errors.As(err, &appErr) {
			return nil, err
		}
		return nil, kernel.WrapAppError(http.StatusBadGateway, "GitHub 技能目录读取失败，请检查仓库地址和网络", err)
	}
	return result, nil
}

func discoverGitHubSkillsWithClient(ctx context.Context, client *http.Client, spec githubSkillSpec) (*SkillGitHubDiscovery, error) {
	if spec.Subdir != "" {
		normalized, err := normalizeSkillPath(spec.Subdir)
		if err != nil {
			return nil, err
		}
		spec.Subdir = normalized
	}
	commit, ref, err := resolveGitHubSkillRef(ctx, client, spec)
	if err != nil {
		return nil, err
	}
	tree, err := fetchGitHubRepositoryTree(ctx, client, spec, commit)
	if err != nil {
		return nil, err
	}
	items := make([]SkillGitHubCandidate, 0)
	seen := make(map[string]bool)
	exactManifest := "SKILL.md"
	if spec.Subdir != "" {
		exactManifest = spec.Subdir + "/SKILL.md"
	}
	hasExactManifest := false
	for _, entry := range tree.Tree {
		if entry.Path == exactManifest {
			hasExactManifest = true
			break
		}
	}
	for _, entry := range tree.Tree {
		if hasExactManifest && entry.Path != exactManifest {
			continue
		}
		if path.Base(entry.Path) != "SKILL.md" || (spec.Subdir != "" && !strings.HasPrefix(entry.Path, spec.Subdir+"/")) {
			continue
		}
		normalized, err := normalizeSkillPath(entry.Path)
		if err != nil {
			return nil, err
		}
		if normalized != entry.Path {
			return nil, kernel.BadAuthRequest("GitHub 技能目录路径无效")
		}
		if entry.Type != "blob" || (entry.Mode != "100644" && entry.Mode != "100755") {
			return nil, kernel.BadAuthRequest("技能包不能包含软链接或特殊文件")
		}
		if entry.Size < 0 || entry.Size > maxSkillFileBytes {
			return nil, kernel.BadAuthRequest("技能包中单个文件不能超过 8MB")
		}
		subdir := path.Dir(entry.Path)
		if subdir == "." {
			subdir = ""
		}
		if seen[subdir] {
			return nil, kernel.BadAuthRequest("技能包包含重复文件路径")
		}
		seen[subdir] = true
		name := subdir
		if name == "" {
			name = spec.Repo
		}
		items = append(items, SkillGitHubCandidate{Subdir: subdir, Name: name})
	}
	if len(items) == 0 {
		return nil, kernel.BadAuthRequest("GitHub 仓库或子目录中未找到 SKILL.md")
	}
	for _, item := range items {
		if item.Subdir == spec.Subdir {
			items = []SkillGitHubCandidate{item}
			break
		}
	}
	if len(items) > maxSkillPackageFiles {
		return nil, kernel.BadAuthRequest("GitHub 仓库包含的技能过多，请指定更具体的技能子目录")
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Subdir < items[j].Subdir })
	return &SkillGitHubDiscovery{SourceURL: fmt.Sprintf("https://github.com/%s/%s", spec.Owner, spec.Repo), SourceRef: ref, SourceCommit: commit, Skills: items}, nil
}

func parseGitHubSkillURL(rawURL string, requestedRef string, requestedSubdir string) (githubSkillSpec, error) {
	target, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || target.Scheme != "https" || !strings.EqualFold(target.Hostname(), "github.com") || target.User != nil {
		return githubSkillSpec{}, kernel.BadAuthRequest("请输入公开的 https://github.com 仓库地址")
	}
	parts := strings.Split(strings.Trim(target.Path, "/"), "/")
	if len(parts) < 2 {
		return githubSkillSpec{}, kernel.BadAuthRequest("GitHub 地址必须包含 owner/repository")
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
		return githubSkillSpec{}, kernel.BadAuthRequest("GitHub 地址必须指向仓库根目录或 tree 子目录")
	}
	if spec.Owner == "" || spec.Repo == "" {
		return githubSkillSpec{}, kernel.BadAuthRequest("GitHub 仓库地址无效")
	}
	return spec, nil
}

func fetchGitHubSkillArchive(ctx context.Context, spec githubSkillSpec) (skillPackageArchive, string, string, string, error) {
	client := &http.Client{Timeout: 2 * time.Minute}
	return fetchGitHubSkillArchiveWithClient(ctx, client, spec)
}

func fetchGitHubSkillArchiveWithClient(ctx context.Context, client *http.Client, spec githubSkillSpec) (skillPackageArchive, string, string, string, error) {
	commit, resolvedRef, err := resolveGitHubSkillRef(ctx, client, spec)
	if err != nil {
		return skillPackageArchive{}, "", "", "", err
	}
	var archive skillPackageArchive
	if spec.Subdir != "" {
		archive, err = fetchGitHubSkillSubdir(ctx, client, spec, commit)
	} else {
		archive, err = fetchGitHubSkillZip(ctx, client, spec, commit)
	}
	if err != nil {
		return skillPackageArchive{}, "", "", "", err
	}
	canonicalURL := fmt.Sprintf("https://github.com/%s/%s", spec.Owner, spec.Repo)
	return archive, commit, canonicalURL, resolvedRef, nil
}

func resolveGitHubSkillRef(ctx context.Context, client *http.Client, spec githubSkillSpec) (string, string, error) {
	resolvedRef := spec.Ref
	if resolvedRef == "" {
		var repoInfo struct {
			DefaultBranch string `json:"default_branch"`
		}
		if err := githubJSON(ctx, client, fmt.Sprintf("https://api.github.com/repos/%s/%s", url.PathEscape(spec.Owner), url.PathEscape(spec.Repo)), &repoInfo); err != nil {
			return "", "", err
		}
		resolvedRef = repoInfo.DefaultBranch
	}
	var commitInfo struct {
		SHA string `json:"sha"`
	}
	if err := githubJSON(ctx, client, fmt.Sprintf("https://api.github.com/repos/%s/%s/commits/%s", url.PathEscape(spec.Owner), url.PathEscape(spec.Repo), url.PathEscape(resolvedRef)), &commitInfo); err != nil {
		return "", "", err
	}
	if commitInfo.SHA == "" {
		return "", "", errors.New("GitHub 未返回提交版本")
	}
	return commitInfo.SHA, resolvedRef, nil
}

const (
	maxGitHubRepositoryZipBytes = 256 << 20
	maxGitHubRepositoryEntries  = 10000
	maxGitHubTreeBytes          = 8 << 20
)

func fetchGitHubSkillZip(ctx context.Context, client *http.Client, spec githubSkillSpec, commit string) (skillPackageArchive, error) {
	downloadURL := fmt.Sprintf("https://codeload.github.com/%s/%s/zip/%s", url.PathEscape(spec.Owner), url.PathEscape(spec.Repo), url.PathEscape(commit))
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	request.Header.Set("User-Agent", outbound.DefaultOutboundUserAgent)
	response, err := client.Do(request)
	if err != nil {
		return skillPackageArchive{}, fmt.Errorf("下载 GitHub 技能失败: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return skillPackageArchive{}, fmt.Errorf("下载 GitHub 技能失败: HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxSkillPackageBytes+1))
	if err != nil {
		return skillPackageArchive{}, err
	}
	if len(data) > maxSkillPackageBytes {
		return archiveFromLargeGitHubResponse(response.Body, data)
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return skillPackageArchive{}, kernel.BadAuthRequest("GitHub 仓库 ZIP 无法解析")
	}
	return archiveFromGitHubZip(reader)
}

func archiveFromLargeGitHubResponse(body io.Reader, prefix []byte) (skillPackageArchive, error) {
	temporary, err := os.CreateTemp("", "yingce-github-skill-*.zip")
	if err != nil {
		return skillPackageArchive{}, err
	}
	defer os.Remove(temporary.Name())
	defer temporary.Close()
	if _, err := temporary.Write(prefix); err != nil {
		return skillPackageArchive{}, err
	}
	remaining := int64(maxGitHubRepositoryZipBytes - len(prefix) + 1)
	additional, err := io.Copy(temporary, io.LimitReader(body, remaining))
	if err != nil {
		return skillPackageArchive{}, err
	}
	if int64(len(prefix))+additional > maxGitHubRepositoryZipBytes {
		return skillPackageArchive{}, kernel.BadAuthRequest("GitHub 仓库 ZIP 超过 256MB，请指定技能子目录")
	}
	if err := temporary.Close(); err != nil {
		return skillPackageArchive{}, err
	}
	return archiveFromLargeGitHubZip(temporary.Name())
}

func archiveFromLargeGitHubZip(filename string) (skillPackageArchive, error) {
	reader, err := zip.OpenReader(filename)
	if err != nil {
		return skillPackageArchive{}, kernel.BadAuthRequest("GitHub 仓库 ZIP 无法解析")
	}
	defer reader.Close()
	return archiveFromGitHubZip(&reader.Reader)
}

func archiveFromGitHubZip(reader *zip.Reader) (skillPackageArchive, error) {
	if len(reader.File) > maxGitHubRepositoryEntries {
		return skillPackageArchive{}, kernel.BadAuthRequest("GitHub 仓库文件数量过多")
	}
	wrapper := ""
	paths := make([]string, 0, len(reader.File))
	for _, entry := range reader.File {
		if entry.FileInfo().IsDir() {
			continue
		}
		entryPath, err := normalizeSkillPath(entry.Name)
		if err != nil {
			return skillPackageArchive{}, err
		}
		parts := strings.SplitN(entryPath, "/", 2)
		if len(parts) != 2 {
			return skillPackageArchive{}, kernel.BadAuthRequest("GitHub 仓库 ZIP 路径异常")
		}
		if wrapper == "" {
			wrapper = parts[0] + "/"
		}
		if !strings.HasPrefix(entryPath, wrapper) {
			return skillPackageArchive{}, kernel.BadAuthRequest("GitHub 仓库 ZIP 路径异常")
		}
		paths = append(paths, parts[1])
	}
	root, err := selectGitHubSkillRoot(paths)
	if err != nil {
		return skillPackageArchive{}, err
	}
	omitRootExamples := false
	if root == "" {
		var count int
		var total uint64
		for _, entry := range reader.File {
			if entry.FileInfo().IsDir() {
				continue
			}
			count++
			if count > maxSkillPackageFiles || entry.UncompressedSize64 > maxSkillFileBytes || entry.UncompressedSize64 > maxSkillPackageBytes-total {
				omitRootExamples = true
				break
			}
			total += entry.UncompressedSize64
		}
	}
	files := make(map[string][]byte)
	var total int64
	for _, entry := range reader.File {
		if entry.FileInfo().IsDir() {
			continue
		}
		entryPath, err := normalizeSkillPath(entry.Name)
		if err != nil {
			return skillPackageArchive{}, err
		}
		if !strings.HasPrefix(entryPath, wrapper) {
			return skillPackageArchive{}, kernel.BadAuthRequest("GitHub 仓库 ZIP 路径异常")
		}
		relative := strings.TrimPrefix(entryPath, wrapper)
		if root != "" {
			if !strings.HasPrefix(relative, root+"/") {
				continue
			}
			relative = strings.TrimPrefix(relative, root+"/")
		} else if omitRootExamples && isRootExamplePath(relative) {
			continue
		}
		if entry.Mode()&os.ModeSymlink != 0 || !entry.Mode().IsRegular() {
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包不能包含软链接或特殊文件")
		}
		if _, exists := files[relative]; exists {
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
		files[relative] = content
		if len(files) > maxSkillPackageFiles {
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包文件数量不能超过 512 个")
		}
	}
	return finalizeSkillArchive(files, parseSkillPackageMetadata(files["SKILL.md"]))
}

// Legacy installs can store a repository or enclosing directory with one nested
// skill as their source. Resolve that singleton before counting unrelated files.
func selectGitHubSkillRoot(paths []string) (string, error) {
	roots := make(map[string]bool)
	for _, filePath := range paths {
		if path.Base(filePath) != "SKILL.md" {
			continue
		}
		normalized, err := normalizeSkillPath(filePath)
		if err != nil {
			return "", err
		}
		if normalized != filePath {
			return "", kernel.BadAuthRequest("GitHub 技能目录路径无效")
		}
		if filePath == "SKILL.md" {
			return "", nil
		}
		roots[path.Dir(filePath)] = true
	}
	if len(roots) == 0 {
		return "", kernel.BadAuthRequest("GitHub 所选目录缺少 SKILL.md，请指定技能子目录")
	}
	if len(roots) > 1 {
		return "", kernel.BadAuthRequest("GitHub 仓库包含多个 SKILL.md，请指定技能子目录")
	}
	for root := range roots {
		return root, nil
	}
	return "", nil
}

func fetchGitHubSkillSubdir(ctx context.Context, client *http.Client, spec githubSkillSpec, commit string) (skillPackageArchive, error) {
	subdir, err := normalizeSkillPath(spec.Subdir)
	if err != nil {
		return skillPackageArchive{}, err
	}
	return fetchGitHubSkillTree(ctx, client, spec, commit, subdir)
}

func fetchGitHubSkillTree(ctx context.Context, client *http.Client, spec githubSkillSpec, commit string, subdir string) (skillPackageArchive, error) {
	tree, err := fetchGitHubRepositoryTree(ctx, client, spec, commit)
	if err != nil {
		return skillPackageArchive{}, err
	}
	type skillTreeFile struct {
		relative string
		full     string
	}
	selected := make([]skillTreeFile, 0)
	var total int64
	prefix := subdir + "/"
	paths := make([]string, 0)
	for _, entry := range tree.Tree {
		if strings.HasPrefix(entry.Path, prefix) && entry.Type != "tree" {
			paths = append(paths, strings.TrimPrefix(entry.Path, prefix))
		}
	}
	root, err := selectGitHubSkillRoot(paths)
	if err != nil {
		return skillPackageArchive{}, err
	}
	if root != "" {
		prefix += root + "/"
	}
	for _, entry := range tree.Tree {
		if !strings.HasPrefix(entry.Path, prefix) || entry.Type == "tree" {
			continue
		}
		relative, err := normalizeSkillPath(strings.TrimPrefix(entry.Path, prefix))
		if err != nil {
			return skillPackageArchive{}, err
		}
		if entry.Type != "blob" || (entry.Mode != "100644" && entry.Mode != "100755") {
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包不能包含软链接或特殊文件")
		}
		if entry.Size < 0 || entry.Size > maxSkillFileBytes {
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包中单个文件不能超过 8MB")
		}
		total += entry.Size
		if total > maxSkillPackageBytes {
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包解压后不能超过 20MB")
		}
		selected = append(selected, skillTreeFile{relative: relative, full: entry.Path})
		if len(selected) > maxSkillPackageFiles {
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包文件数量不能超过 512 个")
		}
	}
	if len(selected) == 0 {
		return skillPackageArchive{}, kernel.BadAuthRequest("GitHub 技能目录不存在或为空")
	}
	files := make(map[string][]byte, len(selected))
	var downloadedTotal int64
	preferContentsAPI := false
	for _, entry := range selected {
		response, usedContentsAPI, err := openGitHubSkillFile(ctx, client, spec, commit, entry.full, preferContentsAPI)
		if err != nil {
			return skillPackageArchive{}, fmt.Errorf("下载 GitHub 技能文件失败: %w", err)
		}
		preferContentsAPI = usedContentsAPI
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			response.Body.Close()
			return skillPackageArchive{}, fmt.Errorf("下载 GitHub 技能文件失败: HTTP %d", response.StatusCode)
		}
		content, readErr := io.ReadAll(io.LimitReader(response.Body, maxSkillFileBytes+1))
		closeErr := response.Body.Close()
		if readErr != nil {
			return skillPackageArchive{}, readErr
		}
		if closeErr != nil {
			return skillPackageArchive{}, closeErr
		}
		if len(content) > maxSkillFileBytes {
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包中单个文件不能超过 8MB")
		}
		downloadedTotal += int64(len(content))
		if downloadedTotal > maxSkillPackageBytes {
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包解压后不能超过 20MB")
		}
		if _, exists := files[entry.relative]; exists {
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包包含重复文件路径")
		}
		files[entry.relative] = content
	}
	files, err = normalizeSkillArchiveRoot(files, "")
	if err != nil {
		return skillPackageArchive{}, err
	}
	return finalizeSkillArchive(files, parseSkillPackageMetadata(files["SKILL.md"]))
}

func openGitHubSkillFile(ctx context.Context, client *http.Client, spec githubSkillSpec, commit string, filePath string, useContentsAPI bool) (*http.Response, bool, error) {
	for {
		fileURL := fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/%s/%s", url.PathEscape(spec.Owner), url.PathEscape(spec.Repo), url.PathEscape(commit), escapeGitHubPath(filePath))
		if useContentsAPI {
			fileURL = fmt.Sprintf("https://api.github.com/repos/%s/%s/contents/%s?ref=%s", url.PathEscape(spec.Owner), url.PathEscape(spec.Repo), escapeGitHubPath(filePath), url.QueryEscape(commit))
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, fileURL, nil)
		if err != nil {
			return nil, useContentsAPI, err
		}
		request.Header.Set("User-Agent", outbound.DefaultOutboundUserAgent)
		if useContentsAPI {
			request.Header.Set("Accept", "application/vnd.github.raw+json")
		}
		response, err := client.Do(request)
		serverError := response != nil && response.StatusCode >= 500 && response.StatusCode <= 599
		if !useContentsAPI && ctx.Err() == nil && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) && (err != nil || serverError) {
			if response != nil {
				response.Body.Close()
			}
			// Both URLs refer to the same immutable commit. Once the raw host
			// fails, use the official API for the remaining files in this fetch.
			useContentsAPI = true
			continue
		}
		return response, useContentsAPI, err
	}
}

func fetchGitHubRepositoryTree(ctx context.Context, client *http.Client, spec githubSkillSpec, commit string) (*githubSkillTree, error) {
	var tree githubSkillTree
	treeURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/git/trees/%s?recursive=1", url.PathEscape(spec.Owner), url.PathEscape(spec.Repo), url.PathEscape(commit))
	if err := githubJSONWithLimit(ctx, client, treeURL, &tree, maxGitHubTreeBytes); err != nil {
		return nil, err
	}
	if tree.Truncated {
		return nil, kernel.BadAuthRequest("GitHub 仓库目录过大，无法完整读取技能")
	}
	if len(tree.Tree) > maxGitHubRepositoryEntries {
		return nil, kernel.BadAuthRequest("GitHub 仓库文件数量过多")
	}
	return &tree, nil
}

func isRootExamplePath(filePath string) bool {
	return strings.HasPrefix(filePath, "example/") || strings.HasPrefix(filePath, "examples/")
}

func escapeGitHubPath(value string) string {
	parts := strings.Split(path.Clean(value), "/")
	for index := range parts {
		parts[index] = url.PathEscape(parts[index])
	}
	return strings.Join(parts, "/")
}

func githubJSON(ctx context.Context, client *http.Client, target string, output any) error {
	return githubJSONWithLimit(ctx, client, target, output, 1<<20)
}

func githubJSONWithLimit(ctx context.Context, client *http.Client, target string, output any, maxBytes int64) error {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", outbound.DefaultOutboundUserAgent)
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("读取 GitHub 信息失败: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("读取 GitHub 信息失败: HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	if err != nil {
		return err
	}
	if int64(len(data)) > maxBytes {
		return kernel.BadAuthRequest("GitHub 返回的数据过大，请指定更具体的技能子目录")
	}
	return json.Unmarshal(data, output)
}
