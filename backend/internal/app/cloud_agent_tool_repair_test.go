package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCloudAgentToolRepairBudgetAndSafety(t *testing.T) {
	state := &cloudAgentRuntime{}
	run := &model.CloudAgentExecution{ID: "run", Status: "running"}
	call := cloudAgentCall{ID: "bad-1"}
	call.Function.Name = "canvas_apply_ops"
	err := cloudAgentFieldError("ops[0].type", "required", "缺少操作类型")
	for attempt := 1; attempt <= cloudAgentToolAttemptLimit; attempt++ {
		call.ID = fmt.Sprintf("bad-%d", attempt)
		cloudAgentRecordToolResult(run, state, call, nil, err)
		last := state.Events[len(state.Events)-1]
		if attempt < cloudAgentToolAttemptLimit {
			if run.Status != "running" || last.Type != "tool_failed" || last.Payload["retry"].(map[string]any)["status"] != "retrying" {
				t.Fatalf("repair stopped prematurely: %+v", last)
			}
			read := cloudAgentCall{ID: "read"}
			read.Function.Name = "canvas_get_state"
			cloudAgentRecordToolResult(run, state, read, map[string]any{}, nil)
		} else if run.Status != "failed" || last.Type != "run_failed" || last.Payload["reason"] != "tool_retry_exhausted" {
			t.Fatalf("repair did not stop at its bound: %+v", last)
		}
	}
	for _, test := range []struct {
		name   string
		err    error
		result map[string]any
	}{
		{"permission", BadAuthRequest("工具未获本轮权限授权"), nil},
		{"storage", errors.New("storage unavailable"), nil},
		{"submitted", err, map[string]any{"taskSubmitted": true}},
		{"completion", err, map[string]any{"phase": "completion"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			state := &cloudAgentRuntime{}
			cloudAgentToolResult("run", state, call, test.result, test.err)
			if state.Events[0].Payload["retry"] != nil || len(state.ToolRepairs) != 0 {
				t.Fatal("unsafe operation was marked for automatic repair")
			}
		})
	}
}

func TestCloudAgentToolRepairSuccessResetsOnlyItsOwnBudget(t *testing.T) {
	state := &cloudAgentRuntime{}
	call := cloudAgentCall{ID: "bad"}
	call.Function.Name = "canvas_apply_ops"
	cloudAgentToolResult("run", state, call, nil, cloudAgentFieldError("ops[0].type", "required", "缺少操作类型"))
	cloudAgentToolResult("run", state, call, map[string]any{}, nil)
	if len(state.ToolRepairs) != 0 || state.Events[1].Payload["retry"].(map[string]any)["status"] != "recovered" {
		t.Fatal("successful operation did not close its repair group")
	}
	call.ID = "next-bad"
	cloudAgentToolResult("run", state, call, nil, cloudAgentFieldError("ops[0].type", "required", "缺少操作类型"))
	if state.ToolRepairs[call.Function.Name].Attempt != 1 || state.ToolRepairs[call.Function.Name].GroupID != "run:repair:next-bad" {
		t.Fatal("a new operation inherited the old exhausted allowance")
	}
}

