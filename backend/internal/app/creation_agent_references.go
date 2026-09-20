package app

import (
	"encoding/json"
	"strings"
)

func validateAgentResourcePlaceholders(input canvasGenerationInput) error {
	_, err := resolveAgentResourcePlaceholders(input, false)
	return err
}

// Only hydrated references can replace protocol placeholders. The returned request
// is an in-memory copy and must never be written back to Task.InputJSON.
func resolveAgentResourcePlaceholders(input canvasGenerationInput, hydrate bool) (canvasGenerationInput, error) {
	if input.AgentRequests == nil {
		return input, nil
	}
	if hydrate {
		encoded, err := json.Marshal(input.AgentRequests)
		if err != nil {
			return input, err
		}
		if !strings.Contains(string(encoded), `"resource:`) {
			return input, nil
		}
	}
	references := map[string]string{}
	for _, media := range input.ReferenceImages {
		if !strings.HasPrefix(media.StorageKey, "resource:") {
			return input, BadAuthRequest("规划图片必须引用当前账号资源")
		}
		value := media.StorageKey
		if hydrate {
			value = firstNonEmpty(media.DataURL, media.URL)
			if value == "" {
				return input, BadAuthRequest("规划图片尚未读取成功")
			}
		}
		references[media.StorageKey] = value
	}
	b, err := json.Marshal(input.AgentRequests)
	if err != nil {
		return input, err
	}
	var root any
	if err = json.Unmarshal(b, &root); err != nil {
		return input, err
	}
	var visit func(any) (any, error)
	visit = func(value any) (any, error) {
		switch typed := value.(type) {
		case string:
			if strings.HasPrefix(typed, "resource:") {
				resolved, ok := references[typed]
				if !ok {
					return nil, BadAuthRequest("模型协议引用了未获准的图片")
				}
				return resolved, nil
			}
			return typed, nil
		case []any:
			for i, child := range typed {
				next, e := visit(child)
				if e != nil {
					return nil, e
				}
				typed[i] = next
			}
			return typed, nil
		case map[string]any:
			if !hydrate {
				var imageRef any
				switch typed["type"] {
				case "image_url":
					imageRef = typed["image_url"]
				case "input_image":
					imageRef = typed["image_url"]
				case "image":
					source, _ := typed["source"].(map[string]any)
					if source["type"] != "url" {
						return nil, BadAuthRequest("规划图片必须使用资源占位")
					}
					imageRef = source["url"]
				}
				if object, ok := imageRef.(map[string]any); ok {
					imageRef = object["url"]
				}
				if imageRef != nil {
					ref, ok := imageRef.(string)
					if !ok || references[ref] == "" {
						return nil, BadAuthRequest("规划图片不在获准资源清单")
					}
				}
				if raw, ok := typed["fileData"].(map[string]any); ok {
					ref, _ := raw["fileUri"].(string)
					if references[ref] == "" {
						return nil, BadAuthRequest("规划图片不在获准资源清单")
					}
				}
				if typed["inlineData"] != nil {
					return nil, BadAuthRequest("规划图片不能持久化内嵌数据")
				}
			}
			// Claude URL source and Gemini fileData need protocol-specific base64 envelopes.
			if hydrate && typed["type"] == "url" {
				if ref, ok := typed["url"].(string); ok && strings.HasPrefix(ref, "resource:") {
					data, ok := references[ref]
					if !ok {
						return nil, BadAuthRequest("模型图片未获准")
					}
					mime, payload, ok := splitCreationDataURL(data)
					if !ok {
						return nil, BadAuthRequest("模型图片需要可读取的图片数据")
					}
					return map[string]any{"type": "base64", "media_type": mime, "data": payload}, nil
				}
			}
			if hydrate {
				if raw, ok := typed["fileData"].(map[string]any); ok {
					if ref, ok := raw["fileUri"].(string); ok && strings.HasPrefix(ref, "resource:") {
						data, ok := references[ref]
						if !ok {
							return nil, BadAuthRequest("模型图片未获准")
						}
						mime, payload, ok := splitCreationDataURL(data)
						if !ok {
							return nil, BadAuthRequest("模型图片需要可读取的图片数据")
						}
						delete(typed, "fileData")
						typed["inlineData"] = map[string]any{"mimeType": mime, "data": payload}
					}
				}
			}
			for key, child := range typed {
				next, e := visit(child)
				if e != nil {
					return nil, e
				}
				typed[key] = next
			}
			return typed, nil
		}
		return value, nil
	}
	root, err = visit(root)
	if err != nil {
		return input, err
	}
	b, err = json.Marshal(root)
	if err != nil {
		return input, err
	}
	var requests agentToolRequests
	if err = json.Unmarshal(b, &requests); err != nil {
		return input, err
	}
	input.AgentRequests = &requests
	return input, nil
}
func splitCreationDataURL(value string) (string, string, bool) {
	if !strings.HasPrefix(value, "data:") {
		return "", "", false
	}
	parts := strings.SplitN(strings.TrimPrefix(value, "data:"), ";base64,", 2)
	if len(parts) != 2 || !strings.HasPrefix(parts[0], "image/") {
		return "", "", false
	}
	return parts[0], parts[1], true
}
