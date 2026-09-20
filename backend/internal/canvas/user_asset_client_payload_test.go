package canvas

import (
	"encoding/json"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestClientAssetPayloadRepairsWorkflowAssetDocument(t *testing.T) {
	createdAt := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	asset := model.Asset{
		ID: "workflow-asset-test",
		PayloadJSON: `{
			"id":"workflow-asset-test",
			"kind":"video",
			"title":"镜头01 · 视频",
			"category":"material",
			"status":"confirmed",
			"tags":[],
			"data":{"url":"/api/resources/res-1/file","storageKey":"resource:res-1","width":0,"height":0,"bytes":1,"mimeType":"video/mp4"}
		}`,
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}

	raw := ClientAssetPayload(asset)
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload["coverUrl"] != "/api/resources/res-1/file" {
		t.Fatalf("coverUrl = %#v", payload["coverUrl"])
	}
	if payload["createdAt"] == nil || payload["updatedAt"] == nil {
		t.Fatalf("timestamps missing: %#v", payload)
	}
	data := payload["data"].(map[string]any)
	if data["width"].(float64) != 1 || data["height"].(float64) != 1 {
		t.Fatalf("dimensions = %#v", data)
	}
}

func TestClientAssetPayloadPreservesCompleteDocument(t *testing.T) {
	rawInput := `{"id":"asset-1","kind":"image","title":"完整","coverUrl":"https://example.com/a.png","tags":["角色"],"createdAt":"2026-08-29T00:00:00.000Z","updatedAt":"2026-08-29T00:00:00.000Z","data":{"dataUrl":"https://example.com/a.png","width":2,"height":3,"bytes":1,"mimeType":"image/png"}}`
	asset := model.Asset{PayloadJSON: rawInput}
	raw := ClientAssetPayload(asset)
	var before map[string]any
	var after map[string]any
	if err := json.Unmarshal([]byte(rawInput), &before); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &after); err != nil {
		t.Fatal(err)
	}
	beforeJSON, _ := json.Marshal(before)
	afterJSON, _ := json.Marshal(after)
	if string(beforeJSON) != string(afterJSON) {
		t.Fatalf("payload changed: %s", raw)
	}
}
