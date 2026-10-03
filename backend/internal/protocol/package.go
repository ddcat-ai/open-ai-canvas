package protocol

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
)

const (
	PluginPackageFormat    = "yingce.plugin/package-v1"
	PluginPackageMaxBytes  = 48 << 20
	PluginManifestMaxBytes = 512 << 10
	pluginPackageMaxFiles  = 256
	pluginPackageMaxEntry  = 16 << 20
)

// PluginPackage is the transport envelope for every uploaded plugin. The
// manifest remains the single capability contract; files are optional runtime
// artifacts addressed by manifest.entry.
type PluginPackage struct {
	Manifest    Manifest
	ManifestRaw []byte
	Files       map[string][]byte
}

// PluginPackageInfo 是只读取清单、不解压其余文件的包摘要。
// 它刻意不携带 Files：调用方无法误把"只校验过结构"的包内容写到磁盘或执行。
type PluginPackageInfo struct {
	Manifest    Manifest
	ManifestRaw []byte
}

// ParsePluginPackage validates the package container and returns its manifest
// and files. Uploaded code is never executed by this function.
func ParsePluginPackage(data []byte) (PluginPackage, error) {
	return readPluginPackage(data, nil)
}

// InspectPluginPackage 与 ParsePluginPackage 做同样的结构校验（路径白名单、文件数、
// 单文件声明大小、符号链接、manifest 与运行时入口），但只解压 manifest.json。
//
// 为什么需要它：官方支付插件每个包内含 7 个平台的可执行文件，解压后约 44MB；
// 服务启动（以及每个构造 Service 的测试）只需要清单即可完成注册。全量解压让每次
// 启动多花约 4 秒，CI 中上百个测试累计 7 分钟以上。
//
// 限制：未解压的条目只校验 zip 头声明的大小，不校验 CRC。整包完整性由调用方
// 对原始字节计算 SHA-256 保证；真正需要落盘执行文件时仍必须走 ParsePluginPackage。
func InspectPluginPackage(data []byte) (PluginPackageInfo, error) {
	pkg, err := readPluginPackage(data, func(string) bool { return false })
	if err != nil {
		return PluginPackageInfo{}, err
	}
	return PluginPackageInfo{Manifest: pkg.Manifest, ManifestRaw: pkg.ManifestRaw}, nil
}

// ParsePluginPackageFiles 与 ParsePluginPackage 做完全相同的校验，但只解压 keep 返回 true
// 的条目（manifest.json 总会解压）；其余条目在 Files 中值为 nil，仅用于存在性判断。
// 被解压的条目仍会经过 zip 的 CRC 校验。
func ParsePluginPackageFiles(data []byte, keep func(name string) bool) (PluginPackage, error) {
	if keep == nil {
		keep = func(string) bool { return false }
	}
	return readPluginPackage(data, keep)
}

