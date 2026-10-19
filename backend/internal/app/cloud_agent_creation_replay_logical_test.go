package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestCreationReplayReadmitsLogicalModelWithOriginalOptions(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	s.legacyCloudAgentRootTask = false
	logical := seedAgentLogicalImageModel(t, s, db)
	req := creationAgentRequest()
	req.PermissionMode = "auto"
	req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{LogicalModelID: logical.ID}, ParameterMode: "manual", Size: "1024x1024", Quality: "high", Count: 1}}
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	completeCreationReferenceRun(t, db, root.ID)
	input := map[string]any{
		"mode": "image", "prompt": "Keep the approved visual", "config": map[string]any{},
		"capabilityOptions": map[string]any{"size": "1024x1024", "quality": "high", "imageResolution": "1k", "count": 1},
		"metadata":          map[string]any{"source": "cloud_agent_creation", "agentRunId": root.ID},
	}
	original, err := s.CreateTask("user", CreateTaskRequest{Type: "canvas_image", Operation: "text_to_image", Prompt: "Keep the approved visual", LogicalModelID: logical.ID, Input: input, creationPrepare: &creationTaskPreparation{}})
	if err != nil {
		t.Fatal(err)
	}
	original.ID, original.AgentRunID, original.Status = "logical-replay-source", root.ID, model.TaskStatusFailed
	if err := db.Create(original).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.RouteAttempt{ID: "logical-replay-rejection", TaskID: original.ID, RouteRun: original.RouteRun, Status: "failed", DispatchState: "rejected_no_job", FailureCode: "upstream_429"}).Error; err != nil {
		t.Fatal(err)
	}
	req.IdempotencyKey, req.SessionID = "logical-replay", root.SessionID
	req.Retry = &CloudAgentCreationRetry{RunID: root.ID, TaskID: original.ID}
	next, err := s.CreateCloudAgentRun("user", req, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", next.ID); err != nil {
		t.Fatal(err)
	}
	retried, err := s.repo.TaskForUser("user", cloudAgentCommerceRetryTaskID("user", original.ID))
	if err != nil {
		run, _ := s.repo.CloudAgent("user", next.ID)
		t.Fatalf("logical replay failed to submit: %v; run failure: %s", err, run.FailureMessage)
	}
	if retried.LogicalModelID != logical.ID || retried.RouteID != original.RouteID || retried.Prompt != original.Prompt {
		t.Fatalf("logical replay lost model, route or intent: %+v", retried)
	}
	var resolved struct {
		Config            map[string]any `json:"config"`
		CapabilityOptions map[string]any `json:"capabilityOptions"`
	}
	if err := json.Unmarshal([]byte(retried.InputJSON), &resolved); err != nil {
		t.Fatal(err)
	}
	if stringValue(resolved.Config["size"]) != "1024x1024" || stringValue(resolved.Config["quality"]) != "high" || stringValue(resolved.Config["imageResolution"]) != "1k" || stringValue(resolved.CapabilityOptions["quality"]) != "high" {
		t.Fatalf("logical replay reset approved options: %+v", resolved)
	}
}
