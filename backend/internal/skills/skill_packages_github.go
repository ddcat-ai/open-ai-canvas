// 从 GitHub 安装与同步技能：解析仓库地址、下载归档、按提交号记录版本。

package skills

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/outbound"
)

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
	request.Header.Set("User-Agent", outbound.DefaultOutboundUserAgent)
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
		return skillPackageArchive{}, "", "", "", kernel.BadAuthRequest("GitHub 技能包超过 20MB")
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
	request.Header.Set("User-Agent", outbound.DefaultOutboundUserAgent)
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
