package app

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestCloudAgentAskUserReturnsCommittedResultAfterRunCompletes(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	run, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	stored, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	call := cloudAgentCall{ID: "ask-terminal-1"}
	call.Function.Name = "ask_user"
	call.Function.Arguments = `{"question":"选择用途？","options":[{"label":"园艺"},{"label":"其他"}]}`
	state, err := cloudAgentDecode(stored)
	if err != nil {
		t.Fatal(err)
	}
	state.Calls = []cloudAgentCall{call}
	state.CallIndex = 0
	if err := s.repo.MutateCloudAgent("user", run.ID, stored.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	fence, err := s.repo.ClaimCloudAgentOwner("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.WithValue(context.Background(), cloudAgentOwnerContextKey{}, fence)
	result, err := s.executeCloudAgentRuntimeTool(ctx, "user", run.ID, call)
	if err != nil {
		t.Fatalf("ask_user result was lost after terminal transition: %v", err)
	}
	payload, ok := result.(map[string]any)
	if !ok || payload["terminate"] != true {
		t.Fatalf("unexpected terminal ask_user result: %#v", result)
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(payload["content"].(string)), &body); err != nil || body["phase"] != "question" {
		t.Fatalf("question result missing: %#v err=%v", payload, err)
	}
	final, err := s.repo.CloudAgent("user", run.ID)
	if err != nil || final.Status != "completed" {
		t.Fatalf("terminal ask_user did not complete run: status=%s err=%v", final.Status, err)
	}
}

func TestCloudAgentFailedToolReturnsCommittedResultAndFlushesNativeHistory(t *testing.T) {
	s, _, _ := agentMediaFixture(t)
	choice := CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "seedance-test"}, ParameterMode: "manual", Size: "9:16", DurationSeconds: 6}
	run, state := creationMediaRun(t, s, "failed-tool-flush", cloudAgentMediaArgs{Mode: "video", Prompt: "Create a product video", LogicalModelID: "forbidden-model-change"}, choice)
	call := state.Calls[0]
	state.Calls, state.CallIndex = nil, 0
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	fence, err := s.repo.ClaimCloudAgentOwner("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.WithValue(context.Background(), cloudAgentOwnerContextKey{}, fence)
	result, err := s.executeCloudAgentRuntimeTool(ctx, "user", run.ID, call)
	if err != nil {
		t.Fatalf("failed tool lost its committed error result: %v", err)
	}
	payload, ok := result.(map[string]any)
	if !ok || payload["terminate"] != true || payload["isError"] != true {
		t.Fatalf("failure must terminate Pi with its paired error result: %#v", result)
	}
	latest, err := s.repo.CloudAgent("user", run.ID)
	if err != nil || latest.Status != "failed" {
		t.Fatalf("failure status changed: %v", err)
	}
	if err := s.repo.CheckCloudAgentOwner(latest, fence); !errors.Is(err, repository.ErrCloudAgentOwnerLost) {
		t.Fatalf("ordinary terminal writes were allowed: %v", err)
	}
	if _, err := s.cloudAgentPiEvent(ctx, "user", run.ID, piEventForTest(t, map[string]any{"type": "tool_call_end", "callId": call.ID})); err != nil {
		t.Fatalf("final tool event rejected: %v", err)
	}
	snapshot := "{\"type\":\"session\",\"id\":\"failure-flush\",\"version\":3}\n" + mustMarshal(map[string]any{"type": "message", "message": map[string]any{"role": "toolResult", "toolCallId": call.ID, "content": []any{map[string]any{"type": "text", "text": payload["content"]}}, "isError": true}}) + "\n"
	if _, err := s.cloudAgentPiEvent(ctx, "user", run.ID, piEventForTest(t, map[string]any{"type": "session_snapshot", "sessionJSONL": snapshot})); err != nil {
		t.Fatalf("paired native failure snapshot rejected: %v", err)
	}
	saved, err := s.repo.CloudAgentPiSession("user", run.ID)
	if err != nil || saved.SessionJSONL != snapshot {
		t.Fatalf("native failure history was not persisted: %v", err)
	}
	stale := *fence
	stale.Epoch++
	if err := s.repo.CheckCloudAgentPiSnapshotOwner(latest, &stale); !errors.Is(err, repository.ErrCloudAgentOwnerLost) {
		t.Fatalf("stale terminal owner was accepted: %v", err)
	}
	if err := s.repo.CheckCloudAgentPiSnapshotOwner(latest, nil); !errors.Is(err, repository.ErrCloudAgentOwnerLost) {
		t.Fatalf("ownerless terminal snapshot was accepted: %v", err)
	}
}
