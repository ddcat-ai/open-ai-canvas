package app

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func creationMediaRun(t *testing.T, s *Service, key string, args cloudAgentMediaArgs, choice CloudAgentCreationMediaChoice, permissions ...string) (*model.CloudAgentExecution, cloudAgentRuntime) {
	t.Helper()
	req := creationAgentRequest()
	req.PermissionMode = "request_approval"
	if len(permissions) > 0 {
		req.PermissionMode = permissions[0]
	}
	req.IdempotencyKey = key
	req.Budget.MaxCredits = 10
	req.Budget.MaxGenerationTasks = 2
	req.Budget.MaxVideoSeconds = 24
	req.Attachments = []CloudAgentAttachment{{ResourceID: "ref-one", StorageKey: "resource:ref-one", Kind: "image", Role: "product", Name: "商品图"}}
	req.MediaSettings = &CloudAgentCreationMedia{Video: &choice}
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	state.ActiveTaskID = ""
	state.Calls = []cloudAgentCall{agentMediaCall(args)}
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	return run, state
}

func TestCreationMediaApprovalBillsOnceWithoutCanvasMutation(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	original := canvas.PayloadJSON
	args := cloudAgentMediaArgs{Mode: "video", Prompt: "拍摄一段商品演示视频", AttachmentResourceIDs: []string{"ref-one"}, Duration: 6, Size: "16:9", Title: "商品演示"}
	choice := CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "seedance-test"}, ParameterMode: "manual", Size: "9:16", DurationSeconds: 12}
	run, state := creationMediaRun(t, s, "creation-video-approval", args, choice)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	stored, err := s.CloudAgentRun("user", run.ID)
	if err != nil || stored.Status != "waiting_approval" || stored.Approval == nil {
		t.Fatalf("missing creation approval: %+v, %v", stored, err)
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 0 {
		t.Fatal("media task submitted before approval")
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, stored.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	storedRun, _ := s.repo.CloudAgent("user", run.ID)
	state, err = cloudAgentDecode(storedRun)
	if err != nil || state.MediaTaskID == "" {
		t.Fatalf("missing admitted media task: %v, %+v", err, state)
	}
	task, err := s.repo.TaskForUser("user", state.MediaTaskID)
	if err != nil {
		t.Fatal(err)
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if task.ProjectID != "" || input.Config.Model != "seedance-test" || input.Config.Size != "9:16" || input.Config.VideoSeconds != "12" || len(input.ReferenceImages) != 1 || input.ReferenceImages[0].StorageKey != "resource:ref-one" || input.ReferenceImages[0].URL != "" {
		t.Fatalf("creation generation input mismatch: project=%q config=%+v refs=%+v", task.ProjectID, input.Config, input.ReferenceImages)
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, stored.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 1 {
		t.Fatalf("expected one charged generation, got %d", count)
	}
	canvas, _ = s.repo.CanvasProjectForUser("user", "agent-canvas")
	if canvas.PayloadJSON != original {
		t.Fatal("creation generation mutated an unrelated canvas")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"url":"https://generated.example/result.mp4"}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	storedRun, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(storedRun)
	completed := false
	for _, event := range state.Events {
		completed = completed || event.Type == "generation_task_completed"
	}
	if state.MediaTaskID != "" || !completed {
		t.Fatalf("completed creation task did not restore a durable tool result: status=%s mediaTask=%q callIndex=%d", storedRun.Status, state.MediaTaskID, state.CallIndex)
	}
}

func TestCreationMediaRejectsUnlistedAttachment(t *testing.T) {
	s, _, _ := agentMediaFixture(t)
	choice := CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "seedance-test"}, ParameterMode: "auto"}
	args := cloudAgentMediaArgs{Mode: "video", Prompt: "商品演示", AttachmentResourceIDs: []string{"ref-two"}}
	run, state := creationMediaRun(t, s, "creation-unlisted-attachment", args, choice)
	_, _, err := s.prepareCloudAgentMedia(run, &state, state.Calls[0])
	if err == nil || !strings.Contains(err.Error(), "授权附件") {
		t.Fatalf("unlisted attachment was accepted: %v", err)
	}
}

func TestCreationMediaAutoModeHonorsGenerationBudget(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	choice := CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "seedance-test"}, ParameterMode: "auto"}
	args := cloudAgentMediaArgs{Mode: "video", Prompt: "商品演示", Duration: 12, AttachmentResourceIDs: []string{"ref-one"}}
	run, state := creationMediaRun(t, s, "creation-auto-budget", args, choice, "auto")
	state.Request.Budget.MaxGenerationTasks = 1
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	stored, _ := s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(stored)
	if stored.Status == "waiting_approval" || state.MediaTaskID == "" || state.Generations != 1 {
		t.Fatalf("auto generation did not submit within budget: status=%s generations=%d task=%q", stored.Status, state.Generations, state.MediaTaskID)
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 1 {
		t.Fatalf("expected one media task, got %d", count)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 1 {
		t.Fatalf("worker restart duplicated charged task: %d", count)
	}
}
