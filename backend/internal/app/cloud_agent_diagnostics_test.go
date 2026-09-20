package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCloudAgentCanvasArgumentFeedbackIdentifiesFailingOperation(t *testing.T) {
	for _, tc := range []struct{ op, field, issue string }{
		{`{"type":"add_node","id":"note","nodeType":"text","snapshotHash":"misplaced"}`, "ops[0].snapshotHash", "unexpected_field"},
		{`{"type":"add_node","nodeType":"text"}`, "ops[0].id", "required"},
		{`{"type":"add_node","id":"note"}`, "ops[0].nodeType", "required"},
		{`{"type":"connect_nodes","id":"edge","toNodeId":"target"}`, "ops[0].fromNodeId", "required"},
		{`{"type":"update_node","id":"note"}`, "ops[0].patch", "required"},
		{`{"type":"add_node","id":"note","nodeType":"text","x":"private-sentinel"}`, "ops[0].x", "type_mismatch"},
		{`{"type":"add_node","id":"note","nodeType":"text","private-sentinel":"private-sentinel"}`, "ops[0]", "unexpected_field"},
	} {
		t.Run(tc.field+tc.issue, func(t *testing.T) {
			call := cloudAgentCall{ID: "write"}
			call.Function.Name, call.Function.Arguments = "canvas_apply_ops", `{"snapshotHash":"snapshot","ops":[`+tc.op+`]}`
			// Malformed calls must fail before reading, approving, or writing.
			_, err := prepareCloudAgentCanvasMutation(nil, "user", "canvas", call)
			if err == nil {
				t.Fatal("invalid operation accepted")
			}
			req := agentTestRequest()
			req.PermissionMode = "request_approval"
			state := &cloudAgentRuntime{Canonical: canonicalAgentRequest{Tools: cloudAgentTools(req)}}
			cloudAgentToolResult("run", state, call, nil, err)
			content := state.Canonical.Messages[0]["content"].(string)
			var result map[string]any
			if err := json.Unmarshal([]byte(content), &result); err != nil {
				t.Fatal(err)
			}
			if result["field"] != tc.field || result["issue"] != tc.issue || result["reason"] != "invalid_tool_arguments" || result["parameters"] == nil || strings.Contains(content, "private-sentinel") {
				t.Fatalf("incorrect repair feedback: %s", content)
			}
		})
	}
	// Replay the logged failure with only the misplaced field removed.
	s, _, _ := agentMediaFixture(t)
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	call := cloudAgentCall{ID: "corrected"}
	call.Function.Name = "canvas_apply_ops"
	call.Function.Arguments = `{"snapshotHash":"` + cloudAgentCanvasHash(doc) + `","ops":[{"type":"add_node","id":"note","nodeType":"text"}]}`
	plan, err := prepareCloudAgentCanvasMutation(s.repo, "user", "agent-canvas", call)
	if err != nil || plan == nil {
		t.Fatalf("corrected call failed: %v", err)
	}
	stored, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if stored.PayloadJSON != canvas.PayloadJSON {
		t.Fatal("preview wrote without approval")
	}
}

