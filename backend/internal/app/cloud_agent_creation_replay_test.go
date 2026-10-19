package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestCreationRetryReplaysFrozenInputsWithoutPlanning(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	s.legacyCloudAgentRootTask = false
	installCreationParallelImageModel(t, db)
	req := creationAgentRequest()
	req.PermissionMode = "auto"
	req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "image-test"}, ParameterMode: "auto"}}
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	completeCreationReferenceRun(t, db, root.ID)
	for _, id := range []string{"ref-one", "ref-two"} {
		input := map[string]any{"mode": "image", "prompt": "Keep original " + id, "config": map[string]any{"channelId": "channel", "channelModelKey": "image-test", "model": "image-test", "size": "1024x1024", "count": "1"}, "referenceImages": []map[string]any{{"id": id, "storageKey": "resource:" + id, "type": "image/png", "role": "reference"}}, "metadata": map[string]any{"source": "cloud_agent_creation", "title": id, "agentRunId": root.ID}}
		task := model.Task{ID: "failed-" + id, UserID: "user", AgentRunID: root.ID, Type: "canvas_image", Operation: "image_to_image", Model: "image-test", Prompt: "Keep original " + id, InputJSON: mustMarshal(input), Status: model.TaskStatusFailed}
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.RouteAttempt{ID: "attempt-" + id, TaskID: task.ID, Status: "failed", DispatchState: "rejected_no_job", FailureCode: "upstream_429"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	req.IdempotencyKey, req.SessionID = "replay-without-planning", root.SessionID
	req.Retry = &CloudAgentCreationRetry{RunID: root.ID, TaskIDs: []string{"failed-ref-one", "failed-ref-two"}}
	next, err := s.CreateCloudAgentRun("user", req, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", next.ID); err != nil {
		t.Fatal(err)
	}
	var tasks []model.Task
	if err := db.Where("agent_run_id = ?", next.ID).Find(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 2 {
		t.Fatalf("want two media tasks without a planning call, got %d: %+v", len(tasks), tasks)
	}
	for _, task := range tasks {
		if task.Type != "canvas_image" {
			t.Fatalf("retry invoked planner: %s", task.Type)
		}
		var input struct {
			References []struct {
				ID string `json:"id"`
			} `json:"referenceImages"`
		}
		if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
			t.Fatal(err)
		}
		if len(input.References) != 1 || task.Prompt != "Keep original "+input.References[0].ID {
			t.Fatalf("lost original prompt/reference mapping: %s", task.InputJSON)
		}
		if err := db.Model(&task).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"images":[]}`}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := s.advanceCloudAgentByID("user", next.ID); err != nil {
		t.Fatal(err)
	}
	finished, err := s.CloudAgentRun("user", next.ID)
	if err != nil || finished.Status != "completed" {
		t.Fatalf("retry did not finish directly: %+v %v", finished, err)
	}
	req.IdempotencyKey = "duplicate-replay-new-key"
	if _, err := s.CreateCloudAgentRun("user", req, next.ID); err == nil {
		t.Fatal("a different request key replayed the same original failures twice")
	}
}

func TestCreationRetryVideoPreservesFrozenRequest(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	s.legacyCloudAgentRootTask = false
	req := creationAgentRequest()
	req.PermissionMode = "auto"
	req.MediaSettings = &CloudAgentCreationMedia{Video: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "seedance-test"}, ParameterMode: "auto"}}
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	completeCreationReferenceRun(t, db, root.ID)
	input := map[string]any{"mode": "video", "prompt": "原视频提示词", "config": map[string]any{"channelId": "channel", "channelModelKey": "seedance-test", "model": "seedance-test", "size": "9:16", "videoSeconds": "12"}, "referenceImages": []map[string]any{{"id": "ref-one", "storageKey": "resource:ref-one", "role": "reference", "type": "image/png"}}}
	original := model.Task{ID: "failed-video", UserID: "user", AgentRunID: root.ID, Type: "canvas_video", Operation: "image_to_video", Model: "seedance-test", Prompt: "原视频提示词", InputJSON: mustMarshal(input), Status: model.TaskStatusFailed}
	if err := db.Create(&original).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.RouteAttempt{ID: "video-rejected", TaskID: original.ID, Status: "failed", DispatchState: "rejected_no_job"}).Error; err != nil {
		t.Fatal(err)
	}
	req.SessionID, req.IdempotencyKey, req.Retry = root.SessionID, "retry-video", &CloudAgentCreationRetry{RunID: root.ID, TaskID: original.ID}
	next, err := s.CreateCloudAgentRun("user", req, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", next.ID); err != nil {
		t.Fatal(err)
	}
	var tasks []model.Task
	if err := db.Where("agent_run_id = ?", next.ID).Find(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 1 || tasks[0].Type != "canvas_video" || tasks[0].Prompt != original.Prompt {
		t.Fatalf("video retry invoked planning or lost prompt: %+v", tasks)
	}
	var got canvasGenerationInput
	if err := json.Unmarshal([]byte(tasks[0].InputJSON), &got); err != nil {
		t.Fatal(err)
	}
	if got.Config.Size != "9:16" || got.Config.VideoSeconds != "12" || len(got.ReferenceImages) != 1 || got.ReferenceImages[0].StorageKey != "resource:ref-one" {
		t.Fatalf("video specifications changed: %+v", got)
	}
}

func TestCreationReplaySettingsIgnoreRoutingPolicyButKeepCreativeConstraints(t *testing.T) {
	old := &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "image"}, ParameterMode: "manual", Size: "1:1", Quality: "high", Count: 1}}
	choice := *old.Image
	choice.SelectionMode = "preferred"
	next := &CloudAgentCreationMedia{Image: &choice}
	if !cloudAgentReplaySettingsEqual(old, next) {
		t.Fatal("new routing default forced a legacy unchanged retry through planning")
	}
	choice.Size = "16:9"
	if cloudAgentReplaySettingsEqual(old, next) {
		t.Fatal("changed creative specification bypassed planning")
	}
}