// Exercise scheduler checkpoints and real canvas admission, not a second
// implementation of the retry loop. Model outputs are injected at the task seam.
func TestCloudAgentEmptyCanvasRepairAcrossCheckpoints(t *testing.T) {
	for _, scenario := range []string{"exhausted", "connection_repaired"} {
		for _, permission := range []string{"auto", "request_approval"} {
			t.Run(scenario+"/"+permission, func(t *testing.T) {
				s, db, _, _ := creationTestService(t)
				canvas := model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[],"connections":[]}`}
				if err := db.Create(&canvas).Error; err != nil {
					t.Fatal(err)
				}
				req := agentTestRequest()
				req.PermissionMode = permission
				root, err := s.CreateCloudAgentRun("user", req, "")
				if err != nil {
					t.Fatal(err)
				}
				load := func() (*model.CloudAgentExecution, cloudAgentRuntime) {
					t.Helper()
					run, err := s.repo.CloudAgent("user", root.ID)
					if err != nil {
						t.Fatal(err)
					}
					state, err := cloudAgentDecode(run)
					if err != nil {
						t.Fatal(err)
					}
					return run, state
				}
				advance := func() {
					t.Helper()
					if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
						t.Fatal(err)
					}
				}
				inject := func(id, tool, args string) {
					t.Helper()
					_, state := load()
					if state.ActiveTaskID == "" {
						t.Fatal("missing continuation model task")
					}
					call := cloudAgentCall{ID: id}
					call.Function.Name, call.Function.Arguments = tool, args
					body, _ := json.Marshal(map[string]any{"toolCalls": []cloudAgentCall{call}})
					if err := db.Model(&model.Task{}).Where("id = ?", state.ActiveTaskID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": string(body)}).Error; err != nil {
						t.Fatal(err)
					}
					advance()
					advance()
				}
				doc, _ := creationDocument(canvas.PayloadJSON)
				hash := cloudAgentCanvasHash(doc)
				bad := `{"snapshotHash":"` + hash + `","ops":[{"id":"note","nodeType":"text"}]}`
				if scenario == "connection_repaired" {
					bad = `{"snapshotHash":"` + hash + `","ops":[{"type":"add_node","id":"note","nodeType":"text"},{"type":"add_node","id":"doc","nodeType":"markdown"},{"type":"connect_nodes","id":"edge","fromNodeId":"note","toNodeId":"doc"}]}`
				}
				attempts := 3
				if scenario == "connection_repaired" {
					attempts = 1
				}
				for attempt := 1; attempt <= attempts; attempt++ {
					inject(fmt.Sprintf("bad-%d", attempt), "canvas_apply_ops", bad)
					run, state := load()
					stored, _ := s.repo.CanvasProjectForUser("user", canvas.ID)
					if stored.PayloadJSON != canvas.PayloadJSON || state.Approval != nil {
						t.Fatal("failed batch wrote nodes or requested approval")
					}
					if state.ToolRepairs["canvas_apply_ops"].Attempt != attempt {
						t.Fatal("repair budget lost across checkpoint")
					}
					if attempt == 3 {
						if run.Status != "failed" || state.Events[len(state.Events)-1].Payload["reason"] != "tool_retry_exhausted" {
							t.Fatal("third failed attempt did not terminate")
						}
						advance()
						_, stopped := load()
						if stopped.ActiveTaskID != "" {
							t.Fatal("exhausted run submitted another task")
						}
						return
					}
					if run.Status != "running" {
						t.Fatalf("repairable failure terminated run: %s", run.Status)
					}
					advance()
					inject(fmt.Sprintf("read-%d", attempt), "canvas_get_state", `{}`)
					advance()
				}
				inject("corrected", "canvas_apply_ops", `{"snapshotHash":"`+hash+`","ops":[{"type":"add_node","id":"note","nodeType":"text"}]}`)
				if permission == "request_approval" {
					run, state := load()
					stored, _ := s.repo.CanvasProjectForUser("user", canvas.ID)
					if run.Status != "waiting_approval" || state.Approval == nil || stored.PayloadJSON != canvas.PayloadJSON {
						t.Fatal("repair bypassed approval")
					}
					if err := s.DecideCloudAgentApproval("user", run.ID, state.Approval.ID, "approve", ""); err != nil {
						t.Fatal(err)
					}
					advance()
				}
				run, state := load()
				if run.Status == "failed" || len(state.ToolRepairs) != 0 {
					t.Fatal("successful correction did not resolve retry state")
				}
				last := state.Events[len(state.Events)-1]
				if last.Type != "tool_completed" || last.Payload["retry"].(map[string]any)["status"] != "recovered" {
					t.Fatal("missing recovery receipt")
				}
				stored, _ := s.repo.CanvasProjectForUser("user", canvas.ID)
				written, _ := creationDocument(stored.PayloadJSON)
				if len(creationMaps(written["nodes"])) != 1 || len(creationMaps(written["connections"])) != 0 {
					t.Fatal("repaired operation did not write exactly one node")
				}
			})
		}
	}
}
