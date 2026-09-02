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

	references, err := canvasMediaAssetReferences(raw)
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

func TestValidateCanvasMediaAssetsRejectsResourceWithoutAsset(t *testing.T) {
	svc, db, _ := newResourceDeletionTestService(t)
	resource := model.Resource{
		ID: "resource-canvas-orphan", UserID: "user-1", Status: model.ResourceStatusReady,
		Provider: "local", ObjectKey: "users/user-1/image/orphan.png",
	}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	raw := json.RawMessage(`{
		"id":"canvas-1",
		"nodes":[{"id":"node-1","type":"image","metadata":{"storageKey":"resource:resource-canvas-orphan","content":"/api/resources/resource-canvas-orphan/file"}}]
	}`)

	err := svc.validateCanvasMediaAssets("user-1", raw)
	if err == nil || !strings.Contains(err.Error(), "尚未进入素材库") {
		t.Fatalf("validateCanvasMediaAssets() error = %v", err)
	}
}

func TestValidateCanvasMediaAssetsAcceptsMatchingNodeAndTimelineAssets(t *testing.T) {
	svc, db, _ := newResourceDeletionTestService(t)
	resources := []model.Resource{
		{ID: "resource-node", UserID: "user-1", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "users/user-1/image/node.png"},
		{ID: "resource-timeline", UserID: "user-1", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "users/user-1/video/timeline.mp4"},
	}
	assets := []model.Asset{
		{ID: "asset-node", UserID: "user-1", PayloadJSON: `{"id":"asset-node","data":{"storageKey":"resource:resource-node"}}`},
		{ID: "asset-timeline", UserID: "user-1", PayloadJSON: `{"id":"asset-timeline","data":{"url":"/api/resources/resource-timeline/file"}}`},
	}
	for index := range resources {
		if err := db.Create(&resources[index]).Error; err != nil {
			t.Fatal(err)
		}
	}
	for index := range assets {
		if err := db.Create(&assets[index]).Error; err != nil {
			t.Fatal(err)
		}
	}
	raw := json.RawMessage(`{
		"id":"canvas-1",
		"nodes":[{"id":"node-1","type":"image","metadata":{"assetId":"asset-node","storageKey":"resource:resource-node"}}],
		"timeline":{"clips":[{"id":"clip-1","directMedia":{"kind":"video","assetId":"asset-timeline","storageKey":"resource:resource-timeline"}}]}
	}`)

	if err := svc.validateCanvasMediaAssets("user-1", raw); err != nil {
		t.Fatalf("validateCanvasMediaAssets() error = %v", err)
	}
}

func TestValidateCanvasMediaAssetsRejectsMismatchedAsset(t *testing.T) {
	svc, db, _ := newResourceDeletionTestService(t)
	resources := []model.Resource{
		{ID: "resource-canvas", UserID: "user-1", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "users/user-1/image/canvas.png"},
		{ID: "resource-other", UserID: "user-1", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "users/user-1/image/other.png"},
	}
	for index := range resources {
		if err := db.Create(&resources[index]).Error; err != nil {
			t.Fatal(err)
		}
	}
	asset := model.Asset{ID: "asset-wrong", UserID: "user-1", PayloadJSON: `{"data":{"storageKey":"resource:resource-other"}}`}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	raw := json.RawMessage(`{"nodes":[{"type":"image","metadata":{"assetId":"asset-wrong","storageKey":"resource:resource-canvas"}}]}`)

	err := svc.validateCanvasMediaAssets("user-1", raw)
	if err == nil || !strings.Contains(err.Error(), "不一致") {
		t.Fatalf("validateCanvasMediaAssets() error = %v", err)
	}
}
