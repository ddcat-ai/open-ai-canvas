package mcpintegration

import (
	"encoding/json"
	"slices"
	"strings"

	"yingce/backend/internal/kernel"
)

type secretRedactor struct {
	secrets  []string
	replacer *strings.Replacer
}

func newSecretRedactor(secrets []string) secretRedactor {
	values := slices.Clone(secrets)
	values = slices.DeleteFunc(values, func(value string) bool { return value == "" })
	slices.SortFunc(values, func(a, b string) int {
		if len(a) != len(b) {
			return len(b) - len(a)
		}
		return strings.Compare(a, b)
	})
	values = slices.Compact(values)
	pairs := make([]string, 0, 2*len(values))
	for _, value := range values {
		pairs = append(pairs, value, "[REDACTED]")
	}
	return secretRedactor{secrets: values, replacer: strings.NewReplacer(pairs...)}
}

func (r secretRedactor) contains(value string) bool {
	for _, secret := range r.secrets {
		if strings.Contains(value, secret) {
			return true
		}
	}
	return false
}

// Tool names, property names, enums and other validation data cannot be changed:
// doing so would authorize a different contract from the one the server exposed.
// Only documentation strings are redactable. Fixed JSON Schema keywords and
// primitive type names are protocol constants, not echoed credential values.
func sanitizeDiscoveredTools(tools []Tool, secrets []string) ([]Tool, error) {
	r := newSecretRedactor(secrets)
	result := make([]Tool, 0, len(tools))
	for _, tool := range tools {
		if r.contains(tool.Name) {
			return nil, unsafeToolDefinition()
		}
		schema, err := cloneJSONObject(tool.InputSchema)
		if err != nil || !r.schema(schema) {
			return nil, unsafeToolDefinition()
		}
		tool.InputSchema = schema
		tool.Description = r.replacer.Replace(tool.Description)
		result = append(result, tool)
	}
	return result, nil
}

func unsafeToolDefinition() error {
	return kernel.BadAuthRequest("MCP 工具定义的名称或参数结构包含认证参数，已拒绝检测；请修正服务端工具定义")
}

func cloneJSONObject(value map[string]any) (map[string]any, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	err = json.Unmarshal(raw, &result)
	return result, err
}

func (r secretRedactor) schema(value any) bool {
	if _, ok := value.(bool); ok {
		return true
	}
	schema, ok := value.(map[string]any)
	if !ok {
		return false
	}
	for key, value := range schema {
		switch key {
		case "description", "title", "$comment":
			text, ok := value.(string)
			if !ok {
				return false
			}
			schema[key] = r.replacer.Replace(text)
		case "type":
			if !schemaPrimitiveTypes(value) {
				return false
			}
		case "$defs", "definitions", "properties", "patternProperties", "dependentSchemas":
			entries, ok := value.(map[string]any)
			if !ok {
				return false
			}
			for name, nested := range entries {
				if r.contains(name) || !r.schema(nested) {
					return false
				}
			}
		case "allOf", "anyOf", "oneOf", "prefixItems":
			if !r.schemaArray(value) {
				return false
			}
		case "items":
			if _, array := value.([]any); array {
				if !r.schemaArray(value) {
					return false
				}
			} else if !r.schema(value) {
				return false
			}
		case "additionalProperties", "unevaluatedProperties", "propertyNames", "additionalItems", "contains", "unevaluatedItems", "not", "if", "then", "else", "contentSchema":
			if !r.schema(value) {
				return false
			}
		default:
			if (!schemaKeyword(key) && r.contains(key)) || r.structuralConflict(value) {
				return false
			}
		}
	}
	return true
}

func schemaPrimitiveTypes(value any) bool {
	if values, ok := value.([]any); ok {
		for _, item := range values {
			if !schemaPrimitiveTypes(item) {
				return false
			}
		}
		return len(values) > 0
	}
	switch value {
	case "null", "boolean", "object", "array", "number", "integer", "string":
		return true
	}
	return false
}

func (r secretRedactor) schemaArray(value any) bool {
	values, ok := value.([]any)
	if !ok {
		return false
	}
	for _, item := range values {
		if !r.schema(item) {
			return false
		}
	}
	return true
}

