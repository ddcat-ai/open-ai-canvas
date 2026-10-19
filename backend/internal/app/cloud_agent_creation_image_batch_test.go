package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func creationContextImageBatchFixture(t *testing.T, permission string) (*Service, *gorm.DB, string, cloudAgentCall) {
	t.Helper()
	s, db, _ := agentMediaFixture(t)
	installCreationParallelImageModel(t, db)
	policy := defaultRuntimePolicy()
	policy.Task.ActiveTaskLimit = 20
	if _, err := s.UpdateRuntimePolicySetting(&model.User{ID: "admin", Role: model.UserRoleAdmin}, policy); err != nil {
		t.Fatal(err)
	}
	parent, err := s.CreateCloudAgentRun("user", creationAgentRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 5; i++ {
		resource := fmt.Sprintf("previous-image-%d", i)
		if err := db.Create(&model.Resource{ID: resource, UserID: "user", Kind: "image", Status: "ready", MimeType: "image/png", Width: 1024, Height: 1024, Size: 50}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.Task{ID: fmt.Sprintf("previous-task-%d", i), UserID: "user", AgentRunID: parent.ID, Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: `{}`, ResultJSON: `{"images":[{"storageKey":"resource:` + resource + `"}]}`}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", parent.ID).Update("status", "completed").Error; err != nil {
		t.Fatal(err)
	}
	req := creationAgentRequest()
	req.Prompt, req.PermissionMode, req.IdempotencyKey = "把上面生成的五张图片全部换成中文，只改文字，保留各自画面", permission, "context-image-batch-"+permission
	req.Budget.MaxCredits, req.Budget.MaxGenerationTasks = 10, 5
	req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "image-test"}, ParameterMode: "manual", Size: "1024x1024", Count: 4}}
	root, err := s.CreateCloudAgentRun("user", req, parent.ID)
	if err != nil {
		t.Fatal(err)
	}
	var items []map[string]any
	for i := 1; i <= 5; i++ {
		call := cloudAgentCall{ID: fmt.Sprintf("read-original-%d", i)}
		call.Function.Name, call.Function.Arguments = "creation_media_read", fmt.Sprintf(`{"taskId":"previous-task-%d","outputIndex":1}`, i)
		if result, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", root.ID, call); err != nil || result.(map[string]any)["isError"] == true {
			t.Fatalf("read historical original: %+v %v", result, err)
		}
		id := fmt.Sprintf("previous-image-%d", i)
		items = append(items, map[string]any{"id": fmt.Sprint(i), "title": fmt.Sprintf("图%d换成中文", i), "prompt": "仅将画面文字换成中文，保留原图其他所有内容", "attachmentResourceIds": []string{id}, "references": []map[string]any{{"resourceId": id, "role": "source", "usage": "此项对应的原图，只修改文字"}}})
	}
	run, state := agentInterjectionState(t, s, root.ID)
	state.ActiveTaskID = ""
	call := cloudAgentCall{ID: "translate-five-originals"}
	call.Function.Name, call.Function.Arguments = "generate_image_batch", mustMarshal(map[string]any{"items": items})
	state.PiModelCalls = []cloudAgentCall{call}
	if err := s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	return s, db, root.ID, call
}

