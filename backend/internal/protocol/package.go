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
	PluginPackageMaxBytes  = 16 << 20
	PluginManifestMaxBytes = 512 << 10
	pluginPackageMaxFiles  = 256
	pluginPackageMaxEntry  = 8 << 20
)

// PluginPackage is the transport envelope for every uploaded plugin. The
// manifest remains the single capability contract; files are optional runtime
// artifacts addressed by manifest.entry.
type PluginPackage struct {
	Manifest    Manifest
	ManifestRaw []byte
	Files       map[string][]byte
}

// ParsePluginPackage validates the package container and returns its manifest
// and files. Uploaded code is never executed by this function.
func ParsePluginPackage(data []byte) (PluginPackage, error) {
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
	if name == "manifest.json" || strings.HasPrefix(name, "web/") || strings.HasPrefix(name, "assets/") || strings.HasPrefix(name, "docs/") || name == "README.md" || name == "LICENSE" {
		return name, nil
	}
	return "", fmt.Errorf("plugin package path %q is outside the allowed package roots", name)
}

func validatePluginPackageRuntime(manifest Manifest, files map[string][]byte) error {
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
