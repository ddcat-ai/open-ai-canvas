package app

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestCloudAgentCharacterArgumentTypeFeedback(t *testing.T) {
	for _, tc := range []struct{ name, args, field, expected, actual string }{
		{"aliases object", `{"definition":{"aliases":{"item":["private-sentinel"]}}}`, "definition.aliases", "string[]", "object"},
		{"nested aliases", `{"definition":{"aliases":[["private-sentinel"]]}}`, "definition.aliases[]", "string", "array"},
		{"aliases string", `{"definition":{"aliases":"private-sentinel"}}`, "definition.aliases", "string[]", "string"},
		{"alias object", `{"definition":{"aliases":[{"private-sentinel":"private-sentinel"}]}}`, "definition.aliases[]", "string", "object"},
		{"alias number", `{"definition":{"aliases":[123456789]}}`, "definition.aliases[]", "string", "number"},
		{"alias boolean", `{"definition":{"aliases":[true]}}`, "definition.aliases[]", "string", "boolean"},
		{"definition array", `{"definition":["private-sentinel"]}`, "definition", "object", "array"},
		{"role object", `{"definition":{"role":{"private-sentinel":"private-sentinel"}}}`, "definition.role", "string", "object"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			call := cloudAgentCall{ID: "bad-character"}
			call.Function.Name, call.Function.Arguments = "canvas_create_character", tc.args
			// nil 仓储确保类型错误在读取资源或准备审批前被拒绝。
			plan, err := prepareCloudAgentCharacterCreate(nil, "user", "canvas", call)
			if err == nil || plan != nil {
				t.Fatal("invalid character arguments accepted")
			}
			req := agentTestRequest()
			req.PermissionMode = "request_approval"
			state := &cloudAgentRuntime{Request: req, Canonical: canonicalAgentRequest{Tools: cloudAgentTools(req)}}
			if cloudAgentToolResult("run", state, call, nil, err) {
				t.Fatal("first argument failure exhausted repair budget")
			}
			content := state.Canonical.Messages[0]["content"].(string)
			var result map[string]any
			if err := json.Unmarshal([]byte(content), &result); err != nil {
				t.Fatal(err)
			}
			for key, want := range map[string]string{
				"field": tc.field, "issue": "type_mismatch", "expectedType": tc.expected, "actualType": tc.actual,
				"reason": "invalid_tool_arguments", "errorClass": "schema_error", "requiredAction": "fix_arguments",
			} {
				if result[key] != want {
					t.Errorf("%s = %v, want %s", key, result[key], want)
				}
			}
			if result["parameters"] == nil || strings.Contains(content, "private-sentinel") || strings.Contains(content, "123456789") || strings.Contains(content, "json:") {
				t.Fatalf("unsafe or incomplete feedback: %s", content)
			}
			if state.Approval != nil || state.ToolRepairs[call.Function.Name].Attempt != 1 {
				t.Fatal("invalid call changed approval or repair behavior")
			}
		})
	}
}

func TestCloudAgentCharacterRejectsUnknownAndMalformedArguments(t *testing.T) {
	for _, raw := range []string{
		`{"aliases":["private-sentinel"]}`,
		`{"definition":{"private-sentinel":"private-sentinel"}}`,
		`{"definition":{"aliases":[],"private-sentinel":"private-sentinel"}}`,
		`{"definition":{"aliases":[]}} {"private-sentinel":true}`,
		`{"definition":{"aliases":["private-sentinel"]}`,
		`[]`, `null`, `"private-sentinel"`,
	} {
		call := cloudAgentCall{ID: "invalid"}
		call.Function.Name, call.Function.Arguments = "canvas_create_character", raw
		if _, err := prepareCloudAgentCharacterCreate(nil, "user", "canvas", call); err == nil {
			t.Fatalf("invalid arguments accepted: %s", raw)
		} else {
			state := &cloudAgentRuntime{}
			cloudAgentToolResult("run", state, call, nil, err)
			content := state.Canonical.Messages[0]["content"].(string)
			if strings.Contains(content, "private-sentinel") || !strings.Contains(content, "invalid_tool_arguments") {
				t.Fatalf("unsafe argument feedback: %s", content)
			}
		}
	}
}

