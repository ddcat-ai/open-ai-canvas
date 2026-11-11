package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestCloudAgentPiProviderContextOverflowReleasesStep(t *testing.T) {
	s, db, runID := piOutputLimitFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := s.cloudAgentPiModel(ctx, "user", runID, map[string]json.RawMessage{
			"messages": json.RawMessage(`[{"role":"user","content":"继续"}]`),
			"purpose":  json.RawMessage(`"conversation"`),
		})
		done <- err
	}()
	var taskID string
	for taskID == "" {
		_, state := agentInterjectionState(t, s, runID)
		taskID = state.ActiveTaskID
		if taskID != "" {
			break
		}
		select {
		case err := <-done:
			t.Fatalf("model bridge returned before task creation: %v", err)
		case <-ctx.Done():
			t.Fatal("model task was not created")
		case <-time.After(20 * time.Millisecond):
		}
	}
	if err := db.Create(&model.ApiCallLog{
		ID: "pi-context-overflow", UserID: "user", TaskID: taskID,
		Capability: "text", RequestKind: "create", Status: model.ApiCallStatusFailed,
		StatusCode: 400, ErrorCode: "context_length_exceeded", Error: "upstream-private-diagnostic",
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Update("status", model.TaskStatusFailed).Error; err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "exceeds the context window") || strings.Contains(err.Error(), "upstream-private-diagnostic") {
			t.Fatalf("Pi must receive a sanitized overflow marker, got %v", err)
		}
	case <-ctx.Done():
		t.Fatal("overflow bridge did not return")
	}
	_, state := agentInterjectionState(t, s, runID)
	if state.ActiveTaskID != "" {
		t.Fatalf("failed step blocks the next compaction request: %s", state.ActiveTaskID)
	}
	var count int64
	if err := db.Model(&model.Task{}).Where("agent_run_id = ? AND operation = ?", runID, cloudAgentStepOperation).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("Go must not retry the oversized request before Pi compacts: %d tasks", count)
	}
}

func TestCloudAgentPiContextOverflowDoesNotGuessFromHTTPStatus(t *testing.T) {
	for _, call := range []model.ApiCallLog{
		{Status: model.ApiCallStatusFailed, StatusCode: 413, Error: "file too large"},
		{Status: model.ApiCallStatusFailed, StatusCode: 429, ErrorCode: "rate_limit_exceeded"},
		{Status: model.ApiCallStatusSucceeded, ErrorCode: "context_length_exceeded"},
	} {
		if cloudAgentPiContextOverflow(call) {
			t.Fatalf("unrelated error should not trigger compaction: %#v", call)
		}
	}
}
