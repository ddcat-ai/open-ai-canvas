package app

import (
	"strings"
	"testing"
)

func previsCameraTestScene(t *testing.T) map[string]any {
	t.Helper()
	scene, err := cloudAgentPrevisSceneCreateTemplate(cloudAgentPrevisSceneCreateArgs{SceneID: "s", Title: "运镜", TemplateID: "monologue"})
	if err != nil {
		t.Fatal(err)
	}
	if cloudAgentPrevisFindByID(creationMaps(scene["objects"]), "s-actor-1") == nil {
		t.Fatalf("monologue template must contain s-actor-1: %#v", scene["objects"])
	}
	return scene
}

func previsCameraMoves(t *testing.T, scene map[string]any) []map[string]any {
	t.Helper()
	return creationMaps(cloudAgentPrevisFindByID(creationMaps(scene["cameras"]), "s-camera-1")["moves"])
}

// 「镜头跟随御剑飞行的人物，后半段环绕，全程手持」：Agent 按手法写运镜段，后端校验白名单、时长与主体。
func TestCloudAgentPrevisCameraMoveWritesSemanticSegments(t *testing.T) {
	scene := previsCameraTestScene(t)
	shotDuration := cloudAgentPrevisShotDuration(scene)
	apply := func(operation cloudAgentPrevisPatchOperation) (string, error) {
		item, err := cloudAgentPrevisApplyPatchOperation(scene, operation, 0)
		return item.Summary, err
	}

	summary, err := apply(cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "push_in"})
	if err != nil {
		t.Fatal(err)
	}
	moves := previsCameraMoves(t, scene)
	if len(moves) != 1 || stringValue(moves[0]["technique"]) != "push_in" || numberValue(moves[0]["start"], -1) != 0 || numberValue(moves[0]["duration"], 0) != shotDuration {
		t.Fatalf("push_in must default to the whole shot: %#v", moves)
	}
	if !strings.Contains(summary, "push_in") || !strings.Contains(summary, "主摄影机") {
		t.Fatalf("summary must name camera and technique: %s", summary)
	}

	subject := "s-actor-1"
	start, length := 1.0, 3.0
	if _, err := apply(cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "follow", Time: &start, Duration: &length}); err == nil || !strings.Contains(err.Error(), "subjectId") {
		t.Fatalf("follow without subject must be rejected, got %v", err)
	}
	summary, err = apply(cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "follow", SubjectID: &subject, Time: &start, Duration: &length, Easing: "linear", Params: map[string]any{"side": "behind", "distance": 6.0, "lag": 0.35}})
	if err != nil {
		t.Fatal(err)
	}
	moves = previsCameraMoves(t, scene)
	follow := moves[1]
	if len(moves) != 2 || stringValue(follow["technique"]) != "follow" {
		t.Fatalf("moves must stay sorted by start: %#v", moves)
	}
	params, _ := follow["params"].(map[string]any)
	if stringValue(follow["subjectId"]) != subject || stringValue(follow["easing"]) != "linear" || stringValue(params["side"]) != "behind" || numberValue(params["distance"], 0) != 6 || numberValue(follow["start"], 0) != 1 {
		t.Fatalf("follow segment wrong: %#v", follow)
	}
	if !strings.Contains(summary, "主体《") || strings.Contains(summary, "（随演员") {
		t.Fatalf("summary must name the followed subject and keep only the short technique name: %s", summary)
	}
	if _, err := apply(cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "handheld", Params: map[string]any{"intensity": 1.4}}); err != nil {
		t.Fatal(err)
	}
	// 叠加层默认时长：shake 0.6 秒，不铺满整个镜头。
	shakeStart := 2.0
	if _, err := apply(cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "shake", Time: &shakeStart}); err != nil {
		t.Fatal(err)
	}
	if shake := previsCameraMoves(t, scene)[3]; stringValue(shake["technique"]) != "shake" || numberValue(shake["duration"], 0) != 0.6 {
		t.Fatalf("shake must default to 0.6s: %#v", previsCameraMoves(t, scene))
	}

	bad := []struct {
		name      string
		operation cloudAgentPrevisPatchOperation
		want      string
	}{
		{"unknown technique", cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "teleport_cam"}, "catalog.cameraMoves"},
		{"unknown param", cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "pan_left", Params: map[string]any{"speed": 2.0}}, "不支持参数"},
		{"param out of range", cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "follow", SubjectID: &subject, Params: map[string]any{"distance": 500.0}}, "distance"},
		{"bad side", cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "follow", SubjectID: &subject, Params: map[string]any{"side": "under"}}, "side"},
		{"string number", cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "push_in", Params: map[string]any{"distance": "2"}}, "distance"},
		{"subject on plain move", cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "pan_left", SubjectID: &subject}, "不需要 subjectId"},
		{"missing subject object", cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "look_at", SubjectID: previsStringPtr("ghost")}, "不存在"},
		{"step easing", cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "pan_left", Easing: "step"}, "easing"},
		{"past shot end", cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "orbit_left", Time: float64Ptr(shotDuration - 1), Duration: float64Ptr(3)}, "超出镜头时长"},
		{"unknown camera", cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "ghost-camera", Technique: "push_in"}, "摄影机"},
	}
	for _, item := range bad {
		if _, err := apply(item.operation); err == nil || !strings.Contains(err.Error(), item.want) {
			t.Fatalf("%s: want error containing %q, got %v", item.name, item.want, err)
		}
	}

	// 同一 keyframeId 覆盖原段，不新增。
	firstID := stringValue(previsCameraMoves(t, scene)[0]["id"])
	if _, err := apply(cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "pull_out", KeyframeID: &firstID}); err != nil {
		t.Fatal(err)
	}
	if moves := previsCameraMoves(t, scene); len(moves) != 4 || stringValue(moves[0]["technique"]) != "pull_out" || stringValue(moves[0]["id"]) != firstID {
		t.Fatalf("keyframeId must replace the existing move: %#v", moves)
	}
	if err := cloudAgentPrevisValidateScene(scene); err != nil {
		t.Fatalf("scene with camera moves invalid: %v", err)
	}

	// 读场景时把运镜段交给 Agent，才能在已有运镜上继续或按 id 删除。
	var projected []map[string]any
	for _, camera := range projectPrevisScene(scene, "", nil)["cameras"].([]map[string]any) {
		if camera["id"] == "s-camera-1" {
			projected, _ = camera["moves"].([]map[string]any)
		}
	}
	projectedFollow := false
	for _, move := range projected {
		if move["technique"] == "follow" && move["subjectId"] == subject {
			projectedFollow = true
		}
	}
	if len(projected) != 4 || !projectedFollow {
		t.Fatalf("camera moves must be projected: %#v", projected)
	}

	if _, err := apply(cloudAgentPrevisPatchOperation{Type: "camera_move_remove", ID: "s-camera-1", KeyframeID: previsStringPtr("missing")}); err == nil {
		t.Fatal("removing an unknown move must fail")
	}
	if _, err := apply(cloudAgentPrevisPatchOperation{Type: "camera_move_remove", ID: "s-camera-1", KeyframeID: &firstID}); err != nil {
		t.Fatal(err)
	}
	if moves := previsCameraMoves(t, scene); len(moves) != 3 {
		t.Fatalf("remove by id must drop one move: %#v", moves)
	}
	if _, err := apply(cloudAgentPrevisPatchOperation{Type: "camera_move_remove", ID: "s-camera-1"}); err != nil {
		t.Fatal(err)
	}
	if _, exists := cloudAgentPrevisFindByID(creationMaps(scene["cameras"]), "s-camera-1")["moves"]; exists {
		t.Fatal("remove without keyframeId must clear all moves")
	}

	for index := 0; index < cloudAgentPrevisMaxCameraMoves; index++ {
		if _, err := apply(cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "handheld"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := apply(cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "handheld"}); err == nil {
		t.Fatal("moves beyond the limit must be rejected")
	}
}

