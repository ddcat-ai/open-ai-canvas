package app

import (
	"errors"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestCloudAgentReadUsesOneCheckpointSnapshot(t *testing.T) {
	for _, method := range []string{"run", "run-transcript", "active-task", "active-runs", "session-runs"} {
		t.Run(method, func(t *testing.T) { testCloudAgentReadUsesOneCheckpointSnapshot(t, method) })
	}
}

func testCloudAgentReadUsesOneCheckpointSnapshot(t *testing.T, method string) {
	s, db, runID := piOutputLimitFixture(t)
	before, err := s.repo.CloudAgent("user", runID)
	if err != nil {
		t.Fatal(err)
	}
	// Commit a real checkpoint after the execution row has been read, before
	// its journal and transcript queries. PostgreSQL READ COMMITTED otherwise
	// mixes the old counters with the newly committed child rows.
	wrote := false
	const callback = "test:checkpoint_between_agent_reads"
	if err := db.Callback().Query().After("gorm:query").Register(callback, func(tx *gorm.DB) {
		if wrote || tx.Statement.Table != "cloud_agent_executions" {
			return
		}
		wrote = true
		if _, err := s.InterjectCloudAgent("user", runID, "snapshot-message", "保留原方案"); err != nil {
			t.Errorf("concurrent checkpoint: %v", err)
			return
		}
		if method == "run" {
			return
		}
		latest, state := agentInterjectionState(t, s, runID)
		state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "user", "content": "补充参考要求"})
		if err := s.repo.MutateCloudAgent("user", runID, latest.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			return cloudAgentSave(current, &state)
		}); err != nil {
			t.Errorf("concurrent transcript checkpoint: %v", err)
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Query().Remove(callback) })
	var run *model.CloudAgentExecution
	switch method {
	case "run", "run-transcript":
		run, err = s.repo.CloudAgent("user", runID)
	case "active-task":
		run, err = s.repo.CloudAgentForActiveTask("user", before.ActiveTaskID)
	case "active-runs", "session-runs":
		var runs []model.CloudAgentExecution
		if method == "active-runs" {
			runs, err = s.repo.ActiveCloudAgents()
		} else {
			sessionID := before.SessionID
			if sessionID == "" {
				sessionID = before.ConversationID
			}
			runs, err = s.repo.CloudAgentExecutionsBySession("user", sessionID, 10)
		}
		if err == nil && len(runs) != 1 {
			t.Fatalf("runs = %d, want 1", len(runs))
		}
		if err == nil {
			run = &runs[0]
		}
	}
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatalf("mixed checkpoint: revision=%d events=%d journal=%d: %v", run.Revision, run.EventCount, len(run.Journal), err)
	}
	if !wrote || run.Revision != before.Revision || run.EventCount != before.EventCount || len(state.PendingInterjections) != 0 {
		t.Fatalf("read must retain its original checkpoint: wrote=%v revision=%d events=%d pending=%d", wrote, run.Revision, run.EventCount, len(state.PendingInterjections))
	}
	latest, latestState := agentInterjectionState(t, s, runID)
	wantMessageCount := run.MessageCount
	if method != "run" {
		wantMessageCount++
	}
	if latest.Revision <= run.Revision || latest.EventCount != run.EventCount+1 || len(latestState.PendingInterjections) != 1 || latest.MessageCount != wantMessageCount {
		t.Fatalf("next read must see the committed checkpoint: revision=%d events=%d pending=%d", latest.Revision, latest.EventCount, len(latestState.PendingInterjections))
	}
	called := false
	err = s.repo.MutateCloudAgent("user", runID, run.Revision, func(_ *model.CloudAgentExecution, _ *repository.Repository) error {
		called = true
		return nil
	})
	if !errors.Is(err, repository.ErrCreationConflict) || called {
		t.Fatalf("stale snapshot must not overwrite the checkpoint: callback=%v error=%v", called, err)
	}
}
