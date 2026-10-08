package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

// waitingAgentMediaApproval 把 Agent 推进到“等待生成审批”，返回运行和审批 ID。
func waitingAgentMediaApproval(t *testing.T, s *Service, a cloudAgentMediaArgs) (*model.CloudAgentExecution, string) {
	t.Helper()
	run, _ := agentMediaRun(t, s, a, "request_approval")
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, err := cloudAgentDecode(run)
	if err != nil || run.Status != "waiting_approval" || state.Approval == nil {
		t.Fatalf("expected waiting approval: status=%s err=%v", run.Status, err)
	}
	return run, state.Approval.ID
}

// userNodeTaskRequest 复用 Agent 同一份生成请求，但以普通画布节点生成的身份提交。
func userNodeTaskRequest(t *testing.T, s *Service, run *model.CloudAgentExecution, metadata map[string]any) CreateTaskRequest {
	t.Helper()
	state, _ := cloudAgentDecode(run)
	req, _, err := s.prepareCloudAgentMedia(run, &state, state.Calls[state.CallIndex])
	if err != nil {
		t.Fatal(err)
	}
	req.Input["metadata"] = metadata
	return req
}

func TestNodeGenerationSupersedesMatchingAgentApproval(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	run, approvalID := waitingAgentMediaApproval(t, s, a)
	req := userNodeTaskRequest(t, s, run, map[string]any{"nodeId": a.NodeID, "source": "canvas"})
	task, err := s.CreateTask("user", req)
	if err != nil {
		t.Fatal(err)
	}

	run, _ = s.repo.CloudAgent("user", run.ID)
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != "running" || state.Approval != nil || state.Decisions[approvalID] != cloudAgentApprovalSuperseded || state.CallIndex != 1 {
		t.Fatalf("approval not superseded: status=%s approval=%+v decision=%q index=%d", run.Status, state.Approval, state.Decisions[approvalID], state.CallIndex)
	}
	decided := false
	for _, event := range state.Events {
		if event.Type == "approval_decided" && event.Payload["decision"] == cloudAgentApprovalSuperseded {
			decided = event.Payload["approvalId"] == approvalID && event.Payload["taskId"] == task.ID && event.Payload["nodeId"] == a.NodeID
		}
	}
	if !decided {
		t.Fatal("missing superseded approval_decided event")
	}
	content, ok := cloudAgentToolMessage(&state, "media-call")
	if !ok || !strings.Contains(content, "superseded_by_user") || !strings.Contains(content, task.ID) || cloudAgentToolContentIsError(content) {
		t.Fatalf("tool result does not tell the Agent the user submitted: %q", content)
	}
	if state.MediaTaskID != "" || state.Generations != 0 {
		t.Fatalf("Agent took over the user task: media=%s generations=%d", state.MediaTaskID, state.Generations)
	}
	var count, leases int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	db.Model(&model.CloudAgentResourceLease{}).Where("owner_id = ?", approvalID).Count(&leases)
	if count != 1 || leases != 0 {
		t.Fatalf("expected only the user task and released leases: tasks=%d leases=%d", count, leases)
	}

	// 卡片上的“同意/拒绝”晚到时不能再提交任务，并给出可读原因。
	for _, decision := range []string{"approve", "reject"} {
		err = s.DecideCloudAgentApproval("user", run.ID, approvalID, decision, "")
		if err == nil || !strings.Contains(err.Error(), "直接生成") {
			t.Fatalf("late %s must be rejected with a superseded reason: %v", decision, err)
		}
	}
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 1 {
		t.Fatalf("late approval submitted a duplicate task: %d", count)
	}
}

func TestNodeGenerationLeavesUnrelatedAgentApprovals(t *testing.T) {
	for name, metadata := range map[string]map[string]any{
		"other node":   {"nodeId": "hero", "source": "canvas"},
		"no node":      {"source": "canvas"},
		"agent origin": {"nodeId": "video-shot-1", "source": "cloud_agent"},
	} {
		t.Run(name, func(t *testing.T) {
			s, _, a := agentMediaFixture(t)
			run, approvalID := waitingAgentMediaApproval(t, s, a)
			state, _ := cloudAgentDecode(run)
			s.supersedeCloudAgentApprovalsForNodeTask("user", &model.Task{ID: "user-task", ProjectID: "agent-canvas"}, map[string]any{"metadata": metadata})
			if name == "agent origin" {
				// 显式带 AgentRunID 的任务同样跳过。
				s.supersedeCloudAgentApprovalsForNodeTask("user", &model.Task{ID: "agent-task", ProjectID: "agent-canvas", AgentRunID: run.ID}, map[string]any{"metadata": map[string]any{"nodeId": a.NodeID}})
			}
			// 其他画布上的同名节点也不能关闭本画布的审批。
			s.supersedeCloudAgentApprovalsForNodeTask("user", &model.Task{ID: "other-canvas-task", ProjectID: "other-canvas"}, map[string]any{"metadata": map[string]any{"nodeId": a.NodeID}})
			after, _ := s.repo.CloudAgent("user", run.ID)
			afterState, _ := cloudAgentDecode(after)
			if after.Status != "waiting_approval" || afterState.Approval == nil || afterState.Approval.ID != approvalID || afterState.CallIndex != state.CallIndex {
				t.Fatalf("unrelated task changed the approval: status=%s approval=%+v", after.Status, afterState.Approval)
			}
			if err := s.DecideCloudAgentApproval("user", run.ID, approvalID, "reject", ""); err != nil {
				t.Fatalf("approval should still be decidable: %v", err)
			}
		})
	}
}

func TestNodeGenerationSupersedeViaSourceNode(t *testing.T) {
	s, _, a := agentMediaFixture(t)
	run, approvalID := waitingAgentMediaApproval(t, s, a)
	// 批量图片的结果落在新子节点，sourceNodeId 才是被审批的那个节点。
	s.supersedeCloudAgentApprovalsForNodeTask("user", &model.Task{ID: "batch-child-task", ProjectID: "agent-canvas"}, map[string]any{"metadata": map[string]any{"nodeId": "batch-child", "sourceNodeId": a.NodeID}})
	after, _ := s.repo.CloudAgent("user", run.ID)
	state, _ := cloudAgentDecode(after)
	if state.Decisions[approvalID] != cloudAgentApprovalSuperseded || state.Approval != nil {
		t.Fatalf("sourceNodeId did not supersede the approval: %+v", state.Approval)
	}
	// 重复通知是幂等的：不会再写第二条工具结果。
	s.supersedeCloudAgentApprovalsForNodeTask("user", &model.Task{ID: "batch-child-task-2", ProjectID: "agent-canvas"}, map[string]any{"metadata": map[string]any{"nodeId": a.NodeID}})
	again, _ := s.repo.CloudAgent("user", run.ID)
	if again.Revision != after.Revision {
		t.Fatalf("repeated supersede mutated the run: %d -> %d", after.Revision, again.Revision)
	}
}
