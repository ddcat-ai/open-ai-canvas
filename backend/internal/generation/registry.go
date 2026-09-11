package generation

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

type protocolRegistryContextKey struct{}

var emptyProtocolRegistry, _ = protocol.NewRegistry()
var officialFallbackRegistryMu sync.Mutex
var officialFallbackRegistryLoaded bool
var officialFallbackRegistry = emptyProtocolRegistry

func WithProtocolRegistry(ctx context.Context, registry *protocol.Registry) context.Context {
	return context.WithValue(ctx, protocolRegistryContextKey{}, registry)
}

func ProtocolRegistryFromContext(ctx context.Context) (*protocol.Registry, bool) {
	registry, ok := ctx.Value(protocolRegistryContextKey{}).(*protocol.Registry)
	return registry, ok && registry != nil
}

func ProtocolAdapterForContext(ctx context.Context, id string) (protocol.Adapter, bool) {
	registry, _ := ctx.Value(protocolRegistryContextKey{}).(*protocol.Registry)
	if registry == nil {
		registry = emptyProtocolRegistry
	}
	return registry.Resolve(strings.TrimSpace(id))
}

// EnsureOfficialProtocolAdapter 让未注入 registry 的调用（主要是单测）与生产一样
// 使用官方插件包。调用方若显式放入空 registry，表示要测“插件未安装”。
func EnsureOfficialProtocolAdapter(ctx context.Context, interfaceType string) context.Context {
	if _, present := ProtocolRegistryFromContext(ctx); present {
		return ctx
	}
	interfaceType = strings.TrimSpace(interfaceType)
	if interfaceType == "" {
		return ctx
	}
	registry := LoadOfficialFallbackRegistry()
	adapter, ok := registry.Resolve(interfaceType)
	if !ok || adapter.Metadata().Execution != "declarative" {
		return ctx
	}
	return WithProtocolRegistry(ctx, registry)
}

func OfficialDeclarativeVideoInterface(interfaceType string) (string, bool) {
	switch strings.TrimSpace(interfaceType) {
	case string(model.ChannelInterfaceAgnesVideo):
		return "Agnes", true
	case string(model.ChannelInterfaceMiniMaxVideo):
		return "MiniMax", true
	case string(model.ChannelInterfaceGeminiVeo):
		return "Gemini Veo", true
	case string(model.ChannelInterfaceNovitaVideo):
		return "Novita", true
	case string(model.ChannelInterfaceNewAPIChannel2):
		return "NewAPI Video Generations", true
	case string(model.ChannelInterfaceNewAPIChannel1):
		return "NewAPI 媒体任务", true
	case string(model.ChannelInterfaceXAIVideo):
		return "xAI", true
	case string(model.ChannelInterfaceVolcengineArkVideo):
		return "火山方舟", true
	case string(model.ChannelInterfaceVolcengineJiMengVideo):
		return "即梦", true
	case string(model.ChannelInterfaceNewAPIVideo):
		return "OpenAI Videos", true
	default:
		return "", false
	}
}

func OfficialDeclarativeImageInterface(interfaceType string) (string, bool) {
	switch strings.TrimSpace(interfaceType) {
	case string(model.ChannelInterfaceGeminiImage):
		return "Gemini Images", true
	case string(model.ChannelInterfaceOpenAIImage):
		return "OpenAI Images", true
	case string(model.ChannelInterfaceGrokImage):
		return "Grok Images", true
	case string(model.ChannelInterfaceVolcengineArkImage):
		return "火山方舟图片", true
	case string(model.ChannelInterfaceVolcengineJiMengImage):
		return "即梦图片", true
	default:
		return "", false
	}
}

func OfficialDeclarativeAudioInterface(interfaceType string) (string, bool) {
	switch strings.TrimSpace(interfaceType) {
	case string(model.ChannelInterfaceOpenAIAudio):
		return "OpenAI Audio", true
	case string(model.ChannelInterfaceAsyncAudio):
		return "异步音频", true
	default:
		return "", false
	}
}

