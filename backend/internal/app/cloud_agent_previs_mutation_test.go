package app

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func previsMutationFixture(t *testing.T) (*Service, *model.CanvasProject) {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	canvas := &model.CanvasProject{
		ID:          "previs-canvas",
		UserID:      "user",
		Title:       "预演测试画布",
		PayloadJSON: `{"nodes":[],"connections":[],"previsScenes":[]}`,
	}
	if err := db.Create(canvas).Error; err != nil {
		t.Fatal(err)
	}
	return s, canvas
}

func previsMutationCall(t *testing.T, id, name string, args any) cloudAgentCall {
	t.Helper()
	raw, err := json.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	call := cloudAgentCall{ID: id}
	call.Function.Name = name
	call.Function.Arguments = string(raw)
	return call
}

func previsResultString(t *testing.T, result any, key string) string {
	t.Helper()
	payload, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("result is not an object: %#v", result)
	}
	value, ok := payload[key].(string)
	if !ok || value == "" {
		t.Fatalf("result.%s = %#v", key, payload[key])
	}
	return value
}

func TestCloudAgentPrevisSceneCreateAndPatchKeepSemanticAndCanvasHashesSeparate(t *testing.T) {
	s, canvas := previsMutationFixture(t)
	req := agentTestRequest()
	req.CanvasID = canvas.ID
	req.PermissionMode = "auto"
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	beforeDoc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	beforeCanvasHash := cloudAgentCanvasHash(beforeDoc)
	createCall := previsMutationCall(t, "previs-create-1", "previs_scene_create", map[string]any{
		"canvasSnapshotHash": beforeCanvasHash,
		"sceneId":            "scene-1",
		"title":              "客厅对白",
		"templateId":         "dialogue",
	})
	createResult, err := applyCloudAgentPrevisMutation(s.repo, "user", canvas.ID, createCall, policy, cloudAgentMutationRecorderForRun(run.ID))
	if err != nil {
		t.Fatal(err)
	}
	createdSceneHash := previsResultString(t, createResult, "snapshotHash")
	createdCanvasHash := previsResultString(t, createResult, "canvasSnapshotHash")
	if createdCanvasHash == beforeCanvasHash || createdSceneHash == createdCanvasHash {
		t.Fatalf("scene and canvas hashes were not separated: scene=%s canvas=%s before=%s", createdSceneHash, createdCanvasHash, beforeCanvasHash)
	}

	stored, err := s.repo.CanvasProjectForUser("user", canvas.ID)
	if err != nil {
		t.Fatal(err)
	}
	createdDoc, err := creationDocument(stored.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	scene, ok := findPrevisScene(creationMaps(createdDoc["previsScenes"]), "scene-1")
	if !ok {
		t.Fatal("created scene missing")
	}
	if creationHash(scene) != createdSceneHash || cloudAgentCanvasHash(createdDoc) != createdCanvasHash {
		t.Fatalf("returned hashes do not match persisted values: scene=%s/%s canvas=%s/%s", createdSceneHash, creationHash(scene), createdCanvasHash, cloudAgentCanvasHash(createdDoc))
	}

	patchCall := previsMutationCall(t, "previs-patch-1", "previs_apply_patch", map[string]any{
		"snapshotHash": createdSceneHash,
		"sceneId":      "scene-1",
		"operations": []map[string]any{{
			"type":      "object_add",
			"id":        "actor-1",
			"kind":      "actor",
			"primitive": "character",
			"name":      "演员甲",
			"position":  []float64{0, 0, 0},
			"color":     "#f1f3f5",
		}},
	})
	patchResult, err := applyCloudAgentPrevisMutation(s.repo, "user", canvas.ID, patchCall, policy, cloudAgentMutationRecorderForRun(run.ID))
	if err != nil {
		t.Fatal(err)
	}
	patchedSceneHash := previsResultString(t, patchResult, "snapshotHash")
	patchedCanvasHash := previsResultString(t, patchResult, "canvasSnapshotHash")
	if patchedSceneHash == createdSceneHash || patchedCanvasHash == createdCanvasHash {
		t.Fatalf("patch did not advance both hashes: scene=%s->%s canvas=%s->%s", createdSceneHash, patchedSceneHash, createdCanvasHash, patchedCanvasHash)
	}

	stored, err = s.repo.CanvasProjectForUser("user", canvas.ID)
	if err != nil {
		t.Fatal(err)
	}
	patchedDoc, err := creationDocument(stored.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	patchedScene, _ := findPrevisScene(creationMaps(patchedDoc["previsScenes"]), "scene-1")
	if creationHash(patchedScene) != patchedSceneHash || cloudAgentCanvasHash(patchedDoc) != patchedCanvasHash {
		t.Fatalf("patch hashes do not match persisted values")
	}
	if cloudAgentPrevisFindByID(creationMaps(patchedScene["objects"]), "actor-1") == nil {
		t.Fatalf("semantic patch did not add actor: %#v", patchedScene["objects"])
	}

	mutation, err := s.repo.LatestCloudAgentCanvasMutation("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if mutation.Operation != "previs_apply_patch" || mutation.BeforeSnapshotHash != createdCanvasHash || mutation.AfterSnapshotHash != patchedCanvasHash {
		t.Fatalf("mutation recorded scene hash instead of canvas hash: %+v", mutation)
	}
	undoResult, err := s.UndoCloudAgentCanvas("user", run.ID, patchCall.ID, patchedCanvasHash, "测试撤销")
	if err != nil {
		t.Fatal(err)
	}
	if undoResult["accepted"] != true || undoResult["snapshotHash"] != createdCanvasHash {
		t.Fatalf("unexpected previs undo result: %+v", undoResult)
	}
}

func TestCloudAgentPrevisRejectsStaleSnapshotsAndCrossUserCanvas(t *testing.T) {
	s, canvas := previsMutationFixture(t)
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	staleCreate := previsMutationCall(t, "stale-create", "previs_scene_create", map[string]any{
		"canvasSnapshotHash": strings.Repeat("0", 64),
		"sceneId":            "scene-stale",
		"title":              "过期",
		"templateId":         "empty",
	})
	_, err = prepareCloudAgentPrevisSceneCreate(s.repo, "user", canvas.ID, staleCreate)
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Status != 409 {
		t.Fatalf("stale canvas snapshot should conflict, got %v", err)
	}

	validCreate := previsMutationCall(t, "create-for-stale-patch", "previs_scene_create", map[string]any{
		"canvasSnapshotHash": cloudAgentCanvasHash(doc),
		"sceneId":            "scene-stale",
		"title":              "场景",
		"templateId":         "empty",
	})
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = applyCloudAgentPrevisMutation(s.repo, "user", canvas.ID, validCreate, policy); err != nil {
		t.Fatal(err)
	}
	stored, err := s.repo.CanvasProjectForUser("user", canvas.ID)
	if err != nil {
		t.Fatal(err)
	}
	storedDoc, _ := creationDocument(stored.PayloadJSON)
	scene, _ := findPrevisScene(creationMaps(storedDoc["previsScenes"]), "scene-stale")
	patch := previsMutationCall(t, "stale-patch", "previs_apply_patch", map[string]any{
		"snapshotHash": strings.Repeat("1", 64),
		"sceneId":      "scene-stale",
		"operations":   []map[string]any{{"type": "scene_update", "id": "scene-stale", "title": "不应写入"}},
	})
	_, err = prepareCloudAgentPrevisApplyPatch(s.repo, "user", canvas.ID, patch)
	if !errors.As(err, &appErr) || appErr.Status != 409 {
		t.Fatalf("stale scene snapshot should conflict, got %v", err)
	}
	if stringValue(scene["title"]) != "场景" {
		t.Fatalf("stale patch mutated scene in memory or persistence: %#v", scene)
	}

	_, err = prepareCloudAgentPrevisSceneCreate(s.repo, "other-user", canvas.ID, validCreate)
	if err == nil {
		t.Fatal("cross-user canvas access was accepted")
	}
}

func TestCloudAgentPrevisNormalizesLegacyCSSColorsBeforeValidation(t *testing.T) {
	scene := map[string]any{
		"id": "scene", "version": 1, "title": "场景", "background": "rgb(255, 70, 74)", "environmentIntensity": 0.7,
		"objects":      []any{map[string]any{"id": "object", "name": "球体", "kind": "primitive", "primitive": "sphere", "color": "rgb(255,70,74)", "transform": map[string]any{"position": []any{0, 0, 0}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}}},
		"cameras":      []any{map[string]any{"id": "camera", "name": "摄影机", "focalLength": 35, "target": []any{0, 1, 0}, "transform": map[string]any{"position": []any{0, 1, 3}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}}},
		"lights":       []any{map[string]any{"id": "light", "name": "主光", "type": "point", "color": "rgba(255, 255, 255, 0.5)", "intensity": 1, "transform": map[string]any{"position": []any{0, 2, 0}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}}},
		"shots":        []any{map[string]any{"id": "shot", "name": "镜头 1", "cameraId": "camera", "duration": 5, "fps": 24, "shotSize": "medium", "cameraMove": "static", "prompt": ""}},
		"activeShotId": "shot",
	}
	if err := cloudAgentPrevisValidateScene(scene); err != nil {
		t.Fatal(err)
	}
	if got := scene["background"]; got != "#ff464a" {
		t.Fatalf("background = %#v, want #ff464a", got)
	}
	object := creationMaps(scene["objects"])[0]
	if got := object["color"]; got != "#ff464a" {
		t.Fatalf("object color = %#v, want #ff464a", got)
	}
	light := creationMaps(scene["lights"])[0]
	if got := light["color"]; got != "#ffffff80" {
		t.Fatalf("light color = %#v, want #ffffff80", got)
	}
}

func TestCloudAgentPrevisColorSchemaRejectsNonHexInput(t *testing.T) {
	if err := cloudAgentPrevisValidateColor("rgb(255,70,74)", "对象颜色"); err == nil {
		t.Fatal("non-hex agent color was accepted")
	}
	if err := cloudAgentPrevisValidateColor("#ff464a", "对象颜色"); err != nil {
		t.Fatalf("valid hex agent color rejected: %v", err)
	}
}

func TestCloudAgentPrevisCatalogReadAndToolPermissions(t *testing.T) {
	s, canvas := previsMutationFixture(t)
	catalogCall := cloudAgentCall{ID: "catalog"}
	catalogCall.Function.Name = "previs_scene_read"
	catalogCall.Function.Arguments = `{}`
	result, err := cloudAgentPrevisSceneRead(s.repo, "user", canvas.ID, catalogCall)
	if err != nil {
		t.Fatal(err)
	}
	catalog, ok := result.(map[string]any)
	if !ok || catalog["canvasSnapshotHash"] != cloudAgentCanvasHash(mustCreationDocument(t, canvas.PayloadJSON)) {
		t.Fatalf("catalog did not return a usable canvasSnapshotHash: %#v", result)
	}

	readOnly := CloudAgentRequest{PermissionMode: "read_only", ContextScope: []string{"canvas"}}
	if !cloudAgentToolAllowed(readOnly, "previs_scene_read") {
		t.Fatal("read-only mode lost semantic Previs read")
	}
	if cloudAgentToolAllowed(readOnly, "previs_scene_create") || cloudAgentToolAllowed(readOnly, "previs_apply_patch") {
		t.Fatal("read-only mode exposed Previs writes")
	}
	auto := CloudAgentRequest{PermissionMode: "auto", ContextScope: []string{"canvas"}}
	if !cloudAgentToolAllowed(auto, "previs_scene_create") || !cloudAgentToolAllowed(auto, "previs_apply_patch") {
		t.Fatal("auto mode did not expose Previs writes")
	}
	_ = s
}

func TestCloudAgentPrevisPatchLimitsAndClosedArguments(t *testing.T) {
	call := cloudAgentCall{ID: "invalid"}
	call.Function.Name = "previs_apply_patch"
	call.Function.Arguments = `{"snapshotHash":"snapshot","sceneId":"scene","operations":[{"type":"scene_update","id":"scene","rawScene":{"nodes":[]}}]}`
	var args cloudAgentPrevisApplyPatchArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err == nil {
		t.Fatal("raw scene replacement field was accepted")
	}

	operations := make([]map[string]any, cloudAgentPrevisMaxOperations+1)
	for index := range operations {
		operations[index] = map[string]any{"type": "scene_update", "id": "scene"}
	}
	call = previsMutationCall(t, "too-many", "previs_apply_patch", map[string]any{"snapshotHash": "snapshot", "sceneId": "scene", "operations": operations})
	if _, err := prepareCloudAgentPrevisApplyPatch(nil, "user", "canvas", call); err == nil {
		t.Fatal("oversized Previs patch was accepted")
	}

	if _, err := cloudAgentPrevisSceneCreateTemplate(cloudAgentPrevisSceneCreateArgs{SceneID: "scene", Title: "场景", TemplateID: "unknown"}); err == nil {
		t.Fatal("unknown Previs template was accepted")
	}
}

func TestCloudAgentPrevisCharacterBindingAndAnimationPatch(t *testing.T) {
	s, canvas := previsMutationFixture(t)
	canvas.PayloadJSON = `{"nodes":[{"id":"hero-card","type":"text","metadata":{"workflowKind":"character","characterAssetId":"hero-asset","characterVersionId":"hero-v1"}}],"connections":[],"previsScenes":[]}`
	if err := s.repo.Save(canvas); err != nil {
		t.Fatal(err)
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	create := previsMutationCall(t, "binding-create", "previs_scene_create", map[string]any{
		"canvasSnapshotHash": cloudAgentCanvasHash(doc), "sceneId": "binding-scene", "title": "绑定动画", "templateId": "empty",
	})
	if _, err := applyCloudAgentPrevisMutation(s.repo, "user", canvas.ID, create, policy); err != nil {
		t.Fatal(err)
	}
	stored, err := s.repo.CanvasProjectForUser("user", canvas.ID)
	if err != nil {
		t.Fatal(err)
	}
	storedDoc, _ := creationDocument(stored.PayloadJSON)
	scene, _ := findPrevisScene(creationMaps(storedDoc["previsScenes"]), "binding-scene")
	sceneHash := creationHash(scene)
	patch := previsMutationCall(t, "binding-patch", "previs_apply_patch", map[string]any{
		"snapshotHash": sceneHash, "sceneId": "binding-scene", "operations": []map[string]any{
			{"type": "object_add", "id": "hero-actor", "kind": "actor", "primitive": "character", "name": "主角", "characterAssetId": "hero-asset", "characterVersionId": "hero-v1", "referenceNodeId": "hero-card", "characterName": "主角", "position": []float64{0, 0, 0}},
		},
	})
	result, err := applyCloudAgentPrevisMutation(s.repo, "user", canvas.ID, patch, policy)
	if err != nil {
		t.Fatal(err)
	}
	stored, err = s.repo.CanvasProjectForUser("user", canvas.ID)
	if err != nil {
		t.Fatal(err)
	}
	storedDoc, _ = creationDocument(stored.PayloadJSON)
	scene, _ = findPrevisScene(creationMaps(storedDoc["previsScenes"]), "binding-scene")
	actor := cloudAgentPrevisFindByID(creationMaps(scene["objects"]), "hero-actor")
	binding, ok := actor["characterBinding"].(map[string]any)
	if !ok || stringValue(binding["characterAssetId"]) != "hero-asset" || stringValue(actor["sourceNodeId"]) != "hero-card" {
		t.Fatalf("character binding was not persisted: %#v", actor)
	}

	animationPatch := previsMutationCall(t, "animation-patch", "previs_apply_patch", map[string]any{
		"snapshotHash": previsResultString(t, result, "snapshotHash"), "sceneId": "binding-scene", "operations": []map[string]any{
			{"type": "object_keyframe_upsert", "id": "hero-actor", "time": 2, "position": []float64{1, 0, 0}, "easing": "smooth"},
			{"type": "object_motion_path_set", "id": "hero-actor", "pathPoints": [][]float64{{0, 0, 0}, {1, 0, 0}, {2, 0, 0}}, "pathSpeed": "walk", "orientToPath": true},
		},
	})
	if _, err := applyCloudAgentPrevisMutation(s.repo, "user", canvas.ID, animationPatch, policy); err != nil {
		t.Fatal(err)
	}
	stored, err = s.repo.CanvasProjectForUser("user", canvas.ID)
	if err != nil {
		t.Fatal(err)
	}
	storedDoc, _ = creationDocument(stored.PayloadJSON)
	scene, _ = findPrevisScene(creationMaps(storedDoc["previsScenes"]), "binding-scene")
	actor = cloudAgentPrevisFindByID(creationMaps(scene["objects"]), "hero-actor")
	if len(creationMaps(actor["keyframes"])) != 1 || actor["motionPath"] == nil {
		t.Fatalf("animation patch was not persisted: %#v", actor)
	}
}

func TestCloudAgentPrevisRejectsMismatchedCharacterBinding(t *testing.T) {
	s, canvas := previsMutationFixture(t)
	canvas.PayloadJSON = `{"nodes":[{"id":"hero-card","type":"text","metadata":{"workflowKind":"character","characterAssetId":"hero-asset","characterVersionId":"hero-v1"}}],"connections":[],"previsScenes":[]}`
	if err := s.repo.Save(canvas); err != nil {
		t.Fatal(err)
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	doc, _ := creationDocument(canvas.PayloadJSON)
	create := previsMutationCall(t, "mismatch-create", "previs_scene_create", map[string]any{"canvasSnapshotHash": cloudAgentCanvasHash(doc), "sceneId": "mismatch-scene", "title": "错误绑定", "templateId": "empty"})
	if _, err := applyCloudAgentPrevisMutation(s.repo, "user", canvas.ID, create, policy); err != nil {
		t.Fatal(err)
	}
	stored, _ := s.repo.CanvasProjectForUser("user", canvas.ID)
	storedDoc, _ := creationDocument(stored.PayloadJSON)
	scene, _ := findPrevisScene(creationMaps(storedDoc["previsScenes"]), "mismatch-scene")
	patch := previsMutationCall(t, "mismatch-patch", "previs_apply_patch", map[string]any{"snapshotHash": creationHash(scene), "sceneId": "mismatch-scene", "operations": []map[string]any{{"type": "object_add", "id": "bad-actor", "kind": "actor", "characterAssetId": "other-asset", "characterVersionId": "hero-v1", "referenceNodeId": "hero-card"}}})
	if _, err := applyCloudAgentPrevisMutation(s.repo, "user", canvas.ID, patch, policy); err == nil {
		t.Fatal("mismatched character binding was accepted")
	}
}
func TestCloudAgentPrevisAnimationOperationsRespectShotDurationAndRemoval(t *testing.T) {
	scene, err := cloudAgentPrevisSceneCreateTemplate(cloudAgentPrevisSceneCreateArgs{SceneID: "animation-scene", Title: "动画边界", TemplateID: "monologue"})
	if err != nil {
		t.Fatal(err)
	}
	actor := cloudAgentPrevisFindByID(creationMaps(scene["objects"]), "animation-scene-actor-1")
	camera := cloudAgentPrevisFindByID(creationMaps(scene["cameras"]), "animation-scene-camera-1")
	if actor == nil || camera == nil {
		t.Fatal("animation fixture is missing actor or camera")
	}

	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{
		Type: "object_keyframe_upsert", ID: actor["id"].(string), Time: float64Ptr(5), Position: vec3Ptr([]float64{1, 0, 0}),
	}, 0); err != nil {
		t.Fatalf("object keyframe at shot end rejected: %v", err)
	}
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{
		Type: "camera_keyframe_upsert", ID: camera["id"].(string), Time: float64Ptr(5), Position: vec3Ptr([]float64{2, 1, 4}),
	}, 1); err != nil {
		t.Fatalf("camera keyframe at shot end rejected: %v", err)
	}
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{
		Type: "object_motion_path_set", ID: actor["id"].(string), PathPoints: [][]float64{{0, 0, 0}, {1, 0, 0}}, StartDelay: float64Ptr(5),
	}, 2); err != nil {
		t.Fatalf("motion path at shot end rejected: %v", err)
	}

	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{
		Type: "object_keyframe_upsert", ID: actor["id"].(string), Time: float64Ptr(5.01), Position: vec3Ptr([]float64{2, 0, 0}),
	}, 3); err == nil {
		t.Fatal("object keyframe beyond active shot duration was accepted")
	}
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{
		Type: "camera_keyframe_upsert", ID: camera["id"].(string), Time: float64Ptr(5.01), Position: vec3Ptr([]float64{3, 1, 4}),
	}, 4); err == nil {
		t.Fatal("camera keyframe beyond active shot duration was accepted")
	}
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{
		Type: "object_motion_path_set", ID: actor["id"].(string), PathPoints: [][]float64{{0, 0, 0}, {1, 0, 0}}, StartDelay: float64Ptr(5.01),
	}, 5); err == nil {
		t.Fatal("motion path beyond active shot duration was accepted")
	}

	objectKeyframeID := stringValue(creationMaps(actor["keyframes"])[0]["id"])
	cameraKeyframeID := stringValue(creationMaps(camera["keyframes"])[0]["id"])
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "object_keyframe_remove", ID: actor["id"].(string), KeyframeID: previsStringPtr(objectKeyframeID)}, 6); err != nil {
		t.Fatalf("object keyframe removal failed: %v", err)
	}
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "camera_keyframe_remove", ID: camera["id"].(string), KeyframeID: previsStringPtr(cameraKeyframeID)}, 7); err != nil {
		t.Fatalf("camera keyframe removal failed: %v", err)
	}
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "object_motion_path_clear", ID: actor["id"].(string)}, 8); err != nil {
		t.Fatalf("motion path clear failed: %v", err)
	}
	if len(creationMaps(actor["keyframes"])) != 0 || len(creationMaps(camera["keyframes"])) != 0 || actor["motionPath"] != nil {
		t.Fatalf("animation removal did not clear state: actor=%#v camera=%#v", actor, camera)
	}
}

