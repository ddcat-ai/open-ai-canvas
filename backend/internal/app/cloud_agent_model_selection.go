package app

import (
	"encoding/json"
	"strings"
)

// Keep cross-field validation server-side rather than adding provider-specific
// root schema combinators. The same contract is advertised by both media tools.
const cloudAgentModelSelectionDescription = "模型选择必填：将 model_list 返回的一种 selection 展开到顶层参数，必须提供非空 logicalModelId，或同时提供非空 channelId 和 channelModelKey，二者互斥。未使用的选择字段省略或传空字符串，不得传 null 或仅含空白的字符串。缺失、混用或不完整均在提交前拒绝，不会自动选择或切换模型。"

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
		return cloudAgentFieldError("logicalModelId", "required", "缺少模型选择：必须复制 model_list 的 logicalModelId 或完整的 channelId/channelModelKey，不会自动选择模型")
	case a.ChannelID == "":
		return cloudAgentFieldError("channelId", "required", "系统渠道模型选择不完整：缺少 channelId，请复制 model_list 的完整 selection")
	case a.ChannelModelKey == "":
		return cloudAgentFieldError("channelModelKey", "required", "系统渠道模型选择不完整：缺少 channelModelKey，请复制 model_list 的完整 selection")
	default:
		return nil
	}
}
