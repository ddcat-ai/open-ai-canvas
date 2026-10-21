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

	// 体积预算：
	// 之后能力注册表加入角色卡（图片/视频/音频接受 character 输入）到 28,979 字节；再新增
	// canvas_create_character（角色卡打包创建，设定字段已压成一行描述）后为 25 个工具、29,938
	// 字节；本轮加入 previs_scene_create 与 previs_apply_patch 后为 27 个工具、34,171 字节，
	// 因此显式上调到 35,000；视频生成支持 Agent 设置首尾帧（#696）后为 35,050 字节，
	// 再显式上调到 36,000，保留约2.7%的余量。skill_search 补触发时机与零命中行为
	// 描述后为 36,072 字节；启用视觉工具后为 29 个工具、36,883 字节，预算显式上调到
	// 37,500，保留约1.7%的余量。新增工具或字段时请重新测量并有意识地
	// 调整这个数字，而不是让 schema 悄悄膨胀（它每一步都要发、还在前缀最前面）。
	// #840 补全角色设定嵌套字段并压缩本工具描述后为 37,480 字节，仍保持原预算。
	if len(raw) > 37500 {
		t.Fatalf("平台工具 schema 体积 %d 字节超出预算 37500：请压缩描述或显式调整预算", len(raw))
	}
}

func TestCloudAgentCharacterDefinitionSchema(t *testing.T) {
	tools, _ := platformToolSchema(t)
	for _, tool := range tools {
		function := tool["function"].(map[string]any)
		if function["name"] != "canvas_create_character" {
			continue
		}
		parameters := function["parameters"].(map[string]any)
		if !reflect.DeepEqual(parameters["required"], []string{"nodeId", "name", "imageNodeId"}) || parameters["additionalProperties"] != false {
			t.Fatalf("character required fields or strictness changed: %#v", parameters)
		}
		definition := parameters["properties"].(map[string]any)["definition"].(map[string]any)
		if definition["type"] != "object" || definition["additionalProperties"] != false || len(schemaStringList(definition["required"])) != 0 {
			t.Fatalf("definition must be optional and reject unknown fields: %#v", definition)
		}
		properties, ok := definition["properties"].(map[string]any)
		definitionType := reflect.TypeOf(cloudAgentCharacterDefinitionArgs{})
		if !ok || len(properties) != definitionType.NumField() {
			t.Fatalf("definition schema must cover every allowed field: %#v", properties)
		}
		for i := 0; i < definitionType.NumField(); i++ {
			field := definitionType.Field(i).Tag.Get("json")
			property, ok := properties[field].(map[string]any)
			if !ok {
				t.Fatalf("missing schema for %s", field)
			}
			if field == "aliases" {
				if property["type"] != "array" || property["maxItems"] != 16 || !reflect.DeepEqual(property["items"], map[string]any{"type": "string"}) {
					t.Fatalf("aliases must be a string array with at most 16 items: %#v", property)
				}
			} else if property["type"] != "string" {
				t.Errorf("%s must remain a string: %#v", field, property)
			}
		}
		return
	}
	t.Fatal("canvas_create_character was not registered")
}
