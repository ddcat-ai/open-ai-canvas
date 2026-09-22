package app

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

// geometryPatchFixture 造一对"只差位置"的重节点：正文很大，几何变化很小。
func geometryPatchFixture() (map[string]any, map[string]any) {
	heavy := strings.Repeat("分镜行正文", 2000)
	node := func(x, y float64, rows []any) map[string]any {
		return map[string]any{
			"id": "sb-1", "type": "script", "title": "第一场",
			"position": map[string]any{"x": x, "y": y}, "width": 920.0, "height": 360.0,
			"metadata": map[string]any{"storyboard": map[string]any{"rows": rows}, "status": "idle"},
		}
	}
	return node(0, 0, []any{heavy}), node(120, 480, []any{heavy})
}

// 位置/尺寸变化只发几何增量：一次整理几十个分镜节点时，完整 before/after 会让单条
// canvas_updated 事件超过 validateCloudAgentRuntime 的 128KiB 单事件上限，整轮直接终止。
func TestCloudAgentGeometryOnlyChangeShrinksPatch(t *testing.T) {
	before, after := geometryPatchFixture()
	shrunkBefore, shrunkAfter := cloudAgentShrinkChange(before, after)
	raw, _ := json.Marshal([]map[string]any{{"before": shrunkBefore, "after": shrunkAfter}})
	if len(raw) > 512 {
		t.Fatalf("几何增量仍然过大（%d 字节）：%s", len(raw), raw)
	}
	if shrunkBefore["id"] != "sb-1" || shrunkAfter["id"] != "sb-1" {
		t.Fatalf("增量必须带 id：%+v %+v", shrunkBefore, shrunkAfter)
	}
	if _, ok := shrunkAfter["position"]; !ok {
		t.Fatalf("几何增量缺少 position：%+v", shrunkAfter)
	}
	if _, ok := shrunkAfter["metadata"]; ok {
		t.Fatalf("几何增量不应携带正文字段：%+v", shrunkAfter)
	}

	// 新增节点（before 为空）没有可比对的旧值，不缩。
	if _, kept := cloudAgentShrinkChange(nil, after); kept["metadata"] == nil {
		t.Fatalf("新增节点不应被缩减：%+v", kept)
	}
}

// 内容变化（正文 / metadata）仍发完整 before/after：前端按字段三方合并，缩成几何增量会
// 丢掉内容变化，也会影响前端对生成任务状态的保护逻辑。
func TestCloudAgentContentChangeKeepsFullPatch(t *testing.T) {
	before, after := geometryPatchFixture()
	contentAfter := map[string]any{
		"id": "sb-1", "type": "script", "title": "第一场",
		"position": after["position"], "width": 920.0, "height": 360.0,
		"metadata": map[string]any{"storyboard": map[string]any{"rows": []any{"改过的行"}}, "status": "idle"},
	}
	keptBefore, keptAfter := cloudAgentShrinkChange(before, contentAfter)
	if _, ok := keptAfter["metadata"]; !ok {
		t.Fatalf("内容变化被错误地缩成几何增量：%+v", keptAfter)
	}
	if keptBefore["id"] != before["id"] || keptBefore["metadata"] == nil {
		t.Fatalf("内容变化应保留完整 before：%+v", keptBefore)
	}

	// 键被删掉时同样不缩：只发几何字段会让前端无法区分"消失的字段"与"保持本地值"。
	keyRemoved := map[string]any{"id": "sb-1", "type": "script", "title": "第一场", "position": after["position"]}
	deletedBefore, deletedAfter := cloudAgentShrinkChange(before, keyRemoved)
	if !reflect.DeepEqual(deletedBefore, before) || !reflect.DeepEqual(deletedAfter, keyRemoved) {
		t.Fatalf("缺键的变更不应被缩成几何增量：%+v %+v", deletedBefore, deletedAfter)
	}
}
