package service

import (
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

	"infinite-canvas/backend/internal/payment"
	"infinite-canvas/backend/internal/protocol"
)

const (
	protocolPluginMaxBytes  = protocol.PluginManifestMaxBytes
	paymentRuntimeReadyFile = ".ready"
)

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
	mu              sync.RWMutex
	mutationMu      sync.Mutex
	registryPath    string
	packageDir      string
	plugins         map[string]pluginRecord
	registry        *protocol.Registry
	paymentRegistry *payment.Registry
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
	if err := center.bootstrapBuiltInPlugins(); err != nil {
		return nil, err
	}
	if err := center.reload(); err != nil {
		return nil, err
	}
	return center, nil
}

func (c *pluginRuntime) bootstrapBuiltInPlugins() error {
	stored, err := c.readRegistry()
	if err != nil {
		return err
	}
	byID := make(map[string]pluginRegistryRecord, len(stored))
	for _, record := range stored {
		byID[record.ID] = record
	}
	officialDir, err := officialPluginPackageDir()
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(officialDir)
	if err != nil {
		return fmt.Errorf("读取官方插件目录失败：%w", err)
	}
	builtInIDs := make(map[string]struct{}, len(entries)+2)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".yingce-plugin") {
			continue
		}
		packageData, err := os.ReadFile(filepath.Join(officialDir, entry.Name()))
		if err != nil {
			return fmt.Errorf("读取官方插件包 %s：%w", entry.Name(), err)
		}
		pkg, err := protocol.ParsePluginPackage(packageData)
		if err != nil {
			return fmt.Errorf("校验官方插件包 %s：%w", entry.Name(), err)
		}
		if strings.HasPrefix(strings.TrimSpace(pkg.Manifest.Runtime.Backend), "host:") {
			return fmt.Errorf("官方插件 %q 不能依赖 host 执行器", pkg.Manifest.Metadata.ID)
		}
		if len(pkg.Manifest.Contributes.PaymentProviders) == 0 {
			if _, err := protocol.LoadInstalledProviders(pkg.ManifestRaw, nil); err != nil {
				return fmt.Errorf("加载官方插件 %q：%w", pkg.Manifest.Metadata.ID, err)
			}
		}
		id := pkg.Manifest.Metadata.ID
		if _, duplicate := builtInIDs[id]; duplicate {
			return fmt.Errorf("官方插件 ID %q 重复", id)
		}
		builtInIDs[id] = struct{}{}
		manifest := pkg.Manifest
		record := byID[id]
		if len(record.Raw) > 0 {
			var previous protocol.Manifest
			if err := json.Unmarshal(record.Raw, &previous); err == nil {
				manifest.Metadata.Enabled = previous.Metadata.Enabled
			}
		}
		manifestData, err := json.Marshal(manifest)
		if err != nil {
			return fmt.Errorf("编码官方插件 %q：%w", id, err)
		}
		hash := pluginHash(packageData)
		packageName := hash + ".yingce-plugin"
		if err := writePluginFile(filepath.Join(c.packageDir, packageName), packageData); err != nil {
			return fmt.Errorf("缓存官方插件 %q：%w", id, err)
		}
		now := time.Now().UTC()
		if record.InstalledAt.IsZero() {
			record.InstalledAt = now
		}
		source := PluginOriginOfficial
		if _, systemPayment := systemPaymentPolicies[id]; systemPayment {
			source = PluginOriginSystem
		}
		record.ID, record.Raw, record.Source, record.FileName = id, manifestData, source, entry.Name()
		record.PackagePath, record.PackageSHA256, record.UpdatedAt = packageName, hash, now
		byID[id] = record
	}
	bundledManifests := append(bundledWorkflowPluginManifests(), bundledPaymentPluginManifests()...)
	for _, bundled := range bundledManifests {
		builtInIDs[bundled.Metadata.ID] = struct{}{}
		if existing, exists := byID[bundled.Metadata.ID]; exists && existing.PackagePath != "" && isSystemPaymentPluginID(bundled.Metadata.ID) {
			// An official package is the executable source of truth. The bundled
			// manifest remains only as a fallback when the package is unavailable.
			continue
		}
		data, err := json.Marshal(bundled)
		if err != nil {
			return fmt.Errorf("encode built-in plugin %s: %w", bundled.Metadata.ID, err)
		}
		record := byID[bundled.Metadata.ID]
		if len(record.Raw) > 0 {
			var installed protocol.Manifest
			if err := json.Unmarshal(record.Raw, &installed); err != nil {
				return fmt.Errorf("decode built-in plugin %s: %w", bundled.Metadata.ID, err)
			}
			bundled.Metadata.Enabled = installed.Metadata.Enabled
			data, err = json.Marshal(bundled)
			if err != nil {
				return fmt.Errorf("encode built-in plugin %s: %w", bundled.Metadata.ID, err)
			}
		}
		now := time.Now().UTC()
		if record.InstalledAt.IsZero() {
			record.InstalledAt = now
		}
		source := PluginOriginOfficial
		if _, systemPayment := systemPaymentPolicies[bundled.Metadata.ID]; systemPayment {
			source = PluginOriginSystem
		}
		record.UpdatedAt = now
		record.ID, record.Raw, record.Source, record.PackagePath = bundled.Metadata.ID, data, source, ""
		byID[bundled.Metadata.ID] = record
	}
	result := make([]pluginRegistryRecord, 0, len(byID))
	for _, record := range byID {
		if isBuiltInPluginSource(record.Source) {
			if _, exists := builtInIDs[record.ID]; !exists {
				// Built-in records are reconciled from repository packages and host
				// manifests on every startup, so removed plugins cannot survive stale.
				continue
			}
		}
		result = append(result, record)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return c.writeRegistry(result)
}

