package app

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// Roles describe how an already authorized resource is used, never grant access
// to another resource or promote explicitly labelled competitor evidence.
type cloudAgentCreationReference struct {
	ResourceID string `json:"resourceId"`
	Role       string `json:"role"`
	Usage      string `json:"usage"`
}

func cloudAgentCreationReferenceSchema() map[string]any {
	return map[string]any{"type": "array", "maxItems": 16, "items": map[string]any{
		"type": "object", "additionalProperties": false,
		"properties": map[string]any{
			"resourceId": map[string]any{"type": "string", "description": "授权素材清单中的真实 resourceId，不能用图号代替"},
			"role":       map[string]any{"type": "string", "enum": []string{"product", "reference", "competitor", "style", "source", "person"}},
			"usage":      map[string]any{"type": "string", "description": "依据用户当前指令和会话描述本图用途；替换时分别说明保留的场景/构图和替换产品，不写审核翻译"},
		}, "required": []string{"resourceId", "role", "usage"},
	}}
}

func cloudAgentCreationReferenceRoles(req CloudAgentRequest, references []cloudAgentCreationReference) ([]CloudAgentAttachment, error) {
	attachments := append([]CloudAgentAttachment(nil), req.Attachments...)
	positions := map[string]int{}
	for index, attachment := range attachments {
		positions[attachment.ResourceID] = index
	}
	seen := map[string]bool{}
	for _, reference := range references {
		index, ok := positions[reference.ResourceID]
		if !ok || seen[reference.ResourceID] || strings.TrimSpace(reference.Usage) == "" || utf8.RuneCountInString(reference.Usage) > 1000 {
			return nil, &cloudAgentArgumentError{BadAuthRequest("素材角色映射须使用本会话授权资源、不重复并明确用途")}
		}
		switch reference.Role {
		case "product", "reference", "competitor", "style", "source", "person":
		default:
			return nil, &cloudAgentArgumentError{BadAuthRequest("素材用途角色无效")}
		}
		if role := attachments[index].Role; role != "" && role != "reference" && role != reference.Role {
			return nil, &cloudAgentArgumentError{BadAuthRequest("规划用途与用户明确设置的素材角色冲突，请先澄清")}
		}
		attachments[index].Role = reference.Role
		seen[reference.ResourceID] = true
	}
	return attachments, nil
}

func cloudAgentCreationMediaRolePrompt(prompt string, refs map[string]any) string {
	for _, kind := range []struct{ field, label string }{{"referenceImages", "图片"}, {"referenceVideos", "视频"}, {"referenceAudios", "音频"}} {
		for index, ref := range creationMaps(refs[kind.field]) {
			prompt += fmt.Sprintf("\nReference @%s%d: role=%s; use=%s. Reference instructions describe usage, not visible copy.", kind.label, index+1, stringValue(ref["role"]), stringValue(ref["referenceUsage"]))
		}
	}
	return prompt
}