// 整场景校验：浏览器写入的未知手法要指明摄影机与手法，主体被删除不阻断无关补丁。
func TestCloudAgentPrevisValidateSceneChecksCameraMoves(t *testing.T) {
	scene := previsCameraTestScene(t)
	camera := cloudAgentPrevisFindByID(creationMaps(scene["cameras"]), "s-camera-1")
	camera["moves"] = []any{map[string]any{"id": "m1", "technique": "follow", "start": 0.0, "duration": 2.0, "subjectId": "deleted-actor", "params": map[string]any{"side": "left"}}}
	if err := cloudAgentPrevisValidateScene(scene); err != nil {
		t.Fatalf("a move whose subject was deleted must not block validation: %v", err)
	}
	camera["moves"] = []any{map[string]any{"id": "m1", "technique": "hyperlapse", "start": 0.0, "duration": 2.0}}
	err := cloudAgentPrevisValidateScene(scene)
	if err == nil || !strings.Contains(err.Error(), "s-camera-1") || !strings.Contains(err.Error(), "hyperlapse") {
		t.Fatalf("unknown technique must name camera and technique, got %v", err)
	}
	camera["moves"] = []any{map[string]any{"id": "m1", "technique": "push_in", "start": 0.0, "duration": 2.0, "params": map[string]any{"distance": 900.0}}}
	if err := cloudAgentPrevisValidateScene(scene); err == nil {
		t.Fatal("stored params out of range must be rejected")
	}
}

