package app

import (
	"testing"

	"infinite-canvas/backend/internal/canvas/capability"
)

func TestCloudAgentVideoFrameToolSchema(t *testing.T) {
	req := CloudAgentRequest{PermissionMode: "auto", ContextScope: []string{"canvas"}}
	found := false
	for _, tool := range cloudAgentTools(req) {
		function := tool["function"].(map[string]any)
		if function["name"] != "generate_media" {
			continue
		}
		found = true
		properties := function["parameters"].(map[string]any)["properties"].(map[string]any)
		for _, key := range []string{"videoStartFrameNodeId", "videoEndFrameNodeId"} {
			if properties[key].(map[string]any)["type"] != "string" {
				t.Fatalf("生成工具未暴露 %s", key)
			}
		}
	}
	if !found {
		t.Fatal("缺少生成工具")
	}
}

func TestCloudAgentVideoFrameGenerationValidation(t *testing.T) {
	refs := map[string]any{
		"referenceImages": []map[string]any{{"id": "first"}, {"id": "last"}},
		"referenceVideos": []map[string]any{{"id": "clip"}},
	}
	base := cloudAgentMediaArgs{Mode: "video", ChannelID: "channel", ChannelModelKey: "video", ReferenceNodeIDs: []string{"last", "first", "clip"}, VideoStartFrameNodeID: "first", VideoEndFrameNodeID: "last"}
	for _, test := range []struct {
		name string
		edit func(*cloudAgentMediaArgs)
		fail bool
	}{
		{"明确首尾帧", func(*cloudAgentMediaArgs) {}, false},
		{"仅首帧", func(a *cloudAgentMediaArgs) { a.VideoEndFrameNodeID = "" }, false},
		{"仅尾帧", func(a *cloudAgentMediaArgs) { a.VideoStartFrameNodeID = "" }, false},
		{"普通参考", func(a *cloudAgentMediaArgs) { a.VideoStartFrameNodeID, a.VideoEndFrameNodeID = "", "" }, false},
		{"缺失节点", func(a *cloudAgentMediaArgs) { a.VideoStartFrameNodeID = "missing" }, true},
		{"非图片", func(a *cloudAgentMediaArgs) { a.VideoStartFrameNodeID = "clip" }, true},
		{"未选为参考", func(a *cloudAgentMediaArgs) { a.ReferenceNodeIDs = []string{"last"} }, true},
		{"非视频模式", func(a *cloudAgentMediaArgs) { a.Mode = "image" }, true},
		{"同一节点", func(a *cloudAgentMediaArgs) { a.VideoEndFrameNodeID = "first" }, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			a := base
			test.edit(&a)
			_, err := cloudAgentGenerationSpec(a, refs, nil)
			if (err != nil) != test.fail {
				t.Fatalf("参数校验结果不符合预期：%v", err)
			}
		})
	}
}

func TestCloudAgentVideoFrameCanvasEditing(t *testing.T) {
	for _, test := range []struct {
		name, kind, frame string
		connected, fail   bool
	}{
		{"设置首尾帧", "video", "first", true, false},
		{"取消选择", "video", "", false, false},
		{"未连接", "video", "first", false, true},
		{"不存在", "video", "missing", true, true},
		{"非图片", "video", "text", true, true},
		{"禁止图片节点设置帧", "image", "first", true, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			nodes := []map[string]any{
				{"id": "first", "type": "image", "metadata": map[string]any{}},
				{"id": "last", "type": "image", "metadata": map[string]any{}},
				{"id": "text", "type": "text", "metadata": map[string]any{}},
				{"id": "target", "type": test.kind, "metadata": map[string]any{}},
			}
			edges := []map[string]any{{"id": "last-edge", "fromNodeId": "last", "toNodeId": "target"}}
			if test.connected {
				edges = append(edges, map[string]any{"id": "first-edge", "fromNodeId": test.frame, "toNodeId": "target"})
			}
			doc := map[string]any{"nodes": nodes, "connections": edges}
			patch := map[string]any{"videoStartFrameNodeId": test.frame, "videoEndFrameNodeId": "last"}
			_, err := applyCloudAgentCanvasPlan(doc, []agentCanvasOp{{Type: "update_node", ID: "target", Patch: patch}})
			if (err != nil) != test.fail {
				t.Fatalf("编辑结果不符合预期：%v", err)
			}
			if err != nil {
				return
			}
			metadata := nodes[3]["metadata"].(map[string]any)
			descriptor, _ := cloudAgentNodeCapabilityForType(test.kind)
			projected, err := cloudAgentProjectNodeFields(nodes[3], metadata, descriptor, descriptor.DetailFields, 1000, true, 0)
			if err != nil || projected["videoStartFrameNodeId"] != test.frame || projected["videoEndFrameNodeId"] != "last" {
				t.Fatalf("帧选择未保存或未返回给 Agent：%v %v", projected, err)
			}
		})
	}
	for _, kind := range []string{"text", "image", "audio"} {
		descriptor, _ := capability.BuiltinRegistry().Resolve(kind)
		if err := descriptor.ValidatePatch(map[string]any{"videoEndFrameNodeId": "last"}); err == nil {
			t.Fatalf("%s 不应接受视频帧参数", kind)
		}
	}
}
