package prompts

import (
	"encoding/json"
	"errors"
)

func extractJSONText(raw string) (string, error) {
	// Text models may prepend an explanation or append a Markdown fence despite
	// the JSON-only contract. Scan complete JSON values instead of pairing the
	// first opening brace with the final closing brace, which can merge prose and
	// make an otherwise valid character breakdown fail validation.
	for start := 0; start < len(raw); start++ {
		if raw[start] != '{' && raw[start] != '[' {
			continue
		}
		end := jsonValueEnd(raw, start)
		if end < start {
			continue
		}
		candidate := raw[start : end+1]
		var decoded interface{}
		if json.Unmarshal([]byte(candidate), &decoded) == nil {
			return candidate, nil
		}
	}
	return "", errors.New("模型返回的不是 JSON")
}

// ExtractJSONText 从模型正文中抽出第一个完整 JSON 值。
func ExtractJSONText(raw string) (string, error) {
	return extractJSONText(raw)
}

// ExtractPreferredJSONText 优先返回包含 preferKey 的顶层 JSON 对象。
func ExtractPreferredJSONText(raw string, preferKey string) (string, error) {
	return extractPreferredJSONText(raw, preferKey)
}

// extractPreferredJSONText 与 extractJSONText 一样逐个扫描完整的 JSON 值，但会优先返回顶层对象且
// 包含 preferKey 的候选。模型常在给出契约对象前先用正文列举一遍内容（例如先写一段角色名数组），
// 只取第一个可解析值会命中这些旁枝片段，导致后续校验拿到完全无关的结构。
// 找不到偏好候选时回退到第一个可解析值，保证与 extractJSONText 的默认行为一致。
func extractPreferredJSONText(raw string, preferKey string) (string, error) {
	fallback := ""
	for start := 0; start < len(raw); start++ {
		if raw[start] != '{' && raw[start] != '[' {
			continue
		}
		end := jsonValueEnd(raw, start)
		if end < start {
			continue
		}
		candidate := raw[start : end+1]
		var decoded interface{}
		if json.Unmarshal([]byte(candidate), &decoded) != nil {
			continue
		}
		if obj, ok := decoded.(map[string]interface{}); ok {
			if _, ok := obj[preferKey]; ok {
				return candidate, nil
			}
		}
		if fallback == "" {
			fallback = candidate
		}
	}
	if fallback != "" {
		return fallback, nil
	}
	return "", errors.New("模型返回的不是 JSON")
}

func jsonValueEnd(source string, start int) int {
	stack := make([]byte, 0, 8)
	inString := false
	escaped := false
	for index := start; index < len(source); index++ {
		value := source[index]
		if inString {
			if escaped {
				escaped = false
			} else if value == '\\' {
				escaped = true
			} else if value == '"' {
				inString = false
			}
			continue
		}
		switch value {
		case '"':
			inString = true
		case '{', '[':
			stack = append(stack, value)
		case '}', ']':
			if len(stack) == 0 {
				return -1
			}
			opener := stack[len(stack)-1]
			if (value == '}' && opener != '{') || (value == ']' && opener != '[') {
				return -1
			}
			stack = stack[:len(stack)-1]
			if len(stack) == 0 {
				return index
			}
		}
	}
	return -1
}