func isSystemPaymentPluginID(id string) bool {
	_, ok := systemPaymentPolicies[strings.TrimSpace(id)]
	return ok
}

func isBuiltInPluginSource(source string) bool {
	switch strings.TrimSpace(source) {
	case "bundled", PluginOriginOfficial, PluginOriginSystem:
		return true
	default:
		return false
	}
}

func officialPluginPackageDir() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("CANVAS_OFFICIAL_PLUGIN_DIR")); configured != "" {
		info, err := os.Stat(configured)
		if err != nil || !info.IsDir() {
			return "", fmt.Errorf("CANVAS_OFFICIAL_PLUGIN_DIR 不是可读目录：%s", configured)
		}
		return configured, nil
	}
	workingDir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	candidates := []string{"/app/plugin-packages"}
	current := workingDir
	for range 8 {
		candidates = append(candidates, filepath.Join(current, "plugin-packages"))
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate, nil
		}
	}
	return "", errors.New("未找到官方 plugin-packages 目录；请设置 CANVAS_OFFICIAL_PLUGIN_DIR")
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
		if packageSHA256 == "" && strings.TrimSpace(storedRecord.PackagePath) == "" {
			packageSHA256 = pluginHash(data)
		}
		plugins[metadata.ID] = pluginRecord{Raw: data, Metadata: metadata, Source: storedRecord.Source, FileName: storedRecord.FileName, PackagePath: storedRecord.PackagePath, PackageSHA256: packageSHA256, SHA256: packageSHA256, InstalledAt: storedRecord.InstalledAt, UpdatedAt: storedRecord.UpdatedAt, Status: "invalid"}
	}
	registry, err := protocol.NewRegistry()
	if err != nil {
		return err
	}
	for id, record := range plugins {
		var manifest protocol.Manifest
		if err := json.Unmarshal(record.Raw, &manifest); err != nil {
			record.Error = err.Error()
			plugins[id] = record
			continue
		}
		if len(manifest.Contributes.PaymentProviders) > 0 && record.Source == PluginOriginUploaded {
			backend := strings.TrimSpace(manifest.Runtime.Backend)
			if strings.HasPrefix(backend, "host:") {
				record.Metadata.Enabled = false
				record.Status = "invalid"
				record.Error = "首期支付插件只能使用系统宿主适配器"
				plugins[id] = record
				continue
			}
			if backend != "rpc" && backend != "wasm" {
				record.Metadata.Enabled = false
				record.Status = "invalid"
				record.Error = "上传支付插件必须声明 rpc 或 wasm 后端"
				plugins[id] = record
				continue
			}
		}
		if len(manifest.Contributes.PaymentProviders) > 0 && len(manifest.Contributes.Providers) == 0 {
			if record.Metadata.Enabled {
				record.Status = "enabled"
			} else {
				record.Status = "disabled"
			}
			plugins[id] = record
			continue
		}
		adapters, loadErr := protocol.LoadInstalledProviders(record.Raw, nil)
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
	// Payment adapters are loaded exclusively from validated plugin packages.
	// An empty registry is intentional when the official package is unavailable;
	// payment writes must fail closed instead of silently using host code.
	basePayment, registryErr := payment.NewRegistry()
	if registryErr != nil {
		return registryErr
	}
	dynamicPayments := make([]payment.Provider, 0)
	for id, record := range plugins {
		if (record.Source != PluginOriginUploaded && record.Source != PluginOriginOfficial && record.Source != PluginOriginSystem) || !record.Metadata.Enabled || record.Status != "enabled" {
			continue
		}
		var manifest protocol.Manifest
		if err := json.Unmarshal(record.Raw, &manifest); err != nil || len(manifest.Contributes.PaymentProviders) == 0 {
			continue
		}
		if strings.TrimSpace(manifest.Runtime.Backend) != "rpc" {
			record.Status = "invalid"
			record.Error = "wasm 支付运行时尚未启用"
			plugins[id] = record
			continue
		}
		packageData, readErr := os.ReadFile(filepath.Join(c.packageDir, filepath.Base(record.PackagePath)))
		if readErr != nil {
			record.Status = "invalid"
			record.Error = "支付插件包文件不存在"
			plugins[id] = record
			continue
		}
		packageSHA256 := pluginHash(packageData)
		if expected := strings.TrimSpace(record.PackageSHA256); expected != "" && !strings.EqualFold(expected, packageSHA256) {
			record.Status = "invalid"
			record.Error = "支付插件包完整性校验失败"
			plugins[id] = record
			continue
		}
		record.PackageSHA256 = packageSHA256
		record.SHA256 = packageSHA256
		plugins[id] = record
		pkg, parseErr := protocol.ParsePluginPackage(packageData)
		if parseErr != nil {
			record.Status = "invalid"
			record.Error = parseErr.Error()
			plugins[id] = record
			continue
		}
		runtimeDir, materializeErr := materializePaymentBackend(c.packageDir, packageSHA256, pkg)
		if materializeErr != nil {
			record.Status = "invalid"
			record.Error = materializeErr.Error()
			plugins[id] = record
			continue
		}
		for _, contribution := range manifest.Contributes.PaymentProviders {
			provider, providerErr := payment.NewRPCProvider(payment.DescriptorFromManifest(manifest, contribution), runtimeDir, manifest.Runtime.BackendEntry)
			if providerErr != nil {
				record.Status = "invalid"
				record.Error = providerErr.Error()
				continue
			}
			dynamicPayments = append(dynamicPayments, provider)
		}
	}
	dynamicIDs := make(map[string]struct{}, len(dynamicPayments))
	for _, provider := range dynamicPayments {
		dynamicIDs[provider.Descriptor().ID] = struct{}{}
	}
	baseProviders := make([]payment.Provider, 0)
	for _, provider := range basePayment.Providers() {
		if _, replaced := dynamicIDs[provider.Descriptor().ID]; !replaced {
			baseProviders = append(baseProviders, provider)
		}
	}
	providers := append(baseProviders, dynamicPayments...)
	c.paymentRegistry, err = payment.NewRegistry(providers...)
	if err != nil {
		return err
	}
	c.plugins = plugins
	return nil
}

