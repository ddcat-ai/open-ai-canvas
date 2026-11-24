package hostupdate

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

var ErrBusy = errors.New("更新、版本检查或来源检测正在进行，请稍后重试")

func (s Sources) Validate() error {
	if s.GitHubSource != "direct" && s.GitHubSource != "gh_proxy" {
		return errors.New("GitHub 来源必须为 direct 或 gh_proxy")
	}
	if s.ImageSource != "ghcr" && s.ImageSource != "nju" {
		return errors.New("容器镜像来源必须为 ghcr 或 nju")
	}
	return nil
}

func (s Sources) description() string {
	github, registry := "GitHub 直连", "ghcr.io"
	if s.GitHubSource == "gh_proxy" {
		github = "gh-proxy.com"
	}
	if s.ImageSource == "nju" {
		registry = "ghcr.nju.edu.cn"
	}
	return github + " / " + registry
}

func (s Sources) images(repository, version string) deploymentImages {
	images := immutableImageRefs(repository, version)
	if s.ImageSource == "nju" {
		images.backend = strings.Replace(images.backend, "ghcr.io/", "ghcr.nju.edu.cn/", 1)
		images.web = strings.Replace(images.web, "ghcr.io/", "ghcr.nju.edu.cn/", 1)
		images.agent = strings.Replace(images.agent, "ghcr.io/", "ghcr.nju.edu.cn/", 1)
	}
	return images
}

func (m *Manager) busyLocked() bool {
	return m.state.Operation.Phase.Active() || (m.state.SourceProbe != nil && m.state.SourceProbe.Status == "running")
}

func (m *Manager) SaveSources(sources Sources) (Status, error) {
	if err := sources.Validate(); err != nil {
		return m.Snapshot(), err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.busyLocked() {
		return m.snapshotLocked(), ErrBusy
	}
	if sources == m.state.Sources {
		return m.snapshotLocked(), nil
	}
	previous := m.state
	m.state.Sources = sources
	m.state.LatestRelease = nil
	m.state.SourceProbe = nil
	if m.state.Operation.Phase != PhaseManualIntervention {
		m.state.Operation = Operation{Phase: PhaseIdle, Logs: []LogEntry{}}
	}
	m.appendLogLocked(m.state.Operation.Phase, "更新来源已保存，请重新检查版本："+sources.description())
	if err := m.saveStateLocked(); err != nil {
		m.state = previous
		return m.snapshotLocked(), fmt.Errorf("保存更新来源：%w", err)
	}
	return m.snapshotLocked(), nil
}

// 只转换更新器构造的公开 GitHub 地址，不接收任意代理地址或转发管理员凭据。
func (m *Manager) githubGet(ctx context.Context, original string, sources Sources, accept string) (*http.Response, error) {
	parsed, err := url.Parse(original)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Port() != "" {
		return nil, errors.New("无效的 GitHub 更新资源地址")
	}
	switch parsed.Hostname() {
	case "api.github.com", "github.com", "raw.githubusercontent.com":
	default:
		return nil, errors.New("更新资源必须来自 GitHub")
	}
	address := original
	proxy := sources.GitHubSource == "gh_proxy"
	if proxy {
		address = "https://gh-proxy.com/" + original
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "open-ai-canvas-host-updater")
	if accept != "" {
		request.Header.Set("Accept", accept)
	}
	if parsed.Hostname() == "api.github.com" {
		request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
		if !proxy && m.config.GitHubToken != "" {
			request.Header.Set("Authorization", "Bearer "+m.config.GitHubToken)
		}
	}
	client := *m.httpClient
	client.CheckRedirect = func(next *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("更新资源重定向次数过多")
		}
		host := next.URL.Hostname()
		if next.URL.Scheme != "https" || next.URL.User != nil || next.URL.Port() != "" {
			return errors.New("更新资源重定向地址无效")
		}
		if proxy {
			next.Header.Del("Authorization")
			if host != "gh-proxy.com" {
				return errors.New("镜像源重定向离开 gh-proxy.com，请检查来源或切换直连")
			}
		} else {
			if host != "api.github.com" {
				next.Header.Del("Authorization")
			}
			if host != "github.com" && host != "api.github.com" && !strings.HasSuffix(host, ".githubusercontent.com") {
				return errors.New("更新资源重定向离开 GitHub")
			}
		}
		return nil
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, sourceHTTPError(response.StatusCode)
	}
	return response, nil
}

func sourceHTTPError(status int) error {
	switch status {
	case http.StatusForbidden, http.StatusTooManyRequests:
		return fmt.Errorf("来源返回 HTTP %d：请求被拒绝或达到限流，请稍后重试或切换来源", status)
	case http.StatusNotFound:
		return errors.New("来源返回 HTTP 404：目标版本或资源不存在，镜像源可能尚未同步")
	default:
		return fmt.Errorf("来源返回 HTTP %d", status)
	}
}
