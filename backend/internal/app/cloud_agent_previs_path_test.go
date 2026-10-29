package app

import (
	"math"
	"strings"
	"testing"
)

// 与 web/test/previs-motion-path.test.ts 的 PREVIS_PATH_GOLDEN 同一组输入和期望值：前后端展开同一条路径必须得到同样的关键帧。
func TestCloudAgentPrevisPathMatchesFrontendGolden(t *testing.T) {
	type expect struct {
		count                    int
		firstID, lastID          string
		lastTime                 float64
		lastPosition             []float64
		timeSum, xSum, heightSum float64
	}
	cases := []struct {
		name   string
		locked bool
		shot   float64
		spec   cloudAgentPrevisPathSpec
		want   expect
	}{
		{"actor-hold-smooth", true, 10, cloudAgentPrevisPathSpec{Points: [][]float64{{0, 0, 0}, {4, 2, 0}, {4, 2, 4}}, Speed: "walk", MetersPerSecond: 2, StartDelay: 1, Orient: true, Easing: "smooth", Holds: []float64{0, 1, 0}},
			expect{46, "hold", "45", 6.236, []float64{4, 0, 4}, 160.789, 132, 66}},
		{"camera-curve-speeds", false, 6, cloudAgentPrevisPathSpec{Points: [][]float64{{0, 3, 0}, {2, 3, 2}, {4, 1, 0}, {6, 0.5, 2}}, Speed: "run", Curve: true, Speeds: []float64{1, 2, 0.5}},
			expect{25, "1", "25", 3.019, []float64{6, 0.5, 2}, 31.005, 75, 47.9142}},
		{"compressed-ease-in", true, 5, cloudAgentPrevisPathSpec{Points: [][]float64{{0, 0, 0}, {30, 0, 0}}, Speed: "walk", Orient: true, Easing: "ease_in"},
			expect{51, "1", "51", 5, []float64{30, 0, 0}, 127.5, 515.1, 0}},
	}
	round4 := func(value float64) float64 { return math.Round(value*10000) / 10000 }
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			frames, err := cloudAgentPrevisBuildPathKeyframes("p", []float64{0, 0, 0}, []float64{1, 1, 1}, item.spec, item.shot, item.locked)
			if err != nil {
				t.Fatal(err)
			}
			suffix := func(frame map[string]any) string { return strings.TrimPrefix(stringValue(frame["id"]), "p-path-") }
			timeSum, xSum, heightSum := 0.0, 0.0, 0.0
			for index, frame := range frames {
				position, _ := cloudAgentPrevisNumberVec3(cloudAgentPrevisMapTransform(frame)["position"])
				timeSum += numberValue(frame["time"], 0)
				xSum += position[0]
				if item.locked {
					heightSum += numberValue(frame["lift"], 0)
				} else {
					heightSum += position[1]
				}
				if index > 0 && numberValue(frame["time"], 0) <= numberValue(frames[index-1]["time"], 0) {
					t.Fatalf("keyframe times must increase: %#v", frames)
				}
			}
			last := frames[len(frames)-1]
			lastPosition, _ := cloudAgentPrevisNumberVec3(cloudAgentPrevisMapTransform(last)["position"])
			got := expect{len(frames), suffix(frames[0]), suffix(last), numberValue(last["time"], 0), lastPosition, round4(timeSum), round4(xSum), round4(heightSum)}
			if got.count != item.want.count || got.firstID != item.want.firstID || got.lastID != item.want.lastID || got.lastTime != item.want.lastTime || got.timeSum != item.want.timeSum || got.xSum != item.want.xSum || got.heightSum != item.want.heightSum {
				t.Fatalf("checksum mismatch with frontend:\n got  %+v\n want %+v", got, item.want)
			}
			for axis := range lastPosition {
				if lastPosition[axis] != item.want.lastPosition[axis] {
					t.Fatalf("last position %v, want %v", lastPosition, item.want.lastPosition)
				}
			}
		})
	}
}

