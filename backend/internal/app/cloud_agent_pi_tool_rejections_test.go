package app

import (
	"context"
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestCloudAgentPiValidationFailureUsesCurrentCallBatch(t *testing.T) {
	s, db, root := approvalPauseRoot(t)
	run, state := agentInterjectionState(t, s, root.ID)
	call := cloudAgentCall{ID: "reused-call"}
	call.Function.Name, call.Function.Arguments = "generate_media", `{"aspectRatio":"16:9"}`
	state.Canonical.Messages = append(state.Canonical.Messages,
		map[string]any{"role": "assistant", "content": "", "tool_calls": []cloudAgentCall{call}},
		map[string]any{"role": "tool", "tool_call_id": call.ID, "content": `{"status":"succeeded"}`},
		map[string]any{"role": "assistant", "content": "", "tool_calls": []cloudAgentCall{call}},
	)
	previous := cloudAgentCall{ID: "previous-read"}
	previous.Function.Name, previous.Function.Arguments = "skill_read_file", `{}`
	state.Calls, state.CallIndex = []cloudAgentCall{previous}, 1
	state.PiModelCalls, state.PiModelTaskID = []cloudAgentCall{call}, "latest-model-step"
	approvalPauseSaveState(t, s, db, run, &state)
	var before int64
	if err := db.Model(&model.Task{}).Where("agent_run_id = ?", root.ID).Count(&before).Error; err != nil {
		t.Fatal(err)
	}
	payload := map[string]json.RawMessage{"type": json.RawMessage(`"tool_validation_failed"`), "callId": json.RawMessage(`"reused-call"`), "toolName": json.RawMessage(`"generate_media"`), "error": json.RawMessage(`"unexpected aspectRatio"`)}
	if _, err := s.cloudAgentPiEvent(context.Background(), "user", root.ID, payload); err != nil {
		t.Fatal(err)
	}
	_, after := agentInterjectionState(t, s, root.ID)
	if after.CallIndex != 1 {
		t.Fatalf("旧批次回执吞掉了当前校验失败，游标=%d", after.CallIndex)
	}
	var count int64
	if err := db.Model(&model.Task{}).Where("agent_run_id = ?", root.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != before {
		t.Fatal("SDK 参数拒绝创建了收费任务")
	}
	events := len(after.Events)
	if _, err := s.cloudAgentPiEvent(context.Background(), "user", root.ID, payload); err != nil {
		t.Fatal(err)
	}
	_, replayed := agentInterjectionState(t, s, root.ID)
	if len(replayed.Events) != events || replayed.CallIndex != 1 {
		t.Fatal("重复拒绝事件未保持幂等")
	}
}
