package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCloudAgentMediaCleanupUsesPersistedTaskTarget(t *testing.T) {
	for _, missingTarget := range []bool{false, true} {
		t.Run(map[bool]string{false: "known target", true: "unknown target"}[missingTarget], func(t *testing.T) {
			s, db, args := agentMediaFixture(t)
			run, _ := agentMediaRun(t, s, args, "auto")
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			approveAgentMediaDraft(t, s, run.ID)
			run, state := agentInterjectionState(t, s, run.ID)
			updates := map[string]any{"status": model.TaskStatusFailed, "error": "上游超时"}
			if missingTarget {
				updates["input_json"] = `{}`
			}
			if err := db.Model(&model.Task{}).Where("id = ?", state.MediaTaskID).Updates(updates).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", run.ID).Updates(map[string]any{"status": "failed", "cleanup_pending": true, "state_json": `{`}).Error; err != nil {
				t.Fatal(err)
			}
			run, err := s.repo.CloudAgent("user", run.ID)
			if err != nil {
				t.Fatal(err)
			}
			if err := s.finishCloudAgentCleanup(context.Background(), run); err != nil {
				t.Fatal(err)
			}
			run, err = s.repo.CloudAgent("user", run.ID)
			if err != nil {
				t.Fatal(err)
			}
			if run.CleanupPending || run.MediaTaskID != "" {
				t.Fatal("cleanup checkpoint did not finish")
			}
			canvas, err := s.repo.CanvasProjectForUser("user", state.Request.CanvasID)
			if err != nil {
				t.Fatal(err)
			}
			doc, err := creationDocument(canvas.PayloadJSON)
			if err != nil {
				t.Fatal(err)
			}
			nodes, _ := creationObjects(doc["nodes"])
			meta := nodes[args.NodeID]["metadata"].(map[string]any)
			if missingTarget {
				if meta["status"] != "loading" || !strings.Contains(run.FailureMessage, "缺少有效的目标节点") {
					t.Fatal("unknown target must not be guessed from a copied task ID")
				}
			} else if meta["status"] != "error" {
				t.Fatal("known target did not receive terminal status")
			}
		})
	}
}

