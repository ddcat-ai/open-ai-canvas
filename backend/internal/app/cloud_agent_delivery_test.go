package app

import (
	"encoding/json"
	"errors"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCloudAgentDeliveryRestoresOnceWithoutBillingAndSupportsUndo(t *testing.T) {
	s, db, args := agentMediaFixture(t)
	run, _ := agentMediaRun(t, s, args, "auto")
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	approveAgentMediaDraft(t, s, run.ID)
	_, state := agentInterjectionState(t, s, run.ID)
	taskID := state.MediaTaskID
	if err := db.Create(&model.Resource{ID: "delivery-output", UserID: "user", Kind: "video", Status: "ready", MimeType: "video/mp4", Width: 720, Height: 1280}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"mode":"video","video":{"storageKey":"resource:delivery-output"}}`}).Error; err != nil {
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
	// Preserve a user's replacement node; recovery must create a new node.
	for _, node := range creationMaps(doc["nodes"]) {
		if stringValue(node["id"]) == args.NodeID {
			node["metadata"] = map[string]any{"taskId": "replacement", "content": "keep-user-content"}
		}
	}
	raw, _ := json.Marshal(doc)
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", canvas.ID).Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	view, err := s.CloudAgentRun("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if view.Status != "failed" || len(view.Delivery.Items) != 1 || view.Delivery.Items[0].Status != "restore_available" {
		t.Fatalf("lost recoverable output: %+v", view)
	}
	task, err := s.repo.TaskForUser("user", taskID)
	if err != nil {
		t.Fatal(err)
	}
	originalDiagnostic := task.ExecutionDiagnosticJSON
	beforeFacts := cloudAgentTaskDiagnostic(s.repo, task)
	if beforeFacts["writebackOutcome"] != "failed" || beforeFacts["resultRestoration"] != nil {
		t.Fatalf("unrestored output has incorrect facts: %#v", beforeFacts)
	}
	assertRestorationFacts := func(status, nodeID string) {
		t.Helper()
		result, err := cloudAgentReadTool(s.repo, "user", &state, cloudAgentStoryboardCall(t, "task_get", "inspect-recovery", map[string]any{"taskId": taskID}))
		if err != nil {
			t.Fatal(err)
		}
		facts := result.(map[string]any)
		restoration, ok := facts["resultRestoration"].(map[string]any)
		if !ok || restoration["status"] != status || restoration["nodeId"] != nodeID {
			t.Fatalf("recovery facts = %#v, want %s/%s", facts["resultRestoration"], status, nodeID)
		}
		if facts["writebackOutcome"] != "failed" || facts["writebackNodeId"] != args.NodeID {
			t.Fatalf("recovery replaced the original writeback audit: %#v", facts)
		}
		stored, err := s.repo.TaskForUser("user", taskID)
		if err != nil || stored.ExecutionDiagnosticJSON != originalDiagnostic {
			t.Fatalf("projection rewrote the stored diagnostic: %v", err)
		}
	}
	var taskCount, orderCount int64
	db.Model(&model.Task{}).Count(&taskCount)
	db.Model(&model.BillingOrder{}).Count(&orderCount)
	if _, err := s.RestoreCloudAgentResult("other", run.ID, taskID); err == nil {
		t.Fatal("cross-user restore accepted")
	}
	if _, err := s.RestoreCloudAgentResult("user", run.ID, run.ID); err == nil {
		t.Fatal("text task accepted")
	}
	first, err := s.RestoreCloudAgentResult("user", run.ID, taskID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.RestoreCloudAgentResult("user", run.ID, taskID)
	if err != nil || first["nodeId"] != second["nodeId"] {
		t.Fatalf("restore not idempotent: %v %v %v", first, second, err)
	}
	restoredNodeID := first["nodeId"].(string)
	assertRestorationFacts("delivered", restoredNodeID)
	for _, change := range []struct {
		name string
		edit func(*model.Task)
	}{
		{"non-agent", func(copy *model.Task) { copy.AgentRunID = "" }},
		{"foreign-owner", func(copy *model.Task) { copy.UserID = "other" }},
		{"other-canvas", func(copy *model.Task) { copy.ProjectID = "other-canvas" }},
		{"failed", func(copy *model.Task) { copy.Status = model.TaskStatusFailed }},
		{"non-media", func(copy *model.Task) { copy.Type = "canvas_text" }},
		{"unrelated-task", func(copy *model.Task) { copy.ID = "unrelated-task" }},
	} {
		copy := *task
		change.edit(&copy)
		if facts := cloudAgentTaskDiagnostic(s.repo, &copy); facts["resultRestoration"] != nil {
			t.Fatalf("%s received restoration facts: %#v", change.name, facts["resultRestoration"])
		}
	}
	var afterTasks, afterOrders int64
	db.Model(&model.Task{}).Count(&afterTasks)
	db.Model(&model.BillingOrder{}).Count(&afterOrders)
	if afterTasks != taskCount || afterOrders != orderCount {
		t.Fatal("restore created a task or bill")
	}
	canvas, _ = s.repo.CanvasProjectForUser("user", canvas.ID)
	doc, _ = creationDocument(canvas.PayloadJSON)
	for _, node := range creationMaps(doc["nodes"]) {
		if stringValue(node["id"]) == args.NodeID && stringValue(node["metadata"].(map[string]any)["content"]) != "keep-user-content" {
			t.Fatal("overwrote replacement node")
		}
	}
	view, err = s.CloudAgentRun("user", run.ID)
	if err != nil || view.Delivery.Items[0].Status != "delivered" {
		t.Fatalf("delivery not refreshed: %v", err)
	}
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", canvas.ID).Update("payload_json", "invalid-json").Error; err != nil {
		t.Fatal(err)
	}
	assertRestorationFacts("unavailable", restoredNodeID)
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", canvas.ID).Update("payload_json", canvas.PayloadJSON).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", "delivery-output").Update("user_id", "other").Error; err != nil {
		t.Fatal(err)
	}
	assertRestorationFacts("unavailable", restoredNodeID)
	if err := db.Model(&model.Resource{}).Where("id = ?", "delivery-output").Update("user_id", "user").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.UndoCloudAgentCanvas("user", run.ID, "restore:"+taskID, cloudAgentCanvasHash(doc), "undo recovery"); err != nil {
		t.Fatal(err)
	}
	assertRestorationFacts("restored_then_changed", restoredNodeID)
	view, err = s.CloudAgentRun("user", run.ID)
	if err != nil || view.Delivery.Items[0].Status != "restored_then_changed" {
		t.Fatal("offered impossible recovery after undo")
	}
	if _, err := s.RestoreCloudAgentResult("user", run.ID, taskID); err == nil {
		t.Fatal("a late retry resurrected an undone node")
	}
}

func TestCloudAgentDeliveryDoesNotClaimPlanOrQuestionCompleted(t *testing.T) {
	s, _, root := reliableAgentRoot(t)
	run, state := agentInterjectionState(t, s, root.ID)
	run.Status = "completed"
	state.Plan = []cloudAgentPlanItem{{ID: "1", Title: "剩余镜头", Status: "doing"}}
	delivery, err := s.cloudAgentDelivery(run, &state)
	if err != nil || delivery.Status != "needs_attention" {
		t.Fatalf("pending plan reported done: %+v %v", delivery, err)
	}
	state.event(run.ID, "user_question", map[string]any{"question": "选择规格"})
	delivery, err = s.cloudAgentDelivery(run, &state)
	if err != nil || delivery.Status != "awaiting_input" {
		t.Fatalf("question reported done: %+v %v", delivery, err)
	}
}

func TestCloudAgentImageFalseVideoToggleNormalizedButTrueRejected(t *testing.T) {
	s, _, args := agentMediaFixture(t)
	run, state := agentMediaRun(t, s, args, "auto")
	args.Mode, args.Duration, args.SourceNodeID = "image", 0, ""
	args.ChannelModelKey = "grok-image"
	no := false
	args.VideoGenerateAudio = &no
	_, plan, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(args))
	if err != nil {
		t.Fatal(err)
	}
	if plan.Args.VideoGenerateAudio != nil {
		t.Fatal("irrelevant false toggle retained")
	}
	yes := true
	args.VideoGenerateAudio = &yes
	_, _, err = s.prepareCloudAgentMedia(run, &state, agentMediaCall(args))
	var field *cloudAgentFieldArgumentError
	if !errors.As(err, &field) || field.Field != "videoGenerateAudio" {
		t.Fatalf("substantive option silently discarded: %v", err)
	}
}
