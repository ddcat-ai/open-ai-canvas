// Package runtime 是 Agent 进程的宿主层：桥接、进程闸门，以及启动前的运行时供给。
//
// 供给层补的是打包版的缺口：壳只随包发布前端资源与 Go 后端，既没有 node，
// 也没有 backend/agent-runtime/pi。这里按「显式指定 → 已安装 → 系统 PATH → 按需下载」
// 解析 node，按「显式指定 → 已解包 → 随包压缩资源 → 容器/源码路径」解析 pi 运行时，
// 与 open-astravia/packages/runtime-node 的 managed-executables 同构。
// 安装结果一律落在 CANVAS_RUNTIME_DIR（默认 <数据目录>/runtimes）下，不进仓库、不进包内。
package runtime

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
)

const (
	envNodeBin      = "CANVAS_NODE_BIN"
	envNodeVersion  = "CANVAS_NODE_VERSION"
	envNodeDistBase = "CANVAS_NODE_DIST_BASE"
	envPiRuntimeDir = "CANVAS_PI_RUNTIME_DIR"
	envPiArchive    = "CANVAS_PI_ARCHIVE"
	envRuntimeRoot  = "CANVAS_RUNTIME_DIR"
	envAutoInstall  = "CANVAS_RUNTIME_AUTO_INSTALL"
	envDataDir      = "CANVAS_BACKEND_DATA_DIR"

	defaultDataDir = "data"
	runtimeSubdir  = "runtimes"
	nodeSubdir     = "node"
	piSubdir       = "pi"
	piEntryName    = "agent-runtime.mjs"

	// containerRuntimeDir 是容器镜像里的 pi 运行时位置（见 backend/Dockerfile）。
	containerRuntimeDir = "/app/backend/agent-runtime/pi"

	digestNameLength = 12
)

// Provision 是一次可用的 Agent 运行时供给。
type Provision struct {
	// NodePath 是 node 可执行文件，可能是绝对路径，也可能来自系统 PATH。
	NodePath string
	// Dir 是含 agent-runtime.mjs 的 pi 运行时目录。
	Dir string
}

// Ensure 解析（必要时安装）当前进程可用的 Agent 运行时。
// 只有本地 Run 需要它；远程 yingce-agent 模式由远端服务自己解析运行时。
func Ensure(ctx context.Context) (Provision, error) {
	return defaultProvisioner().ensure(ctx)
}

// provisioner 把「读哪个环境、怎么找可执行文件、怎么下载」抽成可注入的边界，
// 单测因此不需要网络、不需要真实 HOME，也不依赖测试机跑在哪个操作系统。
type provisioner struct {
	getenv   func(string) string
	lookPath func(string) (string, error)
	fetch    func(context.Context, string) (io.ReadCloser, error)
	goos     string
	goarch   string
}

func defaultProvisioner() *provisioner {
	return &provisioner{
		getenv:   os.Getenv,
		lookPath: exec.LookPath,
		fetch:    httpFetch,
		goos:     runtime.GOOS,
		goarch:   runtime.GOARCH,
	}
}

func (p *provisioner) ensure(ctx context.Context) (Provision, error) {
	// 先解析 pi 运行时：它是本地文件，失败得快；node 可能触发下载，放在后面。
	dir, err := p.resolveRuntimeDir(ctx)
	if err != nil {
		return Provision{}, err
	}
	nodePath, err := p.resolveNode(ctx)
	if err != nil {
		return Provision{}, err
	}
	return Provision{NodePath: nodePath, Dir: dir}, nil
}

// runtimeRoot 是壳不占用的运行时安装根：CANVAS_RUNTIME_DIR，或数据目录下的 runtimes/。
func (p *provisioner) runtimeRoot() string {
	if explicit := strings.TrimSpace(p.getenv(envRuntimeRoot)); explicit != "" {
		return explicit
	}
	dataDir := strings.TrimSpace(p.getenv(envDataDir))
	if dataDir == "" {
		dataDir = defaultDataDir
	}
	return filepath.Join(dataDir, runtimeSubdir)
}