func TestCloudAgentMediaCompletionKeepsGenerationAndWritebackFailures(t *testing.T) {
	for _, test := range []struct {
		name   string
		status model.TaskStatus
		err    string
		change string
		reason string
	}{
		{"failed task and deleted node", model.TaskStatusFailed, "上游拒绝该生成规格", "delete", "target_node_missing"},
		{"failed task and replaced binding", model.TaskStatusFailed, "上游请求超时", "rebind", "task_binding_changed"},
		{"successful task and deleted node", model.TaskStatusSucceeded, "", "delete", "target_node_missing"},
		{"successful task without resource", model.TaskStatusSucceeded, "", "", "result_resource_unavailable"},
		{"long task error remains readable", model.TaskStatusFailed, strings.Repeat("上游拒绝该生成规格", 40), "delete", "target_node_missing"},
		{"private task error remains redacted", model.TaskStatusFailed, "upstream https://private.invalid/?token=private-value", "delete", "target_node_missing"},
	} {
		t.Run(test.name, func(t *testing.T) {
			s, db, args := agentMediaFixture(t)
			run, _ := agentMediaRun(t, s, args, "auto")
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			approveAgentMediaDraft(t, s, run.ID)
			run, state := agentInterjectionState(t, s, run.ID)
			taskID := state.MediaTaskID
			if taskID == "" {
				t.Fatal("media task missing")
			}
			if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{"status": test.status, "error": test.err, "result_json": `{}`}).Error; err != nil {
				t.Fatal(err)
			}
			canvas, err := s.repo.CanvasProjectForUser("user", state.Request.CanvasID)
			if err != nil {
				t.Fatal(err)
			}
			doc, err := creationDocument(canvas.PayloadJSON)
			if err != nil {
				t.Fatal(err)
			}
			nodes := creationMaps(doc["nodes"])
			updated := make([]map[string]any, 0, len(nodes))
			for _, node := range nodes {
				if stringValue(node["id"]) == args.NodeID {
					if test.change == "delete" {
						continue
					}
					if test.change == "rebind" {
						node["metadata"].(map[string]any)["taskId"] = "replacement-task"
					}
				}
				updated = append(updated, node)
			}
			// A copied task ID on another node must not redirect the writeback.
			if test.change == "rebind" {
				updated = append(updated, map[string]any{"id": "different-node", "type": "video", "metadata": map[string]any{"taskId": taskID, "content": "keep-existing", "status": "success"}})
			}
			doc["nodes"] = updated
			before, err := json.Marshal(doc)
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.CanvasProject{}).Where("id = ?", canvas.ID).Update("payload_json", string(before)).Error; err != nil {
				t.Fatal(err)
			}
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			run, state = agentInterjectionState(t, s, run.ID)
			last := state.Events[len(state.Events)-1]
			result, _ := last.Payload["result"].(map[string]any)
			if last.Type != "tool_failed" || result["status"] != string(test.status) || result["writebackReason"] != test.reason || result["targetNodeId"] != args.NodeID || result["taskId"] != taskID || result["taskSubmitted"] != true {
				t.Fatalf("completion lost distinct outcome or target: %+v", result)
			}
			message := stringValue(result["error"])
			if run.Status != "failed" || run.FailureMessage != message || message == "工具执行失败，请检查输入或稍后重试" || state.MediaTaskID != "" {
				t.Fatalf("terminal failure was not checkpointed with its diagnostic: status=%s message=%q", run.Status, run.FailureMessage)
			}
			if test.status == model.TaskStatusFailed {
				if stringValue(result["generationError"]) == "" || !strings.Contains(message, stringValue(result["generationError"])) || strings.Contains(message, "任务已成功") {
					t.Fatal("writeback masked generation failure")
				}
			} else if result["generationError"] != nil || !strings.Contains(message, "媒体任务已成功") {
				t.Fatal("successful generation reported as failed")
			}
			serialized, _ := json.Marshal(last.Payload)
			if strings.Contains(string(serialized), "private-value") || strings.Contains(string(serialized), "private.invalid") {
				t.Fatal("provider credentials leaked into Agent events")
			}
			failure := state.Events[len(state.Events)-2]
			if failure.Type != "run_failed" || failure.Payload["reason"] != test.reason || failure.Payload["generationStatus"] != string(test.status) {
				t.Fatal("run failure lost structured causes")
			}
			if test.change != "" {
				after, err := s.repo.CanvasProjectForUser("user", canvas.ID)
				if err != nil {
					t.Fatal(err)
				}
				if after.PayloadJSON != string(before) {
					t.Fatal("missing or rebound target modified another node")
				}
			}
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			var count int64
			if err := db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if count != 1 {
				t.Fatal("completion failure resubmitted billable media")
			}
		})
	}
}

func TestCloudAgentCapabilityGuidePublishesConnectionContracts(t *testing.T) {
	guide := cloudAgentCapabilityGuide()
	for _, nodeType := range []string{"script", "markdown", "text", "image", "video"} {
		descriptor, ok := cloudAgentNodeCapabilityForType(nodeType)
		if !ok {
			t.Fatalf("missing capability %s", nodeType)
		}
		found := false
		for _, line := range strings.Split(guide, "\n") {
			if !strings.Contains(line, "（"+nodeType+"）：") {
				continue
			}
			_, raw, ok := strings.Cut(line, " 连线能力：")
			if !ok {
				t.Fatalf("connection contract missing for %s", nodeType)
			}
			var contract map[string]any
			if err := json.Unmarshal([]byte(raw), &contract); err != nil {
				t.Fatal(err)
			}
			if contract["canSource"] != descriptor.Connection.CanSource || contract["canTarget"] != descriptor.Connection.CanTarget || contract["inputKind"] != descriptor.InputKind {
				t.Fatalf("guide differs from execution registry for %s", nodeType)
			}
			found = true
		}
		if !found {
			t.Fatalf("node %s missing from guide", nodeType)
		}
	}
}