// readPluginPackage 是各种读取方式的共同实现。keep 为 nil 表示解压全部条目；
// 否则只解压 manifest.json 与 keep 选中的条目，其余只登记文件名（值为 nil）。
func readPluginPackage(data []byte, keep func(name string) bool) (PluginPackage, error) {
	if len(data) == 0 || len(data) > PluginPackageMaxBytes {
		return PluginPackage{}, fmt.Errorf("plugin package must be between 1 and %d bytes", PluginPackageMaxBytes)
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return PluginPackage{}, fmt.Errorf("decode plugin package: %w", err)
	}
	if len(reader.File) == 0 || len(reader.File) > pluginPackageMaxFiles {
		return PluginPackage{}, fmt.Errorf("plugin package must contain between 1 and %d files", pluginPackageMaxFiles)
	}
	files := make(map[string][]byte, len(reader.File))
	var manifestRaw []byte
	for _, file := range reader.File {
		name, err := validatePluginPackagePath(file.Name)
		if err != nil {
			return PluginPackage{}, err
		}
		if _, exists := files[name]; exists {
			return PluginPackage{}, fmt.Errorf("duplicate plugin package file %q", name)
		}
		if file.FileInfo().IsDir() {
			continue
		}
		if file.Mode()&os.ModeSymlink != 0 {
			return PluginPackage{}, fmt.Errorf("plugin package cannot contain symlink %q", name)
		}
		if file.UncompressedSize64 > pluginPackageMaxEntry {
			return PluginPackage{}, fmt.Errorf("plugin package file %q exceeds %d bytes", name, pluginPackageMaxEntry)
		}
		if keep != nil && name != "manifest.json" && !keep(name) {
			files[name] = nil
			continue
		}
		stream, err := file.Open()
		if err != nil {
			return PluginPackage{}, fmt.Errorf("open plugin package file %q: %w", name, err)
		}
		content, readErr := io.ReadAll(io.LimitReader(stream, pluginPackageMaxEntry+1))
		closeErr := stream.Close()
		if readErr != nil {
			return PluginPackage{}, fmt.Errorf("read plugin package file %q: %w", name, readErr)
		}
		if closeErr != nil {
			return PluginPackage{}, fmt.Errorf("close plugin package file %q: %w", name, closeErr)
		}
		if len(content) > pluginPackageMaxEntry {
			return PluginPackage{}, fmt.Errorf("plugin package file %q exceeds %d bytes", name, pluginPackageMaxEntry)
		}
		files[name] = content
		if name == "manifest.json" {
			manifestRaw = content
		}
	}
	if len(manifestRaw) == 0 {
		return PluginPackage{}, fmt.Errorf("plugin package must contain manifest.json")
	}
	if len(manifestRaw) > PluginManifestMaxBytes {
		return PluginPackage{}, fmt.Errorf("manifest.json exceeds %d bytes", PluginManifestMaxBytes)
	}
	var manifest Manifest
	if err := json.Unmarshal(manifestRaw, &manifest); err != nil {
		return PluginPackage{}, fmt.Errorf("decode plugin manifest: %w", err)
	}
	if err := ValidateManifest(manifest); err != nil {
		return PluginPackage{}, err
	}
	if err := validatePluginPackageRuntime(manifest, files); err != nil {
		return PluginPackage{}, err
	}
	return PluginPackage{Manifest: manifest, ManifestRaw: manifestRaw, Files: files}, nil
}

func validatePluginPackagePath(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || strings.ContainsRune(name, '\\') || strings.HasPrefix(name, "/") || path.IsAbs(name) || path.Clean(name) != name || strings.HasPrefix(name, "../") || name == ".." {
		return "", fmt.Errorf("invalid plugin package path %q", name)
	}
	if name == "manifest.json" || strings.HasPrefix(name, "web/") || strings.HasPrefix(name, "backend/") || strings.HasPrefix(name, "assets/") || strings.HasPrefix(name, "docs/") || strings.HasPrefix(name, "fixtures/") || name == "README.md" || name == "LICENSE" {
		return name, nil
	}
	return "", fmt.Errorf("plugin package path %q is outside the allowed package roots", name)
}

func validatePluginPackageRuntime(manifest Manifest, files map[string][]byte) error {
	backend := strings.TrimSpace(manifest.Runtime.Backend)
	if backend == "rpc" || backend == "wasm" {
		entry := strings.TrimSpace(manifest.Runtime.BackendEntry)
		if !strings.HasPrefix(entry, "backend/") || path.Clean(entry) != entry {
			return fmt.Errorf("manifest.runtime.backendEntry must point inside backend/")
		}
		if backend == "rpc" {
			if !HasAnyPaymentRPCBackend(entry, files) {
				return fmt.Errorf("manifest runtime backend entry %q is missing a host-executable artifact", entry)
			}
		} else if _, ok := files[entry]; !ok {
			return fmt.Errorf("manifest runtime backend entry %q is missing from package", entry)
		}
		if backend == "wasm" && !strings.HasSuffix(strings.ToLower(entry), ".wasm") {
			return fmt.Errorf("wasm backend entry must have .wasm extension")
		}
	}
	if strings.TrimSpace(manifest.Entry) == "" {
		if strings.TrimSpace(manifest.Runtime.Web) != "" {
			return fmt.Errorf("manifest.runtime.web requires manifest.entry")
		}
		for name := range files {
			if strings.HasPrefix(name, "web/") {
				return fmt.Errorf("plugin package web files require manifest.entry")
			}
		}
		return nil
	}
	entry := strings.TrimSpace(manifest.Entry)
	if !strings.HasPrefix(entry, "web/") || path.Clean(entry) != entry {
		return fmt.Errorf("plugin manifest entry must point inside web/")
	}
	if _, ok := files[entry]; !ok {
		return fmt.Errorf("plugin manifest entry %q is missing from package", entry)
	}
	if manifest.Runtime.Web != "sandbox" && manifest.Runtime.Web != "worker" {
		return fmt.Errorf("uploaded web plugins require runtime.web sandbox or worker")
	}
	return nil
}
