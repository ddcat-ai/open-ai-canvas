package app

import (
	"encoding/json"
	"strings"
)

// The tool schema advertises the alternative selection shapes, while this
// validator remains the authoritative boundary for null, whitespace and
// decoded-value checks that JSON Schema cannot reliably express across all
// provider adapters.
const cloudAgentModelSelectionDescription = "模型选择：复制 model_list 的 selection 到顶层。媒体生成必须显式提供 logicalModelId，或同时提供 channelId 与 channelModelKey，二者互斥。未使用字段省略或传空字符串，不得传 null/空白；混用或不完整均拒绝，不会使用项目默认模型或随机选模。"

// A model can occasionally omit the copied selection even after reading
// model_list. We may repair that omission only when the exact same query has a
// single candidate. This is deterministic materialization of an explicit
// model_list result, not a project-default or random model fallback.
func cloudAgentApplyUniqueModelListSelection(state *cloudAgentRuntime, raw string, a *cloudAgentMediaArgs) bool {
	if state == nil || a == nil || cloudAgentModelSelectionProvided(raw) {
		return false
	}
	for i := len(state.Events) - 1; i >= 0; i-- {
		event := state.Events[i]
		if event.Type != "tool_completed" || stringValue(event.Payload["toolName"]) != "model_list" {
			continue
		}
		var query struct {
			Mode             string   `json:"mode"`
			ReferenceNodeIDs []string `json:"referenceNodeIds"`
		}
		if err := json.Unmarshal([]byte(stringValue(event.Payload["arguments"])), &query); err != nil || query.Mode != a.Mode || !sameStringSlice(query.ReferenceNodeIDs, a.ReferenceNodeIDs) {
			continue
		}
		result, ok := event.Payload["result"].(map[string]any)
		if !ok {
			return false
		}
		models, ok := result["models"].([]any)
		if !ok {
			return false
		}
		var selection map[string]string
		for _, item := range models {
			modelItem, ok := item.(map[string]any)
			if !ok || normalizeCapability(stringValue(modelItem["capability"])) != normalizeCapability(a.Mode) {
				continue
			}
			candidate, ok := modelItem["selection"].(map[string]any)
			if !ok {
				continue
			}
			candidateSelection := map[string]string{}
			if logical := strings.TrimSpace(stringValue(candidate["logicalModelId"])); logical != "" {
				candidateSelection["logicalModelId"] = logical
			} else if channelID := strings.TrimSpace(stringValue(candidate["channelId"])); channelID != "" {
				if modelKey := strings.TrimSpace(stringValue(candidate["channelModelKey"])); modelKey != "" {
					candidateSelection["channelId"], candidateSelection["channelModelKey"] = channelID, modelKey
				}
			}
			if len(candidateSelection) == 0 {
				continue
			}
			if selection != nil {
				return false
			}
			selection = candidateSelection
		}
		if len(selection) == 0 {
			return false
		}
		a.LogicalModelID, a.ChannelID, a.ChannelModelKey = selection["logicalModelId"], selection["channelId"], selection["channelModelKey"]
		return true
	}
	return false
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

func sameStringSlice(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
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
		return cloudAgentFieldError("logicalModelId", "required", "缺少模型选择：请复制 model_list 的 logicalModelId 或完整的 channelId/channelModelKey；媒体生成必须显式指定模型，不会使用项目默认模型或随机选模")
	case a.ChannelID == "":
		return cloudAgentFieldError("channelId", "required", "系统渠道模型选择不完整：缺少 channelId，请复制 model_list 的完整 selection")
	case a.ChannelModelKey == "":
		return cloudAgentFieldError("channelModelKey", "required", "系统渠道模型选择不完整：缺少 channelModelKey，请复制 model_list 的完整 selection")
	default:
		return nil
	}
}
