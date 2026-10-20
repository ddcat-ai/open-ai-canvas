package app

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

func agentStoryboardImageFixture(t *testing.T) (*Service, *gorm.DB, cloudAgentStoryboardImageArgs) {
	t.Helper()
	s, db, _ := agentMediaFixture(t)
	canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	doc, _ := creationDocument(canvas.PayloadJSON)
	rows := []map[string]any{
		{"id": "row-one", "shotNumber": 1, "durationSeconds": 12, "plotDescription": "小女孩双脚悬空坐在破败王座，父亲在右前方，少年倚远处门框", "imageGenerationPrompt": "破败正殿的体量反差", "shotSize": "中远景", "camera": "35mm低机位", "performanceBlocking": "王座中轴，父亲右前方，少年远门框", "emotion": "严肃喜感", "lightingAndAtmosphere": "冷青天光穿透微尘", "continuityOut": "王座三道裂缝，双脚悬空", "dialogue": "不应烧录到画面的旁白", "audioEffects": "不应烧录到画面的风声", "timeBeats": "不应强制绘制多个时间格", "mustHave": []string{"夜明珠空槽"}, "characters": []map[string]any{{"characterName": "扶颦"}}, "assetBindings": []map[string]any{{"nodeId": "cat", "role": "environment", "priority": 90}}},
		{"id": "row-two", "shotNumber": 2, "durationSeconds": 4, "plotDescription": "下一镜"},
	}
	doc["nodes"] = append(creationMaps(doc["nodes"]), map[string]any{"id": "script", "type": "script", "title": "魔宫分镜", "position": map[string]any{"x": 100, "y": 100}, "width": 920, "metadata": map[string]any{"storyboard": map[string]any{"rows": rows, "referenceNodeIds": []string{}}}}, map[string]any{"id": "image-draft", "type": "image", "title": "镜01已有草稿", "position": map[string]any{"x": 1200, "y": 100}, "width": 360, "metadata": map[string]any{"status": "idle", "prompt": "原草稿"}})
	raw, _ := json.Marshal(doc)
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", canvas.ID).Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	args := cloudAgentStoryboardImageArgs{NodeID: "script", RowID: "row-one", ImageNodeID: "image-draft", SnapshotHash: cloudAgentNodeHash(doc, "script"), ImageSnapshotHash: cloudAgentNodeHash(doc, "image-draft"), Prompt: "完整优化的单帧画面", ReferenceBindings: []cloudAgentStoryboardImageBinding{{NodeID: "hero", Role: "character"}}}
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-test")
	for _, item := range []any{
		&model.ChannelModel{ID: "image-cm", ChannelID: "channel", ModelKey: "gpt-image-test", Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, capability), BillingMode: "fixed_request", PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "image-tier", ChannelModelID: "image-cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	return s, db, args
}

func agentStoryboardImageDocument(t *testing.T, s *Service) map[string]any {
	t.Helper()
	canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

func applyAgentStoryboardImage(t *testing.T, s *Service, args cloudAgentStoryboardImageArgs) map[string]any {
	t.Helper()
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	result, err := applyCloudAgentStoryboardImage(s.repo, "user", "agent-canvas", cloudAgentStoryboardCall(t, "canvas_prepare_storyboard_image", "prepare-image", args), policy, nil)
	if err != nil {
		t.Fatal(err)
	}
	return result.(map[string]any)
}

func TestCloudAgentStoryboardImageReusesDraftAndKeepsCompleteShot(t *testing.T) {
	s, db, args := agentStoryboardImageFixture(t)
	before := agentStoryboardImageDocument(t, s)
	_, _, originalRows, _ := storyboardNodeFromDocument(before, "script")
	result := applyAgentStoryboardImage(t, s, args)
	after := agentStoryboardImageDocument(t, s)
	if result["imageNodeId"] != "image-draft" || result["submitted"] != false || len(creationMaps(after["nodes"])) != len(creationMaps(before["nodes"])) {
		t.Fatal("preparation duplicated a node or claimed generation")
	}
	_, _, rows, _ := storyboardNodeFromDocument(after, "script")
	for key, value := range originalRows[0] {
		if key != "assetBindings" && !reflect.DeepEqual(value, rows[0][key]) {
			t.Fatalf("preparation changed source shot field %s", key)
		}
	}
	prompt := result["prompt"].(string)
	for _, phrase := range []string{"双脚悬空", "35mm低机位", "父亲右前方", "严肃喜感", "冷青天光", "三道裂缝", "夜明珠空槽", "扶颦", "@图片1", "@图片2", "场景空间", "角色身份"} {
		if !strings.Contains(prompt, phrase) {
			t.Fatalf("compiled prompt omitted %s", phrase)
		}
	}
	for _, phrase := range []string{"不应烧录到画面的旁白", "不应烧录到画面的风声", "不应强制绘制多个时间格"} {
		if strings.Contains(prompt, phrase) {
			t.Fatalf("non-visual content was blindly pasted into image prompt: %s", phrase)
		}
	}
	if len(creationMaps(after["connections"])) != 5 || rows[0]["imageNodeId"] != "image-draft" {
		t.Fatal("row input, image references and row output were not linked")
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_image").Count(&count)
	if count != 0 {
		t.Fatal("preparation submitted a billed task")
	}
	args.SnapshotHash, args.ImageSnapshotHash = result["snapshotHash"].(string), result["imageSnapshotHash"].(string)
	applyAgentStoryboardImage(t, s, args)
	if len(creationMaps(agentStoryboardImageDocument(t, s)["connections"])) != 5 {
		t.Fatal("repeated preparation duplicated edges")
	}
}

func TestCloudAgentStoryboardImagePreservesNarrativeInputAndRepairsOnlyItsMissingOutput(t *testing.T) {
	s, db, args := agentStoryboardImageFixture(t)
	doc := agentStoryboardImageDocument(t, s)
	doc["connections"] = []map[string]any{
		{"id": "narrative-input", "fromNodeId": "shot-1", "toNodeId": "script", "toHandleId": "row:row-one"},
		{"id": "missing-output", "fromNodeId": "script", "toNodeId": "deleted-image", "fromHandleId": "row:row-one", "storyboardRowId": "row-one", "relation": "storyboard-output"},
		{"id": "other-missing-output", "fromNodeId": "script", "toNodeId": "other-deleted-image", "fromHandleId": "row:row-two", "storyboardRowId": "row-two", "relation": "storyboard-output"},
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	args.ImageNodeID, args.ImageSnapshotHash = "", ""
	args.SnapshotHash = cloudAgentNodeHash(doc, "script")
	result := applyAgentStoryboardImage(t, s, args)
	if len(result["referenceNodeIds"].([]string)) != 2 || strings.Contains(result["prompt"].(string), "镜头完整指令") {
		t.Fatal("narrative text was injected or treated as an image reference")
	}
	after := agentStoryboardImageDocument(t, s)
	outputs, narrative, other := 0, false, false
	for _, edge := range creationMaps(after["connections"]) {
		if edge["id"] == "missing-output" {
			t.Fatal("missing image retained an invalid output line for this row")
		}
		if edge["id"] == "narrative-input" {
			narrative = true
		}
		if edge["id"] == "other-missing-output" {
			other = true
		}
		if edge["relation"] == "storyboard-output" && edge["storyboardRowId"] == "row-one" {
			outputs++
			if edge["toNodeId"] != result["imageNodeId"] {
				t.Fatal("row output does not point to the prepared image")
			}
		}
	}
	if outputs != 1 || !narrative || !other {
		t.Fatal("preparation deleted narrative/another row or duplicated its output")
	}
	media := cloudAgentMediaArgs{Mode: "image", NodeID: result["imageNodeId"].(string), ReferenceNodeIDs: result["referenceNodeIds"].([]string)}
	if err := validateCloudAgentStoryboardImageInputs(after, media); err != nil {
		t.Fatal(err)
	}
}

func TestCloudAgentStoryboardImageRecoversExistingRowOutputWithoutCreatingAnother(t *testing.T) {
	s, db, args := agentStoryboardImageFixture(t)
	doc := agentStoryboardImageDocument(t, s)
	doc["connections"] = []map[string]any{{"id": "existing-output", "fromNodeId": "script", "toNodeId": "image-draft", "fromHandleId": "row:row-one", "storyboardRowId": "row-one", "relation": "storyboard-output"}}
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	args.ImageNodeID = ""
	args.SnapshotHash = cloudAgentNodeHash(doc, "script")
	plan, result, err := prepareCloudAgentStoryboardImage(s.repo, "user", "agent-canvas", cloudAgentStoryboardCall(t, "canvas_prepare_storyboard_image", "recover-image", args))
	if err != nil {
		t.Fatal(err)
	}
	if result["imageNodeId"] != "image-draft" || len(creationMaps(plan.Document["nodes"])) != len(creationMaps(doc["nodes"])) {
		t.Fatal("existing row output was replaced by another image")
	}
	if plan.BeforeSnapshotHash != cloudAgentCanvasHash(doc) {
		t.Fatal("recovered binding corrupted the before-mutation snapshot")
	}
	if _, _, err := cloudAgentStoryboardImageSource(plan.Document, "image-draft"); err != nil {
		t.Fatal(err)
	}
}

func TestCloudAgentStoryboardImageCreatesOnlyWhenUnbound(t *testing.T) {
	s, _, args := agentStoryboardImageFixture(t)
	args.ImageNodeID, args.ImageSnapshotHash = "", ""
	result := applyAgentStoryboardImage(t, s, args)
	if result["imageNodeId"] == "" || result["imageNodeId"] == "image-draft" {
		t.Fatal("new output must have a real server-assigned ID")
	}
	args.SnapshotHash, args.ImageSnapshotHash = result["snapshotHash"].(string), result["imageSnapshotHash"].(string)
	second := applyAgentStoryboardImage(t, s, args)
	if second["imageNodeId"] != result["imageNodeId"] {
		t.Fatal("bound row created another output on repeated preparation")
	}
}

func TestCloudAgentStoryboardImageRejectsMissingCharacterRepresentation(t *testing.T) {
	s, db, args := agentStoryboardImageFixture(t)
	doc := agentStoryboardImageDocument(t, s)
	_, _, rows, _ := storyboardNodeFromDocument(doc, "script")
	rows[0]["characters"] = []map[string]any{{"characterName": "扶颦", "characterAssetId": "missing-character"}}
	args.SnapshotHash = cloudAgentNodeHash(doc, "script")
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	_, _, err = prepareCloudAgentStoryboardImage(s.repo, "user", "agent-canvas", cloudAgentStoryboardCall(t, "canvas_prepare_storyboard_image", "missing-character", args))
	if err == nil || !strings.Contains(err.Error(), "扶颦") || !strings.Contains(err.Error(), "缺少对应的角色卡或角色图片") {
		t.Fatalf("missing character was silently omitted: %v", err)
	}
	if after := agentStoryboardImageDocument(t, s); cloudAgentCanvasHash(after) != cloudAgentCanvasHash(doc) {
		t.Fatal("missing character changed persisted canvas")
	}
}

func TestCloudAgentStoryboardImageMatchesCharacterImagesByAsset(t *testing.T) {
	for _, scenario := range []struct {
		name     string
		multiple bool
		selectID bool
	}{
		{"single image", false, false},
		{"ambiguous images", true, false},
		{"explicit version", true, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			s, db, args := agentStoryboardImageFixture(t)
			doc := agentStoryboardImageDocument(t, s)
			_, _, rows, _ := storyboardNodeFromDocument(doc, "script")
			rows[0]["characters"] = []map[string]any{{"characterName": "扶颦", "characterAssetId": "character-asset"}}
			nodes, _ := creationObjects(doc["nodes"])
			metadata := nodes["hero"]["metadata"].(map[string]any)
			metadata["workflowKind"], metadata["characterAssetId"] = "character", "character-asset"
			if scenario.multiple {
				doc["nodes"] = append(creationMaps(doc["nodes"]), map[string]any{"id": "hero-other", "type": "image", "title": "另一个角色形象", "metadata": map[string]any{"workflowKind": "character", "characterAssetId": "character-asset", "status": "success", "storageKey": "resource:ref-two"}})
			}
			args.ReferenceBindings = nil
			if scenario.selectID {
				args.ReferenceBindings = []cloudAgentStoryboardImageBinding{{NodeID: "hero", Role: "character"}}
			}
			args.SnapshotHash = cloudAgentNodeHash(doc, "script")
			raw, err := json.Marshal(doc)
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", string(raw)).Error; err != nil {
				t.Fatal(err)
			}
			_, result, err := prepareCloudAgentStoryboardImage(s.repo, "user", "agent-canvas", cloudAgentStoryboardCall(t, "canvas_prepare_storyboard_image", "character-image", args))
			if scenario.multiple && !scenario.selectID {
				if err == nil || !strings.Contains(err.Error(), "多个画布形象或版本") {
					t.Fatalf("ambiguous character was guessed: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			bindings := creationMaps(result["referenceBindings"])
			if len(bindings) != 2 || bindings[1]["nodeId"] != "hero" || bindings[1]["role"] != "character" {
				t.Fatalf("authorized character image was not matched: %+v", bindings)
			}
		})
	}
}

func TestCloudAgentStoryboardImageToolIsScopedAndReportsImageSnapshot(t *testing.T) {
	req := agentTestRequest()
	req.PermissionMode = "read_only"
	for _, tool := range cloudAgentTools(req) {
		if tool["function"].(map[string]any)["name"] == "canvas_prepare_storyboard_image" {
			t.Fatal("read-only run exposed a storyboard write")
		}
	}
	if !cloudAgentWrite("canvas_prepare_storyboard_image") {
		t.Fatal("preparation bypasses write authorization")
	}
	s, _, args := agentStoryboardImageFixture(t)
	result := applyAgentStoryboardImage(t, s, args)
	state := &cloudAgentRuntime{Request: agentTestRequest()}
	view, err := cloudAgentReadTool(s.repo, "user", state, cloudAgentStoryboardCall(t, "canvas_read_storyboard", "read-row", map[string]any{"nodeId": "script", "offset": 0}))
	if err != nil {
		t.Fatal(err)
	}
	storyboard := view.(map[string]any)["storyboard"].(map[string]any)
	rows := creationMaps(storyboard["rows"])
	if len(rows) != 1 || rows[0]["rowId"] != args.RowID || rows[0]["imageSnapshotHash"] != result["imageSnapshotHash"] {
		t.Fatal("precise row read omitted output identity or concurrency snapshot")
	}
}

func TestCloudAgentStoryboardImageRejectsUnsafePreparation(t *testing.T) {
	s, db, original := agentStoryboardImageFixture(t)
	for _, test := range []struct {
		name string
		edit func(*cloudAgentStoryboardImageArgs, map[string]any)
	}{
		{"stale row", func(args *cloudAgentStoryboardImageArgs, _ map[string]any) {
			args.SnapshotHash = strings.Repeat("a", 64)
		}},
		{"stale image", func(args *cloudAgentStoryboardImageArgs, _ map[string]any) {
			args.ImageSnapshotHash = strings.Repeat("b", 64)
		}},
		{"guessed row", func(args *cloudAgentStoryboardImageArgs, _ map[string]any) { args.RowID = "made-up" }},
		{"missing existing image", func(args *cloudAgentStoryboardImageArgs, _ map[string]any) { args.ImageNodeID = "missing" }},
		{"unknown reference", func(args *cloudAgentStoryboardImageArgs, _ map[string]any) {
			args.ReferenceBindings = []cloudAgentStoryboardImageBinding{{NodeID: "missing", Role: "character"}}
		}},
		{"invalid role", func(args *cloudAgentStoryboardImageArgs, _ map[string]any) {
			args.ReferenceBindings = []cloudAgentStoryboardImageBinding{{NodeID: "hero", Role: "audio"}}
		}},
		{"task-bound image", func(_ *cloudAgentStoryboardImageArgs, nodes map[string]any) {
			nodes["image-draft"].(map[string]any)["metadata"].(map[string]any)["taskId"] = "existing-task"
		}},
		{"existing output", func(_ *cloudAgentStoryboardImageArgs, nodes map[string]any) {
			nodes["image-draft"].(map[string]any)["metadata"].(map[string]any)["content"] = "resource:existing"
		}},
		{"locked image", func(_ *cloudAgentStoryboardImageArgs, nodes map[string]any) {
			nodes["image-draft"].(map[string]any)["locked"] = true
		}},
		{"pending approval", func(_ *cloudAgentStoryboardImageArgs, nodes map[string]any) {
			nodes["image-draft"].(map[string]any)["metadata"].(map[string]any)["agentDraftRunId"] = "other-run"
		}},
		{"cross-user resource", func(_ *cloudAgentStoryboardImageArgs, nodes map[string]any) {
			nodes["hero"].(map[string]any)["metadata"].(map[string]any)["storageKey"] = "resource:private"
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			doc := agentStoryboardImageDocument(t, s)
			objects, _ := creationObjects(doc["nodes"])
			nodes := map[string]any{}
			for id, node := range objects {
				nodes[id] = node
			}
			args := original
			args.SnapshotHash, args.ImageSnapshotHash = cloudAgentNodeHash(doc, "script"), cloudAgentNodeHash(doc, "image-draft")
			test.edit(&args, nodes)
			if test.name != "stale image" {
				args.ImageSnapshotHash = cloudAgentNodeHash(doc, "image-draft")
			}
			raw, _ := json.Marshal(doc)
			db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", string(raw))
			if _, _, err := prepareCloudAgentStoryboardImage(s.repo, "user", "agent-canvas", cloudAgentStoryboardCall(t, "canvas_prepare_storyboard_image", "unsafe-image", args)); err == nil {
				t.Fatal("unsafe preparation was accepted")
			}
			if encoded, _ := json.Marshal(agentStoryboardImageDocument(t, s)); string(encoded) != string(raw) {
				t.Fatal("failed preparation changed persisted canvas")
			}
			if target := objects["image-draft"]; target != nil {
				target["locked"] = false
				target["metadata"] = map[string]any{"status": "idle", "prompt": "原草稿"}
			}
			objects["hero"]["metadata"].(map[string]any)["storageKey"] = "resource:ref-two"
			reset, _ := json.Marshal(doc)
			db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", string(reset))
		})
	}
	if _, _, err := prepareCloudAgentStoryboardImage(s.repo, "other", "agent-canvas", cloudAgentStoryboardCall(t, "canvas_prepare_storyboard_image", "foreign", original)); err == nil {
		t.Fatal("cross-user canvas accepted")
	}
}

func TestCloudAgentStoryboardImageGenerationEnforcesShotAndReferences(t *testing.T) {
	s, _, args := agentStoryboardImageFixture(t)
	result := applyAgentStoryboardImage(t, s, args)
	media := cloudAgentMediaArgs{Mode: "image", Prompt: "模型只写了一句话", ChannelID: "channel", ChannelModelKey: "gpt-image-test", Size: "1024x1024", Quality: "high", NodeID: "image-draft", Title: result["title"].(string), SnapshotHash: result["mediaSnapshotHash"].(string), ReferenceNodeIDs: result["referenceNodeIds"].([]string)}
	state := &cloudAgentRuntime{Request: agentTestRequest()}
	run := &model.CloudAgentExecution{ID: "generation-run", UserID: "user"}
	request, _, err := s.prepareCloudAgentMedia(run, state, agentMediaCall(media))
	if err != nil {
		t.Fatal(err)
	}
	if prompt := stringValue(request.Input["prompt"]); !strings.Contains(prompt, "35mm低机位") || !strings.Contains(prompt, "王座三道裂缝") || len(creationMaps(request.Input["referenceImages"])) != 2 {
		t.Fatal("media submission dropped shot requirements or references")
	}
	references := media.ReferenceNodeIDs
	media.ReferenceNodeIDs = []string{references[1], references[0]}
	if _, _, err := s.prepareCloudAgentMedia(run, state, agentMediaCall(media)); err == nil {
		t.Fatal("generation reordered assets and changed reference responsibilities")
	}
	media.ReferenceNodeIDs = references[:1]
	if _, _, err := s.prepareCloudAgentMedia(run, state, agentMediaCall(media)); err == nil {
		t.Fatal("generation silently omitted a bound asset")
	}
}

func TestCloudAgentStoryboardImageApprovalTracksOnlyItsShot(t *testing.T) {
	s, _, args := agentStoryboardImageFixture(t)
	result := applyAgentStoryboardImage(t, s, args)
	media := cloudAgentMediaArgs{Mode: "image", NodeID: "image-draft", ReferenceNodeIDs: result["referenceNodeIds"].([]string)}
	doc := agentStoryboardImageDocument(t, s)
	before, err := cloudAgentMediaDependencyHash(doc, media)
	if err != nil {
		t.Fatal(err)
	}
	_, _, rows, _ := storyboardNodeFromDocument(doc, "script")
	rows[1]["plotDescription"] = "与本镜无关的改动"
	unrelated, _ := cloudAgentMediaDependencyHash(doc, media)
	if unrelated != before {
		t.Fatal("unrelated shot invalidated the prepared media")
	}
	rows[0]["performanceBlocking"] = "父亲改到左方"
	changed, _ := cloudAgentMediaDependencyHash(doc, media)
	if changed == before {
		t.Fatal("changed shot did not invalidate approval")
	}
	rows[0]["imageNodeId"] = "other-output"
	if _, err := cloudAgentMediaDependencyHash(doc, media); err == nil {
		t.Fatal("detached output silently lost its source")
	}
}

func TestCloudAgentStoryboardImagePrepareUsesWriteApproval(t *testing.T) {
	s, db, args := agentStoryboardImageFixture(t)
	req := agentTestRequest()
	req.PermissionMode, req.IdempotencyKey = "request_approval", "storyboard-image-approval"
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	run, state := agentInterjectionState(t, s, root.ID)
	state.ActiveTaskID, state.CallIndex = "", 0
	state.Calls = []cloudAgentCall{cloudAgentStoryboardCall(t, "canvas_prepare_storyboard_image", "prepare-call", args)}
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, root.ID)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	waiting, err := s.CloudAgentRun("user", run.ID)
	if err != nil || waiting.Approval == nil || waiting.Status != "waiting_approval" || waiting.Approval.Preview.Items[0].Operation != "prepare_storyboard_image" {
		t.Fatalf("missing scoped preparation approval: %+v %v", waiting, err)
	}
	if len(creationMaps(agentStoryboardImageDocument(t, s)["connections"])) != 0 {
		t.Fatal("row binding was written before approval")
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, waiting.Approval.ID, "approve", "确认准备"); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	if len(creationMaps(agentStoryboardImageDocument(t, s)["connections"])) != 5 {
		t.Fatal("approved preparation did not link the row and references")
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_image").Count(&count)
	if count != 0 {
		t.Fatal("preparation approval was mistaken for media approval")
	}
}

func TestCloudAgentStoryboardImageRejectsChangedShotAtApproval(t *testing.T) {
	s, db, args := agentStoryboardImageFixture(t)
	result := applyAgentStoryboardImage(t, s, args)
	media := cloudAgentMediaArgs{Mode: "image", Prompt: result["prompt"].(string), ChannelID: "channel", ChannelModelKey: "gpt-image-test", Size: "1024x1024", Quality: "high", NodeID: "image-draft", Title: result["title"].(string), SnapshotHash: result["mediaSnapshotHash"].(string), ReferenceNodeIDs: result["referenceNodeIds"].([]string)}
	run, _ := agentMediaRun(t, s, media, "auto")
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	waiting, err := s.CloudAgentRun("user", run.ID)
	if err != nil || waiting.Approval == nil || waiting.Status != "waiting_approval" {
		t.Fatalf("missing media approval: %+v %v", waiting, err)
	}
	doc := agentStoryboardImageDocument(t, s)
	_, _, rows, _ := storyboardNodeFromDocument(doc, "script")
	rows[0]["performanceBlocking"] = "父亲改到左方"
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, waiting.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	_, state := agentInterjectionState(t, s, run.ID)
	var count int64
	if err := db.Model(&model.Task{}).Where("type = ?", "canvas_image").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 || state.MediaTaskID != "" || state.Generations != 0 || state.CallIndex != 1 {
		t.Fatalf("changed shot bypassed approval validation: tasks=%d state=%+v", count, state)
	}
	for _, event := range state.Events {
		detail, _ := event.Payload["result"].(map[string]any)
		if event.Type == "tool_failed" && detail["reason"] == "snapshot_conflict" {
			return
		}
	}
	t.Fatal("changed shot did not report a stale generation approval")
}

func TestCloudAgentStoryboardImageMediaApprovalAndWritebackKeepRow(t *testing.T) {
	s, db, args := agentStoryboardImageFixture(t)
	result := applyAgentStoryboardImage(t, s, args)
	media := cloudAgentMediaArgs{Mode: "image", Prompt: result["prompt"].(string), ChannelID: "channel", ChannelModelKey: "gpt-image-test", Size: "1024x1024", Quality: "high", NodeID: "image-draft", Title: result["title"].(string), SnapshotHash: result["mediaSnapshotHash"].(string), ReferenceNodeIDs: result["referenceNodeIds"].([]string)}
	run, _ := agentMediaRun(t, s, media, "auto")
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	waiting, err := s.CloudAgentRun("user", run.ID)
	if err != nil || waiting.Approval == nil || waiting.Status != "waiting_approval" {
		t.Fatalf("auto bypassed independent media approval: %+v %v", waiting, err)
	}
	if len(creationMaps(agentStoryboardImageDocument(t, s)["connections"])) != 5 {
		t.Fatal("creating the approval draft removed storyboard output")
	}
	approveAgentMediaDraft(t, s, run.ID)
	run, state := agentInterjectionState(t, s, run.ID)
	if state.MediaTaskID == "" {
		t.Fatalf("media was not submitted after approval: %+v", state.Events)
	}
	if err := db.Create(&model.Resource{ID: "shot-output", UserID: "user", Kind: "image", Status: "ready", MimeType: "image/png", Width: 640, Height: 480}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", state.MediaTaskID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": "{\"mode\":\"image\",\"images\":[{\"storageKey\":\"resource:shot-output\"}]}"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	doc := agentStoryboardImageDocument(t, s)
	nodes, _ := creationObjects(doc["nodes"])
	meta := nodes["image-draft"]["metadata"].(map[string]any)
	if meta["status"] != "success" || meta["storageKey"] != "resource:shot-output" || meta["workflowKind"] != "shot" {
		t.Fatalf("result not written to the shot image: %#v", meta)
	}
	_, _, rows, _ := storyboardNodeFromDocument(doc, "script")
	if rows[0]["imageNodeId"] != "image-draft" || len(creationMaps(doc["connections"])) != 5 {
		t.Fatal("completion detached the image from its row or references")
	}
}