func float64Ptr(value float64) *float64 { return &value }

func previsStringPtr(value string) *string { return &value }

func vec3Ptr(value []float64) *[]float64 { return &value }

func TestCloudAgentPrevisApprovalRoundTripUsesSharedAgentGate(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	canvas := model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[],"connections":[],"previsScenes":[]}`}
	if err := db.Create(&canvas).Error; err != nil {
		t.Fatal(err)
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
	advance := func() {
		t.Helper()
		if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
			t.Fatal(err)
		}
	}
	_, initialState := load()
	if initialState.ActiveTaskID == "" {
		t.Fatal("missing continuation model task")
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	call := previsMutationCall(t, "approval-previs-create", "previs_scene_create", map[string]any{
		"canvasSnapshotHash": cloudAgentCanvasHash(doc),
		"sceneId":            "approval-scene",
		"title":              "审批场景",
		"templateId":         "empty",
	})
	body, err := json.Marshal(map[string]any{"toolCalls": []cloudAgentCall{call}})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", initialState.ActiveTaskID).Updates(map[string]any{
		"status":      model.TaskStatusSucceeded,
		"result_json": string(body),
	}).Error; err != nil {
		t.Fatal(err)
	}
	advance()
	advance()
	waiting, state := load()
	if waiting.Status != "waiting_approval" || state.Approval == nil {
		t.Fatalf("Previs write did not enter approval: status=%s approval=%+v", waiting.Status, state.Approval)
	}
	if state.Approval.CallHash != cloudAgentApprovalCallHash(call) {
		t.Fatalf("approval hash does not bind the original Previs call: got=%s want=%s", state.Approval.CallHash, cloudAgentApprovalCallHash(call))
	}
	before := canvas.PayloadJSON
	if err := s.DecideCloudAgentApproval("user", root.ID, state.Approval.ID, "approve", "确认预演场景"); err != nil {
		t.Fatal(err)
	}
	advance()
	stored, err := s.repo.CanvasProjectForUser("user", canvas.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.PayloadJSON == before {
		t.Fatal("approved Previs write did not persist")
	}
	storedDoc, _ := creationDocument(stored.PayloadJSON)
	if _, ok := findPrevisScene(creationMaps(storedDoc["previsScenes"]), "approval-scene"); !ok {
		t.Fatal("approved Previs scene missing")
	}
}

func mustCreationDocument(t *testing.T, raw string) map[string]any {
	t.Helper()
	doc, err := creationDocument(raw)
	if err != nil {
		t.Fatal(err)
	}
	return doc
}