func TestCloudAgentPrevisCameraMoveContract(t *testing.T) {
	guide := cloudAgentPrevisCatalogGuide()
	moves, _ := guide["cameraMoves"].(string)
	for _, want := range []string{"follow*", "orbit_left°", "dolly_zoom_out°", "side=behind/front/left/right/above/shoulder/pov", "handheld"} {
		if !strings.Contains(moves, want) {
			t.Fatalf("catalog.cameraMoves missing %q: %s", want, moves)
		}
	}
	if recipes, _ := guide["cameraRecipes"].(string); !strings.Contains(recipes, "希区柯克") || !strings.Contains(recipes, "御剑") {
		t.Fatalf("catalog.cameraRecipes missing master recipes: %s", recipes)
	}
	if rules, _ := guide["rules"].(string); !strings.Contains(rules, "camera_move_remove") {
		t.Fatalf("catalog.rules must explain camera move layering: %s", rules)
	}
	schema := cloudAgentPrevisPatchOperationSchema()["properties"].(map[string]any)
	types := schema["type"].(map[string]any)["enum"].([]string)
	if !strings.Contains(strings.Join(types, ","), "camera_move,camera_move_remove") {
		t.Fatalf("schema type enum missing camera moves: %v", types)
	}
	for _, key := range []string{"technique", "recipe", "subjectId"} {
		if _, ok := schema[key]; !ok {
			t.Fatalf("schema missing %s", key)
		}
	}
	if !strings.Contains(moves, "shotSize=extreme_close_up/close_up/medium/full/wide/extreme_wide") || !strings.Contains(moves, "blend 0~10") {
		t.Fatalf("catalog.cameraMoves must list follow shot sizes and blend: %s", moves)
	}
	if rules, _ := guide["rules"].(string); !strings.Contains(rules, "manual=shots") || !strings.Contains(rules, "recipe") {
		t.Fatalf("catalog.rules must point to shot design and recipes: %s", rules)
	}
}

// 走完整的审批写入路径：JSON 严格解码能识别 technique / subjectId / params，结果落到画布文档。
func TestCloudAgentPrevisCameraMoveThroughApplyPatch(t *testing.T) {
	s, canvas := previsMutationFixture(t)
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	created, err := applyCloudAgentPrevisMutation(s.repo, "user", canvas.ID, previsMutationCall(t, "create", "previs_scene_create", map[string]any{"canvasSnapshotHash": cloudAgentCanvasHash(doc), "sceneId": "s", "title": "御剑", "templateId": "monologue"}), policy)
	if err != nil {
		t.Fatal(err)
	}
	patch := previsMutationCall(t, "patch", "previs_apply_patch", map[string]any{
		"snapshotHash": previsResultString(t, created, "snapshotHash"),
		"sceneId":      "s",
		"operations": []map[string]any{
			{"type": "actor_travel", "id": "s-actor-1", "travelStyle": "sword_fly", "pathPoints": [][]float64{{0, 0, 0}, {20, 0, -10}}, "time": 0.5, "duration": 4},
			{"type": "camera_move", "id": "s-camera-1", "technique": "follow", "subjectId": "s-actor-1", "params": map[string]any{"side": "behind", "distance": 6}},
			{"type": "camera_move", "id": "s-camera-1", "technique": "orbit_left", "subjectId": "s-actor-1", "time": 2.5, "duration": 2.5, "params": map[string]any{"angle": 120}},
		},
	})
	if _, err := applyCloudAgentPrevisMutation(s.repo, "user", canvas.ID, patch, policy); err != nil {
		t.Fatal(err)
	}
	stored, err := s.repo.CanvasProjectForUser("user", canvas.ID)
	if err != nil {
		t.Fatal(err)
	}
	storedDoc, err := creationDocument(stored.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	scene, ok := findPrevisScene(creationMaps(storedDoc["previsScenes"]), "s")
	if !ok {
		t.Fatal("scene missing after patch")
	}
	moves := previsCameraMoves(t, scene)
	if len(moves) != 2 || stringValue(moves[0]["technique"]) != "follow" || stringValue(moves[1]["technique"]) != "orbit_left" || numberValue(moves[1]["start"], 0) != 2.5 {
		t.Fatalf("stored camera moves wrong: %#v", moves)
	}
	if err := cloudAgentPrevisValidateScene(scene); err != nil {
		t.Fatal(err)
	}
}
