package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

// 线上复现（诊断号 ag5865c256d9fb9bcbf2f1719a4ec1023c）：模型一次写了很长的工具参数，
// 流式拼出来的 JSON 多了一个括号，任务报"Agent 工具参数不是完整 JSON"。Go 执行循环
// 会带 truncated_tool_arguments 纠偏重做，但 Pi 模型桥接把它当成不可重试的失败，整轮
// 以"Agent 执行中断"结束。修复后桥接必须带纠偏上下文重做同一步。
func TestCloudAgentPiModelRetriesTruncatedToolArguments(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	s.disablePiRuntime = true
	req := agentTestRequest()
	req.PermissionMode = "auto"
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	runID := root.ID

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	payload := map[string]json.RawMessage{"messages": json.RawMessage(`[{"role":"user","content":"继续"}]`), "thinkingLevel": json.RawMessage(`"off"`)}
	type outcome struct {
		result any
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		result, stepErr := s.cloudAgentPiModel(ctx, "user", runID, payload)
		done <- outcome{result, stepErr}
	}()

	// 等待模型步骤入队，返回它的任务 ID（跳过已处理过的任务）。
	nextStep := func(skip string) string {
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) {
			stored, readErr := s.repo.CloudAgent("user", runID)
			if readErr != nil {
				t.Fatal(readErr)
			}
			state, decodeErr := cloudAgentDecode(stored)
			if decodeErr != nil {
				t.Fatal(decodeErr)
			}
			if state.ActiveTaskID != "" && state.ActiveTaskID != skip {
				return state.ActiveTaskID
			}
			select {
			case got := <-done:
				t.Fatalf("model bridge returned before retry: result=%v err=%v", got.result, got.err)
			case <-time.After(50 * time.Millisecond):
			}
		}
		t.Fatal("model step was never scheduled")
		return ""
	}

	first := nextStep("")
	if err := db.Model(&model.Task{}).Where("id = ?", first).Updates(map[string]any{
		"status": model.TaskStatusFailed,
		"error":  "Agent 工具参数不是完整 JSON：invalid character '}' after array element",
	}).Error; err != nil {
		t.Fatal(err)
	}

	second := nextStep(first)
	var retried model.Task
	if err := db.First(&retried, "id = ?", second).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(retried.InputJSON, string(cloudAgentContextTruncatedArguments)) {
		t.Fatalf("retried step lacks the truncated_tool_arguments correction: %s", retried.InputJSON)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", second).Updates(map[string]any{
		"status":      model.TaskStatusSucceeded,
		"result_json": `{"text":"已拆分写入","toolCalls":[]}`,
	}).Error; err != nil {
		t.Fatal(err)
	}

	select {
	case got := <-done:
		if got.err != nil {
			t.Fatalf("model bridge failed after correction: %v", got.err)
		}
		result, _ := got.result.(map[string]any)
		if result["text"] != "已拆分写入" {
			t.Fatalf("unexpected result: %#v", got.result)
		}
	case <-ctx.Done():
		t.Fatal("model bridge did not return")
	}

	stored, err := s.repo.CloudAgent("user", runID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status == "failed" {
		t.Fatalf("run failed: %q", stored.FailureMessage)
	}
	state, err := cloudAgentDecode(stored)
	if err != nil {
		t.Fatal(err)
	}
	// 纠偏上下文只用于那一次请求，不能写回运行历史。
	for _, message := range state.Canonical.Messages {
		if strings.Contains(stringField(message, "content"), string(cloudAgentContextTruncatedArguments)) {
			t.Fatal("correction context leaked into persisted canonical history")
		}
	}
}
