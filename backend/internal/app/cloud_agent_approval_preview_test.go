package app

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func stringPtr(value string) *string { return &value }

func TestCloudAgentCanvasApprovalPreviewDescribesUpdateTargetAndFields(t *testing.T) {
	doc, err := creationDocument(`{"nodes":[{"id":"video-1","type":"video","title":"满月庆祝视频草稿","metadata":{"content":"已提交结果","prompt":"private prompt","status":"succeeded"}}],"connections":[]}`)
	if err != nil {
		t.Fatal(err)
	}
	newTitle := "满月庆祝视频草稿（舒缓呼吸感）"
	newPrompt := "private next prompt"
	items, err := applyCloudAgentCanvasPlan(doc, []agentCanvasOp{{
		Type: "update_node", ID: "video-1", Patch: map[string]any{"title": newTitle, "content": newPrompt},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one preview item, got %d", len(items))
	}
	item := items[0]
	if item.NodeTitle != "满月庆祝视频草稿" || item.NodeType != "video" || item.NodeTypeLabel != "视频" {
		t.Fatalf("preview lost target identity: %+v", item)
	}
	if item.ResultTitle != newTitle || strings.Join(item.Fields, "、") != "节点名称、提示词" {
		t.Fatalf("preview lost changed fields: %+v", item)
	}
	raw, _ := json.Marshal(item)
	if strings.Contains(string(raw), "private") {
		t.Fatalf("preview exposed private content or internal id: %s", raw)
	}
	metadata := doc["nodes"].([]map[string]any)[0]["metadata"].(map[string]any)
	generationSpec := metadata["generationSpec"].(map[string]any)
	if metadata["content"] != "已提交结果" || metadata["prompt"] != "private prompt" || generationSpec["prompt"] != newPrompt {
		t.Fatalf("preview mutated media result incorrectly: %+v", metadata)
	}
}

func TestCloudAgentStoryboardConnectionsUseRowHandlesAndPersistBindings(t *testing.T) {
	doc, err := creationDocument(`{"nodes":[{"id":"script-1","type":"script","title":"分镜","metadata":{"storyboard":{"rows":[{"id":"row-1","shotNumber":1,"durationSeconds":5,"assetBindings":[],"imageNodeId":""}],"referenceNodeIds":[]}}},{"id":"image-1","type":"image","title":"环境图","metadata":{"content":"ready","assetCategory":"environment"}},{"id":"video-1","type":"video","title":"镜头视频","metadata":{}}],"connections":[]}`)
	if err != nil {
		t.Fatal(err)
	}
	items, err := applyCloudAgentCanvasPlan(doc, []agentCanvasOp{
		{Type: "update_node", ID: "script-1", Patch: map[string]any{"title": "夜雨分镜", "x": 120.0, "y": 240.0}},
		{Type: "connect_nodes", ID: "edge-asset", FromNodeID: "image-1", ToNodeID: "script-1", ToHandleID: "row:row-1"},
		{Type: "connect_nodes", ID: "edge-output", FromNodeID: "script-1", ToNodeID: "video-1", FromHandleID: "row:row-1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 3 || len(items[1].Details) != 1 || !strings.Contains(items[1].Details[0], "row-1") {
		t.Fatalf("row handle was not reflected in approval preview: %+v", items)
	}
	connections := creationMaps(doc["connections"])
	if len(connections) != 2 || stringValue(connections[0]["toHandleId"]) != "row:row-1" || stringValue(connections[1]["fromHandleId"]) != "row:row-1" {
		t.Fatalf("row handles were not persisted: %+v", connections)
	}
	script := cloudAgentNodeByID(creationMaps(doc["nodes"]), "script-1")
	if script["title"] != "夜雨分镜" {
		t.Fatalf("script title update was not applied: %#v", script)
	}
	position := script["position"].(map[string]any)
	if position["x"] != 120.0 || position["y"] != 240.0 {
		t.Fatalf("script position update was not applied: %#v", position)
	}
	metadata := script["metadata"].(map[string]any)
	storyboard := metadata["storyboard"].(map[string]any)
	row := creationMaps(storyboard["rows"])[0]
	if stringValue(row["imageNodeId"]) != "" {
		t.Fatalf("asset connection should not be treated as storyboard output: %#v", row)
	}
	bindings := creationMaps(row["assetBindings"])
	if len(bindings) != 1 || stringValue(bindings[0]["nodeId"]) != "image-1" || stringValue(bindings[0]["role"]) != "environment" {
		t.Fatalf("row asset binding was not persisted: %#v", row)
	}
}

func TestCloudAgentCanvasApprovalPreviewDescribesConnectionsAndMixedOperations(t *testing.T) {
	doc, err := creationDocument(`{"nodes":[{"id":"image-1","type":"image","title":"参考图"},{"id":"video-1","type":"video","title":"视频镜头"}],"connections":[]}`)
	if err != nil {
		t.Fatal(err)
	}
	items, err := applyCloudAgentCanvasPlan(doc, []agentCanvasOp{
		{Type: "add_node", ID: "text-1", NodeType: "text", Title: stringPtr("镜头备注"), Content: stringPtr("private body")},
		{Type: "update_node", ID: "video-1", Patch: map[string]any{"title": "视频镜头新版"}},
		{Type: "connect_nodes", ID: "edge-1", FromNodeID: "image-1", ToNodeID: "video-1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 3 {
		t.Fatalf("expected mixed preview items, got %d", len(items))
	}
	if !strings.Contains(items[0].Summary, "新增文本") || !strings.Contains(items[1].Summary, "节点名称") {
		t.Fatalf("mixed preview summaries are incomplete: %+v", items)
	}
	if !strings.Contains(items[2].Summary, "参考图") || !strings.Contains(items[2].Summary, "视频镜头") {
		t.Fatalf("connection preview omitted endpoints: %+v", items[2])
	}
	preview := cloudAgentCanvasApprovalPreview(items)
	if !strings.Contains(preview.Description, "新增 1 个节点") || !strings.Contains(preview.Description, "修改 1 个节点") || !strings.Contains(preview.Description, "建立 1 条引用连线") {
		t.Fatalf("preview description omitted operation counts: %s", preview.Description)
	}
}

func TestCloudAgentCanvasApprovalPreviewRejectsUnknownTargetInsteadOfFallingBack(t *testing.T) {
	doc, err := creationDocument(`{"nodes":[],"connections":[]}`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = applyCloudAgentCanvasPlan(doc, []agentCanvasOp{{
		Type: "update_node", ID: "missing", Patch: map[string]any{"title": "不能静默写入"},
	}})
	if err == nil || !strings.Contains(err.Error(), "只能更新现有") {
		t.Fatalf("unknown target was not rejected: %v", err)
	}
}

// 漏 patch 必须是**可恢复的参数错误**：运行期会把它当工具结果回给模型重试，
// 而不是把整轮判死；未知操作类型（例如删除）仍按准入失败终止。
func TestCloudAgentCanvasApprovalPreviewTreatsInvalidConnectionEndpointsAsArgumentErrors(t *testing.T) {
	for _, tc := range []struct {
		name, from, to, field string
	}{
		{"missing source", "missing", "image-1", "ops[0].fromNodeId"},
		{"missing target", "image-1", "missing", "ops[0].toNodeId"},
		{"self connection", "image-1", "image-1", "ops[0].toNodeId"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			doc, err := creationDocument(`{"nodes":[{"id":"image-1","type":"image","title":"参考图"}],"connections":[]}`)
			if err != nil {
				t.Fatal(err)
			}
			_, err = applyCloudAgentCanvasPlan(doc, []agentCanvasOp{{Type: "connect_nodes", ID: "edge-1", FromNodeID: tc.from, ToNodeID: tc.to}})
			var fieldErr *cloudAgentFieldArgumentError
			if !errors.As(err, &fieldErr) || fieldErr.Field != tc.field {
				t.Fatalf("expected repairable field error %q, got %v", tc.field, err)
			}
		})
	}
}

func TestCloudAgentCanvasApprovalPreviewTreatsMissingPatchAsArgumentError(t *testing.T) {
	doc, err := creationDocument(`{"nodes":[{"id":"image-1","type":"image","title":"参考图"}],"connections":[]}`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = applyCloudAgentCanvasPlan(doc, []agentCanvasOp{{Type: "update_node", ID: "image-1"}})
	var argumentErr *cloudAgentArgumentError
	if !errors.As(err, &argumentErr) {
		t.Fatalf("漏 patch 应当是可恢复的参数错误，实际：%v", err)
	}

	_, err = applyCloudAgentCanvasPlan(doc, []agentCanvasOp{{Type: "delete_node", ID: "image-1"}})
	if err == nil {
		t.Fatal("未知画布写操作必须仍然报错")
	}
	if errors.As(err, &argumentErr) {
		t.Fatalf("未知画布写操作不能被当成可恢复的参数错误：%v", err)
	}
}
