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

const protocolPluginMaxBytes = 512 << 10

// PluginView is the backend representation consumed by the single frontend
// plugin center. Protocol-specific runtime data is nested under Protocol so
// the public plugin contract can grow without adding another center API.
type PluginView struct {
	Manifest    PluginManifestView `json:"manifest"`
	Source      string             `json:"source"`
	FileName    string             `json:"fileName"`
	SHA256      string             `json:"sha256"`
	InstalledAt time.Time          `json:"installedAt"`
	UpdatedAt   time.Time          `json:"updatedAt"`
	Status      string             `json:"status"`
	Error       string             `json:"error,omitempty"`
}

type PluginManifestView struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Version     string             `json:"version"`
	APIVersion  string             `json:"apiVersion"`
	Category    string             `json:"category"`
	Description string             `json:"description,omitempty"`
	Author      string             `json:"author,omitempty"`
	Surfaces    []string           `json:"surfaces"`
	Permissions []string           `json:"permissions"`
	Trusted     bool               `json:"trusted"`
	Kind        string             `json:"kind"`
	Protocol    PluginProtocolView `json:"protocol"`
}

type PluginProtocolView struct {
	Categories    []string             `json:"categories"`
	Scopes        []string             `json:"scopes"`
	Create        string               `json:"create,omitempty"`
	Poll          string               `json:"poll,omitempty"`
	Cancel        string               `json:"cancel,omitempty"`
	ContentType   string               `json:"contentType,omitempty"`
	Documentation string               `json:"documentation,omitempty"`
	Parameters    []protocol.Parameter `json:"parameters,omitempty"`
}

type pluginRecord struct {
	Raw         []byte
	Metadata    protocol.Metadata
	Source      string
	FileName    string
	SHA256      string
	InstalledAt time.Time
	UpdatedAt   time.Time
	Status      string
	Error       string
}

type pluginRuntime struct {
	mu         sync.RWMutex
	mutationMu sync.Mutex
	dir        string
	plugins    map[string]pluginRecord
	registry   *protocol.Registry
}

func newPluginRuntime(dataDir string) (*pluginRuntime, error) {
	dir := filepath.Join(dataDir, "plugins")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create plugin directory: %w", err)
	}
	center := &pluginRuntime{dir: dir, plugins: make(map[string]pluginRecord)}
	if err := center.bootstrapBundledPlugins(); err != nil {
		return nil, err
	}
	if err := center.reload(); err != nil {
		return nil, err
	}
	return center, nil
}

func (c *pluginRuntime) bootstrapBundledPlugins() error {
	items := protocol.Builtins().List("", "", true)
	for _, metadata := range items {
		protocol.AttachDocumentation(&metadata)
		metadata.Execution = "host:" + metadata.ID
		metadata.Installable = true
		path := filepath.Join(c.dir, metadata.ID+".json")
		existing, err := os.ReadFile(path)
		if err == nil {
			var installed protocol.Manifest
			if err := json.Unmarshal(existing, &installed); err != nil {
				return fmt.Errorf("decode bundled protocol %s: %w", metadata.ID, err)
			}
			if installed.Metadata.Execution != metadata.Execution {
				return fmt.Errorf("protocol id %q is reserved by a bundled plugin", metadata.ID)
			}
			if metadata.Enabled {
				metadata.Enabled = installed.Metadata.Enabled
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		manifest := protocol.Manifest{
			APIVersion: "v1",
			Metadata:   metadata,
			Create:     protocol.ManifestOperation{Method: "POST", Path: "/__host__/" + metadata.ID},
			Response:   protocol.ManifestResponse{},
		}
		data, err := json.Marshal(manifest)
		if err != nil {
			return fmt.Errorf("encode bundled protocol %s: %w", metadata.ID, err)
		}
		if bytes.Equal(existing, data) {
			continue
		}
		if err := writePluginFile(path, data); err != nil {
			return fmt.Errorf("install bundled protocol %s: %w", metadata.ID, err)
		}
	}
	return nil
}

func (c *pluginRuntime) reload() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	entries, err := os.ReadDir(c.dir)
	if err != nil {
		return err
	}
	plugins := make(map[string]pluginRecord)
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		path := filepath.Join(c.dir, entry.Name())
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return fmt.Errorf("read protocol plugin %s: %w", entry.Name(), readErr)
		}
		if len(data) > protocolPluginMaxBytes {
			return fmt.Errorf("protocol plugin %s exceeds %d bytes", entry.Name(), protocolPluginMaxBytes)
		}
		var manifest protocol.Manifest
		if err := json.Unmarshal(data, &manifest); err != nil {
			return fmt.Errorf("decode protocol plugin %s: %w", entry.Name(), err)
		}
		metadata := manifest.Metadata
		if strings.TrimSpace(metadata.ID) == "" {
			return fmt.Errorf("protocol plugin %s has no metadata id", entry.Name())
		}
		if _, exists := plugins[metadata.ID]; exists {
			return fmt.Errorf("duplicate installed protocol %q", metadata.ID)
		}
		now := time.Now().UTC()
		stat, _ := os.Stat(path)
		updated := now
		if stat != nil {
			updated = stat.ModTime().UTC()
		}
		plugins[metadata.ID] = pluginRecord{Raw: data, Metadata: metadata, Source: pluginSource(metadata), FileName: entry.Name(), SHA256: pluginHash(data), InstalledAt: updated, UpdatedAt: updated, Status: "invalid"}
	}
	registry, err := protocol.NewRegistry()
	if err != nil {
		return err
	}
	for id, record := range plugins {
		adapter, loadErr := protocol.LoadInstalledPlugin(record.Raw, func(execution string) (protocol.Adapter, bool) {
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
			_ = registry.Register(protocol.UnavailableAdapter{Info: record.Metadata})
			plugins[id] = record
			continue
		}
		if err := registry.Register(adapter); err != nil {
			record.Error = err.Error()
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
		items = append(items, PluginView{Manifest: pluginManifestView(item.Metadata, item.Source), Source: item.Source, FileName: item.FileName, SHA256: item.SHA256, InstalledAt: item.InstalledAt, UpdatedAt: item.UpdatedAt, Status: item.Status, Error: item.Error})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Manifest.ID < items[j].Manifest.ID })
	return items
}

