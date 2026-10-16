package runtime

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// testProvisioner 让解析逻辑完全跑在临时目录里：没有网络、没有系统 node，也不碰真实 HOME。
func testProvisioner(root string, env map[string]string) *provisioner {
	return &provisioner{
		getenv: func(key string) string {
			if key == envRuntimeRoot {
				return root
			}
			return env[key]
		},
		lookPath: func(string) (string, error) { return "", exec.ErrNotFound },
		fetch: func(context.Context, string) (io.ReadCloser, error) {
			return nil, errors.New("测试不应发起下载")
		},
		goos:   "darwin",
		goarch: "arm64",
	}
}

func writeExecutable(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestRuntimeRootPrefersExplicitDir(t *testing.T) {
	explicit := t.TempDir()
	p := &provisioner{getenv: func(key string) string {
		switch key {
		case envRuntimeRoot:
			return explicit
		case envDataDir:
			return "/data"
		}
		return ""
	}}
	if got := p.runtimeRoot(); got != explicit {
		t.Fatalf("runtimeRoot = %q, want %q", got, explicit)
	}

	fallback := &provisioner{getenv: func(key string) string {
		if key == envDataDir {
			return "/data"
		}
		return ""
	}}
	if got := fallback.runtimeRoot(); got != filepath.Join("/data", "runtimes") {
		t.Fatalf("runtimeRoot = %q", got)
	}
}

func TestResolveNodePrefersExplicitBinary(t *testing.T) {
	root := t.TempDir()
	binary := filepath.Join(t.TempDir(), "node")
	writeExecutable(t, binary)

	p := testProvisioner(root, map[string]string{envNodeBin: binary})
	got, err := p.resolveNode(context.Background())
	if err != nil {
		t.Fatalf("resolveNode: %v", err)
	}
	if got != binary {
		t.Fatalf("node = %q, want %q", got, binary)
	}

	broken := testProvisioner(root, map[string]string{envNodeBin: filepath.Join(root, "missing")})
	if _, err := broken.resolveNode(context.Background()); err == nil {
		t.Fatal("显式指定但不可执行时应报错")
	}
}

func TestResolveNodePicksHighestManagedVersion(t *testing.T) {
	root := t.TempDir()
	writeExecutable(t, filepath.Join(root, "node", "v9.11.2", "bin", "node"))
	writeExecutable(t, filepath.Join(root, "node", "v22.22.2", "bin", "node"))

	p := testProvisioner(root, nil)
	got, err := p.resolveNode(context.Background())
	if err != nil {
		t.Fatalf("resolveNode: %v", err)
	}
	want := filepath.Join(root, "node", "v22.22.2", "bin", "node")
	if got != want {
		t.Fatalf("node = %q, want %q", got, want)
	}
}

func TestResolveNodeFallsBackToPath(t *testing.T) {
	root := t.TempDir()
	p := testProvisioner(root, nil)
	p.lookPath = func(name string) (string, error) {
		if name != "node" {
			return "", exec.ErrNotFound
		}
		return "/usr/bin/node", nil
	}
	got, err := p.resolveNode(context.Background())
	if err != nil {
		t.Fatalf("resolveNode: %v", err)
	}
	if got != "/usr/bin/node" {
		t.Fatalf("node = %q", got)
	}
}

func TestResolveNodeFailsClosedWhenAutoInstallDisabled(t *testing.T) {
	root := t.TempDir()
	p := testProvisioner(root, map[string]string{envAutoInstall: "false"})
	_, err := p.resolveNode(context.Background())
	if err == nil {
		t.Fatal("没有 node 且关闭自动安装时应报错")
	}
	if !bytes.Contains([]byte(err.Error()), []byte(envNodeBin)) {
		t.Fatalf("错误信息应指向 %s：%v", envNodeBin, err)
	}
}

// tarGzEntry 描述一个测试用归档条目。
type tarGzEntry struct {
	name string
	body string
	link string
	mode int64
	dir  bool
}

func buildTarGz(t *testing.T, path string, entries []tarGzEntry) []byte {
	t.Helper()
	var buffer bytes.Buffer
	gz := gzip.NewWriter(&buffer)
	writer := tar.NewWriter(gz)
	for _, entry := range entries {
		header := &tar.Header{Name: entry.name, Mode: entry.mode, Typeflag: tar.TypeReg}
		switch {
		case entry.dir:
			header.Typeflag = tar.TypeDir
			header.Mode = 0o755
		case entry.link != "":
			header.Typeflag = tar.TypeSymlink
			header.Linkname = entry.link
		default:
			header.Size = int64(len(entry.body))
		}
		if header.Mode == 0 {
			header.Mode = 0o644
		}
		if err := writer.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if !entry.dir && entry.link == "" {
			if _, err := writer.Write([]byte(entry.body)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, buffer.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func TestResolveNodeDownloadsAndVerifies(t *testing.T) {
	root := t.TempDir()
	asset, err := nodeAssetFor("darwin", "arm64", pinnedNodeVersion, "")
	if err != nil {
		t.Fatal(err)
	}

	var archive []byte
	archivePath := filepath.Join(t.TempDir(), asset.Name)
	archive = buildTarGz(t, archivePath, []tarGzEntry{
		{name: "node-v22.22.2-darwin-arm64/", dir: true},
		{name: "node-v22.22.2-darwin-arm64/bin/node", body: "node", mode: 0o755},
	})

	sums := fmt.Sprintf("%s  %s\n%s  other.tar.gz\n", sha256Hex(archive), asset.Name, sha256Hex([]byte("x")))
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		switch filepath.Base(r.URL.Path) {
		case asset.Name:
			w.Write(archive)
		case "SHASUMS256.txt":
			io.WriteString(w, sums)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	p := testProvisioner(root, map[string]string{envNodeDistBase: server.URL})
	p.fetch = httpFetch
	got, err := p.resolveNode(context.Background())
	if err != nil {
		t.Fatalf("resolveNode: %v", err)
	}
	want := filepath.Join(root, "node", "v"+pinnedNodeVersion, "bin", "node")
	if got != want {
		t.Fatalf("node = %q, want %q", got, want)
	}
	if body, err := os.ReadFile(got); err != nil || string(body) != "node" {
		t.Fatalf("解包内容不对：%q %v", body, err)
	}
	if requests != 2 {
		t.Fatalf("首次安装应各拉一次资产与校验清单，实际 %d 次", requests)
	}

	// 第二次命中已安装目录，不应再发请求。
	if _, err := p.resolveNode(context.Background()); err != nil {
		t.Fatalf("第二次 resolveNode: %v", err)
	}
	if requests != 2 {
		t.Fatalf("已安装后不应再下载，实际 %d 次", requests)
	}
}

func TestResolveNodeRejectsWrongDigest(t *testing.T) {
	root := t.TempDir()
	asset, err := nodeAssetFor("darwin", "arm64", pinnedNodeVersion, "")
	if err != nil {
		t.Fatal(err)
	}
	archivePath := filepath.Join(t.TempDir(), asset.Name)
	archive := buildTarGz(t, archivePath, []tarGzEntry{
		{name: "node-v22.22.2-darwin-arm64/bin/node", body: "node", mode: 0o755},
	})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if filepath.Base(r.URL.Path) == "SHASUMS256.txt" {
			io.WriteString(w, sha256Hex([]byte("别的包"))+"  "+asset.Name+"\n")
			return
		}
		w.Write(archive)
	}))
	defer server.Close()

	p := testProvisioner(root, map[string]string{envNodeDistBase: server.URL})
	p.fetch = httpFetch
	if _, err := p.resolveNode(context.Background()); err == nil {
		t.Fatal("sha256 不匹配时必须失败")
	}
	if _, statErr := os.Stat(filepath.Join(root, "node", "v"+pinnedNodeVersion)); statErr == nil {
		t.Fatal("校验失败不应留下已安装目录")
	}
}

func TestResolveRuntimeDirPrefersExplicitDir(t *testing.T) {
	root := t.TempDir()
	explicit := t.TempDir()
	if err := os.WriteFile(filepath.Join(explicit, piEntryName), []byte("//"), 0o644); err != nil {
		t.Fatal(err)
	}
	p := testProvisioner(root, map[string]string{envPiRuntimeDir: explicit})
	got, err := p.resolveRuntimeDir(context.Background())
	if err != nil {
		t.Fatalf("resolveRuntimeDir: %v", err)
	}
	if got != explicit {
		t.Fatalf("dir = %q, want %q", got, explicit)
	}

	empty := testProvisioner(root, map[string]string{envPiRuntimeDir: t.TempDir()})
	if _, err := empty.resolveRuntimeDir(context.Background()); err == nil {
		t.Fatal("显式指定的目录缺少 agent-runtime.mjs 时应报错")
	}
}

func TestResolveRuntimeDirExtractsBundledArchive(t *testing.T) {
	root := t.TempDir()
	archive := filepath.Join(t.TempDir(), "pi-runtime.tar.gz")
	buildTarGz(t, archive, []tarGzEntry{
		{name: "agent-runtime.mjs", body: "// runtime"},
		{name: "node_modules/pkg/index.js", body: "module.exports = 1"},
		{name: "node_modules/.bin/pkg", link: "../pkg/index.js"},
	})

	p := testProvisioner(root, map[string]string{envPiArchive: archive})
	got, err := p.resolveRuntimeDir(context.Background())
	if err != nil {
		t.Fatalf("resolveRuntimeDir: %v", err)
	}
	if filepath.Base(filepath.Dir(got)) != "pi" || !isDigestName(filepath.Base(got)) {
		t.Fatalf("解包目录命名不符合 pi/<digest>：%s", got)
	}
	if !hasPiEntry(got) {
		t.Fatal("解包后应存在 agent-runtime.mjs")
	}
	link, err := os.Readlink(filepath.Join(got, "node_modules", ".bin", "pkg"))
	if err != nil || link != "../pkg/index.js" {
		t.Fatalf("符号链接未保留：%q %v", link, err)
	}

	// 压缩包已被清理（例如用户换机后残留）时仍应命中已解包结果。
	if err := os.Remove(archive); err != nil {
		t.Fatal(err)
	}
	again, err := p.resolveRuntimeDir(context.Background())
	if err != nil {
		t.Fatalf("第二次 resolveRuntimeDir: %v", err)
	}
	if again != got {
		t.Fatalf("第二次解析 = %q, want %q", again, got)
	}
}

func TestExtractRejectsPathTraversal(t *testing.T) {
	dst := t.TempDir()
	outside := filepath.Join(filepath.Dir(dst), "evil")
	archive := filepath.Join(t.TempDir(), "evil.tar.gz")
	buildTarGz(t, archive, []tarGzEntry{
		{name: "../evil", body: "boom"},
		{name: "ok.txt", body: "fine"},
	})

	if err := extractTarGz(dst, archive, 0); err != nil {
		t.Fatalf("extractTarGz: %v", err)
	}
	if _, err := os.Stat(outside); err == nil {
		t.Fatalf("越界条目被写出了：%s", outside)
	}
	if _, err := os.Stat(filepath.Join(dst, "ok.txt")); err != nil {
		t.Fatalf("正常条目应被解出：%v", err)
	}
}

func TestExtractZipStripsLeadingDir(t *testing.T) {
	dst := t.TempDir()
	archive := filepath.Join(t.TempDir(), "node.zip")
	file, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	entry, err := writer.Create("node-v22.22.2-win-x64/node.exe")
	if err != nil {
		t.Fatal(err)
	}
	io.WriteString(entry, "exe")
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	file.Close()

	if err := extractZip(dst, archive, 1); err != nil {
		t.Fatalf("extractZip: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dst, "node.exe")); err != nil {
		t.Fatalf("应剥离一层目录：%v", err)
	}
}

func TestEnsureReturnsNodeAndRuntimeDir(t *testing.T) {
	root := t.TempDir()
	explicit := t.TempDir()
	if err := os.WriteFile(filepath.Join(explicit, piEntryName), []byte("//"), 0o644); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(t.TempDir(), "node")
	writeExecutable(t, binary)

	p := testProvisioner(root, map[string]string{envPiRuntimeDir: explicit, envNodeBin: binary})
	got, err := p.ensure(context.Background())
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if got.NodePath != binary || got.Dir != explicit {
		t.Fatalf("ensure = %+v", got)
	}
}

func TestNodeAssetForCoversOfficialPlatforms(t *testing.T) {
	cases := []struct {
		goos, goarch, name string
	}{
		{"darwin", "arm64", "node-v22.22.2-darwin-arm64.tar.gz"},
		{"darwin", "amd64", "node-v22.22.2-darwin-x64.tar.gz"},
		{"linux", "amd64", "node-v22.22.2-linux-x64.tar.gz"},
		{"windows", "amd64", "node-v22.22.2-win-x64.zip"},
		{"windows", "arm64", "node-v22.22.2-win-arm64.zip"},
	}
	for _, item := range cases {
		asset, err := nodeAssetFor(item.goos, item.goarch, pinnedNodeVersion, "")
		if err != nil {
			t.Fatalf("%s/%s: %v", item.goos, item.goarch, err)
		}
		if asset.Name != item.name {
			t.Fatalf("%s/%s = %q, want %q", item.goos, item.goarch, asset.Name, item.name)
		}
	}
	if _, err := nodeAssetFor("plan9", "amd64", pinnedNodeVersion, ""); err == nil {
		t.Fatal("未知平台应报错，而不是拼一个不存在的地址")
	}
	if _, err := nodeAssetFor("darwin", "arm64", "22.22.2/../../evil", ""); err == nil {
		t.Fatal("非法版本号应被拒绝")
	}
}

func TestCompareNodeVersions(t *testing.T) {
	if compareNodeVersions("v22.22.2", "v9.11.2") <= 0 {
		t.Fatal("v22 应大于 v9")
	}
	if compareNodeVersions("v22.9.0", "v22.22.2") >= 0 {
		t.Fatal("v22.9 应小于 v22.22")
	}
	if compareNodeVersions("v22.22.2", "v22.22.2") != 0 {
		t.Fatal("同版本应为 0")
	}
}
