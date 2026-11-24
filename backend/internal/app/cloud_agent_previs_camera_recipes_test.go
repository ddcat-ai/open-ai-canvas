package app

import (
	"encoding/json"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
)

type previsRecipeGolden struct {
	Cases []struct {
		Input struct {
			Start        float64 `json:"start"`
			Duration     float64 `json:"duration"`
			SubjectID    string  `json:"subjectId"`
			ShotDuration float64 `json:"shotDuration"`
		} `json:"input"`
		Recipes map[string][]map[string]any `json:"recipes"`
	} `json:"cases"`
}

func previsSetActiveShotDuration(scene map[string]any, duration float64) {
	for _, shot := range creationMaps(scene["shots"]) {
		if stringValue(shot["id"]) == stringValue(scene["activeShotId"]) {
			shot["duration"] = duration
		}
	}
}

// 规范化为 JSON 再比较：数字统一为 float64，去掉 id，按开始时间与手法排序（与前端 golden 生成一致）。
func previsNormalizeRecipeMoves(t *testing.T, moves []map[string]any, subjectAlias map[string]string) []map[string]any {
	t.Helper()
	result := make([]map[string]any, 0, len(moves))
	for _, move := range moves {
		copied := make(map[string]any, len(move))
		for key, value := range move {
			if key == "id" {
				continue
			}
			copied[key] = value
		}
		if alias, ok := subjectAlias[stringValue(copied["subjectId"])]; ok {
			copied["subjectId"] = alias
		}
		raw, err := json.Marshal(copied)
		if err != nil {
			t.Fatal(err)
		}
		var normalized map[string]any
		if err := json.Unmarshal(raw, &normalized); err != nil {
			t.Fatal(err)
		}
		result = append(result, normalized)
	}
	sort.SliceStable(result, func(i, j int) bool {
		left, right := numberValue(result[i]["start"], 0), numberValue(result[j]["start"], 0)
		if left != right {
			return left < right
		}
		return stringValue(result[i]["technique"]) < stringValue(result[j]["technique"])
	})
	return result
}

// 前端 PREVIS_CAMERA_RECIPES 生成的展开结果与后端 camera_move+recipe 写入的运镜段逐项相同。
func TestCloudAgentPrevisCameraRecipesMatchFrontendGolden(t *testing.T) {
	raw, err := os.ReadFile("testdata/previs_camera_recipes.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden previsRecipeGolden
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	if len(golden.Cases) < 2 {
		t.Fatalf("golden must cover at least two inputs: %d", len(golden.Cases))
	}
	for _, item := range golden.Cases {
		if len(item.Recipes) != len(cloudAgentPrevisCameraRecipes) {
			t.Fatalf("golden recipes %d != backend recipes %d", len(item.Recipes), len(cloudAgentPrevisCameraRecipes))
		}
		for _, recipe := range cloudAgentPrevisCameraRecipes {
			want, ok := item.Recipes[recipe.Recipe]
			if !ok {
				t.Fatalf("golden missing recipe %s", recipe.Recipe)
			}
			scene := previsCameraTestScene(t)
			previsSetActiveShotDuration(scene, item.Input.ShotDuration)
			start, duration := item.Input.Start, item.Input.Duration
			operation := cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Recipe: recipe.Recipe, Time: &start, Duration: &duration}
			if recipe.Subject != "none" {
				subject := "s-actor-1"
				operation.SubjectID = &subject
			}
			if _, err := cloudAgentPrevisApplyPatchOperation(scene, operation, 0); err != nil {
				t.Fatalf("%s: %v", recipe.Recipe, err)
			}
			got := previsNormalizeRecipeMoves(t, previsCameraMoves(t, scene), map[string]string{"s-actor-1": item.Input.SubjectID})
			expected := previsNormalizeRecipeMoves(t, want, nil)
			if !reflect.DeepEqual(got, expected) {
				gotJSON, _ := json.Marshal(got)
				wantJSON, _ := json.Marshal(expected)
				t.Fatalf("recipe %s (start=%g duration=%g) differs from frontend:\n got %s\nwant %s", recipe.Recipe, start, duration, gotJSON, wantJSON)
			}
			if err := cloudAgentPrevisValidateScene(scene); err != nil {
				t.Fatalf("%s: %v", recipe.Recipe, err)
			}
		}
	}
}

