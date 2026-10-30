package app

import (
	"strings"
	"testing"
)

func previsReviewNotes(scene map[string]any) string {
	var notes []string
	for _, review := range cloudAgentPrevisShotReviews(scene) {
		for _, note := range review["notes"].([]string) {
			notes = append(notes, note)
		}
	}
	return strings.Join(notes, "\n")
}

// 镜头检查只看场景数据：一段默认参数的推镜铺满 6 秒、人物在走但镜头没跟、跟拍换方位没有过渡都要被指出；
// 写成多节拍、参数齐全、人物有走位后不再提示。
func TestCloudAgentPrevisShotReviewFlagsThinShots(t *testing.T) {
	apply := func(scene map[string]any, operation cloudAgentPrevisPatchOperation) {
		t.Helper()
		if _, err := cloudAgentPrevisApplyPatchOperation(scene, operation, 0); err != nil {
			t.Fatalf("%s: %v", operation.Type, err)
		}
	}
	subject := "s-actor-1"

	still := previsCameraTestScene(t)
	previsSetActiveShotDuration(still, 6)
	if notes := previsReviewNotes(still); !strings.Contains(notes, "固定机位") || !strings.Contains(notes, "没有动作或走位") {
		t.Fatalf("static shot with a still actor must be flagged: %s", notes)
	}

	lazy := previsCameraTestScene(t)
	previsSetActiveShotDuration(lazy, 6)
	apply(lazy, cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "push_in"})
	apply(lazy, cloudAgentPrevisPatchOperation{Type: "actor_travel", ID: "s-actor-1", TravelStyle: "walk", PathPoints: [][]float64{{0, 0, 0}, {0, 0, 6}}, Time: float64Ptr(0), Duration: float64Ptr(5)})
	notes := previsReviewNotes(lazy)
	for _, want := range []string{"只有 1 个运动节拍", "全靠默认值（push_in）", "在移动，但镜头没有跟拍"} {
		if !strings.Contains(notes, want) {
			t.Fatalf("lazy shot review missing %q: %s", want, notes)
		}
	}

	jump := previsCameraTestScene(t)
	previsSetActiveShotDuration(jump, 6)
	apply(jump, cloudAgentPrevisPatchOperation{Type: "actor_travel", ID: "s-actor-1", TravelStyle: "walk", PathPoints: [][]float64{{0, 0, 0}, {0, 0, 6}}, Time: float64Ptr(0), Duration: float64Ptr(6)})
	apply(jump, cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "follow", SubjectID: &subject, Time: float64Ptr(0), Duration: float64Ptr(3), Params: map[string]any{"side": "behind", "shotSize": "full"}})
	apply(jump, cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "follow", SubjectID: &subject, Time: float64Ptr(3), Duration: float64Ptr(3), Params: map[string]any{"side": "front", "shotSize": "close_up"}})
	if notes := previsReviewNotes(jump); !strings.Contains(notes, "3.0s 起的跟拍换了方位或景别但没设 blend") {
		t.Fatalf("follow side change without blend must be flagged: %s", notes)
	}

	designed := previsCameraTestScene(t)
	previsSetActiveShotDuration(designed, 6)
	apply(designed, cloudAgentPrevisPatchOperation{Type: "actor_travel", ID: "s-actor-1", TravelStyle: "walk", PathPoints: [][]float64{{0, 0, 0}, {0, 0, 6}}, Time: float64Ptr(0), Duration: float64Ptr(6)})
	apply(designed, cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Recipe: "ots_to_closeup", SubjectID: &subject})
	if notes := previsReviewNotes(designed); notes != "" {
		t.Fatalf("multi-beat shot with a moving actor must pass review: %s", notes)
	}
}

// 检查结果随写入结果返回给 Agent，并附带说明它只是数据检查。
func TestCloudAgentPrevisApplyPatchReturnsReview(t *testing.T) {
	s, canvas := previsMutationFixture(t)
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	created, err := applyCloudAgentPrevisMutation(s.repo, "user", canvas.ID, previsMutationCall(t, "create", "previs_scene_create", map[string]any{"canvasSnapshotHash": cloudAgentCanvasHash(doc), "sceneId": "s", "title": "走廊", "templateId": "monologue"}), policy)
	if err != nil {
		t.Fatal(err)
	}
	patch := previsMutationCall(t, "patch", "previs_apply_patch", map[string]any{
		"snapshotHash": previsResultString(t, created, "snapshotHash"),
		"sceneId":      "s",
		"operations":   []map[string]any{{"type": "camera_move", "id": "s-camera-1", "technique": "push_in"}},
	})
	result, err := applyCloudAgentPrevisMutation(s.repo, "user", canvas.ID, patch, policy)
	if err != nil {
		t.Fatal(err)
	}
	payload := result.(map[string]any)
	reviews, _ := payload["review"].([]map[string]any)
	if len(reviews) == 0 || !strings.Contains(stringValue(payload["reviewGuide"]), "manual=shots") {
		t.Fatalf("apply result must carry review and guide: %#v", payload)
	}

	recipe := previsMutationCall(t, "recipe", "previs_apply_patch", map[string]any{
		"snapshotHash": previsResultString(t, result, "snapshotHash"),
		"sceneId":      "s",
		"operations": []map[string]any{
			{"type": "camera_move_remove", "id": "s-camera-1"},
			{"type": "camera_move", "id": "s-camera-1", "recipe": "ots_to_closeup", "subjectId": "s-actor-1"},
		},
	})
	if _, err := applyCloudAgentPrevisMutation(s.repo, "user", canvas.ID, recipe, policy); err != nil {
		t.Fatalf("recipe must decode through the strict apply path: %v", err)
	}
}

