package service

import (
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

const (
	WorkflowPluginRunningHub = "runninghub-workflow-provider"
	WorkflowPluginComfyUI    = "comfyui-workflow-provider"
)

// bundledWorkflowPluginManifests keeps workflow capabilities in the same
// runtime registry as protocol plugins. The execution implementation remains
// in the workflow provider adapter for now, but lifecycle and availability are
// governed by the plugin runtime rather than by individual UI consumers.
func bundledWorkflowPluginManifests() []protocol.Manifest {
	return []protocol.Manifest{
		workflowPluginManifest(WorkflowPluginRunningHub, "RunningHub 工作流", "在画布中拉取并执行 RunningHub Workflow 与 App。"),
		workflowPluginManifest(WorkflowPluginComfyUI, "ComfyUI Bridge 工作流", "通过本机或云端 Bridge 发现、映射并执行 ComfyUI API 工作流。"),
	}
}

func workflowPluginManifest(id, name, description string) protocol.Manifest {
	capabilities := []protocol.Capability{protocol.CapabilityImage, protocol.CapabilityVideo, protocol.CapabilityAudio}
	workflows := make([]protocol.ManifestWorkflow, 0, len(capabilities))
	for _, capability := range capabilities {
		workflows = append(workflows, protocol.ManifestWorkflow{
			ID:         id + "-" + string(capability),
			Label:      name + " · " + string(capability),
			ProviderID: id,
			Capability: capability,
			Parameters: []protocol.Parameter{},
		})
	}
	return protocol.Manifest{
		APIVersion: "yingce.plugin/v1",
		Metadata: protocol.Metadata{
			ID:            id,
			Version:       "1.0.0",
			Name:          name,
			Vendor:        "影策",
			Description:   description,
			Documentation: "# " + name + "\n\n## 影策运行时合同\n\n该工作流能力由插件运行时统一管理。",
			Enabled:       false,
			Installable:   true,
		},
		Surfaces:    []string{"node", "settings"},
		Runtime:     protocol.ManifestRuntime{Backend: "trusted-backend", Web: "trusted-backend"},
		Permissions: []string{"generation.run", "external.open"},
		Contributes: protocol.ManifestContributions{Workflows: workflows},
	}
}

func workflowPluginIDForInterface(value string) (string, bool) {
	switch value {
	case "runninghub-workflow-image", "runninghub-workflow-video", "runninghub-workflow-audio":
		return WorkflowPluginRunningHub, true
	case "comfyui-bridge-image", "comfyui-bridge-video", "comfyui-bridge-audio":
		return WorkflowPluginComfyUI, true
	default:
		return "", false
	}
}

func (s *Service) WorkflowPluginStatuses() map[string]string {
	statuses := make(map[string]string, 2)
	for _, pluginID := range []string{WorkflowPluginRunningHub, WorkflowPluginComfyUI} {
		state, err := s.pluginStateForUser(nil, pluginID, s.Plugins())
		if err == nil && state.PlatformAvailable {
			statuses[pluginID] = "enabled"
		} else {
			statuses[pluginID] = "disabled"
		}
	}
	return statuses
}

func (s *Service) WorkflowPluginStatusesForUser(userID string) (map[string]string, error) {
	statuses := make(map[string]string, 2)
	actor := &model.User{ID: strings.TrimSpace(userID)}
	for _, pluginID := range []string{WorkflowPluginRunningHub, WorkflowPluginComfyUI} {
		state, err := s.pluginStateForUser(actor, pluginID, s.Plugins())
		if err != nil {
			return nil, err
		}
		if state.EffectiveEnabled {
			statuses[pluginID] = "enabled"
		} else {
			statuses[pluginID] = "disabled"
		}
	}
	return statuses, nil
}

func (s *Service) RequireWorkflowPluginForInterface(interfaceType string) error {
	pluginID, ok := workflowPluginIDForInterface(normalizeWorkflowInterfaceType(interfaceType))
	if !ok {
		return Forbidden("未知工作流插件")
	}
	status, exists := s.WorkflowPluginStatuses()[pluginID]
	if !exists || status != "enabled" {
		if pluginID == WorkflowPluginRunningHub {
			return Forbidden("RunningHub 工作流插件未启用")
		}
		return Forbidden("ComfyUI Bridge 工作流插件未启用")
	}
	return nil
}

func (s *Service) RequireWorkflowPluginForUser(userID string, interfaceType string) error {
	pluginID, ok := workflowPluginIDForInterface(normalizeWorkflowInterfaceType(interfaceType))
	if !ok {
		return Forbidden("未知工作流插件")
	}
	if err := s.RequirePluginForUser(userID, pluginID); err != nil {
		if pluginID == WorkflowPluginRunningHub {
			return Forbidden("RunningHub 工作流插件未启用")
		}
		return Forbidden("ComfyUI Bridge 工作流插件未启用")
	}
	return nil
}

func normalizeWorkflowInterfaceType(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	return value
}