func materializePaymentBackend(packageDir, hash string, pkg protocol.PluginPackage) (string, error) {
	digest := strings.ToLower(strings.TrimSpace(hash))
	if len(digest) != sha256.Size*2 {
		return "", errors.New("支付插件包摘要无效")
	}
	if _, err := hex.DecodeString(digest); err != nil {
		return "", errors.New("支付插件包摘要无效")
	}

	runtimeRoot := filepath.Join(packageDir, "runtime")
	root := filepath.Join(runtimeRoot, digest)
	backendEntry := strings.TrimSpace(pkg.Manifest.Runtime.BackendEntry)
	if paymentRuntimeReady(root, digest, backendEntry) {
		return root, nil
	}
	if err := os.MkdirAll(runtimeRoot, 0o700); err != nil {
		return "", fmt.Errorf("创建支付插件运行目录失败：%w", err)
	}
	temporaryRoot, err := os.MkdirTemp(runtimeRoot, ".payment-runtime-")
	if err != nil {
		return "", fmt.Errorf("创建支付插件临时运行目录失败：%w", err)
	}
	defer os.RemoveAll(temporaryRoot)

	for name, content := range pkg.Files {
		if !strings.HasPrefix(name, "backend/") || strings.HasSuffix(name, "/") {
			continue
		}
		target := filepath.Join(temporaryRoot, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return "", err
		}
		if err := os.WriteFile(target, content, 0o700); err != nil {
			return "", fmt.Errorf("写入支付插件运行文件失败：%w", err)
		}
	}
	if err := os.WriteFile(filepath.Join(temporaryRoot, paymentRuntimeReadyFile), []byte(digest+"\n"), 0o600); err != nil {
		return "", fmt.Errorf("写入支付插件运行状态失败：%w", err)
	}
	if err := os.Rename(temporaryRoot, root); err != nil {
		if paymentRuntimeReady(root, digest, backendEntry) {
			return root, nil
		}
		// Digest directories are immutable once ready. An unmarked directory can
		// only be residue from an interrupted extraction and is safe to replace.
		if removeErr := os.RemoveAll(root); removeErr != nil {
			return "", fmt.Errorf("清理未完成的支付插件运行目录失败：%w", removeErr)
		}
		if renameErr := os.Rename(temporaryRoot, root); renameErr != nil {
			return "", fmt.Errorf("发布支付插件运行目录失败：%w", renameErr)
		}
	}
	return root, nil
}

