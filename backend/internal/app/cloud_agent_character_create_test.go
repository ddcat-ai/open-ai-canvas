package app

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCloudAgentCreatesCharacterCardFromCanvasMedia(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	doc := map[string]any{"nodes": []any{
		map[string]any{"id": "portrait", "type": "image", "title": "李莫愁·定妆", "position": map[string]any{"x": 0.0, "y": 0.0}, "width": 300.0, "height": 400.0, "metadata": map[string]any{"storageKey": "resource:portrait-res"}},
		map[string]any{"id": "voice", "type": "audio", "title": "李莫愁·音色", "position": map[string]any{"x": 0.0, "y": 500.0}, "width": 340.0, "height": 120.0, "metadata": map[string]any{"storageKey": "resource:voice-res"}},
		map[string]any{"id": "pending", "type": "image", "title": "未上传", "metadata": map[string]any{"content": "blob:local"}},
	}, "connections": []any{}}
	raw, _ := json.Marshal(doc)
	for _, item := range []any{
		&model.CanvasProject{ID: "agent-canvas", UserID: "user", Title: "赤练劫", PayloadJSON: string(raw)},
		&model.Resource{ID: "portrait-res", UserID: "user", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Size: 10, Width: 720, Height: 960},
		&model.Resource{ID: "voice-res", UserID: "user", Kind: "audio", Status: model.ResourceStatusReady, MimeType: "audio/mpeg", Size: 10},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	args := map[string]any{"nodeId": "lmc-card", "name": "李莫愁", "imageNodeId": "portrait", "audioNodeId": "voice", "definition": map[string]any{"role": "赤练仙子", "appearance": "素纱襌衣", "aliases": []string{"赤练仙子"}}}

	plan, err := prepareCloudAgentCharacterCreate(s.repo, "user", "agent-canvas", cloudAgentStoryboardCall(t, "canvas_create_character", "preview", args))
	if err != nil {
		t.Fatal(err)
	}
	if plan.Preview.Items[0].Operation != "create_character" || !strings.Contains(strings.Join(plan.Preview.Items[0].Details, "\n"), "李莫愁·音色") {
		t.Fatalf("approval preview does not describe the card: %#v", plan.Preview)
	}
	// 审批预览不能提前写入角色库。
	var count int64
	db.Model(&model.Asset{}).Where("category = ?", model.AssetCategoryCharacter).Count(&count)
	if count != 0 {
		t.Fatal("preparing the approval created a character asset")
	}

	result, err := applyCloudAgentCharacterCreate(s.repo, "user", "agent-canvas", cloudAgentStoryboardCall(t, "canvas_create_character", "apply", args), policy)
	if err != nil {
		t.Fatal(err)
	}
	summary := result.(map[string]any)
	if summary["visualStatus"] != "ready" || summary["voiceStatus"] != "ready" {
		t.Fatalf("card media not bound: %#v", summary)
	}
	assetID := stringValue(summary["characterAssetId"])
	detail, err := s.Character("user", assetID)
	if err != nil || detail.Asset.Title != "李莫愁" || detail.Character.Voice == nil || detail.Character.Voice.Profile.Name != "李莫愁·音色" || detail.Character.Definition["role"] != "赤练仙子" {
		t.Fatalf("character asset = %#v, %v", detail, err)
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	stored, _ := creationDocument(canvas.PayloadJSON)
	nodes, _ := creationObjects(stored["nodes"])
	card := nodes["lmc-card"]
	if card == nil {
		t.Fatal("character card node was not placed on canvas")
	}
	descriptor, ok := cloudAgentNodeCapabilityForNode(card)
	meta := card["metadata"].(map[string]any)
	if !ok || descriptor.Type != "character" || meta["characterAssetId"] != assetID || meta["characterVersionPolicy"] != "current" {
		t.Fatalf("placed node is not a usable character card: %#v", card)
	}
	// 未指定坐标时不能叠在形象图片上。
	if position := card["position"].(map[string]any); position["x"].(float64) < 300 {
		t.Fatalf("card overlaps the portrait: %#v", position)
	}
	if _, err := cloudAgentResolveCharacter(s.repo, "user", "", card); err != nil {
		t.Fatalf("placed card cannot be resolved for generation: %v", err)
	}

	for name, bad := range map[string]map[string]any{
		"duplicate node":   {"nodeId": "lmc-card", "name": "李莫愁", "imageNodeId": "portrait"},
		"missing image":    {"nodeId": "x1", "name": "李莫愁"},
		"unsaved image":    {"nodeId": "x2", "name": "李莫愁", "imageNodeId": "pending"},
		"audio as image":   {"nodeId": "x3", "name": "李莫愁", "imageNodeId": "voice"},
		"unknown field":    {"nodeId": "x4", "name": "李莫愁", "imageNodeId": "portrait", "definition": map[string]any{"secret": "x"}},
		"url instead node": {"nodeId": "x5", "name": "李莫愁", "imageNodeId": "https://example.com/a.png"},
	} {
		if _, err := prepareCloudAgentCharacterCreate(s.repo, "user", "agent-canvas", cloudAgentStoryboardCall(t, "canvas_create_character", name, bad)); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
	if !cloudAgentWrite("canvas_create_character") {
		t.Fatal("character creation must go through the write approval path")
	}
}