func TestCloudAgentGenerationDiagnosticsSeparateOutputAndTask(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	for _, tc := range []struct {
		name, user, canvas, detail string
		status                     model.TaskStatus
		visible                    bool
	}{
		{"failed", "user", "agent-canvas", "media dimensions must be between 256 and 5760 pixels", model.TaskStatusFailed, true},
		{"cancelled", "user", "agent-canvas", "任务已取消", model.TaskStatusCancelled, true},
		{"sensitive", "user", "agent-canvas", "https://private-sentinel.invalid?token=private-sentinel", model.TaskStatusFailed, true},
		{"other-user", "other", "agent-canvas", "private-sentinel", model.TaskStatusFailed, false},
		{"other-canvas", "user", "other-canvas", "private-sentinel", model.TaskStatusFailed, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			task := &model.Task{ID: tc.name, UserID: tc.user, ProjectID: tc.canvas, Status: tc.status, Error: tc.detail}
			if err := db.Create(task).Error; err != nil {
				t.Fatal(err)
			}
			node := map[string]any{"id": "video", "type": "video", "metadata": map[string]any{"status": "loading", "taskId": task.ID}}
			doc := map[string]any{"nodes": []map[string]any{node}}
			view, err := cloudAgentCanvasState(s.repo, "user", "agent-canvas", doc, 0, nil, 0)
			if err != nil {
				t.Fatal(err)
			}
			item := view.(map[string]any)["nodes"].([]any)[0].(map[string]any)
			generation := item["generation"].(map[string]any)
			output := item["outputReference"].(map[string]any)
			if output["ready"] != false || output["issue"] == nil || generation["submitBlockedReason"] != "task_bound" {
				t.Fatalf("ambiguous state: %+v", item)
			}
			if tc.visible {
				if generation["taskId"] != task.ID || generation["taskStatus"] != string(tc.status) || generation["error"] == nil {
					t.Fatalf("lost task failure: %+v", generation)
				}
				if tc.name == "failed" && generation["error"] != tc.detail {
					t.Fatalf("lost useful diagnostic: %+v", generation)
				}
			} else if generation["taskStatus"] != "unavailable" || generation["taskId"] != nil || generation["error"] != nil {
				t.Fatalf("task ownership leaked: %+v", generation)
			}
			raw, _ := json.Marshal(view)
			if strings.Contains(string(raw), "private-sentinel") {
				t.Fatal("unsafe error leaked")
			}
			call := cloudAgentCall{ID: "query"}
			call.Function.Name, call.Function.Arguments = "task_get", `{"taskId":"`+task.ID+`"}`
			result, err := cloudAgentReadTool(s.repo, "user", &cloudAgentRuntime{Request: agentTestRequest()}, call)
			if tc.visible {
				if err != nil || result.(map[string]any)["error"] != generation["error"] {
					t.Fatalf("task_get lost diagnostic: %+v %v", result, err)
				}
			} else if err == nil {
				t.Fatal("task_get crossed ownership boundary")
			}
		})
	}
}

func TestCloudAgentMediaAdmissionReportsTaskBinding(t *testing.T) {
	s, db, args := agentMediaFixture(t)
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	doc["nodes"] = append(creationMaps(doc["nodes"]), map[string]any{"id": args.NodeID, "type": "video", "metadata": map[string]any{"status": "error", "taskId": "original-task"}})
	raw, _ := json.Marshal(doc)
	if err := db.Model(canvas).Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	args.SnapshotHash, args.DraftRunID = cloudAgentMediaContentHash(doc), "current-run"
	_, _, _, err := cloudAgentMediaDocument(s.repo, "user", "agent-canvas", args)
	if err == nil {
		t.Fatal("existing task overwritten")
	}
	state := &cloudAgentRuntime{}
	cloudAgentToolResult("run", state, agentMediaCall(args), map[string]any{"phase": "admission", "taskSubmitted": false}, err)
	var result map[string]any
	if err := json.Unmarshal([]byte(state.Canonical.Messages[0]["content"].(string)), &result); err != nil {
		t.Fatal(err)
	}
	if result["reason"] != "task_bound" || result["nodeId"] != args.NodeID || result["taskSubmitted"] != false {
		t.Fatalf("missing admission diagnosis: %+v", result)
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 0 {
		t.Fatal("admission submitted task")
	}
}

func TestCloudAgentCancellationRecordsSourceOnce(t *testing.T) {
	s, _, args := agentMediaFixture(t)
	run, _ := agentMediaRun(t, s, args, "auto")
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	approveAgentMediaDraft(t, s, run.ID)
	run, _ = s.repo.CloudAgent("user", run.ID)
	before, err := cloudAgentDecode(run)
	if err != nil || before.MediaTaskID == "" {
		t.Fatalf("missing media task: %v", err)
	}
	for range 2 {
		if err := s.CancelCloudAgent(context.Background(), "user", run.ID); err != nil {
			t.Fatal(err)
		}
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	after, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, event := range after.Events {
		if event.Type != "run_cancelled" {
			continue
		}
		count++
		if event.Payload["source"] != "user_request" || event.Payload["mediaTaskId"] != before.MediaTaskID {
			t.Fatalf("missing cancel source: %+v", event)
		}
	}
	if count != 1 {
		t.Fatalf("expected one cancellation event, got %d", count)
	}
	task, _ := s.repo.TaskForUser("user", before.MediaTaskID)
	if task.Status != model.TaskStatusCancelled {
		t.Fatalf("child not cancelled: %s", task.Status)
	}
}
