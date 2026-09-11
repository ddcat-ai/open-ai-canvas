package canvas

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func testUserAssetPayload(kind string, extra map[string]any) map[string]any {
	payload := map[string]any{
		"id":       "asset-1",
		"kind":     kind,
		"title":    "测试资产",
		"coverUrl": "",
		"tags":     []string{},
	}
	switch kind {
	case "image":
		payload["data"] = map[string]any{"dataUrl": "https://example.com/a.png", "width": 1, "height": 1, "bytes": 1, "mimeType": "image/png"}
	case "video":
		payload["data"] = map[string]any{"url": "https://example.com/a.mp4", "width": 1, "height": 1, "bytes": 1, "mimeType": "video/mp4"}
	case "audio":
		payload["data"] = map[string]any{"url": "https://example.com/a.mp3", "bytes": 1, "mimeType": "audio/mpeg"}
	case "model":
		payload["data"] = map[string]any{"url": "https://example.com/a.glb", "bytes": 1, "mimeType": "model/gltf-binary", "fileName": "a.glb"}
	case "text":
		payload["data"] = map[string]any{"content": "正文"}
	default:
		payload["data"] = map[string]any{"definition": map[string]any{}}
	}
	for key, value := range extra {
		payload[key] = value
	}
	return payload
}

func TestAssetFromJSONAcceptsDeterministicGenerationID(t *testing.T) {
	id := "generation_" + strings.Repeat("a", 64)
	raw, err := json.Marshal(testUserAssetPayload("image", map[string]any{"id": id, "title": "生成图片"}))
	if err != nil {
		t.Fatalf("marshal asset: %v", err)
	}

	asset, err := AssetFromJSON("user-1", raw)
	if err != nil {
		t.Fatalf("assetFromJSON: %v", err)
	}
	if asset.ID != id {
		t.Fatalf("asset ID = %q, want %q", asset.ID, id)
	}
	if len([]rune(asset.ID)) > model.AssetIDMaxLength {
		t.Fatalf("generation asset ID length = %d, limit %d", len([]rune(asset.ID)), model.AssetIDMaxLength)
	}
}

func TestAssetFromJSONNormalizesLegacyAndUnclassifiedMediaCategories(t *testing.T) {
	tests := []struct {
		name     string
		kind     string
		category string
		want     model.AssetCategory
	}{
		{name: "legacy accessory", kind: "image", category: "accessory", want: model.AssetCategoryProp},
		{name: "legacy style", kind: "image", category: "style", want: model.AssetCategoryMaterial},
		{name: "unclassified video", kind: "video", want: model.AssetCategoryMaterial},
		{name: "unclassified entity", kind: "entity", want: model.AssetCategoryCharacter},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(testUserAssetPayload(test.kind, map[string]any{"category": test.category}))
			if err != nil {
				t.Fatal(err)
			}
			asset, err := AssetFromJSON("user-1", raw)
			if err != nil {
				t.Fatal(err)
			}
			if asset.Category != test.want {
				t.Fatalf("category = %q, want %q", asset.Category, test.want)
			}
		})
	}
}

func TestAssetFromJSONRejectsIncompleteLibraryPayload(t *testing.T) {
	tests := []struct {
		name    string
		payload map[string]any
		want    string
	}{
		{name: "missing tags", payload: testUserAssetPayload("image", map[string]any{"tags": nil}), want: "tags"},
		{name: "malformed tags", payload: testUserAssetPayload("image", map[string]any{"tags": []any{"角色", 1}}), want: "tags"},
		{name: "missing data", payload: testUserAssetPayload("image", map[string]any{"data": nil}), want: "data"},
		{name: "image missing locator", payload: testUserAssetPayload("image", map[string]any{"data": map[string]any{"dataUrl": "", "width": 1, "height": 1, "bytes": 1, "mimeType": "image/png"}}), want: "dataUrl 或 storageKey"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if test.name == "missing tags" {
				delete(test.payload, "tags")
			}
			if test.name == "missing data" {
				delete(test.payload, "data")
			}
			raw, err := json.Marshal(test.payload)
			if err != nil {
				t.Fatal(err)
			}
			_, err = AssetFromJSON("user-1", raw)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("assetFromJSON error = %v, want %q", err, test.want)
			}
		})
	}
}

func TestAssetFromJSONRejectsIDOverLimit(t *testing.T) {
	raw, err := json.Marshal(map[string]any{"id": strings.Repeat("a", model.AssetIDMaxLength+1), "kind": "image"})
	if err != nil {
		t.Fatalf("marshal asset: %v", err)
	}

	_, err = AssetFromJSON("user-1", raw)
	if err == nil || !strings.Contains(err.Error(), "素材 ID 不能超过 80 个字符") {
		t.Fatalf("assetFromJSON error = %v", err)
	}
}

func TestAssetFromJSONRejectsPrimaryVersionIDOverLimit(t *testing.T) {
	raw, err := json.Marshal(map[string]any{"id": "asset-1", "primaryVersionId": strings.Repeat("v", 37)})
	if err != nil {
		t.Fatalf("marshal asset: %v", err)
	}

	_, err = AssetFromJSON("user-1", raw)
	if err == nil || !strings.Contains(err.Error(), "素材主版本 ID 不能超过 36 个字符") {
		t.Fatalf("assetFromJSON error = %v", err)
	}
}

func TestValidateSyncedPayloadAllowsDataURLMentionInErrorMessage(t *testing.T) {
	raw, err := json.Marshal(map[string]interface{}{
		"nodes": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{
					"errorDetails": "Expected a base64 image such as data:image/png;base64,aW1n, but received application/octet-stream",
				},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateSyncedPayload(raw, "画布"); err != nil {
		t.Fatalf("ValidateSyncedPayload() error = %v", err)
	}
}

func TestValidateSyncedPayloadRejectsNestedInlineMedia(t *testing.T) {
	for _, content := range []string{
		"data:image/png;base64,aW1n",
		"  DATA:VIDEO/mp4;base64,dmlkZW8=",
		"data:audio/mpeg;base64,YXVkaW8=",
	} {
		raw, err := json.Marshal(map[string]interface{}{
			"nodes": []interface{}{
				map[string]interface{}{"metadata": map[string]interface{}{"content": content}},
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := ValidateSyncedPayload(raw, "画布"); err == nil {
			t.Fatalf("ValidateSyncedPayload(%q) error = nil", content)
		}
	}
}

func TestCanvasMediaAssetReferencesCollectsNodesAndTimeline(t *testing.T) {
	raw := json.RawMessage(`{
		"nodes":[
			{"type":"image","metadata":{"assetId":"asset-image","storageKey":"resource:resource-image"}},
			{"type":"text","metadata":{"assetId":"asset-text","content":"/api/resources/not-media/file"}},
			{"type":"video","metadata":{"content":"https://cdn.example.com/external.mp4"}}
		],
		"timeline":{"clips":[
			{"directMedia":{"kind":"audio","assetId":"asset-audio","url":"/api/resources/resource-audio/file"}},
			{"directMedia":{"kind":"text","content":"/api/resources/not-timeline-media/file"}}
		]}
	}`)

	references, err := MediaAssetReferences(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(references) != 2 {
		t.Fatalf("references = %#v", references)
	}
	if references[0].AssetID != "asset-image" || references[0].ResourceID != "resource-image" {
		t.Fatalf("node reference = %#v", references[0])
	}
	if references[1].AssetID != "asset-audio" || references[1].ResourceID != "resource-audio" {
		t.Fatalf("timeline reference = %#v", references[1])
	}
}
