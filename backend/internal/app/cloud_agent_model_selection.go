package app

import (
	"encoding/json"
	"strings"
)

// The tool schema advertises the alternative selection shapes, while this
// validator remains the authoritative boundary for null, whitespace and
// decoded-value checks that JSON Schema cannot reliably express across all
// provider adapters.
const cloudAgentModelSelectionDescription = "模型：logicalModelId 或 channelId+channelModelKey，互斥且完整，不传 null/空白。generate_media 可继承草稿或本轮同条件唯一候选，多候选不代选。"

// A model can occasionally omit the copied selection even after reading
// model_list. We may repair that omission only when the exact same query has a
// single candidate. This is deterministic materialization of an explicit
// model_list result, not a project-default or random model fallback.
func cloudAgentApplyUniqueModelListSelection(state *cloudAgentRuntime, raw string, a *cloudAgentMediaArgs) bool {
	if state == nil || a == nil || cloudAgentModelSelectionProvided(raw) || a.LogicalModelID != "" || a.ChannelID != "" || a.ChannelModelKey != "" || len(a.ReferenceTransientIDs) > 0 {
		return false
	}
	for i := len(state.Events) - 1; i >= 0; i-- {
		event := state.Events[i]
		if stringValue(event.Payload["toolName"]) != "model_list" {
			continue
		}
		if event.Type != "tool_completed" {
			return false
		}
		var query struct {
			Operation        string   `json:"operation"`
			Mode             string   `json:"mode"`
			ReferenceNodeIDs []string `json:"referenceNodeIds"`
		}
		if err := json.Unmarshal([]byte(stringValue(event.Payload["arguments"])), &query); err != nil || query.Mode != a.Mode || query.Operation != a.Operation || !sameStringSlice(query.ReferenceNodeIDs, a.ReferenceNodeIDs) {
			return false
		}
		result, ok := event.Payload["result"].(map[string]any)
		if !ok {
			return false
		}
		models := creationMaps(result["models"])
		if len(models) != 1 {
			return false
		}
		modelItem := models[0]
		if normalizeCapability(stringValue(modelItem["capability"])) != normalizeCapability(a.Mode) {
			return false
		}
		candidate, ok := modelItem["selection"].(map[string]any)
		if !ok {
			return false
		}
		encoded, err := json.Marshal(candidate)
		if err != nil {
			return false
		}
		var selection cloudAgentMediaArgs
		if decodeCloudAgentJSONObject(string(encoded), &selection) != nil || validateCloudAgentModelSelection(string(encoded), selection) != nil {
			return false
		}
		a.LogicalModelID, a.ChannelID, a.ChannelModelKey = selection.LogicalModelID, selection.ChannelID, selection.ChannelModelKey
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
