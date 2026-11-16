package hostupdate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"runtime"
	"strings"
	"time"
)

func (m *Manager) TestSources() (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.busyLocked() {
		return m.snapshotLocked(), ErrBusy
	}
	previous := m.state.SourceProbe
	sources := m.state.Sources
	m.state.SourceProbe = &SourceProbe{
		ID: randomID(), Status: "running", Sources: sources, StartedAt: time.Now().UTC(),
		Checks: []Check{
			{Key: "release", Label: "GitHub Release 版本列表", Status: "pending"},
			{Key: "compose", Label: "Compose 下载与配置校验", Status: "pending"},
			{Key: "updater", Label: "Host Updater 校验清单", Status: "pending"},
			{Key: "backend", Label: "Backend 镜像清单", Status: "pending"},
			{Key: "web", Label: "Web 镜像清单", Status: "pending"},
			{Key: "agent", Label: "Agent 镜像清单", Status: "pending"},
		},
	}
	if err := m.saveStateLocked(); err != nil {
		m.state.SourceProbe = previous
		return m.snapshotLocked(), fmt.Errorf("保存来源检测任务：%w", err)
	}
	go m.runSourceProbe(sources)
	return m.snapshotLocked(), nil
}

func (m *Manager) runSourceProbe(sources Sources) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	release, err := m.latestRelease(ctx, sources)
	cancel()
	if err != nil {
		m.recordProbeCheck(0, "", err)
		for i := 1; i < 6; i++ {
			m.recordProbeCheck(i, "", errors.New("未检测：无法确定目标 Release，请先修复版本列表访问"))
		}
		m.finishSourceProbe()
		return
	}
	m.mu.Lock()
	m.state.SourceProbe.TargetVersion = release.Version
	m.mu.Unlock()
	m.recordProbeCheck(0, release.Version+" · "+sources.description(), nil)

	composePath, err := m.prepareTargetCompose(release.Version, sources)
	if err == nil {
		err = m.composeWithImages(composePath, release.Version, sources.images(m.config.Repository, release.Version), time.Minute, nil, "config", "--quiet")
		_ = os.Remove(composePath)
	}
	m.recordProbeCheck(1, "目标版本文件可读取，docker compose config 通过", err)

	asset := "open-ai-canvas-host-updater-linux-" + runtime.GOARCH
	url := fmt.Sprintf("https://github.com/%s/releases/download/%s/SHA256SUMS", m.config.Repository, release.Version)
	checksums, err := m.downloadReleaseAsset(url, 1<<20, sources)
	if err == nil {
		_, err = releaseChecksum(checksums, asset)
	}
	m.recordProbeCheck(2, "存在 "+asset+" 的 SHA-256；完整二进制将在更新前下载并校验", err)

	images := sources.images(m.config.Repository, release.Version)
	for i, image := range []string{images.backend, images.web, images.agent} {
		err = m.probeImage(image)
		m.recordProbeCheck(i+3, image+" · linux/"+runtime.GOARCH, err)
	}
	m.finishSourceProbe()
}

func (m *Manager) recordProbeCheck(index int, detail string, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	check := &m.state.SourceProbe.Checks[index]
	check.Status, check.Detail = "passed", detail
	if err != nil {
		check.Status, check.Detail = "failed", safeOperationError(err)
	}
	_ = m.saveStateLocked()
}

func (m *Manager) finishSourceProbe() {
	m.mu.Lock()
	defer m.mu.Unlock()
	probe := m.state.SourceProbe
	probe.Status = "succeeded"
	for _, check := range probe.Checks {
		if check.Status != "passed" {
			probe.Status = "failed"
			break
		}
	}
	now := time.Now().UTC()
	probe.FinishedAt = &now
	_ = m.saveStateLocked()
}

func (m *Manager) probeImage(image string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	var output, stderr bytes.Buffer
	if err := m.runner.Run(ctx, "docker", []string{"manifest", "inspect", image}, nil, &output, &stderr); err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("读取 %s 超时，请检查服务器到镜像源的网络", image)
		}
		return fmt.Errorf("读取 %s 失败：%s", image, safeOperationError(errors.New(strings.TrimSpace(stderr.String())+" "+err.Error())))
	}
	var manifest struct {
		SchemaVersion int `json:"schemaVersion"`
		Manifests     []struct {
			Platform struct {
				OS           string `json:"os"`
				Architecture string `json:"architecture"`
			} `json:"platform"`
		} `json:"manifests"`
	}
	if err := json.Unmarshal(output.Bytes(), &manifest); err != nil || manifest.SchemaVersion != 2 || len(manifest.Manifests) == 0 {
		return fmt.Errorf("%s 未返回有效的多架构镜像清单", image)
	}
	for _, item := range manifest.Manifests {
		if item.Platform.OS == "linux" && item.Platform.Architecture == runtime.GOARCH {
			return nil
		}
	}
	return fmt.Errorf("%s 不包含 linux/%s 平台镜像", image, runtime.GOARCH)
}
