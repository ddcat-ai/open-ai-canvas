package app

import (
	"encoding/json"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/model"
)

// Keep cross-field validation server-side rather than adding provider-specific
// root schema combinators. The same contract is advertised by both media tools.
const cloudAgentModelSelectionDescription = "模型选择：复制 model_list 的 selection 到顶层。完全省略模型字段时，仅使用当前项目对应能力的可用默认模型。显式选择必须提供 logicalModelId，或同时提供 channelId 与 channelModelKey，二者互斥。未使用字段省略或传空字符串，不得传 null/空白；无可用默认、混用或不完整均拒绝，不会随机选模。"

// applyCloudAgentProjectDefaultModel only fills a selection when the Agent did
// not send any model-selection field at all. An explicitly empty, partial, or
// null selection remains invalid so a malformed tool call cannot silently turn
// into a different model.
func (s *Service) applyCloudAgentProjectDefaultModel(run *model.CloudAgentExecution, state *cloudAgentRuntime, raw string, a *cloudAgentMediaArgs) (bool, error) {
	if s == nil || s.repo == nil || run == nil || state == nil || a == nil || cloudAgentModelSelectionProvided(raw) {
		return false, nil
	}
	a.Mode = strings.ToLower(strings.TrimSpace(a.Mode))
	if a.Mode != "image" && a.Mode != "video" || strings.TrimSpace(state.Request.CanvasID) == "" {
		return false, nil
	}
	canvas, err := s.repo.CanvasProjectForUser(run.UserID, state.Request.CanvasID)
	if err != nil {
		return false, err
	}
	if strings.TrimSpace(canvas.ProjectID) == "" {
		return false, nil
	}
	project, err := s.repo.ProjectForUser(run.UserID, canvas.ProjectID)
	if err != nil {
		return false, err
	}
	defaultModel := strings.TrimSpace(project.DefaultImageModel)
	if a.Mode == "video" {
		defaultModel = strings.TrimSpace(project.DefaultVideoModel)
	}
	if defaultModel == "" {
		return false, nil
	}

	if channelID, channelModelKey, ok := splitCloudAgentChannelModel(defaultModel); ok {
		catalog, catalogErr := s.ModelCatalog(nil)
		if catalogErr != nil {
			return false, catalogErr
		}
		for _, channel := range catalog.Channels {
			if channel.ID != channelID {
				continue
			}
			for _, channelModel := range channel.Models {
				if channelModel.ModelKey == channelModelKey && channelModel.Available && normalizeCapability(channelModel.Capability) == a.Mode {
					a.ChannelID, a.ChannelModelKey = channelID, channelModelKey
					return true, nil
				}
			}
		}
		return false, fmt.Errorf("项目默认%s模型不可用或能力不匹配，请在项目设置中重新选择模型", cloudAgentModeLabel(a.Mode))
	}

	logicalModels, err := s.PublicLogicalModels(nil)
	if err != nil {
		return false, err
	}
	for _, logicalModel := range logicalModels {
		if logicalModel.ID == defaultModel && logicalModel.Available && normalizeCapability(logicalModel.Capability) == a.Mode {
			a.LogicalModelID = defaultModel
			return true, nil
		}
	}
	return false, fmt.Errorf("项目默认%s模型不可用或能力不匹配，请在项目设置中重新选择模型", cloudAgentModeLabel(a.Mode))
}

func cloudAgentModelSelectionProvided(raw string) bool {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &fields); err != nil || fields == nil {
		return true
	}
	for _, field := range []string{"logicalModelId", "channelId", "channelModelKey"} {
		if _, ok := fields[field]; ok {
			return true
		}
	}
	return false
}

func splitCloudAgentChannelModel(value string) (string, string, bool) {
	channelID, channelModelKey, ok := strings.Cut(strings.TrimSpace(value), "::")
	channelID, channelModelKey = strings.TrimSpace(channelID), strings.TrimSpace(channelModelKey)
	return channelID, channelModelKey, ok && channelID != "" && channelModelKey != ""
}

func cloudAgentModeLabel(mode string) string {
	if mode == "video" {
		return "视频"
	}
	return "图片"
}

func validateCloudAgentModelSelection(raw string, a cloudAgentMediaArgs) error {
	// Go's JSON decoder accepts null for string fields; the tool contract does
	// not. Check presence/type before interpreting the decoded selection.
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &fields); err != nil {
		return cloudAgentJSONArgumentError(err)
	}
	for _, field := range []string{"logicalModelId", "channelId", "channelModelKey"} {
		if value, exists := fields[field]; exists {
			var text *string
			if err := json.Unmarshal(value, &text); err != nil || text == nil {
				return cloudAgentFieldError(field, "type_mismatch", "模型选择字段必须是字符串，不能为 null")
			}
			if *text != "" && strings.TrimSpace(*text) == "" {
				return cloudAgentFieldError(field, "invalid_value", "模型选择字段不能仅包含空白字符")
			}
		}
	}
	switch {
	case a.LogicalModelID != "" && (a.ChannelID != "" || a.ChannelModelKey != ""):
		return cloudAgentFieldError("logicalModelId", "mutually_exclusive", "模型选择冲突：logicalModelId 与 channelId/channelModelKey 不得混用，请复制 model_list 的一种 selection")
	case a.LogicalModelID != "":
		return nil
	case a.ChannelID == "" && a.ChannelModelKey == "":
		return cloudAgentFieldError("logicalModelId", "required", "缺少模型选择：请复制 model_list 的 logicalModelId 或完整的 channelId/channelModelKey；若项目未配置当前能力的可用默认模型，不能自动猜测")
	case a.ChannelID == "":
		return cloudAgentFieldError("channelId", "required", "系统渠道模型选择不完整：缺少 channelId，请复制 model_list 的完整 selection")
	case a.ChannelModelKey == "":
		return cloudAgentFieldError("channelModelKey", "required", "系统渠道模型选择不完整：缺少 channelModelKey，请复制 model_list 的完整 selection")
	default:
		return nil
	}
}
