package app

import (
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

const (
	WorkflowPluginRunningHub = "runninghub-workflow-provider"
)

// bundledWorkflowPluginManifests keeps workflow capabilities in the same
// runtime registry as protocol plugins. The execution implementation remains
// in the workflow provider adapter for now, but lifecycle and availability are
// governed by the plugin runtime rather than by individual UI consumers.
func bundledWorkflowPluginManifests() []protocol.Manifest {
	return []protocol.Manifest{
		workflowPluginManifest(WorkflowPluginRunningHub, "RunningHub 工作流", "在画布中拉取并执行 RunningHub Workflow 与 App。"),
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
			Vendor:        "内置工作流",
			Description:   description,
			Documentation: "# " + name + "\n\n## 宿主运行时合同\n\n该工作流能力由插件运行时统一管理。",
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
	default:
		return "", false
	}
}

// workflowPluginIDForInterfaceDeclared 按插件 manifest 的 contributes.workflows 声明识别工作流插件：
// 协议名等于工作流 ID 或等于工作流声明的 providerId 时，归到该插件。
// 工作流插件不再只认 RunningHub 的三个协议名。
func (s *Service) workflowPluginIDForInterfaceDeclared(interfaceType string) (string, bool) {
	value := normalizeWorkflowInterfaceType(interfaceType)
	if value == "" || s == nil {
		return "", false
	}
	for _, plugin := range s.Plugins() {
		for _, workflow := range plugin.Manifest.Contributes.Workflows {
			if normalizeWorkflowInterfaceType(workflow.ID) == value || normalizeWorkflowInterfaceType(workflow.ProviderID) == value {
				if pluginID := strings.TrimSpace(plugin.Manifest.ID); pluginID != "" {
					return pluginID, true
				}
			}
		}
	}
	return "", false
}

// workflowPluginIDForInterfaceFor 先读插件声明，没装声明式工作流插件时回到作者内置的 RunningHub 映射。
func (s *Service) workflowPluginIDForInterfaceFor(interfaceType string) (string, bool) {
	if pluginID, ok := s.workflowPluginIDForInterfaceDeclared(interfaceType); ok {
		return pluginID, true
	}
	return workflowPluginIDForInterface(normalizeWorkflowInterfaceType(interfaceType))
}

func (s *Service) WorkflowPluginStatuses() map[string]string {
	pluginIDs := []string{WorkflowPluginRunningHub}
	seen := map[string]bool{WorkflowPluginRunningHub: true}
	// 插件声明了 contributes.workflows 就纳入工作流插件可用性，不再硬编码只有 RunningHub。
	for _, plugin := range s.Plugins() {
		pluginID := strings.TrimSpace(plugin.Manifest.ID)
		if pluginID == "" || seen[pluginID] || len(plugin.Manifest.Contributes.Workflows) == 0 {
			continue
		}
		seen[pluginID] = true
		pluginIDs = append(pluginIDs, pluginID)
	}
	statuses := make(map[string]string, len(pluginIDs))
	for _, pluginID := range pluginIDs {
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
	pluginIDs := []string{WorkflowPluginRunningHub}
	seen := map[string]bool{WorkflowPluginRunningHub: true}
	for _, plugin := range s.Plugins() {
		pluginID := strings.TrimSpace(plugin.Manifest.ID)
		if pluginID == "" || seen[pluginID] || len(plugin.Manifest.Contributes.Workflows) == 0 {
			continue
		}
		seen[pluginID] = true
		pluginIDs = append(pluginIDs, pluginID)
	}
	statuses := make(map[string]string, len(pluginIDs))
	actor := &model.User{ID: strings.TrimSpace(userID)}
	for _, pluginID := range pluginIDs {
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
	// 按插件声明识别工作流插件，没装插件时才用作者的 RunningHub 内置映射。
	pluginID, ok := s.workflowPluginIDForInterfaceFor(interfaceType)
	if !ok {
		return Forbidden("未知工作流插件")
	}
	status, exists := s.WorkflowPluginStatuses()[pluginID]
	if !exists || status != "enabled" {
		if pluginID == WorkflowPluginRunningHub {
			return Forbidden("RunningHub 工作流插件未启用")
		}
		return Forbidden("工作流插件未启用")
	}
	return nil
}

func (s *Service) RequireWorkflowPluginForUser(userID string, interfaceType string) error {
	pluginID, ok := s.workflowPluginIDForInterfaceFor(interfaceType)
	if !ok {
		return Forbidden("未知工作流插件")
	}
	if err := s.RequirePluginForUser(userID, pluginID); err != nil {
		if pluginID == WorkflowPluginRunningHub {
			return Forbidden("RunningHub 工作流插件未启用")
		}
		return Forbidden("工作流插件未启用")
	}
	return nil
}

func normalizeWorkflowInterfaceType(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	return value
}
