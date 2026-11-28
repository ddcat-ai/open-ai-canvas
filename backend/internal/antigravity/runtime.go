package antigravity

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

// 官方 agy 自动更新服务按平台给出最新发行清单（version、url），与 T3 等官方 ACP 客户端使用同一来源。
const (
	runtimeManifestBase = "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests"
	runtimeExecutable   = "antigravity"
	runtimeFetchTimeout = 10 * time.Minute
)

// RuntimeStatus 描述服务器上托管的 agy 程序。
type RuntimeStatus struct {
	Installed bool   `json:"installed"`
	Version   string `json:"version,omitempty"`
	Target    string `json:"target"`
	Supported bool   `json:"supported"`
}

type runtimeState struct {
	Version    string `json:"version"`
	Executable string `json:"executable"`
}

type runtimeManifest struct {
	Version string `json:"version"`
	URL     string `json:"url"`
}

func (m *Manager) runtimeDirectory() string {
	return filepath.Join(m.root, "runtime")
}

// runtimeTarget 返回发行清单的平台名，例如 linux_arm64_musl、darwin_arm64。
func runtimeTarget() (string, bool) {
	var platform string
	switch runtime.GOOS {
	case "linux", "darwin":
		platform = runtime.GOOS
	default:
		return runtime.GOOS + "_" + runtime.GOARCH, false
	}
	var arch string
	switch runtime.GOARCH {
	case "amd64", "arm64":
		arch = runtime.GOARCH
	default:
		return platform + "_" + runtime.GOARCH, false
	}
	target := platform + "_" + arch
	if platform == "linux" {
		// Alpine 等 musl 系统需要官方单独构建的 musl 版本。
		if matches, _ := filepath.Glob("/lib/ld-musl-*.so.1"); len(matches) > 0 {
			target += "_musl"
		}
	}
	return target, true
}

func (m *Manager) readRuntimeState() (runtimeState, bool, error) {
	var state runtimeState
	data, err := os.ReadFile(filepath.Join(m.runtimeDirectory(), runtimeStateFile))
	if errors.Is(err, os.ErrNotExist) {
		return state, false, nil
	}
	if err != nil {
		return state, false, err
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return state, false, fmt.Errorf("Antigravity CLI 安装记录无效：%w", err)
	}
	return state, true, nil
}

// RuntimeStatus 只读取本地安装记录，不访问网络。
func (m *Manager) RuntimeStatus() (RuntimeStatus, error) {
	target, supported := runtimeTarget()
	status := RuntimeStatus{Target: target, Supported: supported}
	state, ok, err := m.readRuntimeState()
	if err != nil || !ok {
		return status, err
	}
	if _, err := os.Stat(state.Executable); err != nil {
		return status, nil
	}
	status.Installed = true
	status.Version = state.Version
	return status, nil
}

func (m *Manager) executable() (string, error) {
	state, ok, err := m.readRuntimeState()
	if err != nil {
		return "", err
	}
	if !ok {
		return "", errors.New("Antigravity CLI 尚未安装，请管理员在渠道与模型里安装")
	}
	if _, err := os.Stat(state.Executable); err != nil {
		return "", errors.New("Antigravity CLI 程序文件缺失，请管理员在渠道与模型里重新安装")
	}
	return state.Executable, nil
}

// InstallRuntime 按官方发行清单下载当前平台的最新 agy，已是最新版本时不重复下载。
func (m *Manager) InstallRuntime(ctx context.Context) (RuntimeStatus, error) {
	m.installMu.Lock()
	defer m.installMu.Unlock()
	target, supported := runtimeTarget()
	if !supported {
		return RuntimeStatus{Target: target}, fmt.Errorf("Antigravity CLI 没有 %s 平台的官方版本", target)
	}
	ctx, cancel := context.WithTimeout(ctx, runtimeFetchTimeout)
	defer cancel()
	manifest, err := m.fetchManifest(ctx, target)
	if err != nil {
		return RuntimeStatus{Target: target, Supported: true}, err
	}
	if state, ok, _ := m.readRuntimeState(); ok && state.Version == manifest.Version {
		if _, statErr := os.Stat(state.Executable); statErr == nil {
			return m.RuntimeStatus()
		}
	}
	versionDirectory := filepath.Join(m.runtimeDirectory(), manifest.Version)
	staging := versionDirectory + ".download"
	if err := os.RemoveAll(staging); err != nil {
		return RuntimeStatus{}, err
	}
	if err := os.MkdirAll(staging, 0o755); err != nil {
		return RuntimeStatus{}, err
	}
	if err := m.downloadExecutable(ctx, manifest.URL, filepath.Join(staging, runtimeExecutable)); err != nil {
		_ = os.RemoveAll(staging)
		return RuntimeStatus{}, err
	}
	if err := os.RemoveAll(versionDirectory); err != nil {
		return RuntimeStatus{}, err
	}
	if err := os.Rename(staging, versionDirectory); err != nil {
		return RuntimeStatus{}, err
	}
	previous, hadPrevious, _ := m.readRuntimeState()
	state := runtimeState{Version: manifest.Version, Executable: filepath.Join(versionDirectory, runtimeExecutable)}
	data, err := json.Marshal(state)
	if err != nil {
		return RuntimeStatus{}, err
	}
	if err := os.WriteFile(filepath.Join(m.runtimeDirectory(), runtimeStateFile), data, 0o644); err != nil {
		return RuntimeStatus{}, err
	}
	if hadPrevious && previous.Version != state.Version {
		_ = os.RemoveAll(filepath.Dir(previous.Executable))
	}
	return m.RuntimeStatus()
}

func (m *Manager) fetchManifest(ctx context.Context, target string) (runtimeManifest, error) {
	var manifest runtimeManifest
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, runtimeManifestBase+"/"+target+".json", nil)
	if err != nil {
		return manifest, err
	}
	response, err := m.httpClient.Do(request)
	if err != nil {
		return manifest, fmt.Errorf("读取 Antigravity CLI 发行清单失败：%w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return manifest, fmt.Errorf("读取 Antigravity CLI 发行清单失败：HTTP %d", response.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&manifest); err != nil {
		return manifest, fmt.Errorf("Antigravity CLI 发行清单格式无效：%w", err)
	}
	if manifest.Version == "" || manifest.URL == "" {
		return manifest, errors.New("Antigravity CLI 发行清单缺少版本或下载地址")
	}
	return manifest, nil
}

// downloadExecutable 从官方 tar.gz 包里取出 antigravity 可执行文件。
func (m *Manager) downloadExecutable(ctx context.Context, url, destination string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	response, err := m.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("下载 Antigravity CLI 失败：%w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("下载 Antigravity CLI 失败：HTTP %d", response.StatusCode)
	}
	archive, err := gzip.NewReader(response.Body)
	if err != nil {
		return fmt.Errorf("Antigravity CLI 安装包无效：%w", err)
	}
	defer archive.Close()
	reader := tar.NewReader(archive)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return errors.New("Antigravity CLI 安装包里没有 antigravity 程序")
		}
		if err != nil {
			return fmt.Errorf("Antigravity CLI 安装包无效：%w", err)
		}
		if header.Typeflag != tar.TypeReg || filepath.Base(header.Name) != runtimeExecutable {
			continue
		}
		file, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
		if err != nil {
			return err
		}
		if _, err := io.Copy(file, reader); err != nil {
			_ = file.Close()
			return fmt.Errorf("下载 Antigravity CLI 失败：%w", err)
		}
		return file.Close()
	}
}
