package service

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

type protocolRegistryContextKey struct{}

func withProtocolRegistry(ctx context.Context, registry *protocol.Registry) context.Context {
	return context.WithValue(ctx, protocolRegistryContextKey{}, registry)
}

func protocolAdapterForContext(ctx context.Context, id string) (protocol.Adapter, bool) {
	registry, _ := ctx.Value(protocolRegistryContextKey{}).(*protocol.Registry)
	if registry == nil {
		registry = protocol.Builtins()
	}
	return registry.Resolve(strings.TrimSpace(id))
}

func declarativeProtocolAdapterForContext(ctx context.Context, id string) (protocol.Adapter, bool) {
	adapter, ok := protocolAdapterForContext(ctx, id)
	if !ok || adapter.Metadata().Execution != "declarative" {
		return nil, false
	}
	return adapter, true
}

func agentProtocolAdapterForContext(ctx context.Context, id string) (protocol.AgentAdapter, bool) {
	registry, _ := ctx.Value(protocolRegistryContextKey{}).(*protocol.Registry)
	if registry == nil {
		registry = protocol.Builtins()
	}
	adapter, ok := registry.Resolve(strings.TrimSpace(id))
	if !ok || adapter.Metadata().Execution != "declarative" {
		return nil, false
	}
	agentAdapter, ok := adapter.(protocol.AgentAdapter)
	return agentAdapter, ok
}

type PluginProviderCatalogItem struct {
	ID                string                      `json:"id"`
	Version           string                      `json:"version"`
	Name              string                      `json:"name"`
	Vendor            string                      `json:"vendor"`
	Categories        []protocol.Capability       `json:"categories"`
	Scopes            []protocol.Surface          `json:"scopes"`
	Create            string                      `json:"create,omitempty"`
	Poll              string                      `json:"poll,omitempty"`
	ContentType       string                      `json:"contentType,omitempty"`
	BaseURL           string                      `json:"baseUrl,omitempty"`
	Enabled           bool                        `json:"enabled"`
	UnavailableReason string                      `json:"unavailableReason,omitempty"`
	Workflows         []protocol.ManifestWorkflow `json:"workflows,omitempty"`
}

// PluginProviderCatalog projects provider and workflow contributions from the
// unified plugin registry for channel and creation settings.
func (s *Service) PluginProviderCatalog(scope, capability string, includeUnavailable bool) []PluginProviderCatalogItem {
	wantScope := protocol.Surface(strings.TrimSpace(scope))
	wantCapability := protocol.Capability(strings.TrimSpace(capability))
	items := make([]PluginProviderCatalogItem, 0)
	for _, plugin := range s.Plugins() {
		for _, provider := range plugin.Manifest.Contributes.Providers {
			if !containsPluginSurface(provider.Scopes, wantScope) || (wantCapability != "" && !containsPluginCapability(provider.Capabilities, wantCapability)) {
				continue
			}
			item := PluginProviderCatalogItem{ID: provider.ID, Version: plugin.Manifest.Version, Name: provider.Label, Vendor: plugin.Manifest.Author, Categories: provider.Capabilities, Scopes: provider.Scopes, BaseURL: provider.BaseURL, Enabled: plugin.Status == "enabled", UnavailableReason: plugin.Error, Workflows: workflowsForProvider(plugin.Manifest.Contributes.Workflows, provider.ID)}
			item.Create, item.Poll, item.ContentType = operationSummary(provider.Create), operationSummaryPtr(provider.Poll), provider.Create.ContentType
			// The registry metadata is the canonical provider projection. This keeps
			// host-backed dispatch paths out of every user-facing catalog consumer.
			if adapter, ok := canonicalProviderAdapter(s.protocolRegistry(), provider.ID); ok {
				metadata := adapter.Metadata()
				item.Create, item.Poll, item.ContentType = metadata.Create, metadata.Poll, metadata.ContentType
			}
			if includeUnavailable || item.Enabled {
				items = append(items, item)
			}
		}
	}
	return items
}

func canonicalProviderAdapter(registry *protocol.Registry, id string) (protocol.Adapter, bool) {
	if adapter, ok := protocol.Builtins().Resolve(id); ok {
		return adapter, true
	}
	return registry.Resolve(id)
}

func containsPluginSurface(items []protocol.Surface, want protocol.Surface) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}
func containsPluginCapability(items []protocol.Capability, want protocol.Capability) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}
func workflowsForProvider(items []protocol.ManifestWorkflow, providerID string) []protocol.ManifestWorkflow {
	result := make([]protocol.ManifestWorkflow, 0)
	for _, item := range items {
		if item.ProviderID == providerID {
			result = append(result, item)
		}
	}
	return result
}
func operationSummary(operation protocol.ManifestOperation) string {
	path := strings.ReplaceAll(operation.Path, "{{model}}", "{model}")
	path = strings.ReplaceAll(path, "{{taskId}}", "{task_id}")
	return strings.ToUpper(operation.Method) + " " + path
}

func operationSummaryPtr(operation *protocol.ManifestOperation) string {
	if operation == nil {
		return ""
	}
	return operationSummary(*operation)
}

func (s *Service) protocolRegistry() *protocol.Registry {
	if s.pluginRuntime != nil {
		if registry := s.pluginRuntime.registrySnapshot(); registry != nil {
			return registry
		}
	}
	return protocol.Builtins()
}