func DeclarativeProtocolAdapterForContext(ctx context.Context, id string) (protocol.Adapter, bool) {
	adapter, ok := ProtocolAdapterForContext(ctx, id)
	if !ok || adapter.Metadata().Execution != "declarative" {
		return nil, false
	}
	return adapter, true
}

func AgentProtocolAdapterForContext(ctx context.Context, id string) (protocol.AgentAdapter, bool) {
	registry, _ := ctx.Value(protocolRegistryContextKey{}).(*protocol.Registry)
	if registry == nil {
		registry = emptyProtocolRegistry
	}
	adapter, ok := registry.Resolve(strings.TrimSpace(id))
	if !ok || adapter.Metadata().Execution != "declarative" {
		return nil, false
	}
	agentAdapter, ok := adapter.(protocol.AgentAdapter)
	if !ok {
		return nil, false
	}
	capability, ok := adapter.(protocol.AgentCapability)
	return agentAdapter, ok && capability.AgentAvailable()
}

func LoadOfficialFallbackRegistry() *protocol.Registry {
	officialFallbackRegistryMu.Lock()
	defer officialFallbackRegistryMu.Unlock()
	if officialFallbackRegistryLoaded {
		return officialFallbackRegistry
	}
	load := func() {
		directory, err := OfficialPluginPackageDir()
		if err != nil {
			return
		}
		entries, err := os.ReadDir(directory)
		if err != nil {
			return
		}
		adapters := make([]protocol.Adapter, 0, len(entries))
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".yingce-plugin") {
				continue
			}
			data, err := os.ReadFile(filepath.Join(directory, entry.Name()))
			if err != nil {
				return
			}
			pkg, err := protocol.ParsePluginPackage(data)
			if err != nil {
				return
			}
			providers, err := protocol.LoadInstalledProviders(pkg.ManifestRaw, nil)
			if err != nil {
				return
			}
			adapters = append(adapters, providers...)
		}
		registry, err := protocol.NewRegistry(adapters...)
		if err == nil {
			officialFallbackRegistry = registry
			officialFallbackRegistryLoaded = true
		}
	}
	load()
	return officialFallbackRegistry
}

func OfficialPluginPackageDir() (string, error) {
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
	return "", fmt.Errorf("未找到官方插件目录 plugin-packages")
}

// 兼容包内未导出旧名（service 薄包装与未改调用点）。
func withProtocolRegistry(ctx context.Context, registry *protocol.Registry) context.Context {
	return WithProtocolRegistry(ctx, registry)
}
func protocolRegistryFromContext(ctx context.Context) (*protocol.Registry, bool) {
	return ProtocolRegistryFromContext(ctx)
}
func protocolAdapterForContext(ctx context.Context, id string) (protocol.Adapter, bool) {
	return ProtocolAdapterForContext(ctx, id)
}
func ensureOfficialProtocolAdapter(ctx context.Context, interfaceType string) context.Context {
	return EnsureOfficialProtocolAdapter(ctx, interfaceType)
}
func officialDeclarativeVideoInterface(interfaceType string) (string, bool) {
	return OfficialDeclarativeVideoInterface(interfaceType)
}
func officialDeclarativeImageInterface(interfaceType string) (string, bool) {
	return OfficialDeclarativeImageInterface(interfaceType)
}
func officialDeclarativeAudioInterface(interfaceType string) (string, bool) {
	return OfficialDeclarativeAudioInterface(interfaceType)
}
func declarativeProtocolAdapterForContext(ctx context.Context, id string) (protocol.Adapter, bool) {
	return DeclarativeProtocolAdapterForContext(ctx, id)
}
func agentProtocolAdapterForContext(ctx context.Context, id string) (protocol.AgentAdapter, bool) {
	return AgentProtocolAdapterForContext(ctx, id)
}
func loadOfficialFallbackRegistry() *protocol.Registry {
	return LoadOfficialFallbackRegistry()
}
