package service

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"infinite-canvas/backend/internal/protocol"
)

const protocolPluginMaxBytes = protocol.PluginManifestMaxBytes

// PluginView is the backend representation consumed by the single frontend
// plugin center. Protocol-specific runtime data is nested under Protocol so
// the public plugin contract can grow without adding another center API.
type PluginView struct {
	Manifest    PluginManifestView   `json:"manifest"`
	Source      string               `json:"source"`
	FileName    string               `json:"fileName"`
	Package     string               `json:"package"`
	SHA256      string               `json:"sha256"`
	InstalledAt time.Time            `json:"installedAt"`
	UpdatedAt   time.Time            `json:"updatedAt"`
	Status      string               `json:"status"`
	Error       string               `json:"error,omitempty"`
	Management  PluginManagementView `json:"management"`
}

type PluginManifestView struct {
	APIVersion    string                         `json:"apiVersion"`
	ID            string                         `json:"id"`
	Name          string                         `json:"name"`
	Version       string                         `json:"version"`
	Entry         string                         `json:"entry,omitempty"`
	Surfaces      []string                       `json:"surfaces,omitempty"`
	Description   string                         `json:"description,omitempty"`
	Documentation string                         `json:"documentation,omitempty"`
	Author        string                         `json:"author,omitempty"`
	Permissions   []string                       `json:"permissions"`
	Trusted       bool                           `json:"trusted"`
	Runtime       protocol.ManifestRuntime       `json:"runtime,omitempty"`
	Configuration protocol.ManifestConfiguration `json:"configuration,omitempty"`
	Contributes   protocol.ManifestContributions `json:"contributes"`
}

type pluginRecord struct {
	Raw           []byte
	Metadata      protocol.Metadata
	Source        string
	FileName      string
	PackagePath   string
	PackageSHA256 string
	SHA256        string
	InstalledAt   time.Time
	UpdatedAt     time.Time
	Status        string
	Error         string
}

type pluginRuntime struct {
	mu           sync.RWMutex
	mutationMu   sync.Mutex
	registryPath string
	packageDir   string
	plugins      map[string]pluginRecord
	registry     *protocol.Registry
}

