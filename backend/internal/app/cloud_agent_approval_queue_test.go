package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// TestCloudAgentApprovalQueueContinuesSameStep 复现：同一模型步骤里有两个需审批的写入，
// 批准第一个后，第二个应直接生成自己的审批卡，而不是丢回模型要求重发。
// 全程使用临时数据库，不启动 Pi、不调用任何模型。
func TestCloudAgentApprovalQueueContinuesSameStep(t *testing.T) {
	db := agentPermissionsDB(t)
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	s := &Service{repo: repository.New(db), dataDir: t.TempDir(), disablePiRuntime: true}
	if err := os.WriteFile(filepath.Join(s.dataDir, ".settings-key"), make([]byte, 32), 0o600); err != nil {
		t.Fatal(err)
	}
	doc := map[string]any{"nodes": []any{}, "connections": []any{}}
	raw, _ := json.Marshal(doc)
	profile := mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel("chat-completion", "text-test"))
	for _, row := range []any{
		&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: string(raw)},
		&model.ModelChannel{ID: "channel", Scope: model.ChannelScopeSystem, Name: "测试", Enabled: true},
		&model.ChannelModel{ID: "cm", ChannelID: "channel", ModelKey: "text-test", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, CapabilityConfigJSON: profile, BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "tier", ChannelModelID: "cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true},
		&model.CreditAccount{UserID: "user", AvailableMicrocredits: 10000},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	req := agentTestRequest()
	req.PermissionMode = "request_approval"
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	run, state := agentInterjectionState(t, s, root.ID)
	hash := cloudAgentCanvasHash(doc)
	write := func(id, node string) cloudAgentCall {
		call := cloudAgentCall{ID: id}
		call.Function.Name = "canvas_apply_ops"
		args, _ := json.Marshal(map[string]any{"snapshotHash": hash, "ops": []any{map[string]any{"type": "add_node", "id": node, "nodeType": "text", "title": node, "content": node}}})
		call.Function.Arguments = string(args)
		return call
	}
	read := cloudAgentCall{ID: "read"}
	read.Function.Name, read.Function.Arguments = "canvas_get_state", "{}"
	state.Calls = []cloudAgentCall{write("write-1", "note-1"), read, write("write-2", "note-2")}
	state.CallIndex, state.StepSnapshotHash = 0, hash
	state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "assistant", "tool_calls": []any{
		map[string]any{"id": "write-1", "type": "function", "function": map[string]any{"name": "canvas_apply_ops", "arguments": state.Calls[0].Function.Arguments}},
		map[string]any{"id": "read", "type": "function", "function": map[string]any{"name": "canvas_get_state", "arguments": "{}"}},
		map[string]any{"id": "write-2", "type": "function", "function": map[string]any{"name": "canvas_apply_ops", "arguments": state.Calls[2].Function.Arguments}},
	}})
	run.Status = "running"
	approvalPauseSaveState(t, s, db, run, &state)
	run, state = agentInterjectionState(t, s, root.ID)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"write-1", "write-2"} {
		run, state = agentInterjectionState(t, s, root.ID)
		if run.Status != "waiting_approval" || state.Approval == nil || state.Approval.Call.ID != id {
			t.Fatalf("expected approval card for %s, got status=%s callIndex=%d approval=%+v resumePrompt=%q", id, run.Status, state.CallIndex, state.Approval, state.PiResumePrompt)
		}
		if err := s.DecideCloudAgentApproval("user", root.ID, state.Approval.ID, "approve", ""); err != nil {
			t.Fatal(err)
		}
	}
	run, state = agentInterjectionState(t, s, root.ID)
	if run.Status != "running" || state.Approval != nil || state.CallIndex != len(state.Calls) {
		t.Fatalf("queue did not finish: status=%s index=%d", run.Status, state.CallIndex)
	}
	canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil || !strings.Contains(canvas.PayloadJSON, "note-1") || !strings.Contains(canvas.PayloadJSON, "note-2") {
		t.Fatalf("both approved writes must be applied: %v %s", err, canvas.PayloadJSON)
	}
	// 只读调用不在审批队列里执行，恢复时仍按未执行处理，并提示模型按需重发。
	if !cloudAgentCurrentBatchUnanswered(&state) || !strings.Contains(state.PiResumePrompt, "未被执行") {
		t.Fatalf("skipped read must stay unanswered: %q", state.PiResumePrompt)
	}
}

// 同一 call ID 在更早步骤出现过时，只能用最后一批的真实结果替换占位。
func TestCloudAgentApprovalQueueRestoresOnlyCurrentBatch(t *testing.T) {
	assistant := map[string]any{"role": "assistant", "content": []any{runtimeToolCallPart("reused", "generate_media")}}
	placeholder := map[string]any{"role": "toolResult", "toolCallId": "reused", "toolName": "generate_media", "content": "waiting"}
	messages := []map[string]any{assistant, placeholder, {"role": "user", "content": "next"}, assistant, placeholder}
	canonicalAssistant := map[string]any{"role": "assistant", "tool_calls": []any{map[string]any{"id": "reused", "function": map[string]any{"name": "generate_media", "arguments": "{}"}}}}
	committed := canonicalAgentRequest{Messages: []map[string]any{canonicalAssistant,
		{"role": "tool", "tool_call_id": "reused", "content": `{"taskId":"old"}`},
		{"role": "user", "content": "next"}, canonicalAssistant}}
	restored := cloudAgentRestoreApprovalQueueResults(messages, committed)
	if runtimeContentText(restored[4]["content"]) != "waiting" {
		t.Fatal("reused ID copied a receipt from an earlier batch")
	}
	committed.Messages = append(committed.Messages, map[string]any{"role": "tool", "tool_call_id": "reused", "content": `{"taskId":"new"}`})
	restored = cloudAgentRestoreApprovalQueueResults(messages, committed)
	if runtimeContentText(restored[1]["content"]) != "waiting" || runtimeContentText(restored[4]["content"]) != `{"taskId":"new"}` || runtimeContentText(messages[4]["content"]) != "waiting" {
		t.Fatalf("restoration crossed batch or mutated input: %+v", restored)
	}
}
