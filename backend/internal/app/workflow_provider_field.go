// 工作流字段定义（WorkflowField）的兼容解析。
//
// 字段 JSON 来自管理后台配置和历史数据，写法不统一（字符串/数字/嵌套对象都出现过）；
// UnmarshalJSON 在这里统一容错，下游只面对规范化后的结构。

package app

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// WorkflowField 是云端工作流字段描述。Value 与 FieldValue 兼容来源项目
// 的两种命名；Source 可取 referenceImage/referenceVideo/referenceAudio/mask。
type WorkflowField struct {
	ID             string        `json:"id"`
	NodeID         string        `json:"nodeId"`
	ClassType      string        `json:"classType,omitempty"`
	FieldName      string        `json:"fieldName"`
	Value          interface{}   `json:"value,omitempty"`
	FieldValue     interface{}   `json:"fieldValue,omitempty"`
	FieldType      string        `json:"fieldType,omitempty"`
	Label          string        `json:"label,omitempty"`
	Role           string        `json:"role,omitempty"`
	SafeToOverride *bool         `json:"safeToOverride,omitempty"`
	OptionsSource  string        `json:"optionsSource,omitempty"`
	Options        []interface{} `json:"options,omitempty"`
	Min            interface{}   `json:"min,omitempty"`
	Max            interface{}   `json:"max,omitempty"`
	Step           interface{}   `json:"step,omitempty"`
	RandomEnabled  bool          `json:"randomEnabled,omitempty"`
	BindPrompt     bool          `json:"bindPrompt,omitempty"`
	// 指针用于区分“未配置（默认启用）”和明确传入 false。
	Enabled            *bool  `json:"enabled,omitempty"`
	Source             string `json:"source,omitempty"`
	SourceIndex        int    `json:"sourceIndex,omitempty"`
	ImageOrder         int    `json:"imageOrder,omitempty"`
	SourceFromUpstream bool   `json:"sourceFromUpstream,omitempty"`
	Required           bool   `json:"required,omitempty"`
	// nil 兼容旧配置；true 表示来源由字段名推断，false 表示用户在映射面板明确选择。
	SourceAutomatic *bool `json:"sourceAutomatic,omitempty"`
	// 仅在本次反序列化期间保留，用于区分旧数据缺字段与用户明确选择“保留默认值”。
	sourceConfigured bool
}

// UnmarshalJSON 兼容来源项目的字段配置格式。来源项目使用 node/input/default/
// bind_prompt，而画布内部使用 nodeId/fieldName/fieldValue/source；在入口统一归一化，
// 后续 RunningHub 和 Bridge 不需要各自维护一套别名解析。
func (f *WorkflowField) UnmarshalJSON(data []byte) error {
	type plainWorkflowField WorkflowField
	var parsed plainWorkflowField
	if err := json.Unmarshal(data, &parsed); err != nil {
		return err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*f = WorkflowField(parsed)
	if f.NodeID == "" {
		f.NodeID = workflowFieldRawString(raw, "node", "node_id", "nodeID")
	}
	if f.ClassType == "" {
		f.ClassType = workflowFieldRawString(raw, "class_type", "typeName", "nodeType")
	}
	if f.FieldName == "" {
		f.FieldName = workflowFieldRawString(raw, "input", "inputName", "input_name", "name")
	}
	if f.ID == "" {
		f.ID = workflowFieldRawString(raw, "fieldId", "field_id", "key")
	}
	if f.FieldType == "" {
		f.FieldType = workflowFieldRawString(raw, "type")
	}
	if len(f.Options) == 0 {
		if options, ok := workflowFieldRawSlice(raw, "options", "values", "choices", "enum", "fieldOptions", "field_options"); ok {
			f.Options = options
		}
	}
	if f.Min == nil {
		f.Min, _ = workflowFieldRawAny(raw, "min", "minValue", "min_value")
		if f.Min == nil {
			f.Min, _ = workflowFieldRawNestedAny(raw, "min", "minValue", "min_value")
		}
	}
	if f.Max == nil {
		f.Max, _ = workflowFieldRawAny(raw, "max", "maxValue", "max_value")
		if f.Max == nil {
			f.Max, _ = workflowFieldRawNestedAny(raw, "max", "maxValue", "max_value")
		}
	}
	if f.Step == nil {
		f.Step, _ = workflowFieldRawAny(raw, "step", "stepValue", "step_value")
		if f.Step == nil {
			f.Step, _ = workflowFieldRawNestedAny(raw, "step", "stepValue", "step_value")
		}
	}
	if f.Label == "" {
		f.Label = workflowFieldRawString(raw, "title")
	}
	sourceConfigured := workflowFieldRawHas(raw, "source") || workflowFieldRawHas(raw, "bind") || workflowFieldRawHas(raw, "from")
	if f.Source == "" {
		f.Source = workflowFieldRawString(raw, "bind", "from")
	}
	if !workflowFieldRawHas(raw, "fieldValue") {
		if value, ok := workflowFieldRawAny(raw, "defaultValue", "default_value", "default"); ok {
			f.FieldValue = value
		}
	}
	if !workflowFieldRawHas(raw, "sourceIndex") {
		f.SourceIndex = workflowFieldRawInt(raw, f.SourceIndex, "source_index", "index")
	}
	if !workflowFieldRawHas(raw, "imageOrder") {
		f.ImageOrder = workflowFieldRawInt(raw, f.ImageOrder, "image_order")
	}
	if !workflowFieldRawHas(raw, "required") {
		f.Required = workflowFieldRawBool(raw, f.Required, "isRequired", "is_required")
	}
	if !workflowFieldRawHas(raw, "randomEnabled") {
		f.RandomEnabled = workflowFieldRawBool(raw, f.RandomEnabled, "random_enabled")
	}
	if !workflowFieldRawHas(raw, "bindPrompt") {
		f.BindPrompt = workflowFieldRawBool(raw, f.BindPrompt, "bind_prompt")
	}
	if f.BindPrompt && strings.TrimSpace(f.Source) == "" && !sourceConfigured {
		f.Source = "prompt"
	}
	sourceFromUpstreamConfigured := workflowFieldRawHas(raw, "sourceFromUpstream") || workflowFieldRawHas(raw, "source_from_upstream")
	f.sourceConfigured = sourceConfigured || sourceFromUpstreamConfigured
	if !workflowFieldRawHas(raw, "sourceFromUpstream") && workflowFieldRawHas(raw, "source_from_upstream") {
		f.SourceFromUpstream = workflowFieldRawBool(raw, f.SourceFromUpstream, "source_from_upstream")
	}
	if !sourceConfigured && !sourceFromUpstreamConfigured && strings.TrimSpace(f.Source) == "" {
		// 旧工作流没有保存动态来源时，按字段语义恢复宽高、数量、媒体等画布输入绑定。
		f.Source = workflowDynamicSource(f.FieldName, f.FieldType)
	}
	if !sourceConfigured && !sourceFromUpstreamConfigured && !f.SourceFromUpstream {
		switch strings.ToLower(strings.TrimSpace(f.FieldType)) {
		case "image", "video", "audio":
			// 来源配置默认把媒体字段绑定到上游参考素材。
			f.SourceFromUpstream = true
		}
	}
	if f.ID == "" && f.NodeID != "" && f.FieldName != "" {
		f.ID = f.NodeID + "::" + f.FieldName
	}
	return nil
}

func workflowFieldRawHas(raw map[string]json.RawMessage, key string) bool {
	_, ok := raw[key]
	return ok
}

func workflowFieldRawString(raw map[string]json.RawMessage, keys ...string) string {
	for _, key := range keys {
		value, ok := raw[key]
		if !ok {
			continue
		}
		var text string
		if json.Unmarshal(value, &text) == nil && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text)
		}
		var generic interface{}
		if json.Unmarshal(value, &generic) == nil && generic != nil {
			text = strings.TrimSpace(fmt.Sprint(generic))
			if text != "" && text != "<nil>" {
				return text
			}
		}
	}
	return ""
}

