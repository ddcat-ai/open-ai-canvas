package canvas

import (
	"encoding/json"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

// ClientAssetPayload 将素材列与内部媒体 payload 组装为前端素材合同。
// 项目上传和工作流写入不一定经过 UpsertUserAsset，身份字段以素材表为准。
func ClientAssetPayload(asset model.Asset) json.RawMessage {
	raw := strings.TrimSpace(asset.PayloadJSON)
	if raw == "" {
		return nil
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(raw), &payload); err != nil || payload == nil {
		return json.RawMessage(raw)
	}
	if asset.ID != "" {
		payload["id"] = asset.ID
		payload["kind"] = asset.Kind
		payload["title"] = asset.Title
		if asset.Category != "" {
			payload["category"] = asset.Category
		}
		if asset.Status != "" {
			payload["status"] = asset.Status
		}
		if asset.FolderID != "" {
			payload["folderId"] = asset.FolderID
		} else {
			delete(payload, "folderId")
		}
		if asset.PrimaryVersionID != "" {
			payload["primaryVersionId"] = asset.PrimaryVersionID
		} else {
			delete(payload, "primaryVersionId")
		}
	}
	if _, ok := payload["coverUrl"]; !ok {
		payload["coverUrl"] = deriveAssetCoverURL(payload)
	}
	if _, ok := payload["tags"]; !ok {
		payload["tags"] = []string{}
	}
	if _, ok := payload["createdAt"]; !ok {
		payload["createdAt"] = formatClientAssetTime(asset.CreatedAt)
	}
	if _, ok := payload["updatedAt"]; !ok {
		payload["updatedAt"] = formatClientAssetTime(asset.UpdatedAt)
	}
	if data, ok := payload["data"].(map[string]any); ok {
		kind, _ := payload["kind"].(string)
		if kind == "image" || kind == "video" || kind == "audio" || kind == "model" {
			// 资源元数据使用 size；素材合同使用 bytes，直接使用已记录的真实大小。
			if _, exists := data["bytes"]; !exists {
				if size, valid := jsonNumberValue(data["size"]); valid && size >= 0 {
					data["bytes"] = size
				}
			}
			if storageKey, ok := data["storageKey"].(string); ok && strings.TrimSpace(storageKey) != "" {
				locator := "url"
				if kind == "image" {
					locator = "dataUrl"
				}
				if _, exists := data[locator]; !exists {
					data[locator] = ""
				}
			}
		}
		switch kind {
		case "image", "video":
			ensurePositiveAssetDimension(data, "width")
			ensurePositiveAssetDimension(data, "height")
		}
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return json.RawMessage(raw)
	}
	return encoded
}

// ClientAssetListPayload is the list variant used by the paginated asset
// library.  The list only needs enough metadata to render cards and perform
// an action; generation prompts and other verbose metadata belong to the
// asset detail/snapshot paths.  Keeping them out of every page also avoids
// repeatedly parsing and copying the same prompt strings in the browser.
func ClientAssetListPayload(asset model.Asset) json.RawMessage {
	raw := ClientAssetPayload(asset)
	if len(raw) == 0 {
		return nil
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil || payload == nil {
		return raw
	}
	if metadata, ok := payload["metadata"].(map[string]any); ok {
		// 列表只需要项目归属提示。canvasId 仍保留，避免列表卡片把画布素材
		// 错显示成“未关联项目”；节点 ID、生成提示和其他同步上下文在详情路径读取。
		for key := range metadata {
			if key != "projectName" && key != "projectIds" && key != "canvasId" {
				delete(metadata, key)
			}
		}
		if len(metadata) == 0 {
			delete(payload, "metadata")
		}
	}
	// 图片封面和 dataUrl、视频封面和 url 通常是同一个地址；列表保留
	// coverUrl 字段以满足前端合同，但不再重复传输这段长 URL。
	if cover, ok := payload["coverUrl"].(string); ok {
		if data, ok := payload["data"].(map[string]any); ok {
			for _, key := range []string{"dataUrl", "url"} {
				if value, ok := data[key].(string); ok && value == cover {
					payload["coverUrl"] = ""
					break
				}
			}
		}
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return raw
	}
	return encoded
}

func deriveAssetCoverURL(payload map[string]any) string {
	if value, ok := payload["coverUrl"].(string); ok && strings.TrimSpace(value) != "" {
		return value
	}
	data, ok := payload["data"].(map[string]any)
	if !ok {
		return ""
	}
	for _, key := range []string{"dataUrl", "url"} {
		if value, ok := data[key].(string); ok && strings.TrimSpace(value) != "" {
			return value
		}
	}
	if storageKey, ok := data["storageKey"].(string); ok {
		return resourceURLFromStorageKey(storageKey)
	}
	return ""
}

func resourceURLFromStorageKey(storageKey string) string {
	storageKey = strings.TrimSpace(storageKey)
	if !strings.HasPrefix(storageKey, "resource:") {
		return ""
	}
	resourceID := strings.TrimSpace(strings.TrimPrefix(storageKey, "resource:"))
	if resourceID == "" {
		return ""
	}
	return "/api/resources/" + resourceID + "/file"
}

func ensurePositiveAssetDimension(data map[string]any, key string) {
	value, ok := jsonNumberValue(data[key])
	if !ok || value <= 0 {
		data[key] = 1
	}
}

func jsonNumberValue(value any) (float64, bool) {
	switch item := value.(type) {
	case float64:
		return item, true
	case int:
		return float64(item), true
	case int64:
		return float64(item), true
	case json.Number:
		parsed, err := item.Float64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

func formatClientAssetTime(value time.Time) string {
	if value.IsZero() {
		return time.Now().UTC().Format(time.RFC3339Nano)
	}
	return value.UTC().Format(time.RFC3339Nano)
}
