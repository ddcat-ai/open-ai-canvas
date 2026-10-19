package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
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

func TestCloudAgentRuntimeToolExecutesCallIDReusedInLaterStep(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	run, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	step := func(name string) cloudAgentCall {
		var call cloudAgentCall
		call.ID, call.Function.Name, call.Function.Arguments = "call_0", name, `{}`
		persisted, err := s.repo.CloudAgent("user", run.ID)
		if err != nil {
			t.Fatal(err)
		}
		state, err := cloudAgentDecode(persisted)
		if err != nil {
			t.Fatal(err)
		}
		state.Calls, state.CallIndex = []cloudAgentCall{call}, 0
		state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "assistant", "content": "", "tool_calls": []cloudAgentCall{call}})
		if err := s.repo.MutateCloudAgent("user", run.ID, persisted.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			return cloudAgentSave(current, &state)
		}); err != nil {
			t.Fatal(err)
		}
		return call
	}
	first, err := s.executeCloudAgentRuntimeTool(t.Context(), "user", run.ID, step("canvas_list_node_types"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.executeCloudAgentRuntimeTool(t.Context(), "user", run.ID, step("canvas_get_state"))
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(persisted)
	if err != nil {
		t.Fatal(err)
	}
	if state.CallIndex != 1 {
		t.Fatalf("second step call was not executed: CallIndex = %d", state.CallIndex)
	}
	if fmt.Sprint(first.(map[string]any)["content"]) == fmt.Sprint(second.(map[string]any)["content"]) {
		t.Fatalf("second step replayed the first step result: %v", second)
	}
}

func TestCloudAgentPiInvalidArgumentsCannotReplayPreviousStepCallID(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	run, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(persisted)
	if err != nil {
		t.Fatal(err)
	}
	call := oversizedCall("call_0", "canvas_apply_ops")
	state.Canonical.Messages = append(state.Canonical.Messages,
		map[string]any{"role": "assistant", "tool_calls": []cloudAgentCall{call}},
		map[string]any{"role": "tool", "tool_call_id": call.ID, "content": `{"error":"previous-step-receipt"}`},
		map[string]any{"role": "assistant", "tool_calls": []cloudAgentCall{call}},
	)
	if err := s.repo.MutateCloudAgent("user", run.ID, persisted.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	result, err := s.cloudAgentPiTool(t.Context(), "user", run.ID, map[string]json.RawMessage{
		"callId": json.RawMessage(`"call_0"`), "name": json.RawMessage(`"canvas_apply_ops"`), "arguments": json.RawMessage(call.Function.Arguments),
	})
	if err == nil {
		t.Fatalf("later invalid call replayed an earlier receipt: %#v", result)
	}
}

func TestCloudAgentRuntimeLegacyWriteWithoutReceiptStillRequiresReconciliation(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	run, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(persisted)
	if err != nil {
		t.Fatal(err)
	}
	call := validCall("legacy-write", "canvas_apply_ops")
	state.Calls, state.CallIndex = nil, 0
	state.Canonical.Messages = append(state.Canonical.Messages,
		map[string]any{"role": "assistant", "tool_calls": []cloudAgentCall{call}},
		map[string]any{"role": "tool", "tool_call_id": call.ID, "content": `{"applied":true}`},
		map[string]any{"role": "assistant", "content": "next step"},
	)
	if err := s.repo.MutateCloudAgent("user", run.ID, persisted.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	persisted, err = s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.prepareCloudAgentWriteReceipt(persisted, call); err == nil || !strings.Contains(err.Error(), "缺少执行回执") {
		t.Fatalf("legacy write without a receipt was admitted: %v", err)
	}
}

func TestCloudAgentRuntimeReadReplayRequiresResultFromCurrentStep(t *testing.T) {
	call := validCall("call_0", "canvas_get_state")
	state := cloudAgentRuntime{Calls: []cloudAgentCall{call}, CallIndex: 1}
	state.Canonical.Messages = []map[string]any{
		{"role": "assistant", "tool_calls": []cloudAgentCall{call}},
		{"role": "tool", "tool_call_id": call.ID, "content": "previous result"},
		{"role": "assistant", "tool_calls": []cloudAgentCall{call}},
	}
	if content, ok := cloudAgentCommittedToolReplay(&state, call); ok {
		t.Fatalf("current step reused previous read result: %q", content)
	}
	state.Canonical.Messages = append(state.Canonical.Messages,
		map[string]any{"role": "tool", "tool_call_id": call.ID, "content": "current result"},
		map[string]any{"role": "user", "content": "steering message"},
	)
	if content, ok := cloudAgentCommittedToolReplay(&state, call); !ok || content != "current result" {
		t.Fatalf("same-step retry after steering lost its result: content=%q ok=%v", content, ok)
	}
}
