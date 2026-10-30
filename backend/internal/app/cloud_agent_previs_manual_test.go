package app

import (
	"bytes"
	"encoding/json"
	"regexp"
	"slices"
	"strings"
	"testing"

	"yingce/backend/internal/prompts"
)

// 说明书只读：manual 不需要 sceneId，未知主题报出可选主题；目录读取和精读都带说明书索引。
func TestCloudAgentPrevisSceneReadReturnsManual(t *testing.T) {
	s, canvas := previsMutationFixture(t)
	read := func(arguments string) (map[string]any, error) {
		call := cloudAgentCall{ID: "manual"}
		call.Function.Name = "previs_scene_read"
		call.Function.Arguments = arguments
		result, err := cloudAgentPrevisSceneRead(s.repo, "user", canvas.ID, call)
		if err != nil {
			return nil, err
		}
		return result.(map[string]any), nil
	}
	result, err := read(`{"manual":"rules"}`)
	if err != nil {
		t.Fatal(err)
	}
	content, _ := result["content"].(string)
	if result["topic"] != "rules" || !strings.Contains(content, "地面 Y=0") {
		t.Fatalf("manual=rules must return the behavior rules: %#v", result)
	}
	if topics, _ := result["topics"].([]prompts.PrevisManualTopic); len(topics) != len(prompts.PrevisManualTopics()) {
		t.Fatalf("manual result must list topics: %#v", result["topics"])
	}
	if _, err := read(`{"manual":"nope"}`); err == nil || !strings.Contains(err.Error(), "paths") {
		t.Fatalf("unknown topic must list valid topics, got %v", err)
	}
	directory, err := read(`{}`)
	if err != nil {
		t.Fatal(err)
	}
	manual, _ := directory["manual"].(map[string]string)
	if !strings.Contains(manual["paths"], "运镜轨迹") || !strings.Contains(stringValue(directory["guidance"]), "manual=rules") {
		t.Fatalf("directory must point the Agent at the manual: %#v", directory)
	}
	if guide := cloudAgentPrevisCatalogGuide(); guide["manual"] == nil {
		t.Fatal("catalog must carry the manual index")
	}
}

var (
	previsManualJSONBlock = regexp.MustCompile("(?s)```json\n(.*?)```")
	previsManualInlineOp  = regexp.MustCompile("`(\\{\"type\":.*?\\})`")
	previsManualMotions   = regexp.MustCompile(`actor_motion_add(?: motion=)?\s*([a-z_]+(?:\s*[|/]\s*[a-z_]+)*)`)
	previsManualSnakeWord = regexp.MustCompile(`\b[a-z]+(?:_[a-z]+)*\b`)
	previsManualRecipeRef = regexp.MustCompile("recipe[ =]`?([a-z_]+)`?")
)