func paymentRuntimeReady(root, digest, backendEntry string) bool {
	ready, err := os.ReadFile(filepath.Join(root, paymentRuntimeReadyFile))
	if err != nil || strings.TrimSpace(string(ready)) != digest {
		return false
	}
	entry, err := os.Stat(filepath.Join(root, filepath.FromSlash(backendEntry)))
	return err == nil && !entry.IsDir()
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

func (c *pluginRuntime) paymentRegistrySnapshot() *payment.Registry {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.paymentRegistry
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
	if len(manifest.Contributes.PaymentProviders) == 0 {
		if _, err := protocol.LoadInstalledProviders(pkg.ManifestRaw, nil); err != nil {
			return PluginView{}, err
		}
	}
	c.mu.RLock()
	existing, exists := c.plugins[manifest.Metadata.ID]
	c.mu.RUnlock()
	if exists && isBuiltInPluginSource(existing.Source) && !isPaymentPluginManifest(manifest) {
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

func isPaymentPluginManifest(manifest protocol.Manifest) bool {
	backend := strings.TrimSpace(manifest.Runtime.Backend)
	return len(manifest.Contributes.PaymentProviders) > 0 && (backend == "rpc" || backend == "wasm")
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
	if manifest.Metadata.ID == "" {
		manifest.Metadata = metadata
	}
	return PluginManifestView{
		ID: metadata.ID, Name: metadata.Name, Version: metadata.Version, APIVersion: "yingce.plugin/v1", Entry: manifest.Entry, Surfaces: manifest.Surfaces,
		Description: metadata.Description, Documentation: metadata.Documentation, Author: metadata.Vendor,
		Permissions: manifest.Permissions, Trusted: isBuiltInPluginSource(source), Runtime: manifest.Runtime,
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
	if isBuiltInPluginSource(record.Source) {
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
	return "uploaded"
}

func pluginHash(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}
