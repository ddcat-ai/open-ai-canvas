package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// approvalFollowUpFixture 准备一轮停在审批上的画布写入：模型请求把节点改名，等待用户批准。
// 数据只写临时数据库，不启动 Pi、不调用收费模型。
func approvalFollowUpFixture(t *testing.T) (*Service, string, string) {
	t.Helper()
	db := agentPermissionsDB(t)
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	s := &Service{repo: repository.New(db), dataDir: t.TempDir(), disablePiRuntime: true}
	t.Cleanup(s.closeCloudAgentApprovalFollowUps)
	if err := os.WriteFile(filepath.Join(s.dataDir, ".settings-key"), make([]byte, 32), 0o600); err != nil {
		t.Fatal(err)
	}
	doc := map[string]any{"nodes": []any{map[string]any{"id": "story", "type": "text", "title": "原标题", "content": "正文"}}, "connections": []any{}}
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	profile := mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel("chat-completion", "text-test"))
	for _, row := range []any{
		&model.User{ID: "user", Username: "user", Role: model.UserRoleUser, Status: model.UserStatusActive},
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
	call := cloudAgentCall{ID: "rename-story"}
	call.Function.Name = "canvas_apply_ops"
	args, err := json.Marshal(map[string]any{"snapshotHash": cloudAgentCanvasHash(doc), "ops": []any{map[string]any{"type": "update_node", "id": "story", "patch": map[string]any{"title": "新标题"}}}})
	if err != nil {
		t.Fatal(err)
	}
	call.Function.Arguments = string(args)
	state.Calls = []cloudAgentCall{call}
	state.CallIndex = 0
	run.Status = "running"
	approvalPauseSaveState(t, s, db, run, &state)
	run, state = agentInterjectionState(t, s, root.ID)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, root.ID)
	if run.Status != "waiting_approval" || state.Approval == nil {
		t.Fatalf("fixture did not pause for approval: status=%s", run.Status)
	}
	return s, root.ID, state.Approval.ID
}

func approvalFollowUpCanvas(t *testing.T, s *Service) (string, int64) {
	t.Helper()
	canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	title, _ := creationMaps(doc["nodes"])[0]["title"].(string)
	return title, canvas.Revision
}

// 决定落库后、被批准的调用执行前，运行已经是 running。这段间隙里启动的 Pi 会话
// （恢复扫描、幂等重放）不能开一轮模型；决定请求还在收尾时只让出，请求在落库后
// 失败时由会话接手收尾，调用只执行一次并把结果交回 Pi。
func TestCloudAgentPiSessionYieldsApprovedCallToApprovalFollowUp(t *testing.T) {
	s, runID, approvalID := approvalFollowUpFixture(t)
	key := cloudAgentApprovalFollowUpKey(runID, approvalID)

	// 测试先占住收尾登记，模拟另一个决定请求正在收尾：本次决定只落库、不执行。
	if !s.claimCloudAgentApprovalFollowUp(key) {
		t.Fatal("follow-up claim was not available")
	}
	if err := s.DecideCloudAgentApproval("user", runID, approvalID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	run, state := agentInterjectionState(t, s, runID)
	if !cloudAgentApprovedCallPending(run, &state, approvalID) {
		t.Fatalf("decision without the follow-up claim executed the call: status=%s approval=%+v", run.Status, state.Approval)
	}

	if err := s.runCloudAgentPiSession(context.Background(), "user", runID); err != nil {
		t.Fatal(err)
	}
	s.approvalFollowUpWg.Wait()
	run, state = agentInterjectionState(t, s, runID)
	if !cloudAgentApprovedCallPending(run, &state, approvalID) || state.ActiveTaskID != "" {
		t.Fatalf("Pi session ran while the decision request owned the approval: status=%s activeTask=%q", run.Status, state.ActiveTaskID)
	}
	if title, revision := approvalFollowUpCanvas(t, s); title != "原标题" || revision != 1 {
		t.Fatalf("canvas changed before the approved call was executed: title=%q revision=%d", title, revision)
	}

	// 决定请求在落库后退出（收尾失败或进程重启）：下一个 Pi 会话接手收尾。
	s.releaseCloudAgentApprovalFollowUp(key)
	if err := s.runCloudAgentPiSession(context.Background(), "user", runID); err != nil {
		t.Fatal(err)
	}
	s.approvalFollowUpWg.Wait()
	run, state = agentInterjectionState(t, s, runID)
	if run.Status != "running" || state.Approval != nil || state.CallIndex != 1 || state.ActiveTaskID != "" {
		t.Fatalf("follow-up did not execute the approved call once: status=%s approval=%+v callIndex=%d activeTask=%q", run.Status, state.Approval, state.CallIndex, state.ActiveTaskID)
	}
	if state.PiResumePrompt == "" {
		t.Fatal("follow-up did not hand the approved result back to Pi")
	}
	if title, revision := approvalFollowUpCanvas(t, s); title != "新标题" || revision != 2 {
		t.Fatalf("approved canvas write missing: title=%q revision=%d", title, revision)
	}

	// 调用已执行：再次收尾与重送同一决定都不能再写画布。
	if err := s.continueApprovedCloudAgentCall("user", runID, approvalID); err != nil {
		t.Fatal(err)
	}
	if err := s.DecideCloudAgentApproval("user", runID, approvalID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	if _, revision := approvalFollowUpCanvas(t, s); revision != 2 {
		t.Fatalf("approved call executed twice: canvas revision=%d", revision)
	}
}

// 关闭后不再接手新的收尾，未执行的审批留给下次启动。
func TestCloudAgentApprovalFollowUpStopsAfterClose(t *testing.T) {
	s, runID, approvalID := approvalFollowUpFixture(t)
	key := cloudAgentApprovalFollowUpKey(runID, approvalID)
	if !s.claimCloudAgentApprovalFollowUp(key) {
		t.Fatal("follow-up claim was not available")
	}
	if err := s.DecideCloudAgentApproval("user", runID, approvalID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	s.releaseCloudAgentApprovalFollowUp(key)
	s.closeCloudAgentApprovalFollowUps()

	s.startCloudAgentApprovalFollowUp("user", runID, approvalID)
	s.approvalFollowUpWg.Wait()
	run, state := agentInterjectionState(t, s, runID)
	if !cloudAgentApprovedCallPending(run, &state, approvalID) {
		t.Fatalf("closed service still executed the approved call: status=%s", run.Status)
	}
}
