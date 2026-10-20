package app

import (
	"encoding/json"
	"reflect"
	"testing"
)

// 工具 schema 是每一步都要发出去（并且是前缀缓存的第一段）的固定开销，因此值得钉住体积：
// 平台工具全集按 auto + canvas + 技能 + 视觉工具构造，覆盖最大条件工具集。
func platformToolSchema(t *testing.T) ([]map[string]any, []byte) {
	t.Helper()
	req := CloudAgentRequest{PermissionMode: "auto", ContextScope: []string{"canvas"}, SkillIDs: []string{"capability-list"}, VisionEnabled: true}
	req.Budget.MaxGenerationTasks = 1
	tools := cloudAgentTools(req)
	raw, err := json.Marshal(tools)
	if err != nil {
		t.Fatal(err)
	}
	return tools, raw
}

func TestCloudAgentToolSchemaStaysCompact(t *testing.T) {
	tools, raw := platformToolSchema(t)
	t.Logf("platform tool schema: %d tools, %d bytes", len(tools), len(raw))

	// 条件必填不是 type 枚举能表达的约束，压缩描述不能删掉协议语义。
	found := false
	foundVision := false
	for _, tool := range tools {
		function, _ := tool["function"].(map[string]any)
		if function["name"] == "canvas_inspect_image" {
			foundVision = true
		}
		if function["name"] != "canvas_apply_ops" {
			continue
		}
		found = true
		parameters, _ := function["parameters"].(map[string]any)
		ops, _ := parameters["properties"].(map[string]any)
		items, _ := ops["ops"].(map[string]any)
		opItem, _ := items["items"].(map[string]any)
		want := []map[string]any{
			{"properties": map[string]any{"type": map[string]any{"const": "add_node"}}, "required": []string{"nodeType"}},
			{"properties": map[string]any{"type": map[string]any{"const": "update_node"}}, "required": []string{"patch"}},
			{"properties": map[string]any{"type": map[string]any{"const": "connect_nodes"}}, "required": []string{"fromNodeId", "toNodeId"}},
		}
		if !reflect.DeepEqual(opItem["oneOf"], want) {
			t.Fatalf("操作类型条件必填约束丢失: %#v", opItem["oneOf"])
		}
		if props, ok := opItem["properties"].(map[string]any); !ok || len(props) == 0 {
			t.Fatal("canvas_apply_ops 的 ops.items 必须保留 properties")
		}
	}
	if !found {
		t.Fatal("canvas_apply_ops 未暴露")
	}
	if !foundVision {
		t.Fatal("启用视觉能力后 canvas_inspect_image 未暴露")
	}

	names := map[string]bool{}
	for _, tool := range tools {
		function, _ := tool["function"].(map[string]any)
		names[stringValue(function["name"])] = true
	}
	for _, name := range []string{"canvas_create_character", "canvas_prepare_storyboard_image", "previs_scene_create", "previs_apply_patch"} {
		if !names[name] || !cloudAgentWrite(name) {
			t.Fatalf("merged write tool missing schema or authorization: %s", name)
		}
	}

	if len(raw) > 37500 {
		t.Fatalf("平台工具 schema 体积 %d 字节超出预算 37500：请压缩描述或显式调整预算", len(raw))
	}
}