func TestCloudAgentCharacterDefinitionCompatibility(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	canvas := &model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"portrait","type":"image","metadata":{"storageKey":"resource:portrait-res"}}],"connections":[]}`}
	for _, item := range []any{canvas, &model.Resource{ID: "portrait-res", UserID: "user", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"}} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	definition := map[string]any{"aliases": []string{" 别名甲 ", "", "别名乙"}}
	for _, field := range []string{"role", "appearance", "physique", "clothing", "personality", "props", "consistencyPrompt", "multiViewPrompt", "voiceLanguage", "voiceAge", "voiceTimbre"} {
		definition[field] = " 设定 "
	}
	for _, value := range []any{definition, map[string]any{}, nil} {
		args := map[string]any{"nodeId": "character", "name": " 角色 ", "imageNodeId": "portrait", "x": 800, "y": 200}
		if value != nil {
			args["definition"] = value
		}
		plan, err := prepareCloudAgentCharacterCreate(s.repo, "user", canvas.ID, cloudAgentStoryboardCall(t, "canvas_create_character", "corrected", args))
		if err != nil {
			t.Fatal(err)
		}
		if plan.Args.Name != "角色" || plan.ImageResourceID != "portrait-res" || plan.AudioResourceID != "" || plan.Position.X != 800 || plan.Position.Y != 200 || plan.Preview.Items[0].Operation != "create_character" {
			t.Fatalf("optional fields or image-only preview changed: %#v", plan)
		}
		if value == nil || len(value.(map[string]any)) == 0 {
			if !reflect.DeepEqual(plan.Definition, map[string]any{"aliases": []string{}}) {
				t.Fatalf("empty definition changed: %#v", plan.Definition)
			}
		} else {
			if !reflect.DeepEqual(plan.Definition["aliases"], []string{"别名甲", "别名乙"}) || len(plan.Definition) != 12 {
				t.Fatalf("definition lost fields: %#v", plan.Definition)
			}
			for key := range definition {
				if key != "aliases" && plan.Definition[key] != "设定" {
					t.Errorf("%s was not preserved", key)
				}
			}
		}
	}
	for _, count := range []int{16, 17} {
		args := map[string]any{"nodeId": "limit", "name": "角色", "imageNodeId": "portrait", "definition": map[string]any{"aliases": make([]string, count)}}
		_, err := prepareCloudAgentCharacterCreate(s.repo, "user", canvas.ID, cloudAgentStoryboardCall(t, "canvas_create_character", "limit", args))
		if (err == nil) != (count == 16) {
			t.Fatalf("aliases count %d: %v", count, err)
		}
	}
	var count int64
	if err := db.Model(&model.Asset{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("preparation created assets: count=%d, err=%v", count, err)
	}
	stored, err := s.repo.CanvasProjectForUser("user", canvas.ID)
	if err != nil || stored.PayloadJSON != canvas.PayloadJSON {
		t.Fatal("preparation changed canvas")
	}
}

func TestCloudAgentCharacterRepairPreservesApproval(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	canvas := &model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"portrait","type":"image","metadata":{"storageKey":"resource:portrait-res"}}],"connections":[]}`}
	for _, item := range []any{canvas, &model.Resource{ID: "portrait-res", UserID: "user", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"}} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	req := agentTestRequest()
	req.PermissionMode = "request_approval"
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	load := func() (*model.CloudAgentExecution, cloudAgentRuntime) {
		t.Helper()
		run, err := s.repo.CloudAgent("user", root.ID)
		if err != nil {
			t.Fatal(err)
		}
		state, err := cloudAgentDecode(run)
		if err != nil {
			t.Fatal(err)
		}
		return run, state
	}
	// 直接在工具检查点注入模型输出，不启动 worker 或调用模型。
	for _, aliases := range []any{map[string]any{"item": []string{"别名甲"}}, []string{"别名甲"}} {
		run, state := load()
		state.ActiveTaskID, state.CallIndex = "", 0
		state.Calls = []cloudAgentCall{cloudAgentStoryboardCall(t, "canvas_create_character", "character-call", map[string]any{
			"nodeId": "character", "name": "角色", "imageNodeId": "portrait", "definition": map[string]any{"aliases": aliases},
		})}
		if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			return cloudAgentSave(current, &state)
		}); err != nil {
			t.Fatal(err)
		}
		run, state = load()
		if err := s.advanceCloudAgentTool(run, &state); err != nil {
			t.Fatal(err)
		}
		run, state = load()
		if _, bad := aliases.(map[string]any); bad {
			if run.Status == "failed" || state.Approval != nil || state.ToolRepairs["canvas_create_character"].Attempt != 1 {
				t.Fatal("invalid character arguments did not enter bounded repair")
			}
		} else if run.Status != "waiting_approval" || state.Approval == nil {
			t.Fatal("corrected character call bypassed approval")
		}
		var count int64
		if err := db.Model(&model.Asset{}).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("unapproved call wrote assets: %d, %v", count, err)
		}
		stored, err := s.repo.CanvasProjectForUser("user", canvas.ID)
		if err != nil || stored.PayloadJSON != canvas.PayloadJSON {
			t.Fatal("unapproved call changed canvas")
		}
	}
	run, state := load()
	if err := s.DecideCloudAgentApproval("user", run.ID, state.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	_, state = load()
	recovered := false
	for _, event := range state.Events {
		retry, _ := event.Payload["retry"].(map[string]any)
		if event.Type == "tool_completed" && retry["status"] == "recovered" {
			recovered = true
		}
	}
	if len(state.ToolRepairs) != 0 || !recovered {
		t.Fatal("approved correction did not resolve repair state")
	}
	var count int64
	if err := db.Model(&model.Asset{}).Where("category = ?", model.AssetCategoryCharacter).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("approved correction must create exactly one character: %d, %v", count, err)
	}
}

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