func TestCloudAgentPrevisCameraRecipeValidation(t *testing.T) {
	apply := func(scene map[string]any, operation cloudAgentPrevisPatchOperation) (string, error) {
		item, err := cloudAgentPrevisApplyPatchOperation(scene, operation, 0)
		return item.Summary, err
	}
	subject := "s-actor-1"
	scene := previsCameraTestScene(t)
	previsSetActiveShotDuration(scene, 6)

	summary, err := apply(scene, cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Recipe: "ots_to_closeup", SubjectID: &subject})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(summary, "过肩跟随转正面特写") || !strings.Contains(summary, "展开 4 段") || !strings.Contains(summary, "主体《") {
		t.Fatalf("summary must name the recipe, subject and segment count: %s", summary)
	}
	moves := previsCameraMoves(t, scene)
	if len(moves) != 4 {
		t.Fatalf("ots_to_closeup must expand to 4 segments: %#v", moves)
	}
	last := moves[len(moves)-1]
	if params, _ := last["params"].(map[string]any); stringValue(params["shotSize"]) != "extreme_close_up" || numberValue(params["blend"], 0) <= 0 {
		t.Fatalf("last segment must land on an extreme close-up with a blend: %#v", last)
	}

	cases := []struct {
		name      string
		operation cloudAgentPrevisPatchOperation
		want      string
	}{
		{"unknown", cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Recipe: "spielberg_oner", SubjectID: &subject}, "ots_to_closeup"},
		{"with technique", cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Recipe: "vertigo", Technique: "push_in"}, "二选一"},
		{"missing subject", cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Recipe: "walk_and_talk"}, "subjectId"},
		{"subject not allowed", cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Recipe: "emotional_push", SubjectID: &subject}, "不需要 subjectId"},
		{"params", cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Recipe: "hero_orbit", Params: map[string]any{"angle": 90.0}}, "keyframeId"},
		{"too short", cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Recipe: "vertigo", Time: float64Ptr(5.5)}, "至少需要"},
		{"past shot", cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Recipe: "vertigo", Time: float64Ptr(2), Duration: float64Ptr(5)}, "超出镜头时长"},
	}
	for _, item := range cases {
		fresh := previsCameraTestScene(t)
		previsSetActiveShotDuration(fresh, 6)
		if _, err := apply(fresh, item.operation); err == nil || !strings.Contains(err.Error(), item.want) {
			t.Fatalf("%s: want error containing %q, got %v", item.name, item.want, err)
		}
		if len(previsCameraMoves(t, fresh)) != 0 {
			t.Fatalf("%s: rejected recipe must not leave partial moves", item.name)
		}
	}

	full := previsCameraTestScene(t)
	previsSetActiveShotDuration(full, 6)
	for index := 0; index < cloudAgentPrevisMaxCameraMoves-2; index++ {
		if _, err := apply(full, cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Technique: "handheld"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := apply(full, cloudAgentPrevisPatchOperation{Type: "camera_move", ID: "s-camera-1", Recipe: "ots_to_closeup", SubjectID: &subject}); err == nil || !strings.Contains(err.Error(), "上限") {
		t.Fatalf("recipe past the move limit must be rejected before writing, got %v", err)
	}
	if got := len(previsCameraMoves(t, full)); got != cloudAgentPrevisMaxCameraMoves-2 {
		t.Fatalf("rejected recipe must not write partial moves: %d", got)
	}
}

func TestCloudAgentPrevisCameraRecipeCatalog(t *testing.T) {
	guide := cloudAgentPrevisCameraRecipesGuide()
	for _, recipe := range cloudAgentPrevisCameraRecipes {
		if !strings.Contains(guide, recipe.Recipe) || !strings.Contains(guide, recipe.Label) {
			t.Fatalf("catalog.cameraRecipes missing %s: %s", recipe.Recipe, guide)
		}
		for _, segment := range recipe.Segments {
			technique, ok := cloudAgentPrevisFindCameraTechnique(segment.Technique)
			if !ok {
				t.Fatalf("recipe %s uses unknown technique %s", recipe.Recipe, segment.Technique)
			}
			if technique.Subject == "required" && recipe.Subject != "required" {
				t.Fatalf("recipe %s needs a subject for %s", recipe.Recipe, segment.Technique)
			}
			if segment.At < 0 || segment.Span <= 0 || segment.At+segment.Span > 1+1e-9 {
				t.Fatalf("recipe %s segment %s timing out of range", recipe.Recipe, segment.Technique)
			}
		}
	}
	for _, want := range []string{"ots_to_closeup*", "blend=总时长×0.35", "shotSize=extreme_close_up", "recipe"} {
		if !strings.Contains(guide, want) {
			t.Fatalf("catalog.cameraRecipes missing %q: %s", want, guide)
		}
	}
}
