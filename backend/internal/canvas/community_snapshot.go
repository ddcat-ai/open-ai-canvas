package canvas

import (
	"encoding/json"
	"regexp"
	"strings"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
)

var publicationLinkPattern = regexp.MustCompile(`(?i:https?://|//|data:|blob:|file:)[^\s<>"')\]}]+|/api/resources/[A-Za-z0-9_-]+(?:/file)?(?:\?[^\s<>"')\]}]+)?|resource:[A-Za-z0-9_-]+`)

// PublicationSnapshot reuses the public canvas whitelist, but stores resource
// references rather than a temporary share token or signed delivery URL.
func PublicationSnapshot(project *model.CanvasProject) (map[string]any, map[string]bool, error) {
	result, resources, err := publicCanvasProject(project, "community-snapshot")
	if err != nil {
		return nil, nil, err
	}
	var source struct {
		Nodes []struct {
			ID       string         `json:"id"`
			Type     string         `json:"type"`
			Metadata map[string]any `json:"metadata"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal([]byte(project.PayloadJSON), &source); err != nil {
		return nil, nil, err
	}
	richText := map[string]any{}
	textContent := map[string]any{}
	for _, node := range source.Nodes {
		if doc, ok := node.Metadata["richText"]; ok {
			richText[node.ID] = doc
		}
		if node.Type != "image" && node.Type != "video" && node.Type != "audio" {
			if content, ok := node.Metadata["content"]; ok {
				textContent[node.ID] = content
			}
		}
	}
	for _, raw := range result["nodes"].([]any) {
		node := raw.(map[string]any)
		if content, ok := textContent[node["id"].(string)]; ok {
			node["metadata"].(map[string]any)["content"] = content
		}
		if doc, ok := richText[node["id"].(string)]; ok {
			node["metadata"].(map[string]any)["richText"] = doc
		}
	}
	result = scrubPublicationValue(result, resources).(map[string]any)
	return result, resources, nil
}

func scrubPublicationValue(value any, resources map[string]bool) any {
	switch v := value.(type) {
	case map[string]any:
		out := map[string]any{}
		for key, item := range v {
			lower := strings.ToLower(key)
			if strings.Contains(lower, "secret") || strings.Contains(lower, "token") || strings.Contains(lower, "apikey") || strings.Contains(lower, "api_key") || strings.Contains(lower, "password") || strings.Contains(lower, "header") || strings.Contains(lower, "cookie") || lower == "authorization" || lower == "storagekey" || lower == "endpoint" || lower == "baseurl" {
				continue
			}
			if text, ok := item.(string); ok && (lower == "src" || lower == "href" || lower == "poster" || strings.HasSuffix(lower, "url")) {
				if id := assets.ResourceID(text); id != "" && !strings.ContainsAny(strings.TrimSpace(text), " \t\r\n") {
					resources[id] = true
					out[key] = "resource:" + id
				} else {
					out[key] = ""
				}
				continue
			}
			out[key] = scrubPublicationValue(item, resources)
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = scrubPublicationValue(item, resources)
		}
		return out
	case string:
		prefix := "/api/public/canvas-shares/community-snapshot/resources/"
		if strings.HasPrefix(v, prefix) && strings.HasSuffix(v, "/file") {
			return "resource:" + strings.TrimSuffix(strings.TrimPrefix(v, prefix), "/file")
		}
		if id := assets.ResourceID(v); id != "" && !strings.ContainsAny(strings.TrimSpace(v), " \t\r\n") && (strings.HasPrefix(strings.TrimSpace(v), "resource:") || strings.HasPrefix(strings.TrimSpace(v), "/api/resources/") || strings.HasPrefix(strings.TrimSpace(v), "http://") || strings.HasPrefix(strings.TrimSpace(v), "https://")) {
			resources[id] = true
			return "resource:" + id
		}
		var structured any
		if trimmed := strings.TrimSpace(v); (strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[")) && json.Unmarshal([]byte(trimmed), &structured) == nil {
			data, _ := json.Marshal(scrubPublicationValue(structured, resources))
			return string(data)
		}
		return publicationLinkPattern.ReplaceAllStringFunc(v, func(link string) string {
			if id := assets.ResourceID(link); id != "" {
				resources[id] = true
				return "resource:" + id
			}
			return ""
		})
	default:
		return value
	}
}

// RewritePublicationResources also handles references embedded in rich text and
// serialized composer documents; these must follow the same ownership mapping.
func RewritePublicationResources(value any, resourceURL func(string) string) any {
	switch v := value.(type) {
	case map[string]any:
		for key, item := range v {
			v[key] = RewritePublicationResources(item, resourceURL)
		}
		return v
	case []any:
		for index, item := range v {
			v[index] = RewritePublicationResources(item, resourceURL)
		}
		return v
	case string:
		if id := assets.ResourceID(v); id != "" && strings.TrimSpace(v) == "resource:"+id {
			return resourceURL(id)
		}
		return publicationLinkPattern.ReplaceAllStringFunc(v, func(link string) string {
			if id := assets.ResourceID(link); id != "" {
				return resourceURL(id)
			}
			return link
		})
	default:
		return value
	}
}
