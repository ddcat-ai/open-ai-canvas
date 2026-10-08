package app

import (
	"encoding/json"
	"reflect"
	"testing"
)

// 工具 schema 是每一步都要发出去（并且是前缀缓存的第一段）的固定开销，因此值得钉住体积：
// 平台工具全集按 auto + canvas + 技能构造（覆盖条件暴露的工具）。
func platformToolSchema(t *testing.T) ([]map[string]any, []byte) {
	t.Helper()
	req := CloudAgentRequest{PermissionMode: "auto", ContextScope: []string{"canvas"}, SkillIDs: []string{"capability-list"}}
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
	for _, tool := range tools {
		function, _ := tool["function"].(map[string]any)
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

	// 体积预算：导演台、技能检索和上下文读取工具合入后为 24 个工具、27,812 字节，预算 29,000。
	// 之后能力注册表加入角色卡（图片/视频/音频接受 character 输入）到 28,979 字节；再新增
	// canvas_create_character（角色卡打包创建，设定字段已压成一行描述）后为 25 个工具、29,938
	// 字节；本轮加入 previs_scene_create 与 previs_apply_patch 后为 27 个工具、34,171 字节，
	// 因此显式上调到 35,000；视频生成支持 Agent 设置首尾帧（#696）后为 35,050 字节，
	// 再显式上调到 36,000，保留约2.7%的余量。新增工具或字段时请重新测量并有意识地
	// 调整这个数字，而不是让 schema 悄悄膨胀（它每一步都要发、还在前缀最前面）。
	if len(raw) > 36000 {
		t.Fatalf("平台工具 schema 体积 %d 字节超出预算 36000：请压缩描述或显式调整预算", len(raw))
	}
}