// 说明书里的示例必须是当前工具真的接受的写法：字段名、操作类型、手法、动作、布景模板和道具 ID 都要存在。
func TestCloudAgentPrevisManualExamplesMatchTools(t *testing.T) {
	schema := cloudAgentPrevisPatchOperationSchema()["properties"].(map[string]any)
	operationTypes := schema["type"].(map[string]any)["enum"].([]string)
	techniquePrefix := regexp.MustCompile(`^(push|pull|dolly|zoom|pan|tilt|whip|truck|crane|orbit|pedestal)_`)
	decoded := 0
	for _, topic := range prompts.PrevisManualTopics() {
		_, content, _ := prompts.PrevisManual(topic.ID)
		var raws []string
		for _, match := range previsManualJSONBlock.FindAllStringSubmatch(content, -1) {
			raws = append(raws, match[1])
		}
		for _, match := range previsManualInlineOp.FindAllStringSubmatch(content, -1) {
			raws = append(raws, match[1])
		}
		for _, raw := range raws {
			raw = strings.TrimSpace(raw)
			if !strings.HasPrefix(raw, "[") {
				raw = "[" + raw + "]"
			}
			decoder := json.NewDecoder(bytes.NewReader([]byte(raw)))
			decoder.DisallowUnknownFields()
			var operations []cloudAgentPrevisPatchOperation
			if err := decoder.Decode(&operations); err != nil {
				t.Fatalf("manual %s example does not decode as patch operations: %v\n%s", topic.ID, err, raw)
			}
			decoded += len(operations)
			for _, operation := range operations {
				if !slices.Contains(operationTypes, operation.Type) {
					t.Fatalf("manual %s uses unknown operation %q", topic.ID, operation.Type)
				}
				if operation.Technique != "" {
					if _, ok := cloudAgentPrevisFindCameraTechnique(operation.Technique); !ok {
						t.Fatalf("manual %s uses unknown technique %q", topic.ID, operation.Technique)
					}
				}
				if operation.Recipe != "" {
					if _, ok := cloudAgentPrevisFindCameraRecipe(operation.Recipe); !ok {
						t.Fatalf("manual %s uses unknown recipe %q", topic.ID, operation.Recipe)
					}
				}
				if operation.Motion != "" && !slices.Contains(cloudAgentPrevisMotionIDs, operation.Motion) {
					t.Fatalf("manual %s uses unknown motion %q", topic.ID, operation.Motion)
				}
				if operation.LayoutTemplate != "" && !slices.Contains(cloudAgentPrevisLayoutIDs, operation.LayoutTemplate) {
					t.Fatalf("manual %s uses unknown layout %q", topic.ID, operation.LayoutTemplate)
				}
				if operation.PropID != "" {
					if _, ok := cloudAgentPrevisFindProp(operation.PropID); !ok {
						t.Fatalf("manual %s uses unknown prop %q", topic.ID, operation.PropID)
					}
				}
				if operation.TravelStyle != "" && !slices.Contains(cloudAgentPrevisTravelStyles, operation.TravelStyle) {
					t.Fatalf("manual %s uses unknown travel style %q", topic.ID, operation.TravelStyle)
				}
				if operation.Weather != "" && !slices.Contains(cloudAgentPrevisWeathers, operation.Weather) {
					t.Fatalf("manual %s uses unknown weather %q", topic.ID, operation.Weather)
				}
			}
		}
		for _, match := range previsManualMotions.FindAllStringSubmatch(content, -1) {
			for _, motion := range regexp.MustCompile(`[a-z_]+`).FindAllString(match[1], -1) {
				if !slices.Contains(cloudAgentPrevisMotionIDs, motion) {
					t.Fatalf("manual %s mentions unknown motion %q", topic.ID, motion)
				}
			}
		}
		for _, word := range previsManualSnakeWord.FindAllString(content, -1) {
			if !techniquePrefix.MatchString(word) {
				continue
			}
			if _, ok := cloudAgentPrevisFindCameraTechnique(word); !ok {
				t.Fatalf("manual %s mentions unknown camera technique %q", topic.ID, word)
			}
		}
		for _, match := range previsManualRecipeRef.FindAllStringSubmatch(content, -1) {
			if _, ok := cloudAgentPrevisFindCameraRecipe(match[1]); !ok {
				t.Fatalf("manual %s mentions unknown recipe %q", topic.ID, match[1])
			}
		}
		for _, word := range previsManualSnakeWord.FindAllString(content, -1) {
			if strings.HasPrefix(word, "ancient_") || strings.HasPrefix(word, "modern_") {
				// ancient_shop、modern_house 这类是目录道具，ancient_city、modern_street 是布景模板。
				if _, isProp := cloudAgentPrevisFindProp(word); !isProp && !slices.Contains(cloudAgentPrevisLayoutIDs, word) {
					t.Fatalf("manual %s mentions unknown layout or prop %q", topic.ID, word)
				}
			}
		}
	}
	if decoded < 20 {
		t.Fatalf("manual examples were not found, decoded %d operations", decoded)
	}
}

