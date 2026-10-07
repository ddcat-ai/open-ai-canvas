package app

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// 回归（线上 run ag3580aca，2026-10-07）：用户发整份剧本，模型把大纲塞进 canvas_apply_ops
// 参数超过 32000 字节，validateCloudAgentCalls 把整批调用判成致命协议错误，run 以
// 「Agent 执行中断」失败。参数超限是模型输出问题，应走纠偏：无效调用回结构化错误让模型
// 拆分重试，有效调用继续执行；连续多批无效才硬失败。
func oversizedCall(id, name string) cloudAgentCall {
	args, _ := json.Marshal(map[string]any{"ops": []any{map[string]any{"type": "add_node", "id": "big", "content": strings.Repeat("章节大纲内容", 4000)}}})
	if len(args) <= cloudAgentToolArgumentsByteLimit {
		panic("测试前提不成立：参数应超过字节上限")
	}
	return cloudAgentCall{ID: id, Function: struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	}{Name: name, Arguments: string(args)}}
}

func validCall(id, name string) cloudAgentCall {
	return cloudAgentCall{ID: id, Function: struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	}{Name: name, Arguments: `{"nodeId":"n1"}`}}
}

func TestCloudAgentBatchInvalidCalls(t *testing.T) {
	big := oversizedCall("call_big", "canvas_apply_ops")
	ok := validCall("call_ok", "canvas_get_state")

	invalid := cloudAgentBatchInvalidCalls([]cloudAgentCall{big, ok})
	if len(invalid) != 1 {
		t.Fatalf("应只有超限调用无效：got %v", invalid)
	}
	if !strings.Contains(invalid[0], "32000") {
		t.Fatalf("超限原因应说明字节上限：%s", invalid[0])
	}

	// 非法 JSON、ID 重复各自可判；重复 ID 的第二个调用即使参数有效也不放行。
	broken := cloudAgentCall{ID: "call_broken", Function: struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	}{Name: "canvas_apply_ops", Arguments: `{"ops":`}}
	dup := validCall("call_ok", "canvas_get_state")
	invalid = cloudAgentBatchInvalidCalls([]cloudAgentCall{broken, ok, dup})
	if len(invalid) != 2 {
		t.Fatalf("非法 JSON 与重复 ID 都应判无效：got %v", invalid)
	}
	if _, argumentProblem := cloudAgentInvalidCallReason(broken, map[string]bool{}); !argumentProblem {
		t.Fatal("非法 JSON 应归类为参数问题")
	}
}

func TestFinishCloudAgentPiModelStepWithInvalidCalls(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	req := agentTestRequest()
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	state.ActiveTaskID = "model-task-1"
	state.TaskIDs = append(state.TaskIDs, "model-task-1")
	if err = s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}

	big := oversizedCall("call_big", "canvas_apply_ops")
	ok := validCall("call_ok", "canvas_get_state")
	invalid := cloudAgentBatchInvalidCalls([]cloudAgentCall{big, ok})
	if len(invalid) != 1 {
		t.Fatalf("测试前提不成立：应恰好一个无效调用，got %v", invalid)
	}

	if err := s.finishCloudAgentPiModelStepWithInvalidCalls("user", run.ID, "model-task-1", "我先落大纲", "推理文本", []cloudAgentCall{big, ok}, invalid); err != nil {
		t.Fatal(err)
	}

	latest, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	fresh, err := cloudAgentDecode(latest)
	if err != nil {
		t.Fatal(err)
	}
	if fresh.ActiveTaskID != "" {
		t.Fatal("纠偏提交后应释放活动任务")
	}
	if fresh.InvalidArgumentSteps != 1 {
		t.Fatalf("参数纠偏计数应为 1：got %d", fresh.InvalidArgumentSteps)
	}
	if len(fresh.Calls) != 1 || fresh.Calls[0].ID != "call_ok" {
		t.Fatalf("执行批次应只含有效调用：%+v", fresh.Calls)
	}
	if fresh.CallIndex != 0 {
		t.Fatal("执行游标应回到 0")
	}

	// canonical：assistant 保留全部调用，无效调用紧跟结构化错误结果（配对完整）。
	assistantCalls := 0
	receipt := ""
	for _, message := range fresh.Canonical.Messages {
		if stringField(message, "role") == "assistant" {
			if calls, ok := message["tool_calls"].([]any); ok {
				assistantCalls = len(calls)
			}
		}
		if stringField(message, "role") == "tool" && stringField(message, "tool_call_id") == "call_big" {
			receipt = stringField(message, "content")
		}
	}
	if assistantCalls != 2 {
		t.Fatalf("assistant 应保留全部 2 个调用：got %d", assistantCalls)
	}
	if receipt == "" {
		t.Fatal("无效调用必须有错误回执")
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(receipt), &decoded); err != nil {
		t.Fatalf("回执应是结构化 JSON：%v", err)
	}
	if decoded["errorClass"] != cloudAgentToolErrorInvalidModelOutput || decoded["requiredAction"] != "fix_arguments" {
		t.Fatalf("回执应按模型输出问题分类并指引修正参数：%v", decoded)
	}
	if !strings.Contains(stringField(decoded, "error"), "拆分") {
		t.Fatalf("超限回执应指引拆分重试：%v", decoded["error"])
	}

	// 事件可诊断：拒绝的工具体与尝试次数入日志（事件 JSON 顶层带 type 字段）。
	rejected := false
	for _, event := range latest.Journal {
		var payload map[string]any
		if json.Unmarshal([]byte(event.EventJSON), &payload) == nil && payload["type"] == "tool_arguments_rejected" {
			rejected = true
		}
	}
	if !rejected {
		t.Fatal("缺少 tool_arguments_rejected 事件")
	}

	// 成功批次清零计数：普通提交一批全部有效的调用。
	state, err = cloudAgentDecode(latest)
	if err != nil {
		t.Fatal(err)
	}
	state.ActiveTaskID = "model-task-2"
	state.TaskIDs = append(state.TaskIDs, "model-task-2")
	if err = s.repo.MutateCloudAgent("user", run.ID, latest.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	next := validCall("call_next", "canvas_get_state")
	if err := s.finishCloudAgentPiModelStep("user", run.ID, "model-task-2", "", "", []cloudAgentCall{next}); err != nil {
		t.Fatal(err)
	}
	if latest, err = s.repo.CloudAgent("user", run.ID); err != nil {
		t.Fatal(err)
	}
	if fresh, err = cloudAgentDecode(latest); err != nil {
		t.Fatal(err)
	}
	if fresh.InvalidArgumentSteps != 0 {
		t.Fatalf("全部有效的批次应清零纠偏计数：got %d", fresh.InvalidArgumentSteps)
	}
}