type pluginRegistryRecord struct {
	ID            string          `json:"id"`
	Raw           json.RawMessage `json:"manifest"`
	Source        string          `json:"source"`
	FileName      string          `json:"fileName,omitempty"`
	PackagePath   string          `json:"packagePath,omitempty"`
	PackageSHA256 string          `json:"packageSha256,omitempty"`
	InstalledAt   time.Time       `json:"installedAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

func newPluginRuntime(dataDir string) (*pluginRuntime, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create plugin registry directory: %w", err)
	}
	packageDir := filepath.Join(dataDir, "plugin-packages")
	if err := os.MkdirAll(packageDir, 0o700); err != nil {
		return nil, fmt.Errorf("create plugin package directory: %w", err)
	}
	center := &pluginRuntime{registryPath: filepath.Join(dataDir, "plugin_registry.json"), packageDir: packageDir, plugins: make(map[string]pluginRecord)}
	if err := center.bootstrapBundledPlugins(); err != nil {
		return nil, err
	}
	if err := center.reload(); err != nil {
		return nil, err
	}
	return center, nil
}

func (c *pluginRuntime) bootstrapBundledPlugins() error {
	stored, err := c.readRegistry()
	if err != nil {
		return err
	}
	byID := make(map[string]pluginRegistryRecord, len(stored))
	for _, record := range stored {
		byID[record.ID] = record
	}
	items := protocol.Builtins().List("", "", true)
	bundledIDs := make(map[string]struct{}, len(items)+2)
	for _, metadata := range items {
		bundledIDs[metadata.ID] = struct{}{}
		protocol.AttachDocumentation(&metadata)
		metadata.Installable = true
		manifest, declarative := protocol.BundledManifest(metadata.ID)
		existing := []byte(nil)
		if record, ok := byID[metadata.ID]; ok {
			existing = record.Raw
			var installed protocol.Manifest
			if err := json.Unmarshal(existing, &installed); err != nil {
				return fmt.Errorf("decode bundled plugin %s: %w", metadata.ID, err)
			}
			expectedBackend := "host:" + metadata.ID
			if declarative {
				expectedBackend = "declarative"
			}
			if installed.Runtime.Backend != expectedBackend {
				return fmt.Errorf("protocol id %q is reserved by a bundled plugin", metadata.ID)
			}
			if metadata.Enabled {
				metadata.Enabled = installed.Metadata.Enabled
			}
		}
		if declarative {
			manifest.Metadata.Enabled = metadata.Enabled
			manifest.Metadata.Installable = true
		} else {
			metadata.Execution = "host:" + metadata.ID
			manifest = protocol.Manifest{
				APIVersion:  "yingce.plugin/v1",
				Metadata:    metadata,
				Runtime:     protocol.ManifestRuntime{Backend: "host:" + metadata.ID},
				Permissions: []string{"generation.run"},
				Contributes: protocol.ManifestContributions{Providers: []protocol.ManifestProvider{{
					ID: metadata.ID, Label: metadata.Name, Capabilities: metadata.Categories, Scopes: metadata.Scopes,
					Parameters: metadata.Parameters, RequiresPublicMediaURLs: metadata.RequiresPublicMediaURLs,
					Create: protocol.ManifestOperation{Method: "POST", Path: "/__host__/" + metadata.ID}, Response: protocol.ManifestResponse{},
				}}},
			}
		}
		data, err := json.Marshal(manifest)
		if err != nil {
			return fmt.Errorf("encode bundled protocol %s: %w", metadata.ID, err)
		}
		record := byID[metadata.ID]
		if !bytes.Equal(record.Raw, data) {
			now := time.Now().UTC()
			if record.InstalledAt.IsZero() {
				record.InstalledAt = now
			}
			record.UpdatedAt = now
		}
		record.ID, record.Raw, record.Source, record.PackagePath = metadata.ID, data, "bundled", ""
		byID[metadata.ID] = record
	}
	for _, workflow := range bundledWorkflowPluginManifests() {
		bundledIDs[workflow.Metadata.ID] = struct{}{}
		data, err := json.Marshal(workflow)
		if err != nil {
			return fmt.Errorf("encode bundled workflow plugin %s: %w", workflow.Metadata.ID, err)
		}
		record := byID[workflow.Metadata.ID]
		if len(record.Raw) > 0 {
			var installed protocol.Manifest
			if err := json.Unmarshal(record.Raw, &installed); err != nil {
				return fmt.Errorf("decode bundled workflow plugin %s: %w", workflow.Metadata.ID, err)
			}
			workflow.Metadata.Enabled = installed.Metadata.Enabled
			data, err = json.Marshal(workflow)
			if err != nil {
				return fmt.Errorf("encode bundled workflow plugin %s: %w", workflow.Metadata.ID, err)
			}
		}
		if !bytes.Equal(record.Raw, data) {
			now := time.Now().UTC()
			if record.InstalledAt.IsZero() {
				record.InstalledAt = now
			}
			record.UpdatedAt = now
		}
		record.ID, record.Raw, record.Source, record.PackagePath = workflow.Metadata.ID, data, "bundled", ""
		byID[workflow.Metadata.ID] = record
	}
	result := make([]pluginRegistryRecord, 0, len(byID))
	for _, record := range byID {
		if record.Source == "bundled" {
			if _, exists := bundledIDs[record.ID]; !exists {
				// Bundled records are derived from the current host registry. Dropping
				// an obsolete record prevents a removed built-in protocol from surviving
				// as a second, stale provider after a host upgrade.
				continue
			}
		}
		result = append(result, record)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return c.writeRegistry(result)
}

func (c *pluginRuntime) reload() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	stored, err := c.readRegistry()
	if err != nil {
		return err
	}
	plugins := make(map[string]pluginRecord)
	for _, storedRecord := range stored {
		data := storedRecord.Raw
		if len(data) > protocolPluginMaxBytes {
			return fmt.Errorf("plugin %s exceeds %d bytes", storedRecord.ID, protocolPluginMaxBytes)
		}
		var manifest protocol.Manifest
		if err := json.Unmarshal(data, &manifest); err != nil {
			return fmt.Errorf("decode plugin %s: %w", storedRecord.ID, err)
		}
		metadata := manifest.Metadata
		if strings.TrimSpace(metadata.ID) == "" {
			return fmt.Errorf("plugin %s has no metadata id", storedRecord.ID)
		}
		if _, exists := plugins[metadata.ID]; exists {
			return fmt.Errorf("duplicate installed protocol %q", metadata.ID)
		}
		packageSHA256 := storedRecord.PackageSHA256
		if packageSHA256 == "" {
			packageSHA256 = pluginHash(data)
		}
		plugins[metadata.ID] = pluginRecord{Raw: data, Metadata: metadata, Source: storedRecord.Source, FileName: storedRecord.FileName, PackagePath: storedRecord.PackagePath, PackageSHA256: packageSHA256, SHA256: packageSHA256, InstalledAt: storedRecord.InstalledAt, UpdatedAt: storedRecord.UpdatedAt, Status: "invalid"}
	}
	registry, err := protocol.NewRegistry()
	if err != nil {
		return err
	}
	for id, record := range plugins {
		adapters, loadErr := protocol.LoadInstalledProviders(record.Raw, func(execution string) (protocol.Adapter, bool) {
			return protocol.Builtins().Resolve(execution)
		})
		if loadErr != nil {
			record.Metadata.Enabled = false
			record.Metadata.UnavailableReason = loadErr.Error()
			record.Error = loadErr.Error()
			_ = registry.Register(protocol.UnavailableAdapter{Info: record.Metadata})
			plugins[id] = record
			continue
		}
		if !record.Metadata.Enabled {
			record.Status = "disabled"
			for _, adapter := range adapters {
				info := adapter.Metadata()
				info.Enabled = false
				_ = registry.Register(protocol.UnavailableAdapter{Info: info})
			}
			plugins[id] = record
			continue
		}
		registrationFailed := false
		for _, adapter := range adapters {
			if err := registry.Register(adapter); err != nil {
				record.Error = err.Error()
				registrationFailed = true
			}
		}
		if registrationFailed {
			plugins[id] = record
			continue
		}
		record.Status = "enabled"
		plugins[id] = record
	}
	c.plugins = plugins
	c.registry = registry
	return nil
}

func (c *pluginRuntime) list() []PluginView {
	c.mu.RLock()
	defer c.mu.RUnlock()
	items := make([]PluginView, 0, len(c.plugins))
	for _, item := range c.plugins {
		items = append(items, PluginView{Manifest: pluginManifestView(item.Raw, item.Metadata, item.Source), Source: item.Source, FileName: item.FileName, Package: protocol.PluginPackageFormat, SHA256: item.SHA256, InstalledAt: item.InstalledAt, UpdatedAt: item.UpdatedAt, Status: item.Status, Error: item.Error})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Manifest.ID < items[j].Manifest.ID })
	return items
}

func (c *pluginRuntime) registrySnapshot() *protocol.Registry {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.registry
}

func (c *pluginRuntime) install(data []byte, fileName string) (PluginView, error) {
	c.mutationMu.Lock()
	defer c.mutationMu.Unlock()
	if len(data) == 0 || len(data) > protocol.PluginPackageMaxBytes {
		return PluginView{}, fmt.Errorf("plugin package must be between 1 and %d bytes", protocol.PluginPackageMaxBytes)
	}
	pkg, err := protocol.ParsePluginPackage(data)
	if err != nil {
		return PluginView{}, err
	}
	manifest := pkg.Manifest
	if strings.HasPrefix(strings.TrimSpace(manifest.Runtime.Backend), "host:") {
		return PluginView{}, errors.New("上传插件不能使用宿主内置执行器")
	}
	if _, err := protocol.LoadInstalledProviders(pkg.ManifestRaw, nil); err != nil {
		return PluginView{}, err
	}
	c.mu.RLock()
	existing, exists := c.plugins[manifest.Metadata.ID]
	c.mu.RUnlock()
	if exists && existing.Source == "bundled" {
		return PluginView{}, fmt.Errorf("内置插件 %q 不能通过上传覆盖", manifest.Metadata.ID)
	}
	manifest.Metadata.Enabled = !exists || existing.Metadata.Enabled
	manifestData, err := json.Marshal(manifest)
	if err != nil {
		return PluginView{}, err
	}
	hash := pluginHash(data)
	packageName := filepath.Base(strings.TrimSpace(fileName))
	if packageName == "." || packageName == "" || packageName == string(filepath.Separator) {
		packageName = manifest.Metadata.ID + ".yingce-plugin"
	}
	packagePath := filepath.Join(c.packageDir, hash+".yingce-plugin")
	if err := writePluginFile(packagePath, data); err != nil {
		return PluginView{}, fmt.Errorf("保存插件包失败：%w", err)
	}
	stored, err := c.readRegistry()
	if err != nil {
		_ = os.Remove(packagePath)
		return PluginView{}, err
	}
	previousStored := append([]pluginRegistryRecord(nil), stored...)
	now := time.Now().UTC()
	newRecord := pluginRegistryRecord{ID: manifest.Metadata.ID, Raw: manifestData, Source: "uploaded", FileName: packageName, PackagePath: filepath.Base(packagePath), PackageSHA256: hash, InstalledAt: now, UpdatedAt: now}
	if exists {
		newRecord.InstalledAt = existing.InstalledAt
		for index := range stored {
			if stored[index].ID == manifest.Metadata.ID {
				stored[index] = newRecord
				break
			}
		}
	} else {
		stored = append(stored, newRecord)
	}
	if err := c.writeRegistry(stored); err != nil {
		_ = os.Remove(packagePath)
		return PluginView{}, fmt.Errorf("保存插件失败：%w", err)
	}
	if err := c.reload(); err != nil {
		_ = c.writeRegistry(previousStored)
		_ = c.reload()
		_ = os.Remove(packagePath)
		return PluginView{}, err
	}
	if exists && existing.PackagePath != "" && existing.PackagePath != filepath.Base(packagePath) {
		_ = os.Remove(filepath.Join(c.packageDir, filepath.Base(existing.PackagePath)))
	}
	for _, item := range c.list() {
		if item.Manifest.ID == manifest.Metadata.ID {
			return item, nil
		}
	}
	return PluginView{}, errors.New("插件保存后未加载")
}

func (c *pluginRuntime) setEnabled(id string, enabled bool) (PluginView, error) {
	c.mutationMu.Lock()
	defer c.mutationMu.Unlock()
	c.mu.RLock()
	record, ok := c.plugins[strings.TrimSpace(id)]
	c.mu.RUnlock()
	if !ok {
		return PluginView{}, fmt.Errorf("插件 %q 不存在", id)
	}
	var manifest protocol.Manifest
	if err := json.Unmarshal(record.Raw, &manifest); err != nil {
		return PluginView{}, err
	}
	manifest.Metadata.Enabled = enabled
	data, err := json.Marshal(manifest)
	if err != nil {
		return PluginView{}, err
	}
	stored, err := c.readRegistry()
	if err != nil {
		return PluginView{}, err
	}
	for index := range stored {
		if stored[index].ID == record.Metadata.ID {
			stored[index].Raw = data
			stored[index].UpdatedAt = time.Now().UTC()
		}
	}
	if err := c.writeRegistry(stored); err != nil {
		return PluginView{}, err
	}
	if err := c.reload(); err != nil {
		return PluginView{}, err
	}
	for _, item := range c.list() {
		if item.Manifest.ID == manifest.Metadata.ID {
			return item, nil
		}
	}
	return PluginView{}, errors.New("插件状态更新后未加载")
}

func pluginManifestView(raw []byte, metadata protocol.Metadata, source string) PluginManifestView {
	var manifest protocol.Manifest
	_ = json.Unmarshal(raw, &manifest)
	if source == "bundled" {
		if adapter, ok := protocol.Builtins().Get(metadata.ID); ok {
			current := adapter.Metadata()
			current.Enabled = current.Enabled && metadata.Enabled
			metadata = current
		}
		protocol.AttachDocumentation(&metadata)
	}
	if manifest.Metadata.ID == "" {
		manifest.Metadata = metadata
	}
	return PluginManifestView{
		ID: metadata.ID, Name: metadata.Name, Version: metadata.Version, APIVersion: "yingce.plugin/v1", Entry: manifest.Entry, Surfaces: manifest.Surfaces,
		Description: metadata.Description, Documentation: metadata.Documentation, Author: metadata.Vendor,
		Permissions: manifest.Permissions, Trusted: source == "bundled", Runtime: manifest.Runtime,
		Configuration: manifest.Configuration, Contributes: manifest.Contributes,
	}
}

func (c *pluginRuntime) uninstall(id string) error {
	c.mutationMu.Lock()
	defer c.mutationMu.Unlock()
	c.mu.RLock()
	record, ok := c.plugins[strings.TrimSpace(id)]
	c.mu.RUnlock()
	if !ok {
		return fmt.Errorf("插件 %q 不存在", id)
	}
	if record.Source == "bundled" {
		return fmt.Errorf("内置插件 %q 不能卸载，可停用该插件", id)
	}
	stored, err := c.readRegistry()
	if err != nil {
		return err
	}
	filtered := stored[:0]
	for _, item := range stored {
		if item.ID != record.Metadata.ID {
			filtered = append(filtered, item)
		}
	}
	if err := c.writeRegistry(filtered); err != nil {
		return err
	}
	if err := c.reload(); err != nil {
		return err
	}
	if record.PackagePath != "" {
		_ = os.Remove(filepath.Join(c.packageDir, filepath.Base(record.PackagePath)))
	}
	return nil
}

func (c *pluginRuntime) readRegistry() ([]pluginRegistryRecord, error) {
	data, err := os.ReadFile(c.registryPath)
	if errors.Is(err, os.ErrNotExist) {
		return []pluginRegistryRecord{}, nil
	}
	if err != nil {
		return nil, err
	}
	if len(data) > protocolPluginMaxBytes*64 {
		return nil, fmt.Errorf("插件 registry 超过大小限制")
	}
	var records []pluginRegistryRecord
	if err := json.Unmarshal(data, &records); err != nil {
		return nil, fmt.Errorf("读取插件 registry 失败：%w", err)
	}
	return records, nil
}

func (c *pluginRuntime) writeRegistry(records []pluginRegistryRecord) error {
	data, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		return err
	}
	return writePluginFile(c.registryPath, data)
}

func writePluginFile(path string, data []byte) error {
	temporary, err := os.CreateTemp(filepath.Dir(path), ".plugin-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func pluginSource(metadata protocol.Metadata) string {
	if _, ok := protocol.Builtins().Get(metadata.ID); ok {
		return "bundled"
	}
	return "uploaded"
}

func pluginHash(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}
