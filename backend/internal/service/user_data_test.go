package service

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestAssetFromJSONAcceptsDeterministicGenerationID(t *testing.T) {
	id := "generation_" + strings.Repeat("a", 64)
	raw, err := json.Marshal(map[string]any{"id": id, "kind": "image", "title": "生成图片"})
	if err != nil {
		t.Fatalf("marshal asset: %v", err)
	}

	asset, err := assetFromJSON("user-1", raw)
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
			raw, err := json.Marshal(map[string]any{"id": "asset-1", "kind": test.kind, "category": test.category, "title": "测试资产"})
			if err != nil {
				t.Fatal(err)
			}
			asset, err := assetFromJSON("user-1", raw)
			if err != nil {
				t.Fatal(err)
			}
			if asset.Category != test.want {
				t.Fatalf("category = %q, want %q", asset.Category, test.want)
			}
		})
	}
}

func TestAssetFromJSONRejectsIDOverLimit(t *testing.T) {
	raw, err := json.Marshal(map[string]any{"id": strings.Repeat("a", model.AssetIDMaxLength+1), "kind": "image"})
	if err != nil {
		t.Fatalf("marshal asset: %v", err)
	}

	_, err = assetFromJSON("user-1", raw)
	if err == nil || !strings.Contains(err.Error(), "素材 ID 不能超过 80 个字符") {
		t.Fatalf("assetFromJSON error = %v", err)
	}
}

func TestAssetFromJSONRejectsPrimaryVersionIDOverLimit(t *testing.T) {
	raw, err := json.Marshal(map[string]any{"id": "asset-1", "primaryVersionId": strings.Repeat("v", 37)})
	if err != nil {
		t.Fatalf("marshal asset: %v", err)
	}

	_, err = assetFromJSON("user-1", raw)
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
	if err := validateSyncedPayload(raw, "画布"); err != nil {
		t.Fatalf("validateSyncedPayload() error = %v", err)
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
		if err := validateSyncedPayload(raw, "画布"); err == nil {
			t.Fatalf("validateSyncedPayload(%q) error = nil", content)
		}
	}
}
