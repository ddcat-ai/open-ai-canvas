package protocol

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

// SmartCreationEntry 是创作页识别的唯一智能创作入口。
const SmartCreationEntry = "smart-creation"

const (
	smartCreationMaxLabel    = 40
	smartCreationMaxSection  = 128 << 10
	smartCreationMaxToolName = 64
	smartCreationMaxPrompt   = 64 << 10
)

// validateManifestSmartCreation 只校验宿主必须依赖的边界：入口、JSON 形状和工具名称。
// 提示词和 schema 的内容由插件包负责，前端解析失败时回退到宿主内置默认。
func validateManifestSmartCreation(config *ManifestSmartCreation) error {
	if config == nil {
		return nil
	}
	if strings.TrimSpace(config.Entry) != SmartCreationEntry {
		return fmt.Errorf("contributes.smartCreation.entry must be %q", SmartCreationEntry)
	}
	if len([]rune(config.Label)) > smartCreationMaxLabel {
		return fmt.Errorf("contributes.smartCreation.label is too long")
	}
	sections := map[string]json.RawMessage{"planner": config.Planner, "defaults": config.Defaults, "execution": config.Execution}
	for name, raw := range sections {
		if len(raw) == 0 {
			continue
		}
		if len(raw) > smartCreationMaxSection {
			return fmt.Errorf("contributes.smartCreation.%s exceeds %d bytes", name, smartCreationMaxSection)
		}
		if trimmed := bytes.TrimSpace(raw); len(trimmed) == 0 || trimmed[0] != '{' {
			return fmt.Errorf("contributes.smartCreation.%s must be a JSON object", name)
		}
	}
	return validateSmartCreationPlanner(config.Planner)
}

type smartCreationPlannerWire struct {
	SystemPrompt any `json:"systemPrompt"`
	Tool         *struct {
		Name       string          `json:"name"`
		Parameters json.RawMessage `json:"parameters"`
	} `json:"tool"`
}

func validateSmartCreationPlanner(raw json.RawMessage) error {
	if len(raw) == 0 {
		return nil
	}
	var planner smartCreationPlannerWire
	if err := json.Unmarshal(raw, &planner); err != nil {
		return fmt.Errorf("contributes.smartCreation.planner is invalid: %w", err)
	}
	if planner.SystemPrompt != nil {
		prompt, ok := smartCreationPromptText(planner.SystemPrompt)
		if !ok || strings.TrimSpace(prompt) == "" {
			return fmt.Errorf("contributes.smartCreation.planner.systemPrompt must be a non-empty string or string array")
		}
		if len(prompt) > smartCreationMaxPrompt {
			return fmt.Errorf("contributes.smartCreation.planner.systemPrompt exceeds %d bytes", smartCreationMaxPrompt)
		}
	}
	if planner.Tool != nil {
		if !validManifestToolName(strings.TrimSpace(planner.Tool.Name)) {
			return fmt.Errorf("contributes.smartCreation.planner.tool.name is invalid")
		}
		if trimmed := bytes.TrimSpace(planner.Tool.Parameters); len(trimmed) == 0 || trimmed[0] != '{' {
			return fmt.Errorf("contributes.smartCreation.planner.tool.parameters must be a JSON schema object")
		}
	}
	return nil
}

// smartCreationPromptText 接受单个字符串或按行拆分的字符串数组，便于插件包逐条维护规则。
func smartCreationPromptText(value any) (string, bool) {
	switch value := value.(type) {
	case string:
		return value, true
	case []any:
		parts := make([]string, 0, len(value))
		for _, item := range value {
			text, ok := item.(string)
			if !ok {
				return "", false
			}
			parts = append(parts, text)
		}
		return strings.Join(parts, "\n"), true
	default:
		return "", false
	}
}

func validManifestToolName(name string) bool {
	if name == "" || len(name) > smartCreationMaxToolName {
		return false
	}
	for _, r := range name {
		if !(r == '_' || r == '-' || r >= '0' && r <= '9' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z') {
			return false
		}
	}
	return true
}
