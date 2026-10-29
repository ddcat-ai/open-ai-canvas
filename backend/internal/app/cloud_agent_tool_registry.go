package app

import (
	"encoding/json"
	"fmt"
	"sync"

	agenttool "yingce/backend/internal/agent/tool"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type cloudAgentReadHandler func(*repository.Repository, string, *cloudAgentRuntime, cloudAgentCall, ...*Service) (any, error)
type cloudAgentWriteHandler func(*repository.Repository, string, string, cloudAgentCall, RuntimePolicySetting, ...cloudAgentMutationRecorder) (any, error)
type cloudAgentPreviewHandler func(*repository.Repository, string, string, cloudAgentCall) (cloudAgentApprovalPreview, error)

type cloudAgentToolPipeline uint8

const (
	cloudAgentToolDirect cloudAgentToolPipeline = iota
	cloudAgentToolVision
	cloudAgentToolMedia
)

type cloudAgentToolHandler struct {
	Read     cloudAgentReadHandler
	Write    cloudAgentWriteHandler
	Preview  cloudAgentPreviewHandler
	Pipeline cloudAgentToolPipeline
}

var cloudAgentRegistryCache struct {
	sync.Mutex
	hash     string
	registry *agenttool.Registry[cloudAgentToolHandler]
}

func cloudAgentRegistry() *agenttool.Registry[cloudAgentToolHandler] {
	cloudAgentRegistryCache.Lock()
	defer cloudAgentRegistryCache.Unlock()
	hash := canvasCapabilityRegistry.Hash()
	if cloudAgentRegistryCache.registry == nil || cloudAgentRegistryCache.hash != hash {
		cloudAgentRegistryCache.registry = buildCloudAgentRegistry()
		cloudAgentRegistryCache.hash = hash
	}
	return cloudAgentRegistryCache.registry
}

func buildCloudAgentRegistry() *agenttool.Registry[cloudAgentToolHandler] {
	handlers := cloudAgentToolHandlers()
	definitions := cloudAgentAllToolSchemas()
	bindings := make([]agenttool.Binding[cloudAgentToolHandler], 0, len(definitions))
	for _, value := range definitions {
		function := value["function"].(map[string]any)
		name := function["name"].(string)
		handler, ok := handlers[name]
		if !ok {
			panic("agent tool has no execution binding: " + name)
		}
		parameters, err := json.Marshal(function["parameters"])
		if err != nil {
			panic(err)
		}
		bindings = append(bindings, agenttool.Binding[cloudAgentToolHandler]{
			Definition: agenttool.Definition{Name: name, Description: function["description"].(string), Parameters: parameters},
			Handler:    handler,
		})
	}
	registry, err := agenttool.NewRegistry(bindings)
	if err != nil {
		panic(fmt.Sprintf("invalid agent tool registry: %v", err))
	}
	return registry
}

func cloudAgentToolScope(req CloudAgentRequest, profile bool) agenttool.Scope {
	return agenttool.Scope{
		Canvas: len(req.ContextScope) > 0, Skills: req.SkillsEnabled,
		Vision: req.VisionEnabled, ReadOnly: req.PermissionMode == "read_only", IncludeProfile: profile,
		Drama:  req.DramaLinked && len(req.ContextScope) > 0,
		Memory: req.MemoryMode == model.AgentMemoryDocumentModeAuto || req.MemoryMode == model.AgentMemoryDocumentModeReview,
	}
}