func workflowFieldRawAny(raw map[string]json.RawMessage, keys ...string) (interface{}, bool) {
	for _, key := range keys {
		value, ok := raw[key]
		if !ok || string(value) == "null" {
			continue
		}
		var decoded interface{}
		if json.Unmarshal(value, &decoded) == nil {
			return decoded, true
		}
	}
	return nil, false
}

func workflowFieldRawSlice(raw map[string]json.RawMessage, keys ...string) ([]interface{}, bool) {
	value, ok := workflowFieldRawAny(raw, keys...)
	if !ok {
		return nil, false
	}
	if items, ok := value.([]interface{}); ok {
		return items, true
	}
	if object, ok := value.(map[string]interface{}); ok {
		for _, key := range []string{"choices", "options", "values", "enum"} {
			if items, ok := object[key].([]interface{}); ok {
				return items, true
			}
		}
	}
	return nil, false
}

func workflowFieldRawNestedAny(raw map[string]json.RawMessage, keys ...string) (interface{}, bool) {
	for _, containerKey := range []string{"options", "values", "choices", "range", "fieldOptions", "field_options"} {
		value, ok := workflowFieldRawAny(raw, containerKey)
		if !ok {
			continue
		}
		if found, ok := workflowNestedFieldValue(value, keys...); ok {
			return found, true
		}
	}
	return nil, false
}

func workflowNestedFieldValue(value interface{}, keys ...string) (interface{}, bool) {
	if items, ok := value.([]interface{}); ok {
		for _, item := range items {
			if found, ok := workflowNestedFieldValue(item, keys...); ok {
				return found, true
			}
		}
		return nil, false
	}
	object, ok := value.(map[string]interface{})
	if !ok {
		return nil, false
	}
	for _, key := range keys {
		if found, exists := object[key]; exists && found != nil {
			return found, true
		}
	}
	if nested, exists := object["range"]; exists {
		return workflowNestedFieldValue(nested, keys...)
	}
	return nil, false
}

func workflowFieldRawInt(raw map[string]json.RawMessage, fallback int, keys ...string) int {
	value, ok := workflowFieldRawAny(raw, keys...)
	if !ok {
		return fallback
	}
	switch item := value.(type) {
	case float64:
		return int(item)
	case json.Number:
		parsed, err := strconv.Atoi(string(item))
		if err == nil {
			return parsed
		}
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(item))
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func workflowFieldRawBool(raw map[string]json.RawMessage, fallback bool, keys ...string) bool {
	value, ok := workflowFieldRawAny(raw, keys...)
	if !ok {
		return fallback
	}
	switch item := value.(type) {
	case bool:
		return item
	case string:
		parsed, err := strconv.ParseBool(strings.TrimSpace(item))
		if err == nil {
			return parsed
		}
	}
	return fallback
}
