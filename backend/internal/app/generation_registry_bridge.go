package app

import (
	"context"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/protocol"
)

// 协议注册表运行时已迁到 internal/generation；此处保留未导出包装以兼容 service 内大量调用点。

// emptyProtocolRegistry 供单测显式注入「插件未安装」路径。
var emptyProtocolRegistry, _ = protocol.NewRegistry()

func withProtocolRegistry(ctx context.Context, registry *protocol.Registry) context.Context {
	return generation.WithProtocolRegistry(ctx, registry)
}

func protocolRegistryFromContext(ctx context.Context) (*protocol.Registry, bool) {
	return generation.ProtocolRegistryFromContext(ctx)
}

func protocolAdapterForContext(ctx context.Context, id string) (protocol.Adapter, bool) {
	return generation.ProtocolAdapterForContext(ctx, id)
}

func ensureOfficialProtocolAdapter(ctx context.Context, interfaceType string) context.Context {
	return generation.EnsureOfficialProtocolAdapter(ctx, interfaceType)
}

func officialDeclarativeVideoInterface(interfaceType string) (string, bool) {
	return generation.OfficialDeclarativeVideoInterface(interfaceType)
}

func officialDeclarativeImageInterface(interfaceType string) (string, bool) {
	return generation.OfficialDeclarativeImageInterface(interfaceType)
}

func officialDeclarativeAudioInterface(interfaceType string) (string, bool) {
	return generation.OfficialDeclarativeAudioInterface(interfaceType)
}

func declarativeProtocolAdapterForContext(ctx context.Context, id string) (protocol.Adapter, bool) {
	return generation.DeclarativeProtocolAdapterForContext(ctx, id)
}

func agentProtocolAdapterForContext(ctx context.Context, id string) (protocol.AgentAdapter, bool) {
	return generation.AgentProtocolAdapterForContext(ctx, id)
}

func loadOfficialFallbackRegistry() *protocol.Registry {
	return generation.LoadOfficialFallbackRegistry()
}