// Agent：沿用户画的参考轨迹（pathId）飞行，带高度与运动规律；摄影机也能走路径；读场景返回轨迹与路径。
func TestCloudAgentPrevisMotionPathFromSketchWithHeight(t *testing.T) {
	scene := previsCameraTestScene(t)
	scene["paths"] = []any{map[string]any{"id": "sketch-1", "label": "路径1", "points": []any{[]any{0.0, 0.0, 0.0}, []any{6.0, 3.0, 0.0}, []any{12.0, 3.0, 6.0}}}}
	if err := cloudAgentPrevisValidateScene(scene); err != nil {
		t.Fatalf("scene with sketch path invalid: %v", err)
	}
	pathID := "路径1"
	travel := 4.0
	item, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "object_motion_path_set", ID: "s-actor-1", PathID: &pathID, Easing: "smooth", Duration: &travel}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(item.Summary, "最高离地 3.0 米") || !strings.Contains(item.Summary, "smooth") {
		t.Fatalf("summary must describe height and motion law: %s", item.Summary)
	}
	actor := cloudAgentPrevisFindByID(creationMaps(scene["objects"]), "s-actor-1")
	frames := creationMaps(actor["keyframes"])
	maxLift := 0.0
	for _, frame := range frames {
		position, _ := cloudAgentPrevisNumberVec3(cloudAgentPrevisMapTransform(frame)["position"])
		if position[1] != 0 {
			t.Fatalf("actor keyframes must stay grounded, height goes to lift: %#v", frame)
		}
		maxLift = math.Max(maxLift, numberValue(frame["lift"], 0))
	}
	if maxLift != 3 || numberValue(frames[len(frames)-1]["time"], 0) != 4 {
		t.Fatalf("flight path wrong: maxLift=%v frames=%d last=%v", maxLift, len(frames), frames[len(frames)-1]["time"])
	}
	cloudAgentPrevisGroundScene(scene)
	if err := cloudAgentPrevisValidateScene(scene); err != nil {
		t.Fatalf("scene invalid after path: %v", err)
	}
	if lift := numberValue(creationMaps(cloudAgentPrevisFindByID(creationMaps(scene["objects"]), "s-actor-1")["keyframes"])[len(frames)-1]["lift"], 0); lift != 3 {
		t.Fatalf("grounding must keep lift, got %v", lift)
	}

	// 摄影机沿路径升到 8 米高。
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "object_motion_path_set", ID: "s-camera-1", PathPoints: [][]float64{{4.8, 2.7, 6.8}, {0, 8, 10}}, Easing: "ease_out"}, 1); err != nil {
		t.Fatal(err)
	}
	camera := cloudAgentPrevisFindByID(creationMaps(scene["cameras"]), "s-camera-1")
	cameraFrames := creationMaps(camera["keyframes"])
	if end, _ := cloudAgentPrevisNumberVec3(cloudAgentPrevisMapTransform(cameraFrames[len(cameraFrames)-1])["position"]); end[1] != 8 {
		t.Fatalf("camera path height must go into position Y: %v", end)
	}

	for name, operation := range map[string]cloudAgentPrevisPatchOperation{
		"unknown sketch":    {Type: "object_motion_path_set", ID: "s-actor-1", PathID: previsStringPtr("路径9")},
		"both sources":      {Type: "object_motion_path_set", ID: "s-actor-1", PathID: &pathID, PathPoints: [][]float64{{0, 0, 0}, {1, 0, 0}}},
		"underground actor": {Type: "object_motion_path_set", ID: "s-actor-1", PathPoints: [][]float64{{0, -1, 0}, {1, 0, 0}}},
		"step easing":       {Type: "object_motion_path_set", ID: "s-actor-1", PathPoints: [][]float64{{0, 0, 0}, {1, 0, 0}}, Easing: "step"},
		"unknown target":    {Type: "object_motion_path_set", ID: "ghost", PathPoints: [][]float64{{0, 0, 0}, {1, 0, 0}}},
	} {
		if _, err := cloudAgentPrevisApplyPatchOperation(scene, operation, 2); err == nil {
			t.Fatalf("%s must be rejected", name)
		}
	}

	projection := projectPrevisScene(scene, "", nil)
	paths, _ := projection["paths"].([]map[string]any)
	if len(paths) != 1 || paths[0]["label"] != "路径1" || paths[0]["maxHeight"] != 3.0 {
		t.Fatalf("sketch paths must be projected: %#v", projection["paths"])
	}
	foundActorPath := false
	for _, object := range projection["objects"].([]map[string]any) {
		if object["id"] == "s-actor-1" {
			path, _ := object["motionPath"].(map[string]any)
			foundActorPath = path != nil && path["easing"] == "smooth" && path["maxHeight"] == 3.0
		}
	}
	if !foundActorPath {
		t.Fatal("actor motion path must be projected with easing and height")
	}
	rules, _ := cloudAgentPrevisCatalogGuide()["rules"].(string)
	if !strings.Contains(rules, "pathId") || !strings.Contains(rules, "离地高度") {
		t.Fatalf("catalog rules must explain paths: %s", rules)
	}

	scene["paths"] = []any{map[string]any{"id": "bad", "label": "x", "points": []any{[]any{0.0, 0.0, 0.0}}}}
	if err := cloudAgentPrevisValidateScene(scene); err == nil {
		t.Fatal("sketch path with one point must be rejected")
	}
}
