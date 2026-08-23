package service

import (
	"context"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

type protocolRegistryContextKey struct{}

func withProtocolRegistry(ctx context.Context, registry *protocol.Registry) context.Context {
	return context.WithValue(ctx, protocolRegistryContextKey{}, registry)
}

func declarativeProtocolAdapterForContext(ctx context.Context, id string) (protocol.Adapter, bool) {
	registry, _ := ctx.Value(protocolRegistryContextKey{}).(*protocol.Registry)
	if registry == nil {
		registry = protocol.Builtins()
	}
	adapter, ok := registry.Resolve(strings.TrimSpace(id))
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

// ProtocolCatalog is the backend source of truth for the frontend plugin
// center's protocol filtering.
// includeUnavailable is reserved for administrators so incomplete plugins remain visible
// with an explicit reason instead of silently becoming a selectable option.
func (s *Service) ProtocolCatalog(scope, capability string, includeUnavailable bool) []protocol.Metadata {
	return s.protocolRegistry().List(protocol.Surface(strings.TrimSpace(scope)), protocol.Capability(strings.TrimSpace(capability)), includeUnavailable)
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
	return s.pluginRuntime.list()
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
		if item.Source != "bundled" {
			filtered = append(filtered, item)
		}
	}
	return filtered, nil
}

func (s *Service) InstallPlugin(data []byte) (PluginView, error) {
	if s.pluginRuntime == nil {
		return PluginView{}, fmt.Errorf("插件运行时未初始化")
	}
	return s.pluginRuntime.install(data)
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