func (c *pluginRuntime) registrySnapshot() *protocol.Registry {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.registry
}

func (c *pluginRuntime) install(data []byte) (PluginView, error) {
	c.mutationMu.Lock()
	defer c.mutationMu.Unlock()
	if len(data) == 0 || len(data) > protocolPluginMaxBytes {
		return PluginView{}, fmt.Errorf("plugin manifest must be between 1 and %d bytes", protocolPluginMaxBytes)
	}
	var manifest protocol.Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return PluginView{}, fmt.Errorf("插件清单 JSON 无效：%w", err)
	}
	if strings.HasPrefix(strings.TrimSpace(manifest.Metadata.Execution), "host:") {
		return PluginView{}, errors.New("上传插件不能使用宿主内置执行器")
	}
	if _, err := protocol.LoadManifest(data); err != nil {
		return PluginView{}, err
	}
	c.mu.RLock()
	_, exists := c.plugins[manifest.Metadata.ID]
	c.mu.RUnlock()
	if exists {
		return PluginView{}, fmt.Errorf("插件 ID %q 已存在；当前上传入口不支持覆盖安装", manifest.Metadata.ID)
	}
	manifest.Metadata.Enabled = true
	data, err := json.Marshal(manifest)
	if err != nil {
		return PluginView{}, err
	}
	path := filepath.Join(c.dir, manifest.Metadata.ID+".json")
	if err := c.persistAndReload(path, data, nil); err != nil {
		return PluginView{}, fmt.Errorf("保存插件失败：%w", err)
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
	if err := c.persistAndReload(filepath.Join(c.dir, record.FileName), data, record.Raw); err != nil {
		return PluginView{}, err
	}
	for _, item := range c.list() {
		if item.Manifest.ID == manifest.Metadata.ID {
			return item, nil
		}
	}
	return PluginView{}, errors.New("插件状态更新后未加载")
}

func pluginManifestView(metadata protocol.Metadata, source string) PluginManifestView {
	if source == "bundled" {
		if adapter, ok := protocol.Builtins().Get(metadata.ID); ok {
			current := adapter.Metadata()
			current.Enabled = current.Enabled && metadata.Enabled
			metadata = current
		}
		protocol.AttachDocumentation(&metadata)
	}
	categories := make([]string, 0, len(metadata.Categories))
	for _, item := range metadata.Categories {
		categories = append(categories, string(item))
	}
	scopes := make([]string, 0, len(metadata.Scopes))
	for _, item := range metadata.Scopes {
		scopes = append(scopes, string(item))
	}
	return PluginManifestView{
		ID: metadata.ID, Name: metadata.Name, Version: metadata.Version, APIVersion: "v1",
		Category: "protocol", Description: metadata.Description, Author: metadata.Vendor,
		Surfaces: []string{"hybrid"}, Permissions: []string{"generation.run"},
		Trusted: source == "bundled", Kind: "protocol",
		Protocol: PluginProtocolView{Categories: categories, Scopes: scopes, Create: metadata.Create, Poll: metadata.Poll, Cancel: metadata.Cancel, ContentType: metadata.ContentType, Documentation: metadata.Documentation, Parameters: metadata.Parameters},
	}
}

func (c *pluginRuntime) uninstall(id string) error {
	c.mutationMu.Lock()
	defer c.mutationMu.Unlock()
	c.mu.RLock()
	record, ok := c.plugins[strings.TrimSpace(id)]
	c.mu.RUnlock()
	if !ok {
		return fmt.Errorf("协议插件 %q 不存在", id)
	}
	if record.Source == "bundled" {
		return fmt.Errorf("内置协议插件 %q 不能卸载，可停用该插件", id)
	}
	path := filepath.Join(c.dir, record.FileName)
	if err := os.Remove(path); err != nil {
		return err
	}
	if err := c.reload(); err != nil {
		_ = writePluginFile(path, record.Raw)
		_ = c.reload()
		return err
	}
	return nil
}

func (c *pluginRuntime) persistAndReload(path string, data, rollback []byte) error {
	if err := writePluginFile(path, data); err != nil {
		return err
	}
	if err := c.reload(); err != nil {
		if rollback == nil {
			_ = os.Remove(path)
		} else {
			_ = writePluginFile(path, rollback)
		}
		_ = c.reload()
		return err
	}
	return nil
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
	if strings.HasPrefix(strings.TrimSpace(metadata.Execution), "host:") {
		return "bundled"
	}
	return "uploaded"
}

func pluginHash(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}