func schemaKeyword(key string) bool {
	switch key {
	case "$schema", "$id", "id", "$ref", "$anchor", "$dynamicRef", "$dynamicAnchor", "$recursiveRef", "$recursiveAnchor", "$vocabulary",
		"enum", "const", "default", "examples", "format", "pattern", "required", "dependencies", "dependentRequired",
		"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength",
		"minItems", "maxItems", "uniqueItems", "minContains", "maxContains", "minProperties", "maxProperties",
		"readOnly", "writeOnly", "deprecated", "contentEncoding", "contentMediaType":
		return true
	}
	return false
}

func (r secretRedactor) structuralConflict(value any) bool {
	switch typed := value.(type) {
	case string:
		return r.contains(typed)
	case []any:
		for _, item := range typed {
			if r.structuralConflict(item) {
				return true
			}
		}
	case map[string]any:
		for key, item := range typed {
			if r.contains(key) || r.structuralConflict(item) {
				return true
			}
		}
	}
	return false
}

// A completed remote action stays completed even when its result cannot be
// safely displayed. Conflicting object keys or protocol values produce a small
// safe receipt instead of an error that might invite re-execution.
func sanitizeToolResult(result map[string]any, secrets []string) (map[string]any, error) {
	copy, err := cloneJSONObject(result)
	if err != nil {
		return nil, kernel.BadAuthRequest("MCP 返回结果无法安全解析")
	}
	r := newSecretRedactor(secrets)
	if !r.resultObject(copy, "result") {
		fallback := map[string]any{"redacted": true, "message": "MCP 已返回结果，但结果包含无法安全展示的认证信息；请在外部服务查看完整结果"}
		if isError, ok := result["isError"].(bool); ok {
			fallback["isError"] = isError
		}
		return fallback, nil
	}
	return copy, nil
}

func (r secretRedactor) resultObject(object map[string]any, protocol string) bool {
	for key, value := range object {
		if !resultProtocolKey(protocol, key) && r.contains(key) {
			return false
		}
		if protocol == "content" && key == "type" {
			switch value {
			case "text", "image", "audio", "resource", "resource_link":
				continue
			}
			if r.structuralConflict(value) {
				return false
			}
		}
		if protocol == "result" && key == "content" {
			if content, ok := value.([]any); ok {
				for _, item := range content {
					if entry, ok := item.(map[string]any); !ok || !r.resultObject(entry, "content") {
						return false
					}
				}
				continue
			}
		}
		if (protocol == "content" || protocol == "resource") && (key == "data" || key == "blob" || key == "mimeType" || key == "uri") && r.structuralConflict(value) {
			return false
		}
		if protocol == "content" && (key == "resource" || key == "annotations") {
			if entry, ok := value.(map[string]any); ok {
				if !r.resultObject(entry, key) {
					return false
				}
				continue
			}
		}
		if protocol == "annotations" && key == "audience" {
			if audience, ok := value.([]any); ok {
				for _, role := range audience {
					if role != "user" && role != "assistant" {
						return false
					}
				}
				continue
			}
		}
		sanitized, ok := r.resultValue(value)
		if !ok {
			return false
		}
		object[key] = sanitized
	}
	return true
}

func resultProtocolKey(protocol, key string) bool {
	switch protocol {
	case "result":
		return slices.Contains([]string{"content", "structuredContent", "isError", "_meta", "message", "truncated", "redacted"}, key)
	case "content":
		return slices.Contains([]string{"type", "text", "data", "mimeType", "resource", "uri", "name", "description", "title", "size", "annotations", "_meta"}, key)
	case "resource":
		return slices.Contains([]string{"uri", "mimeType", "text", "blob", "_meta"}, key)
	case "annotations":
		return slices.Contains([]string{"audience", "priority", "lastModified"}, key)
	}
	return false
}

func (r secretRedactor) resultValue(value any) (any, bool) {
	switch typed := value.(type) {
	case string:
		return r.replacer.Replace(typed), true
	case []any:
		for i, item := range typed {
			var ok bool
			typed[i], ok = r.resultValue(item)
			if !ok {
				return nil, false
			}
		}
	case map[string]any:
		return typed, r.resultObject(typed, "")
	}
	return value, true
}