// 说明书 paths 主题方式 A：人物沿摄影机画好的运镜轨迹走（贴地），摄影机沿同一轨迹晚 0.8 秒出发并注视人物。
func TestCloudAgentPrevisActorFollowsCameraPath(t *testing.T) {
	scene := previsCameraTestScene(t)
	apply := func(operation cloudAgentPrevisPatchOperation) cloudAgentApprovalPreviewItem {
		t.Helper()
		item, err := cloudAgentPrevisApplyPatchOperation(scene, operation, 0)
		if err != nil {
			t.Fatalf("%s: %v", operation.Type, err)
		}
		return item
	}
	travel := 3.0
	apply(cloudAgentPrevisPatchOperation{Type: "object_motion_path_set", ID: "s-camera-1", PathPoints: [][]float64{{0, 1.6, 6}, {4, 2.4, 2}, {8, 3, -2}}, Easing: "ease_out", Duration: &travel})

	apply(cloudAgentPrevisPatchOperation{Type: "object_motion_path_set", ID: "s-actor-1", PathID: previsStringPtr("s-camera-1")})
	actor := cloudAgentPrevisFindByID(creationMaps(scene["objects"]), "s-actor-1")
	actorPath, _ := actor["motionPath"].(map[string]any)
	if actorPath == nil || stringValue(actorPath["easing"]) != "ease_out" || numberValue(actorPath["duration"], 0) != 3 {
		t.Fatalf("actor must copy the camera path rhythm: %#v", actorPath)
	}
	for _, raw := range creationAnyList(actorPath["points"]) {
		if point, _ := cloudAgentPrevisNumberVec3(raw); point[1] != 0 {
			t.Fatalf("camera path handed to an actor must walk on the ground: %#v", actorPath["points"])
		}
	}
	for _, frame := range creationMaps(actor["keyframes"]) {
		if numberValue(frame["lift"], 0) != 0 {
			t.Fatalf("grounded copy must not lift the actor: %#v", frame)
		}
	}

	delay := 0.8
	apply(cloudAgentPrevisPatchOperation{Type: "object_motion_path_set", ID: "s-camera-1", PathID: previsStringPtr("s-camera-1"), StartDelay: &delay})
	camera := cloudAgentPrevisFindByID(creationMaps(scene["cameras"]), "s-camera-1")
	cameraPath, _ := camera["motionPath"].(map[string]any)
	if numberValue(cameraPath["startDelay"], 0) != 0.8 || stringValue(cameraPath["easing"]) != "ease_out" {
		t.Fatalf("camera must keep its own path and start later: %#v", cameraPath)
	}
	frames := creationMaps(camera["keyframes"])
	if last, _ := cloudAgentPrevisNumberVec3(cloudAgentPrevisMapTransform(frames[len(frames)-1])["position"]); last[1] != 3 {
		t.Fatalf("camera keeps its drawn heights when copying itself: %v", last)
	}
	apply(cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "look_at", SubjectID: previsStringPtr("s-actor-1")})
	if moves := previsCameraMoves(t, scene); len(moves) != 1 || moves[0]["technique"] != "look_at" {
		t.Fatalf("camera must look at the actor: %#v", moves)
	}

	// 要飞：height 把整条路径放到统一离地高度。
	height := 2.0
	apply(cloudAgentPrevisPatchOperation{Type: "object_motion_path_set", ID: "s-actor-1", PathID: previsStringPtr("s-camera-1"), Height: &height})
	maxLift := 0.0
	for _, frame := range creationMaps(cloudAgentPrevisFindByID(creationMaps(scene["objects"]), "s-actor-1")["keyframes"]) {
		maxLift = max(maxLift, numberValue(frame["lift"], 0))
	}
	if maxLift != 2 {
		t.Fatalf("height must override the copied path, got lift %v", maxLift)
	}
	if err := cloudAgentPrevisValidateScene(scene); err != nil {
		t.Fatalf("scene invalid after transfer: %v", err)
	}

	clear := apply(cloudAgentPrevisPatchOperation{Type: "object_motion_path_clear", ID: "s-camera-1"})
	if camera := cloudAgentPrevisFindByID(creationMaps(scene["cameras"]), "s-camera-1"); camera["motionPath"] != nil || !strings.Contains(clear.Summary, "清除") {
		t.Fatalf("camera path must be removable: %#v", camera["motionPath"])
	}
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "object_motion_path_set", ID: "s-actor-1", PathID: previsStringPtr("s-camera-1")}, 0); err == nil {
		t.Fatal("pathId pointing at a camera without a path must be rejected")
	}
}
