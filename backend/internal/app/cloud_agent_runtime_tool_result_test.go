package app

import (
	"context"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

// 线上复现：recall_lessons 经运行时工具桥执行后，交回模型的 tool 消息是 "null"，
// 上游拿到空结果后返回空内容，整轮失败。任何工具结果都必须是非空的 JSON 文本。
func TestCloudAgentRuntimeToolResultIsNeverNull(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	run, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ name, args string }{
		{"recall_lessons", `{"topic":"用户称呼偏好"}`},
		{"recall_lessons", `{}`},
		{"canvas_list_node_types", `{}`},
		{"canvas_get_state", `{}`},
	} {
		var call cloudAgentCall
		call.ID = "call-" + tc.name + "-" + tc.args
		call.Function.Name = tc.name
		call.Function.Arguments = tc.args
		result, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", run.ID, call)
		if err != nil {
			t.Fatalf("%s(%s) bridge error: %v", tc.name, tc.args, err)
		}
		payload, _ := result.(map[string]any)
		content, _ := payload["content"].(string)
		if strings.TrimSpace(content) == "" || content == "null" {
			t.Fatalf("%s(%s) returned empty tool content: %#v", tc.name, tc.args, result)
		}
	}
}
