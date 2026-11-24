package app

import (
	"math"
	"strings"
	"testing"
)

// Agent 用目录道具、整片布景和 world_update 搭外景，而不是用 box 拼房子。
func TestCloudAgentPrevisCatalogPropsLayoutAndWorld(t *testing.T) {
	scene, err := cloudAgentPrevisSceneCreateTemplate(cloudAgentPrevisSceneCreateArgs{SceneID: "street", Title: "长安街", TemplateID: "empty"})
	if err != nil {
		t.Fatal(err)
	}
	timeOfDay, groundSize, seed, size, variant := 5.0, 2000, 42, 420.0, 3
	ops := []cloudAgentPrevisPatchOperation{
		{Type: "world_update", ID: "street", TimeOfDay: &timeOfDay, Weather: "snow", GroundSize: &groundSize},
		{Type: "object_add", ID: "city", Kind: "layout", LayoutTemplate: "ancient_city", Seed: &seed, Size: &size},
		{Type: "object_add", ID: "willow", Kind: "prop", PropID: "tree_willow", Position: &[]float64{3, -1, 2}},
		{Type: "object_add", ID: "car", Kind: "prop", PropID: "car", Variant: &variant},
	}
	for index, op := range ops {
		if _, err := cloudAgentPrevisApplyPatchOperation(scene, op, index); err != nil {
			t.Fatalf("op %d (%s) failed: %v", index, op.Type, err)
		}
	}
	cloudAgentPrevisGroundScene(scene)
	if err := cloudAgentPrevisValidateScene(scene); err != nil {
		t.Fatalf("scene invalid: %v", err)
	}
	world, _ := scene["world"].(map[string]any)
	if stringValue(world["weather"]) != "snow" || numberValue(world["timeOfDay"], 0) != 5 || int(numberValue(world["groundSize"], 0)) != 2000 || stringValue(world["ground"]) != "grass" {
		t.Fatalf("world not merged with defaults: %#v", world)
	}
	objects := creationMaps(scene["objects"])
	city := cloudAgentPrevisFindByID(objects, "city")
	layout, _ := city["layout"].(map[string]any)
	if stringValue(city["name"]) != "古代城池" || stringValue(layout["template"]) != "ancient_city" || numberValue(layout["size"], 0) != 420 || !boolValue(layout["crowd"], false) {
		t.Fatalf("layout defaults wrong: %#v", city)
	}
	willow := cloudAgentPrevisFindByID(objects, "willow")
	position, _ := cloudAgentPrevisNumberVec3(cloudAgentPrevisMapTransform(willow)["position"])
	if stringValue(willow["propId"]) != "tree_willow" || stringValue(willow["name"]) != "垂柳" || position[1] != 0 {
		t.Fatalf("prop not grounded or named from catalog: %#v", willow)
	}
	if car := cloudAgentPrevisFindByID(objects, "car"); stringValue(car["color"]) != "#c0392b" || int(numberValue(car["variant"], 0)) != 3 {
		t.Fatalf("car should take catalog accent color and variant: %#v", car)
	}

	// 改布景参数走 object_update，越界与错用都要拒绝。
	density := 0.4
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "object_update", ID: "city", Density: &density}, 0); err != nil {
		t.Fatal(err)
	}
	tooBig := 5000.0
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "object_update", ID: "city", Size: &tooBig}, 0); err == nil {
		t.Fatal("oversized layout must be rejected")
	}
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "object_update", ID: "willow", Seed: &seed}, 0); err == nil {
		t.Fatal("layout params on a prop must be rejected")
	}
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "object_add", ID: "ufo", Kind: "prop", PropID: "ufo"}, 0); err == nil || !strings.Contains(err.Error(), "catalog") {
		t.Fatalf("unknown propId must be rejected with catalog hint, got %v", err)
	}
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "world_update", ID: "street", Weather: "acid"}, 0); err == nil {
		t.Fatal("unknown weather must be rejected")
	}
	off := false
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "world_update", ID: "street", WorldEnabled: &off}, 0); err != nil || scene["world"] != nil {
		t.Fatalf("worldEnabled=false must remove world, err=%v", err)
	}

	// 「三栋 12 层玻璃楼」：一个 object_array_add，参数校验并补全默认值。
	count, floors := 3, 12.0
	towers := cloudAgentPrevisPatchOperation{Type: "object_array_add", ID: "glass", PropID: "building", Count: &count, Params: map[string]any{"floors": floors, "style": "glass"}, Position: &[]float64{40, 0, 0}}
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, towers, 0); err != nil {
		t.Fatal(err)
	}
	objects = creationMaps(scene["objects"])
	for index := 1; index <= 3; index++ {
		item := cloudAgentPrevisFindByID(objects, "glass-"+string(rune('0'+index)))
		params, _ := item["params"].(map[string]any)
		if item == nil || numberValue(params["floors"], 0) != 12 || stringValue(params["style"]) != "glass" || stringValue(params["roof"]) != "flat" {
			t.Fatalf("array item %d wrong: %#v", index, item)
		}
	}
	first, _ := cloudAgentPrevisNumberVec3(cloudAgentPrevisMapTransform(cloudAgentPrevisFindByID(objects, "glass-1"))["position"])
	last, _ := cloudAgentPrevisNumberVec3(cloudAgentPrevisMapTransform(cloudAgentPrevisFindByID(objects, "glass-3"))["position"])
	if math.Abs((last[0]-first[0])-32) > 0.001 || math.Abs((first[0]+last[0])/2-40) > 0.001 {
		t.Fatalf("line spacing should default to width+2 around center: %v %v", first, last)
	}
	if err := cloudAgentPrevisValidateScene(scene); err != nil {
		t.Fatalf("scene with arrays invalid: %v", err)
	}
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "object_update", ID: "glass-2", Params: map[string]any{"floors": 30.0}}, 0); err != nil {
		t.Fatal(err)
	}
	if params, _ := cloudAgentPrevisFindByID(creationMaps(scene["objects"]), "glass-2")["params"].(map[string]any); numberValue(params["floors"], 0) != 30 || stringValue(params["style"]) != "glass" {
		t.Fatalf("params update must merge: %#v", params)
	}
	for name, bad := range map[string]map[string]any{"unknown key": {"color": "red"}, "out of range": {"floors": 500.0}, "bad enum": {"style": "gothic"}} {
		if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "object_update", ID: "glass-1", Params: bad}, 0); err == nil {
			t.Fatalf("%s params must be rejected", name)
		}
	}

	// 「让人物 3 秒从 A 点御剑飞到 B 点」：按右键标记点生成贴地起终帧与位移段。
	scene["markers"] = []any{map[string]any{"id": "m1", "label": "A", "position": []any{-5.0, 0.0, 2.0}}, map[string]any{"id": "m2", "label": "B", "position": []any{7.0, 0.0, -4.0}}}
	scene["objects"] = append(creationMapsToAnyForTest(creationMaps(scene["objects"])), map[string]any{"id": "hero", "name": "主角", "kind": "actor", "primitive": "character", "color": "#2f7de1", "visible": true, "transform": map[string]any{"position": []any{0.0, 0.0, 0.0}, "rotation": []any{0.0, 0.0, 0.0}, "scale": []any{1.0, 1.0, 1.0}}, "keyframes": []any{}})
	start, travelDuration := 1.0, 3.0
	from, to := "A", "b"
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "actor_travel", ID: "hero", TravelStyle: "sword_fly", FromMarker: &from, ToMarker: &to, Time: &start, Duration: &travelDuration}, 0); err != nil {
		t.Fatal(err)
	}
	hero := cloudAgentPrevisFindByID(creationMaps(scene["objects"]), "hero")
	frames := creationMaps(hero["keyframes"])
	if len(frames) != 2 || numberValue(frames[0]["time"], 0) != 1 || numberValue(frames[1]["time"], 0) != 4 {
		t.Fatalf("travel keyframes wrong: %#v", frames)
	}
	endPosition, _ := cloudAgentPrevisNumberVec3(cloudAgentPrevisMapTransform(frames[1])["position"])
	if endPosition[0] != 7 || endPosition[1] != 0 || endPosition[2] != -4 || stringValue(frames[0]["easing"]) != "smooth" {
		t.Fatalf("travel must end grounded at B with smooth flight easing: %#v", frames)
	}
	travels := creationMaps(hero["travels"])
	if len(travels) != 1 || stringValue(travels[0]["style"]) != "sword_fly" || numberValue(travels[0]["height"], 0) != 2.5 {
		t.Fatalf("travel segment wrong: %#v", travels)
	}
	if err := cloudAgentPrevisValidateScene(scene); err != nil {
		t.Fatalf("scene with travel invalid: %v", err)
	}
	// 闪现：step 起点帧；越过镜头时长、未知标记点要拒绝。
	teleportStart, short := 4.0, 0.5
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "actor_travel", ID: "hero", TravelStyle: "teleport", ToMarker: &from, Time: &teleportStart, Duration: &short}, 0); err != nil {
		t.Fatal(err)
	}
	if frames := creationMaps(cloudAgentPrevisFindByID(creationMaps(scene["objects"]), "hero")["keyframes"]); stringValue(frames[1]["easing"]) != "step" {
		t.Fatalf("teleport must hold with step easing: %#v", frames)
	}
	long := 30.0
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "actor_travel", ID: "hero", ToMarker: &to, Duration: &long}, 0); err == nil {
		t.Fatal("travel beyond shot duration must be rejected")
	}
	missing := "Z"
	if _, err := cloudAgentPrevisApplyPatchOperation(scene, cloudAgentPrevisPatchOperation{Type: "actor_travel", ID: "hero", ToMarker: &missing}, 0); err == nil || !strings.Contains(err.Error(), "A、B") {
		t.Fatalf("unknown marker must list existing labels, got %v", err)
	}
	if markers, _ := projectPrevisScene(scene, "", nil)["markers"].([]map[string]any); len(markers) != 2 {
		t.Fatalf("markers must be projected for the agent: %#v", markers)
	}

	// 读场景时投影道具 ID 与布景参数，并给出目录。
	projection := projectPrevisScene(scene, "", nil)
	found := false
	for _, object := range projection["objects"].([]map[string]any) {
		if object["id"] == "city" {
			found = object["layout"] != nil
		}
	}
	if !found {
		t.Fatalf("layout params missing from projection: %#v", projection["objects"])
	}
	guide := cloudAgentPrevisCatalogGuide()
	if props, _ := guide["props"].(map[string]string); !strings.Contains(props["古风建筑"], "ancient_house") {
		t.Fatalf("catalog guide missing ancient props: %#v", guide)
	}
}

func creationMapsToAnyForTest(items []map[string]any) []any {
	result := make([]any, 0, len(items))
	for _, item := range items {
		result = append(result, item)
	}
	return result
}

// 场景里有当前服务不认识的对象类型时，报错要指明是哪个对象，避免 Agent 误判为自己的操作对象有问题。
func TestCloudAgentPrevisUnknownKindErrorNamesTheObject(t *testing.T) {
	scene, err := cloudAgentPrevisSceneCreateTemplate(cloudAgentPrevisSceneCreateArgs{SceneID: "s", Title: "t", TemplateID: "empty"})
	if err != nil {
		t.Fatal(err)
	}
	scene["objects"] = []any{map[string]any{"id": "future", "name": "未来对象", "kind": "hologram", "color": "#8795a5", "visible": true, "transform": map[string]any{"position": []any{0.0, 0.0, 0.0}, "rotation": []any{0.0, 0.0, 0.0}, "scale": []any{1.0, 1.0, 1.0}}, "keyframes": []any{}}}
	err = cloudAgentPrevisValidateScene(scene)
	if err == nil || !strings.Contains(err.Error(), "future") || !strings.Contains(err.Error(), "hologram") {
		t.Fatalf("error must name object and kind, got %v", err)
	}
}