// resolveRuntimeDir 解析 pi 运行时目录。显式指定优先，其后是上一次解包的结果，
// 再往后才是随包压缩资源，最后回退到容器/源码路径。
func (p *provisioner) resolveRuntimeDir(ctx context.Context) (string, error) {
	if explicit := strings.TrimSpace(p.getenv(envPiRuntimeDir)); explicit != "" {
		if hasPiEntry(explicit) {
			return explicit, nil
		}
		return "", fmt.Errorf("%s 指向的目录里没有 %s：%s", envPiRuntimeDir, piEntryName, explicit)
	}
	if installed := p.installedPiDir(); installed != "" {
		return installed, nil
	}
	if archive := strings.TrimSpace(p.getenv(envPiArchive)); archive != "" {
		return p.installPiArchive(ctx, archive)
	}
	for _, candidate := range hostRuntimeDirs() {
		if hasPiEntry(candidate) {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("Agent 运行时文件缺失：请设置 %s，或用 %s 指向 pi 运行时压缩包", envPiRuntimeDir, envPiArchive)
}

// hostRuntimeDirs 是容器与源码开发的回退路径。打包版两条都不成立：
// 壳用 -trimpath 构建后端，源码相对路径会带上模块前缀，必须靠显式环境变量或压缩资源。
func hostRuntimeDirs() []string {
	candidates := []string{containerRuntimeDir}
	if _, source, _, ok := runtime.Caller(0); ok {
		candidates = append(candidates, filepath.Clean(filepath.Join(filepath.Dir(source), "../../../agent-runtime/pi")))
	}
	return candidates
}

func hasPiEntry(dir string) bool {
	if dir == "" {
		return false
	}
	info, err := os.Stat(filepath.Join(dir, piEntryName))
	return err == nil && !info.IsDir()
}

// installedPiDir 找上一次解包出来的运行时；目录名是压缩包的 sha256 前缀，
// 排序后取最后一个，保证同一份包只解一次、结果稳定。
func (p *provisioner) installedPiDir() string {
	base := filepath.Join(p.runtimeRoot(), piSubdir)
	entries, err := os.ReadDir(base)
	if err != nil {
		return ""
	}
	var found []string
	for _, entry := range entries {
		if !entry.IsDir() || !isDigestName(entry.Name()) {
			continue
		}
		if hasPiEntry(filepath.Join(base, entry.Name())) {
			found = append(found, entry.Name())
		}
	}
	if len(found) == 0 {
		return ""
	}
	sort.Strings(found)
	return filepath.Join(base, found[len(found)-1])
}

// installPiArchive 解包随包发布的 pi 运行时压缩资源，并返回解包目录。
func (p *provisioner) installPiArchive(ctx context.Context, archive string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	digest, err := fileDigest(archive)
	if err != nil {
		return "", fmt.Errorf("读取 pi 运行时压缩包失败：%w", err)
	}
	target := filepath.Join(p.runtimeRoot(), piSubdir, digest)
	if hasPiEntry(target) {
		return target, nil
	}
	log.Printf("[Agent] 首次运行，正在解包 pi 运行时：%s", archive)
	if err := extractArchive(archive, target, 0); err != nil {
		return "", err
	}
	if !hasPiEntry(target) {
		return "", fmt.Errorf("pi 运行时压缩包缺少 %s：%s", piEntryName, archive)
	}
	p.prunePiInstalls(filepath.Join(p.runtimeRoot(), piSubdir), digest)
	log.Printf("[Agent] pi 运行时已解包：%s", target)
	return target, nil
}

// prunePiInstalls 只清理我们自己的命名空间（runtimes/pi/<12 位十六进制>），
// 换版本后不会长期堆积多份 242M 的解包结果。
func (p *provisioner) prunePiInstalls(base, keep string) {
	entries, err := os.ReadDir(base)
	if err != nil {
		return
	}
	for _, entry := range entries {
		name := entry.Name()
		if !entry.IsDir() || name == keep || !isDigestName(name) {
			continue
		}
		if err := os.RemoveAll(filepath.Join(base, name)); err != nil {
			log.Printf("[Agent] 清理旧 pi 运行时失败 %s：%v", name, err)
		}
	}
}

// resolveNode 解析 node 可执行文件：显式指定 → 已安装 → 系统 PATH → 官方分发包下载。
func (p *provisioner) resolveNode(ctx context.Context) (string, error) {
	if explicit := strings.TrimSpace(p.getenv(envNodeBin)); explicit != "" {
		if isExecutableFile(explicit) {
			return explicit, nil
		}
		return "", fmt.Errorf("%s 指向的 node 不可执行：%s", envNodeBin, explicit)
	}
	if installed := p.installedNode(); installed != "" {
		return installed, nil
	}
	if found, err := p.lookPath("node"); err == nil && found != "" {
		return found, nil
	}
	if !autoInstallEnabled(p.getenv) {
		return "", fmt.Errorf("未找到可用的 node：请安装 Node %s+ 或设置 %s；自动安装已关闭（%s=false）", pinnedNodeVersion, envNodeBin, envAutoInstall)
	}
	return p.installNode(ctx)
}

// installedNode 在 runtimes/node/ 下挑版本最高的可用安装；下载中断留下的空目录会被跳过。
func (p *provisioner) installedNode() string {
	base := filepath.Join(p.runtimeRoot(), nodeSubdir)
	entries, err := os.ReadDir(base)
	if err != nil {
		return ""
	}
	var versions []string
	for _, entry := range entries {
		if entry.IsDir() && strings.HasPrefix(entry.Name(), "v") {
			versions = append(versions, entry.Name())
		}
	}
	sort.Slice(versions, func(i, j int) bool {
		return compareNodeVersions(versions[i], versions[j]) > 0
	})
	for _, name := range versions {
		candidate := filepath.Join(base, name, filepath.FromSlash(nodeBinaryRelPath(p.goos)))
		if isExecutableFile(candidate) {
			return candidate
		}
	}
	return ""
}

// installNode 下载官方分发包、校验 sha256、解包到 runtimes/node/。
func (p *provisioner) installNode(ctx context.Context) (string, error) {
	version := strings.TrimSpace(p.getenv(envNodeVersion))
	if version == "" {
		version = pinnedNodeVersion
	}
	asset, err := nodeAssetFor(p.goos, p.goarch, version, p.getenv(envNodeDistBase))
	if err != nil {
		return "", err
	}
	target := filepath.Join(p.runtimeRoot(), nodeSubdir, "v"+asset.Version)
	binary := filepath.Join(target, filepath.FromSlash(nodeBinaryRelPath(p.goos)))
	if isExecutableFile(binary) {
		return binary, nil
	}
	archive, cleanup, err := p.downloadNode(ctx, asset)
	if err != nil {
		return "", err
	}
	defer cleanup()

	log.Printf("[Agent] 未找到 node，正在安装 %s", asset.Name)
	if err := extractArchive(archive, target, asset.Strip); err != nil {
		return "", err
	}
	if !isExecutableFile(binary) {
		// 归档里可能没有可执行位，补一次再判断。
		if _, statErr := os.Stat(binary); statErr == nil {
			if err := os.Chmod(binary, 0o755); err != nil {
				return "", fmt.Errorf("设置 node 可执行权限失败：%w", err)
			}
		}
	}
	if !isExecutableFile(binary) {
		return "", fmt.Errorf("node 分发包解压后缺少 %s：%s", nodeBinaryRelPath(p.goos), asset.Name)
	}
	log.Printf("[Agent] node 已安装：%s", binary)
	return binary, nil
}

// downloadNode 把分发包落到运行目录下的临时文件，并按官方 SHASUMS256.txt 校验 sha256。
// 校验取不到或对不上都直接失败：运行时是外部可执行文件，这里不做降级。
func (p *provisioner) downloadNode(ctx context.Context, asset nodeAsset) (string, func(), error) {
	dir := filepath.Join(p.runtimeRoot(), nodeSubdir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", nil, fmt.Errorf("创建运行时目录失败：%w", err)
	}
	file, err := os.CreateTemp(dir, ".download-*")
	if err != nil {
		return "", nil, fmt.Errorf("创建下载临时文件失败：%w", err)
	}
	cleanup := func() { os.Remove(file.Name()) }

	want, err := p.assetDigest(ctx, asset)
	if err != nil {
		file.Close()
		cleanup()
		return "", nil, err
	}
	body, err := fetchWithRetry(ctx, p.fetch, asset.URL)
	if err != nil {
		file.Close()
		cleanup()
		return "", nil, fmt.Errorf("下载 %s 失败：%w", asset.Name, err)
	}
	defer body.Close()

	digest := sha256.New()
	if _, err := io.Copy(io.MultiWriter(file, digest), body); err != nil {
		file.Close()
		cleanup()
		return "", nil, fmt.Errorf("下载 %s 失败：%w", asset.Name, err)
	}
	if err := file.Close(); err != nil {
		cleanup()
		return "", nil, err
	}
	if got := hex.EncodeToString(digest.Sum(nil)); !strings.EqualFold(got, want) {
		cleanup()
		return "", nil, fmt.Errorf("%s 校验失败：期望 %s，实际 %s", asset.Name, want, got)
	}
	return file.Name(), cleanup, nil
}

// assetDigest 从官方校验清单里取该资产的 sha256。
func (p *provisioner) assetDigest(ctx context.Context, asset nodeAsset) (string, error) {
	body, err := fetchWithRetry(ctx, p.fetch, asset.SumsURL)
	if err != nil {
		return "", fmt.Errorf("下载官方校验清单失败：%w", err)
	}
	defer body.Close()
	content, err := io.ReadAll(io.LimitReader(body, 1<<20))
	if err != nil {
		return "", fmt.Errorf("读取官方校验清单失败：%w", err)
	}
	for _, line := range strings.Split(string(content), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[1] == asset.Name {
			return fields[0], nil
		}
	}
	return "", fmt.Errorf("官方校验清单里没有 %s：%s", asset.Name, asset.SumsURL)
}

// fileDigest 返回文件内容的 sha256 前 12 位，用作解包目录名。
func fileDigest(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil))[:digestNameLength], nil
}

func isDigestName(name string) bool {
	if len(name) != digestNameLength {
		return false
	}
	for _, char := range name {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

// autoInstallEnabled 默认开启；显式 false/0/no/off 才关闭，方便离线部署提前失败。
func autoInstallEnabled(getenv func(string) string) bool {
	switch strings.ToLower(strings.TrimSpace(getenv(envAutoInstall))) {
	case "false", "0", "no", "off":
		return false
	default:
		return true
	}
}

func isExecutableFile(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	if runtime.GOOS == "windows" {
		return true
	}
	return info.Mode().Perm()&0o111 != 0
}

// compareNodeVersions 比较 "v22.22.2" 这类目录名，返回正数表示 a 更新。
func compareNodeVersions(a, b string) int {
	left := strings.Split(strings.TrimPrefix(a, "v"), ".")
	right := strings.Split(strings.TrimPrefix(b, "v"), ".")
	for index := 0; index < len(left) || index < len(right); index++ {
		var lv, rv int
		if index < len(left) {
			lv, _ = strconv.Atoi(left[index])
		}
		if index < len(right) {
			rv, _ = strconv.Atoi(right[index])
		}
		if lv != rv {
			return lv - rv
		}
	}
	return 0
}
