package app

import "infinite-canvas/backend/internal/canvas/capability"

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
