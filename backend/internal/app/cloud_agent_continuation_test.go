package app

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCloudAgentContinuationReplySplitsFactsFromAssistantText(t *testing.T) {
	task := &model.Task{Status: model.TaskStatusSucceeded, ResultJSON: `{"text":"已完成"}`}
	run := &CloudAgentRun{
		ID:     "ag1",
		Status: "failed",
		Events: []CloudAgentEvent{
			{Type: "assistant_message", Payload: map[string]any{"text": "先看画布"}},
			{Type: "tool_completed", Payload: map[string]any{"toolName": "canvas_get_state", "nodeId": "n1"}},
			{Type: "run_failed", Payload: map[string]any{"reason": "cancelled"}},
		},
	}
	reply, context, err := cloudAgentContinuationReply(task, run)
	if err != nil {
		t.Fatal(err)
	}
	if reply != "先看画布" {
		t.Fatalf("reply 应是上一轮 assistant 正文，got %q", reply)
	}
	if context == "" {
		t.Fatal("失败轮次必须留下收束摘要")
	}
	if strings.Contains(reply, "上一轮已结束") || strings.Contains(reply, "canvas_get_state") {
		t.Fatal("摘要不能拼进 assistant 历史")
	}
	if strings.Contains(context, "canvas_get_state") || strings.Contains(context, `"event"`) {
		t.Fatalf("摘要不得把工具流水当成本轮目标：%s", context)
	}
	if !strings.Contains(context, "上一轮已结束（failed）") {
		t.Fatalf("失败摘要不对：%s", context)
	}
}

func TestCloudAgentContinuationOmitsQuietCompletedTurns(t *testing.T) {
	task := &model.Task{Status: model.TaskStatusSucceeded, ResultJSON: `{"text":"好"}`}
	run := &CloudAgentRun{
		Status: "completed",
		Events: []CloudAgentEvent{
			{Type: "assistant_message", Payload: map[string]any{"text": "好"}},
			{Type: "tool_completed", Payload: map[string]any{"toolName": "canvas_get_state"}},
		},
	}
	reply, context, err := cloudAgentContinuationReply(task, run)
	if err != nil {
		t.Fatal(err)
	}
	if reply != "好" || context != "" {
		t.Fatalf("安静完成的一轮不应再塞执行流水：reply=%q context=%q", reply, context)
	}
}

func TestCloudAgentContinuationKeepsSubmittedTaskIDs(t *testing.T) {
	task := &model.Task{Status: model.TaskStatusSucceeded}
	run := &CloudAgentRun{
		Status: "completed",
		Events: []CloudAgentEvent{
			{Type: "assistant_message", Payload: map[string]any{"text": "已提交"}},
			{Type: "generation_task_created", Payload: map[string]any{"taskId": "task-1"}},
			{Type: "tool_completed", Payload: map[string]any{"result": map[string]any{"taskId": "task-2", "taskSubmitted": true}}},
		},
	}
	_, context, err := cloudAgentContinuationReply(task, run)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(context, "task-1") || !strings.Contains(context, "task-2") || !strings.Contains(context, "已提交生成任务") {
		t.Fatalf("已提交任务应留下防重发提示：%s", context)
	}
}
