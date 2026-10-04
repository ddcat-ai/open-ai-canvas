package app

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestProjectDirectorSceneReturnsSafeSemanticProjection(t *testing.T) {
	scene := map[string]any{
		"id":           "scene-1",
		"title":        "客厅",
		"activeShotId": "shot-1",
		"shots": []any{map[string]any{
			"id":         "shot-1",
			"name":       "对话",
			"cameraId":   "camera-1",
			"duration":   4.5,
			"fps":        24,
			"shotSize":   "medium",
			"cameraMove": "push_in",
		}},
		"objects": []any{map[string]any{
			"id":         "actor-1",
			"name":       "演员 A",
			"kind":       "actor",
			"primitive":  "character",
			"color":      "#fff",
			"pose":       "stand",
			"visible":    true,
			"url":        "https://example.invalid/private.glb",
			"storageKey": "secret-storage-key",
			"transform": map[string]any{
				"position": []any{1.0, 0.0, -2.0},
				"rotation": []any{0.0, 0.5, 0.0},
				"scale":    []any{1.0, 1.0, 1.0},
			},
		}},
		"cameras": []any{map[string]any{
			"id":          "camera-1",
			"name":        "主机位",
			"focalLength": 50,
			"target":      []any{0.0, 1.0, 0.0},
			"transform": map[string]any{
				"position": []any{0.0, 2.0, 5.0},
				"rotation": []any{0.0, 0.0, 0.0},
				"scale":    []any{1.0, 1.0, 1.0},
			},
		}},
		"lights": []any{map[string]any{"id": "light-1"}},
	}

	projected := projectDirectorScene(scene, "shot-1", map[string]bool{})
	shots, ok := projected["shots"].([]map[string]any)
	if !ok || len(shots) != 1 {
		t.Fatalf("shots projection = %#v", projected["shots"])
	}
	if shots[0]["shotSize"] != "medium" || shots[0]["cameraMove"] != "push_in" {
		t.Fatalf("shot semantics lost: %#v", shots[0])
	}
	objects, ok := projected["objects"].([]map[string]any)
	if !ok || len(objects) != 1 {
		t.Fatalf("objects projection = %#v", projected["objects"])
	}
	if _, exists := objects[0]["url"]; exists {
		t.Fatal("projection must not expose model URL")
	}
	if _, exists := objects[0]["storageKey"]; exists {
		t.Fatal("projection must not expose storage key")
	}
	transform, ok := objects[0]["transform"].(map[string]any)
	if !ok || len(transform["position"].([]any)) != 3 {
		t.Fatalf("transform projection = %#v", objects[0]["transform"])
	}
}

// director_scene_read 省略 sceneId 时应返回场景目录；空 ID 若先进校验会以
// 「导演场景 ID不能为空」拒绝，Agent 永远拿不到任何 sceneId。
func TestCloudAgentDirectorSceneReadListsScenesWithoutSceneID(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	payload := `{"nodes":[],"directorScenes":[{"id":"scene-1","title":"天台对峙","activeShotId":"shot-1","shots":[{"id":"shot-1","name":"开场"}],"objects":[{"id":"actor-1","name":"主角"}]}]}`
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", payload).Error; err != nil {
		t.Fatal(err)
	}

	call := cloudAgentCall{}
	call.Function.Name = "director_scene_read"
	call.Function.Arguments = `{}`
	result, err := cloudAgentDirectorSceneRead(s.repo, "user", "agent-canvas", call)
	if err != nil {
		t.Fatalf("scene catalogue read failed: %v", err)
	}
	catalogue, _ := result.(map[string]any)
	scenes, _ := catalogue["scenes"].([]map[string]any)
	if catalogue["count"] != 1 || len(scenes) != 1 || scenes[0]["id"] != "scene-1" || scenes[0]["shotCount"] != 1 {
		t.Fatalf("scene catalogue = %#v", catalogue)
	}

	call.Function.Arguments = `{"sceneId":"scene-1"}`
	if _, err := cloudAgentDirectorSceneRead(s.repo, "user", "agent-canvas", call); err != nil {
		t.Fatalf("scene read without shotId failed: %v", err)
	}

	call.Function.Arguments = `{"sceneId":" scene-1"}`
	if _, err := cloudAgentDirectorSceneRead(s.repo, "user", "agent-canvas", call); err == nil {
		t.Fatal("malformed sceneId was accepted")
	}
}
