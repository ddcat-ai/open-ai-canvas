package app

import (
	"encoding/json"
	"strings"
	"testing"
	"yingce/backend/internal/model"
)

func TestCloudAgentCanvasApprovalProtectsConcurrentEdits(t *testing.T) {
	for _, scenario := range []string{"before_approval", "after_approval", "unrelated"} {
		t.Run(scenario, func(t *testing.T) {
			s, db, media := agentMediaFixture(t)
			s.disablePiRuntime = true
			run, state := agentMediaRun(t, s, media, "request_approval")
			canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
			if err != nil {
				t.Fatal(err)
			}
			doc, err := creationDocument(canvas.PayloadJSON)
			if err != nil {
				t.Fatal(err)
			}
			call := canvasApplyCall(cloudAgentCanvasHash(doc), `{"content":"Agent 正文"}`)
			call.Function.Arguments = strings.ReplaceAll(call.Function.Arguments, "text-1", "shot-1")
			state.Calls, state.CallIndex = []cloudAgentCall{call}, 0
			run.Status = "running"
			approvalPauseSaveState(t, s, db, run, &state)
			run, state = agentInterjectionState(t, s, run.ID)
			if err := s.advanceCloudAgentTool(run, &state); err != nil {
				t.Fatal(err)
			}
			run, state = agentInterjectionState(t, s, run.ID)
			if state.Approval == nil || state.Approval.CanvasBeforeJSON == "" {
				t.Fatal("missing persisted approval baseline")
			}
			approvalID := state.Approval.ID
			nodes := creationMaps(doc["nodes"])
			if scenario == "unrelated" {
				nodes[0]["title"] = "用户修改标题"
			} else {
				nodes[0]["metadata"].(map[string]any)["content"] = "用户新正文"
			}
			raw, err := json.Marshal(doc)
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", string(raw)).Error; err != nil {
				t.Fatal(err)
			}
			if scenario == "after_approval" {
				// 模拟决定已落库而 worker 尚未实际执行的窗口。
				state.Approval.Decision = "approve"
				run.Status = "running"
				approvalPauseSaveState(t, s, db, run, &state)
				run, state = agentInterjectionState(t, s, run.ID)
				if err := s.advanceCloudAgentTool(run, &state); err != nil {
					t.Fatal(err)
				}
			} else {
				err := s.DecideCloudAgentApproval("user", run.ID, approvalID, "approve", "")
				if scenario == "before_approval" && (err == nil || !strings.Contains(err.Error(), "用户已修改")) {
					t.Fatalf("expected conflict, got %v", err)
				}
				if scenario == "unrelated" && err != nil {
					t.Fatal(err)
				}
			}
			stored, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
			if err != nil {
				t.Fatal(err)
			}
			if scenario == "unrelated" {
				if !strings.Contains(stored.PayloadJSON, "Agent 正文") || !strings.Contains(stored.PayloadJSON, "用户修改标题") {
					t.Fatal("unrelated edit was not merged")
				}
			} else if !strings.Contains(stored.PayloadJSON, "用户新正文") || strings.Contains(stored.PayloadJSON, "Agent 正文") {
				t.Fatal("stale approval overwrote user content")
			}
		})
	}
}

func canvasApplyCall(snapshot string, patch string) cloudAgentCall {
	return cloudAgentCall{ID: "call-1", Function: struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	}{
		Name:      "canvas_apply_ops",
		Arguments: `{"snapshotHash":"` + snapshot + `","ops":[{"type":"update_node","id":"text-1","patch":` + patch + `}]}`,
	}}
}

func TestCloudAgentCanvasApprovalConflictRejectsSameFieldEdits(t *testing.T) {
	call := canvasApplyCall("baseline", `{"content":"Agent 内容"}`)
	conflict, err := cloudAgentCanvasApprovalConflict(
		`{"nodes":[{"id":"text-1","type":"text","metadata":{"content":"旧内容"}}],"connections":[]}`,
		`{"nodes":[{"id":"text-1","type":"text","metadata":{"content":"用户新内容"}}],"connections":[]}`,
		call,
	)
	if err != nil || !conflict {
		t.Fatalf("same-field user edit must conflict: conflict=%v err=%v", conflict, err)
	}
}

func TestCloudAgentCanvasApprovalConflictAllowsUnrelatedEdits(t *testing.T) {
	call := canvasApplyCall("baseline", `{"content":"Agent 内容"}`)
	conflict, err := cloudAgentCanvasApprovalConflict(
		`{"nodes":[{"id":"text-1","type":"text","metadata":{"content":"旧内容"}},{"id":"text-2","type":"text","metadata":{"content":"另一个旧内容"}}],"connections":[]}`,
		`{"nodes":[{"id":"text-1","type":"text","metadata":{"content":"旧内容"}},{"id":"text-2","type":"text","metadata":{"content":"用户修改了另一个节点"}}],"connections":[]}`,
		call,
	)
	if err != nil || conflict {
		t.Fatalf("unrelated user edit must remain mergeable: conflict=%v err=%v", conflict, err)
	}
}
