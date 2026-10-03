package app

import (
	"context"
	"errors"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// ask_user can complete a run while its Pi process is still flushing the
// assistant/question journal. The same live owner must persist that snapshot.
func TestPiTerminalQuestionPersistsFinalNativeSnapshot(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	const runID = "terminal-question-snapshot"
	if err := db.Create(&model.CloudAgentExecution{ID: runID, UserID: "user", Status: "running", StateJSON: `{}`}).Error; err != nil {
		t.Fatal(err)
	}
	fence, err := s.repo.ClaimCloudAgentOwner("user", runID)
	if err != nil {
		t.Fatal(err)
	}
	first := map[string]any{"sessionJSONL": "pre-model-checkpoint\n"}
	if _, err := s.handlePiSessionSnapshot("user", runID, first, fence); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", runID).Update("status", "completed").Error; err != nil {
		t.Fatal(err)
	}
	ctx := context.WithValue(context.Background(), cloudAgentOwnerContextKey{}, fence)
	if _, err := s.cloudAgentPiEvent(ctx, "user", runID, piEventForTest(t, map[string]any{"type": "tool_call_end", "callId": "ask-1"})); err != nil {
		t.Fatalf("terminal question event blocked native journal flush: %v", err)
	}
	final := map[string]any{"sessionJSONL": "assistant-and-question-result\n"}
	if _, err := s.cloudAgentPiEvent(ctx, "user", runID, piEventForTest(t, map[string]any{"type": "session_snapshot", "sessionJSONL": final["sessionJSONL"]})); err != nil {
		t.Fatalf("live owner lost final question snapshot: %v", err)
	}
	saved, err := s.repo.CloudAgentPiSession("user", runID)
	if err != nil || saved.SessionJSONL != final["sessionJSONL"] || saved.Revision != 2 {
		t.Fatalf("final Pi snapshot missing: session=%+v err=%v", saved, err)
	}
	stale := *fence
	stale.Epoch--
	staleCtx := context.WithValue(context.Background(), cloudAgentOwnerContextKey{}, &stale)
	if _, err := s.cloudAgentPiEvent(staleCtx, "user", runID, piEventForTest(t, map[string]any{"type": "session_snapshot", "sessionJSONL": "stale\n"})); !errors.Is(err, repository.ErrCloudAgentOwnerLost) {
		t.Fatalf("stale owner could overwrite completed snapshot: %v", err)
	}
}
