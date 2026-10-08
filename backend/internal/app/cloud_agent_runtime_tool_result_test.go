package app

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
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
	cases := []struct{ name, args string }{
		{"recall_lessons", `{"topic":"用户称呼偏好"}`},
		{"recall_lessons", `{}`},
		{"canvas_list_node_types", `{}`},
		{"canvas_get_state", `{}`},
	}
	calls := make([]cloudAgentCall, 0, len(cases))
	for index, tc := range cases {
		var call cloudAgentCall
		call.ID = fmt.Sprintf("tool-result-%d", index)
		call.Function.Name = tc.name
		call.Function.Arguments = tc.args
		calls = append(calls, call)
	}

	// executeCloudAgentRuntimeTool is intentionally strict: a bridge result is
	// accepted only when the model declaration has already been checkpointed.
	// Build that same durable boundary here instead of bypassing the contract by
	// calling the executor with an arbitrary call.
	persisted, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(persisted)
	if err != nil {
		t.Fatal(err)
	}
	state.Calls = calls
	state.CallIndex = 0
	state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{
		"role": "assistant", "content": "", "tool_calls": calls,
	})
	if err := s.repo.MutateCloudAgent("user", run.ID, persisted.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatalf("persist model tool calls: %v", err)
	}

	for index, tc := range cases {
		call := calls[index]
		result, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", run.ID, call)
		if err != nil {
			t.Fatalf("%s(%s) bridge error: %v", tc.name, tc.args, err)
		}
		payload, _ := result.(map[string]any)
		content, _ := payload["content"].(string)
		if strings.TrimSpace(content) == "" || content == "null" {
			t.Fatalf("%s(%s) returned empty tool content: %#v", tc.name, tc.args, result)
		}

		// The bridge can retry after losing its response. The second request must
		// replay the committed tool message, not execute the next model call.
		replayed, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", run.ID, call)
		if err != nil {
			t.Fatalf("%s(%s) replay error: %v", tc.name, tc.args, err)
		}
		replayedPayload, _ := replayed.(map[string]any)
		if replayedPayload["content"] != content {
			t.Fatalf("%s(%s) replay changed committed content: first=%q replay=%#v", tc.name, tc.args, content, replayed)
		}
	}
}
