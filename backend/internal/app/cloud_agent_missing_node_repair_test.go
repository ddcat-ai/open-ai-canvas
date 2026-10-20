package app

import (
	"encoding/json"
	"fmt"
	"testing"

	"yingce/backend/internal/model"
)

// Model responses are injected at the task seam; admission, canvas writes,
// repair receipts and checkpoint recovery use the real scheduler.
func TestCloudAgentMissingNodeRepairAcrossCheckpoints(t *testing.T) {
	for _, scenario := range []string{"repaired", "exhausted"} {
		for _, permission := range []string{"auto", "request_approval"} {
			t.Run(scenario+"/"+permission, func(t *testing.T) {
				s, db, _, _ := creationTestService(t)
				canvas := model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"image-1","type":"image","title":"原图","metadata":{}}],"connections":[]}`}
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
						t.Fatal("missing model task")
					}
					call := cloudAgentCall{ID: id}
					call.Function.Name, call.Function.Arguments = tool, args
					body, err := json.Marshal(map[string]any{"toolCalls": []cloudAgentCall{call}})
					if err != nil {
						t.Fatal(err)
					}
					if err := db.Model(&model.Task{}).Where("id = ?", state.ActiveTaskID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": string(body)}).Error; err != nil {
						t.Fatal(err)
					}
					advance()
					advance()
				}
				doc, err := creationDocument(canvas.PayloadJSON)
				if err != nil {
					t.Fatal(err)
				}
				hash := cloudAgentCanvasHash(doc)
				ops := `[{"type":"update_node","id":"image-1","patch":{"title":"参考图"}},{"type":"add_node","id":"video-1","nodeType":"video"},{"type":"connect_nodes","id":"edge-1","fromNodeId":"image-1","toNodeId":"video-1"}`
				bad := `{"snapshotHash":"` + hash + `","ops":` + ops + `,{"type":"update_node","id":"missing","patch":{"title":"不存在"}}]}`
				attempts := 1
				if scenario == "exhausted" {
					attempts = 3
				}
				for attempt := 1; attempt <= attempts; attempt++ {
					callID := fmt.Sprintf("bad-%d", attempt)
					inject(callID, "canvas_apply_ops", bad)
					run, state := load()
					stored, err := s.repo.CanvasProjectForUser("user", canvas.ID)
					if err != nil {
						t.Fatal(err)
					}
					if stored.PayloadJSON != canvas.PayloadJSON || state.Approval != nil || state.MediaTaskID != "" {
						t.Fatal("invalid mixed batch partially wrote, requested approval, or submitted media")
					}
					var detail map[string]any
					for _, event := range state.Events {
						if event.Type == "tool_failed" && event.Payload["callId"] == callID {
							detail, _ = event.Payload["result"].(map[string]any)
						}
					}
					if detail["reason"] != "invalid_tool_arguments" || detail["field"] != "ops[3].id" || detail["issue"] != "not_found" ||
						detail["errorClass"] != "schema_error" || detail["retryable"] != true || detail["requiredAction"] != "fix_arguments" || detail["parameters"] == nil {
						t.Fatalf("missing recoverable schema receipt: %#v", detail)
					}
					if state.ToolRepairs["canvas_apply_ops"].Attempt != attempt {
						t.Fatal("repair allowance was lost across checkpoint")
					}
					if attempt == 3 {
						if run.Status != "failed" || state.Events[len(state.Events)-1].Payload["reason"] != "tool_retry_exhausted" {
							t.Fatal("third invalid target did not exhaust the repair allowance")
						}
						advance()
						_, stopped := load()
						if stopped.ActiveTaskID != "" {
							t.Fatal("exhausted run created another model task")
						}
						return
					}
					if run.Status != "running" {
						t.Fatalf("unknown target prematurely terminated run: %s", run.Status)
					}
					advance()
					inject(fmt.Sprintf("read-%d", attempt), "canvas_get_state", `{}`)
					advance()
				}
				inject("corrected", "canvas_apply_ops", `{"snapshotHash":"`+hash+`","ops":`+ops+`]}`)
				if permission == "request_approval" {
					run, state := load()
					stored, err := s.repo.CanvasProjectForUser("user", canvas.ID)
					if err != nil {
						t.Fatal(err)
					}
					if run.Status != "waiting_approval" || state.Approval == nil || stored.PayloadJSON != canvas.PayloadJSON {
						t.Fatal("correcting the target bypassed approval")
					}
					if err := s.DecideCloudAgentApproval("user", run.ID, state.Approval.ID, "approve", ""); err != nil {
						t.Fatal(err)
					}
					advance()
				}
				run, state := load()
				if run.Status == "failed" || len(state.ToolRepairs) != 0 {
					t.Fatal("successful correction did not clear the repair group")
				}
				stored, err := s.repo.CanvasProjectForUser("user", canvas.ID)
				if err != nil {
					t.Fatal(err)
				}
				written, err := creationDocument(stored.PayloadJSON)
				if err != nil {
					t.Fatal(err)
				}
				if len(creationMaps(written["nodes"])) != 2 || len(creationMaps(written["connections"])) != 1 || cloudAgentNodeByID(creationMaps(written["nodes"]), "image-1")["title"] != "参考图" {
					t.Fatal("corrected batch did not write the exact intended operations")
				}
			})
		}
	}
}