func TestCreationContextImageBatchQueuesEveryOriginalBeforeCompletion(t *testing.T) {
	s, db, runID, call := creationContextImageBatchFixture(t, "auto")
	_, initial := agentInterjectionState(t, s, runID)
	if !strings.Contains(mustMarshal(cloudAgentCreationModelTools(&initial, initial.Canonical.Tools)), "generate_image_batch") {
		t.Fatal("context edits have no generic batch tool without loading commerce again")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		result, err := s.executeCloudAgentRuntimeTool(ctx, "user", runID, call)
		if err == nil && result.(map[string]any)["isError"] == true {
			err = fmt.Errorf("batch failed: %v", result)
		}
		done <- err
	}()
	var tasks []model.Task
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if err := db.Where("agent_run_id = ? AND type = ?", runID, "canvas_image").Find(&tasks).Error; err != nil {
			t.Fatal(err)
		}
		if len(tasks) == 5 {
			break
		}
		select {
		case err := <-done:
			stored, state := agentInterjectionState(t, s, runID)
			t.Fatalf("batch returned before all five requests were admitted: %v; status=%s failure=%s events=%s", err, stored.Status, stored.FailureMessage, mustMarshal(state.Events[max(0, len(state.Events)-3):]))
		default:
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(tasks) != 5 {
		t.Fatalf("only %d/5 independent context edits queued", len(tasks))
	}
	_, admitted := agentInterjectionState(t, s, runID)
	for _, item := range admitted.Plan {
		if item.Status != "doing" {
			t.Fatalf("admitted image still displayed as pending: %+v", item)
		}
	}
	for _, task := range tasks {
		var input struct {
			Config struct {
				Count string `json:"count"`
			} `json:"config"`
			Metadata struct {
				ItemID string `json:"imageBatchItemId"`
				Total  int    `json:"imageBatchTotal"`
			} `json:"metadata"`
			References []struct {
				StorageKey string `json:"storageKey"`
			} `json:"referenceImages"`
		}
		if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
			t.Fatal(err)
		}
		if task.Status != model.TaskStatusQueued || task.Operation != "image_to_image" || input.Config.Count != "1" || input.Metadata.Total != 5 || len(input.References) != 1 || input.References[0].StorageKey != "resource:previous-image-"+input.Metadata.ItemID {
			t.Fatalf("wrong per-image source/count: %+v %s", input, task.InputJSON)
		}
		if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"images":[]}`}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if _, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", runID, call); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", runID, "canvas_image").Count(&count)
	if count != 5 {
		t.Fatalf("batch replay duplicated a task or charge: %d", count)
	}
	ids := make([]string, 0, len(tasks))
	for _, task := range tasks {
		ids = append(ids, task.ID)
	}
	db.Model(&model.BillingOrder{}).Where("task_id IN ?", ids).Count(&count)
	if count != 5 {
		t.Fatalf("expected exactly five billed image orders, got %d", count)
	}
}

func TestCreationContextImageBatchStopKeepsAdmittedTasks(t *testing.T) {
	s, db, runID, call := creationContextImageBatchFixture(t, "auto")
	run, state := agentInterjectionState(t, s, runID)
	state.Calls, state.CallIndex = []cloudAgentCall{call}, 0
	if err := s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, runID)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	if err := s.CancelCloudAgent(context.Background(), "user", runID); err != nil {
		t.Fatal(err)
	}
	var tasks []model.Task
	if err := db.Where("agent_run_id = ? AND type = ?", runID, "canvas_image").Find(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 5 {
		t.Fatalf("stopped batch lost admitted images: %d", len(tasks))
	}
	for _, task := range tasks {
		if task.Status != model.TaskStatusQueued || task.BillingOrderID == "" {
			t.Fatalf("stop cancelled or lost normal billing for admitted image: %+v", task)
		}
	}
	if _, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", runID, call); err == nil {
		t.Fatal("stopped batch was executed again")
	}
}

func TestCreationContextImageBatchApprovalAndFailureKeepExactTasks(t *testing.T) {
	s, db, runID, call := creationContextImageBatchFixture(t, "request_approval")
	result, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", runID, call)
	if err != nil || result.(map[string]any)["pause"] != true {
		t.Fatalf("missing whole-batch approval: %+v %v", result, err)
	}
	run, state := agentInterjectionState(t, s, runID)
	var count int64
	db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", runID, "canvas_image").Count(&count)
	if count != 0 || state.Approval == nil || len(state.Approval.Preview.Items) != 5 {
		t.Fatal("batch charged before its one approval")
	}
	approval := state.Approval.ID
	state.Approval.Batch.Items[0].Prepared.Quote.ExpiresAt = time.Now().Add(-time.Minute)
	if err := s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.DecideCloudAgentApproval("user", runID, approval, "approve", ""); err == nil {
		t.Fatal("expired quote was silently approved")
	}
	_, state = agentInterjectionState(t, s, runID)
	if state.Approval == nil || state.Approval.ID == approval || state.Approval.Batch.Kind != "images" {
		t.Fatal("generic batch quote did not refresh in place")
	}
	approval = state.Approval.ID
	for i := 0; i < 2; i++ {
		if err := s.DecideCloudAgentApproval("user", runID, approval, "approve", ""); err != nil {
			t.Fatal(err)
		}
	}
	var tasks []model.Task
	if err := db.Where("agent_run_id = ? AND type = ?", runID, "canvas_image").Order("created_at").Find(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 5 {
		t.Fatalf("approval/replay did not queue all five exactly once: %d", len(tasks))
	}
	for i, task := range tasks {
		status := model.TaskStatusSucceeded
		if i == 1 {
			status = model.TaskStatusFailed
		}
		if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"status": status, "result_json": `{"images":[]}`, "error": "mock failure"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := s.settleCloudAgentMedia("user", runID); err != nil {
		t.Fatal(err)
	}
	receipt, err := s.repo.CloudAgentReceipt("user", runID, "tool", call.ID)
	if err != nil || !strings.Contains(receipt.Content, `"complete":true`) || !strings.Contains(receipt.Content, tasks[1].ID) || !strings.Contains(receipt.Content, `"status":"failed"`) {
		t.Fatalf("batch lost the real partial-failure receipt: %+v %v", receipt, err)
	}
	_, state = agentInterjectionState(t, s, runID)
	if state.MediaTaskID != "" || state.CommerceBatch != nil || state.Generations != 5 {
		t.Fatal("batch did not settle or counted a replay twice")
	}
}

func TestCreationContextImageBatchRejectsInvalidLastSourceBeforeAnyCharge(t *testing.T) {
	for _, reason := range []string{"foreign_source", "task_budget"} {
		t.Run(reason, func(t *testing.T) {
			s, db, runID, call := creationContextImageBatchFixture(t, "auto")
			run, state := agentInterjectionState(t, s, runID)
			switch reason {
			case "foreign_source":
				call.Function.Arguments = strings.ReplaceAll(call.Function.Arguments, "previous-image-5", "private")
			case "task_budget":
				state.Request.Budget.MaxGenerationTasks = 4
			}
			if _, err := s.prepareCloudAgentImageBatch(run, &state, call); err == nil {
				t.Fatal("invalid batch was admitted")
			}
			var count int64
			db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", runID, "canvas_image").Count(&count)
			if count != 0 {
				t.Fatal("a rejected batch left charged image tasks")
			}
		})
	}
}