func (s *Service) protocolMetadata(id string) (protocol.Metadata, bool) {
	adapter, ok := s.protocolRegistry().Resolve(strings.TrimSpace(id))
	if !ok {
		return protocol.Metadata{}, false
	}
	return adapter.Metadata(), true
}

func (s *Service) channelProtocolMetadata(id string) (protocol.Metadata, bool) {
	return s.protocolMetadata(id)
}

func (s *Service) canonicalProtocolID(id string) (string, bool) {
	adapter, ok := s.protocolRegistry().Resolve(strings.TrimSpace(id))
	if !ok {
		return "", false
	}
	return adapter.Metadata().ID, true
}

func (s *Service) protocolIsSelectable(id string) bool {
	metadata, ok := s.channelProtocolMetadata(id)
	return ok && metadata.Enabled && metadata.UnavailableReason == ""
}

func (s *Service) Plugins() []PluginView {
	if s.pluginRuntime == nil {
		return []PluginView{}
	}
	items := s.pluginRuntime.list()
	for index := range items {
		items[index].Management = pluginManagement(items[index].Manifest.ID, items[index].Source)
	}
	return items
}

// PluginsForUser keeps the plugin center response aligned with the public
// feature switch. Administrators must still be able to inspect and recover
// bundled plugins even when ordinary users cannot see them.
func (s *Service) PluginsForUser(actor *model.User) ([]PluginView, error) {
	items := s.Plugins()
	if actor != nil && actor.Role == model.UserRoleAdmin {
		return items, nil
	}
	visible, err := s.FeatureEnabled(FeatureSystemPlugins)
	if err != nil {
		return nil, err
	}
	if visible {
		return items, nil
	}
	filtered := make([]PluginView, 0, len(items))
	for _, item := range items {
		if item.Management.ActivationScope == PluginScopeUser {
			filtered = append(filtered, item)
		}
	}
	return filtered, nil
}

func (s *Service) InstallPlugin(data []byte, fileName string) (PluginView, error) {
	if s.pluginRuntime == nil {
		return PluginView{}, fmt.Errorf("插件运行时未初始化")
	}
	return s.pluginRuntime.install(data, fileName)
}

func (s *Service) InstallPluginForAdmin(actor *model.User, data []byte, fileName string) (PluginView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return PluginView{}, err
	}
	parsed, err := protocol.ParsePluginPackage(data)
	if err != nil {
		return PluginView{}, err
	}
	if _, reserved := officialApplicationPolicies[parsed.Manifest.Metadata.ID]; reserved {
		return PluginView{}, fmt.Errorf("插件 ID %q 由官方应用保留", parsed.Manifest.Metadata.ID)
	}
	plugin, err := s.InstallPlugin(data, fileName)
	if err != nil {
		return PluginView{}, err
	}
	plugin.Management = pluginManagement(plugin.Manifest.ID, plugin.Source)
	now := time.Now()
	state := &model.PluginPlatformState{PluginID: plugin.Manifest.ID, Available: plugin.Status == "enabled", UpdatedBy: actor.ID, CreatedAt: now, UpdatedAt: now}
	if err := s.repo.SavePluginPlatformState(state); err != nil {
		return PluginView{}, fmt.Errorf("保存插件平台状态：%w", err)
	}
	if err := s.appendAdminAudit(actor, "plugin.install", "plugin", plugin.Manifest.ID, "安装自定义插件", map[string]any{"fileName": fileName, "sha256": plugin.SHA256}); err != nil {
		return PluginView{}, err
	}
	return plugin, nil
}

func (s *Service) PluginPackage(id string) ([]byte, string, error) {
	if s.pluginRuntime == nil {
		return nil, "", fmt.Errorf("插件运行时未初始化")
	}
	s.pluginRuntime.mu.RLock()
	record, ok := s.pluginRuntime.plugins[strings.TrimSpace(id)]
	s.pluginRuntime.mu.RUnlock()
	if !ok {
		return nil, "", fmt.Errorf("插件 %q 不存在", id)
	}
	if record.PackagePath == "" {
		return nil, "", fmt.Errorf("插件 %q 没有可下载的包文件", id)
	}
	data, err := os.ReadFile(filepath.Join(s.pluginRuntime.packageDir, filepath.Base(record.PackagePath)))
	if err != nil {
		return nil, "", fmt.Errorf("读取插件包失败：%w", err)
	}
	return data, record.FileName, nil
}

func (s *Service) SetPluginEnabled(id string, enabled bool) (PluginView, error) {
	if s.pluginRuntime == nil {
		return PluginView{}, fmt.Errorf("插件运行时未初始化")
	}
	return s.pluginRuntime.setEnabled(id, enabled)
}

func (s *Service) UninstallPlugin(id string) error {
	if s.pluginRuntime == nil {
		return fmt.Errorf("插件运行时未初始化")
	}
	return s.pluginRuntime.uninstall(id)
}

func (s *Service) UninstallPluginForAdmin(actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	if err := s.UninstallPlugin(id); err != nil {
		return err
	}
	if err := s.repo.DeleteUserPluginStates(id); err != nil {
		return fmt.Errorf("清理用户插件状态：%w", err)
	}
	if err := s.repo.DeletePluginPlatformState(id); err != nil {
		return fmt.Errorf("清理插件平台状态：%w", err)
	}
	return s.appendAdminAudit(actor, "plugin.uninstall", "plugin", id, "卸载自定义插件", nil)
}
