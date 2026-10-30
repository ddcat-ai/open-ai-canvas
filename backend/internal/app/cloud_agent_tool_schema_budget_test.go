package app

import (
	"bytes"
	"encoding/json"
	"testing"
)

// 工具 schema 是每一步都要发出去（并且是前缀缓存的第一段）的固定开销，因此值得钉住体积：
// 平台工具全集按 auto + canvas + 技能 + 视觉工具构造，覆盖最大条件工具集。
func platformToolSchema(t *testing.T) ([]map[string]any, []byte) {
	t.Helper()
	req := CloudAgentRequest{PermissionMode: "auto", ContextScope: []string{"canvas"}, SkillsEnabled: true, MemoryMode: "auto", VisionEnabled: true}
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
		gotJSON, _ := json.Marshal(opItem["oneOf"])
		wantJSON, _ := json.Marshal(want)
		if !bytes.Equal(gotJSON, wantJSON) {
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
	// 37,500，保留约1.7%的余量。预演台加入目录道具、程序化布景与 world_update 后为
	// 38,340 字节（道具目录 ID 放在 previs_scene_read.catalog 而不是 schema 枚举里，
	// 只增加字段名与天气/远景/模板枚举），预算显式上调到 39,000；再加入参数化组件 params 与
	// object_array_add 后为 38,770 字节（参数键与范围同样放在 catalog 里）；再加入 actor_travel
	// （travelStyle 枚举、fromMarker/toMarker、height）后为 39,077 字节，预算显式上调到 39,700，余量约1.6%。
	// 主分支同期把长期记忆改用 memory_update（替换 remember_lesson / recall_lessons）并新增
	// skill_market_search、skill_recommend（单独测量为 30 个工具、37,277 字节）；两者合并后为
	// 30 个工具、38,984 字节，预算不变，余量约1.8%。世界引擎加入 camera_move / camera_move_remove（technique、
	// subjectId 两个字段；手法表、参数范围和大师手法配方放在 previs_scene_read.catalog）并把预演台改名为世界引擎后为
	// 39,236 字节，预算不变，余量约1.2%。路径动画加入 pathId（引用用户画的参考轨迹）并把 easing 扩展为运动规律
	// （ease_in / ease_out；路径规则放在 catalog.rules）后为 39,299 字节，预算不变，余量约1.0%。previs_scene_read 加入 manual（世界引擎说明书主题；正文按需返回，
	// 主题目录放在读取结果里）后为 39,394 字节，预算不变，余量约0.8%。camera_move 加入 recipe（大师手法整套写入；
	// 配方表与逐段构成放在 catalog.cameraRecipes）并压缩 previs_apply_patch 的运镜描述后为 39,416 字节，预算不变。
	// shot_add / shot_update 加入 aspectRatio（镜头画幅枚举）后为 39,512 字节，预算不变，余量约0.5%。
	// 新增工具或字段时请重新测量并有意识地调整这个数字，而不是让 schema 悄悄膨胀
	// （它每一步都要发、还在前缀最前面）。
	if len(raw) > 39700 {
		t.Fatalf("平台工具 schema 体积 %d 字节超出预算 39700：请压缩描述或显式调整预算", len(raw))
	}
}