// 跟拍交接留了空档（前一段在后一段过渡完之前结束，人物继续走远）要指出；追兵、路人这类背景里移动的人，
// 只要镜头跟着某个移动的人物就不提示。
func TestCloudAgentPrevisShotReviewHandoffGapAndBackgroundMovers(t *testing.T) {
	apply := func(scene map[string]any, operation cloudAgentPrevisPatchOperation) {
		t.Helper()
		if _, err := cloudAgentPrevisApplyPatchOperation(scene, operation, 0); err != nil {
			t.Fatalf("%s: %v", operation.Type, err)
		}
	}
	subject := "s-actor-1"
	scene := previsCameraTestScene(t)
	previsSetActiveShotDuration(scene, 6)
	apply(scene, cloudAgentPrevisPatchOperation{Type: "actor_travel", ID: "s-actor-1", TravelStyle: "walk", PathPoints: [][]float64{{0, 0, 0}, {0, 0, 8}}, Time: float64Ptr(0), Duration: float64Ptr(6)})
	apply(scene, cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "follow", SubjectID: &subject, Time: float64Ptr(0), Duration: float64Ptr(2.5), Params: map[string]any{"side": "shoulder"}})
	apply(scene, cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "follow", SubjectID: &subject, Time: float64Ptr(2.4), Duration: float64Ptr(3.6), Params: map[string]any{"side": "front", "shotSize": "close_up", "blend": 2.0}})
	if notes := previsReviewNotes(scene); !strings.Contains(notes, "前一段跟拍在 2.5s 结束") || !strings.Contains(notes, "4.4s 才过渡完") {
		t.Fatalf("follow handoff gap must be flagged: %s", notes)
	}
	apply(scene, cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "follow", SubjectID: &subject, Time: float64Ptr(0), Duration: float64Ptr(4.6), KeyframeID: previsStringPtr("s-camera-1-move-1"), Params: map[string]any{"side": "shoulder"}})
	if notes := previsReviewNotes(scene); strings.Contains(notes, "前一段跟拍") {
		t.Fatalf("follow that covers the next blend must pass: %s", notes)
	}

	apply(scene, cloudAgentPrevisPatchOperation{Type: "object_add", ID: "chaser", Kind: "actor", Name: previsStringPtr("追兵"), Position: vec3Ptr([]float64{0, 0, -6})})
	apply(scene, cloudAgentPrevisPatchOperation{Type: "actor_travel", ID: "chaser", TravelStyle: "walk", PathPoints: [][]float64{{0, 0, -6}, {0, 0, 4}}, Time: float64Ptr(0), Duration: float64Ptr(6)})
	if notes := previsReviewNotes(scene); strings.Contains(notes, "在移动，但") {
		t.Fatalf("background movers must not be flagged while the camera follows a moving actor: %s", notes)
	}
}

// 镜头画幅：shot_add / shot_update 接受 8 种画幅并写入镜头，非法值拒绝；场景读取返回画幅，未设置按 9:16。
func TestCloudAgentPrevisShotAspectRatio(t *testing.T) {
	scene := previsCameraTestScene(t)
	shotID := stringValue(scene["activeShotId"])
	if projected := projectPrevisScene(scene, "", nil)["shots"].([]map[string]any); projected[0]["aspectRatio"] != "9:16" {
		t.Fatalf("unset aspect ratio must read as 9:16: %#v", projected[0])
	}
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "shot_update", ID: shotID, AspectRatio: "2.39:1"}, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "shot_add", ID: "s-shot-2", AspectRatio: "9:16"}, 0); err != nil {
		t.Fatal(err)
	}
	shots := creationMaps(scene["shots"])
	if stringValue(shots[0]["aspectRatio"]) != "2.39:1" || stringValue(shots[1]["aspectRatio"]) != "9:16" {
		t.Fatalf("aspect ratios not stored: %#v", shots)
	}
	if projected := projectPrevisScene(scene, "", nil)["shots"].([]map[string]any); projected[0]["aspectRatio"] != "2.39:1" {
		t.Fatalf("scene read must return the shot aspect ratio: %#v", projected[0])
	}
	if err := cloudAgentPrevisValidateScene(scene); err != nil {
		t.Fatal(err)
	}
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "shot_update", ID: shotID, AspectRatio: "2:1"}, 0); err == nil || !strings.Contains(err.Error(), "aspectRatio") {
		t.Fatalf("unknown aspect ratio must be rejected, got %v", err)
	}
	shots[0]["aspectRatio"] = "3:2"
	if err := cloudAgentPrevisValidateScene(scene); err == nil {
		t.Fatal("scene validation must reject an unknown stored aspect ratio")
	}
}
