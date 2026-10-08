package app

import "yingce/backend/internal/canvas/capability"

// Canvas capabilities are registered once at the canvas domain boundary. Agent
// tools, creation, media and state projection all consume this registry; there
// is no Agent-only node allow-list to keep in sync.
type cloudAgentNodeCapability = capability.Descriptor

type CloudAgentCapabilitySet struct {
	Version string
	Hash    string
	Nodes   []string
}

const cloudAgentCapabilitySetVersion = capability.SetVersion

var canvasCapabilityRegistry = capability.BuiltinRegistry()

func cloudAgentNodeCapabilityForType(nodeType string) (cloudAgentNodeCapability, bool) {
	return canvasCapabilityRegistry.Resolve(nodeType)
}

// cloudAgentNodeCapabilityForNode 按画布节点本身解析能力：角色卡等 workflowKind 变体
// 优先于底层类型。凡是手里有真实节点（读取、连线、引用、更新）的调用方都应使用它；
// 只有 add_node 这类按类型名创建的入口才使用 cloudAgentNodeCapabilityForType。
func cloudAgentNodeCapabilityForNode(node map[string]any) (cloudAgentNodeCapability, bool) {
	meta, _ := node["metadata"].(map[string]any)
	return canvasCapabilityRegistry.ResolveNode(stringValue(node["type"]), stringValue(meta["workflowKind"]))
}

func cloudAgentNodeTypeNames() []string { return canvasCapabilityRegistry.Types() }

func cloudAgentGenerationModeNames() []string {
	modes := make([]string, 0)
	for _, mode := range canvasCapabilityRegistry.GenerationModeNames() {
		if cloudAgentGenerationModeSupported(mode) {
			modes = append(modes, mode)
		}
	}
	return modes
}

func cloudAgentGenerationModeSupported(mode string) bool {
	_, implemented := cloudAgentGenerationAdapters[mode]
	return implemented && canvasCapabilityRegistry.SupportsGenerationMode(mode)
}

func cloudAgentNodeCapabilityForGenerationMode(mode string) (cloudAgentNodeCapability, bool) {
	return canvasCapabilityRegistry.ResolveGenerationMode(mode)
}

func cloudAgentCapabilitySetHash() string { return canvasCapabilityRegistry.Hash() }

func CloudAgentCapabilitySetInfo() CloudAgentCapabilitySet {
	return CloudAgentCapabilitySet{Version: cloudAgentCapabilitySetVersion, Hash: cloudAgentCapabilitySetHash(), Nodes: cloudAgentNodeTypeNames()}
}
