package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func piRecoverableOwnerFixture(t *testing.T, purpose string) (*Service, string) {
	t.Helper()
	s, db, a := agentMediaFixture(t)
	s.disablePiRuntime = true
	run, state := agentMediaRun(t, s, a, "auto")
	stepID := "recoverable-native-step"
	operation := cloudAgentStepOperation
	if purpose == "compaction" {
		operation = cloudAgentContextCompactionOperation
	}
	hash := sha256.Sum256([]byte(state.Request.Prompt))
	marker, err := json.Marshal(map[string]any{
		"type": "custom", "id": "checkpoint", "customType": "canvas-model-step",
		"data": map[string]any{"runId": run.ID, "turnId": run.ID, "stepId": stepID, "purpose": purpose, "promptSHA256": hex.EncodeToString(hash[:])},
	})
	if err != nil {
		t.Fatal(err)
	}
	snapshot := `{"type":"session","id":"recoverable","version":3}` + "\n" + string(marker) + "\n"
	if err := s.repo.SaveCloudAgentPiSession(&model.CloudAgentPiSession{RunID: run.ID, UserID: "user", SessionJSONL: snapshot}, 0); err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: "recoverable-billed-task", UserID: "user", AgentRunID: run.ID, Operation: operation, Status: model.TaskStatusSucceeded}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	receipt := &model.CloudAgentReceipt{RunID: run.ID, UserID: "user", Kind: "model_step", OperationKey: stepID + ":0", Name: operation, InputSHA256: "checkpoint-input", Status: "committed", TaskID: task.ID}
	if err := s.repo.SaveCloudAgentReceipt(receipt); err != nil {
		t.Fatal(err)
	}
	return s, run.ID
}

func TestPiOwnerRecoversInterruptedNativeCheckpointOnce(t *testing.T) {
	for _, purpose := range []string{"dialogue", "compaction"} {
		t.Run(purpose, func(t *testing.T) {
			s, runID := piRecoverableOwnerFixture(t, purpose)
			calls := 0
			err := s.runOwnedCloudAgent(context.Background(), "user", runID, func(context.Context) error {
				calls++
				if calls == 1 {
					return errors.New("Agent runtime ended before settled")
				}
				return nil
			})
			if err != nil || calls != 2 {
				t.Fatalf("owner did not replay persisted native checkpoint once: calls=%d err=%v", calls, err)
			}
			run, err := s.repo.CloudAgent("user", runID)
			if err != nil || run.Status == "failed" {
				t.Fatalf("recoverable run was failed: status=%q err=%v", run.Status, err)
			}
			state, err := cloudAgentDecode(run)
			if err != nil || state.PiRecoveryAttempts != 1 {
				t.Fatalf("recovery attempt was not durable: attempts=%d err=%v", state.PiRecoveryAttempts, err)
			}
		})
	}
}

func TestPiOwnerRecoveryIsBoundedAndRejectsDeterministicError(t *testing.T) {
	for _, tc := range []struct {
		name     string
		failure  error
		attempts int
		unknown  bool
	}{
		{"deterministic", fmt.Errorf("bridge rejected malformed model input"), 0, false},
		{"limit", errors.New("Agent runtime ended before settled"), 2, false},
		{"unknown submission", errors.New("Agent runtime ended before settled"), 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, runID := piRecoverableOwnerFixture(t, "dialogue")
			if tc.unknown {
				receipt, err := s.repo.CloudAgentReceipt("user", runID, "model_step", "recoverable-native-step:0")
				if err != nil {
					t.Fatal(err)
				}
				receipt.Status = "unknown"
				if err := s.repo.SaveCloudAgentReceipt(receipt); err != nil {
					t.Fatal(err)
				}
			}
			if tc.attempts > 0 {
				run, err := s.repo.CloudAgent("user", runID)
				if err != nil {
					t.Fatal(err)
				}
				state, err := cloudAgentDecode(run)
				if err != nil {
					t.Fatal(err)
				}
				state.PiRecoveryAttempts = tc.attempts
				if err := s.repo.MutateCloudAgent("user", runID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
					return cloudAgentSave(current, &state)
				}); err != nil {
					t.Fatal(err)
				}
			}
			calls := 0
			err := s.runOwnedCloudAgent(context.Background(), "user", runID, func(context.Context) error { calls++; return tc.failure })
			if err == nil || calls != 1 {
				t.Fatalf("unsafe or unbounded replay: calls=%d err=%v", calls, err)
			}
			run, err := s.repo.CloudAgent("user", runID)
			if err != nil || run.Status != "failed" {
				t.Fatalf("nonrecoverable interruption not terminal: status=%q err=%v", run.Status, err)
			}
		})
	}
}

func TestPiOwnerStopsAfterTwoInterruptedReplays(t *testing.T) {
	s, runID := piRecoverableOwnerFixture(t, "compaction")
	calls := 0
	err := s.runOwnedCloudAgent(context.Background(), "user", runID, func(context.Context) error {
		calls++
		return errors.New("Agent runtime ended before settled")
	})
	if err == nil || calls != 1+maxPiProcessRecoveryAttempts {
		t.Fatalf("unbounded native replay: calls=%d err=%v", calls, err)
	}
	run, err := s.repo.CloudAgent("user", runID)
	if err != nil || run.Status != "failed" {
		t.Fatalf("exhausted run did not fail: status=%q err=%v", run.Status, err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil || state.PiRecoveryAttempts != maxPiProcessRecoveryAttempts {
		t.Fatalf("replay limit not persisted: attempts=%d err=%v", state.PiRecoveryAttempts, err)
	}
}

func TestPiRecoveryScanCompletesPersistedNativeAnswer(t *testing.T) {
	s, runID := piRecoverableOwnerFixture(t, "dialogue")
	saved, err := s.repo.CloudAgentPiSession("user", runID)
	if err != nil {
		t.Fatal(err)
	}
	saved.SessionJSONL += `{"type":"message","id":"answer","parentId":"checkpoint","message":{"role":"assistant","stopReason":"stop","content":[{"type":"text","text":"已完成"}]}}` + "\n"
	if err := s.repo.SaveCloudAgentPiSession(saved, saved.Revision); err != nil {
		t.Fatal(err)
	}
	run, err := s.repo.CloudAgent("user", runID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	state.PiAssistantResponses = 1
	if err := s.repo.MutateCloudAgent("user", runID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	s.disablePiRuntime = false
	defer s.closeCloudAgentPiRunners()
	s.recoverCloudAgentPiRunners()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		latest, err := s.repo.CloudAgent("user", runID)
		if err != nil {
			t.Fatal(err)
		}
		if latest.Status == "completed" {
			return
		}
		if latest.Status == "failed" {
			t.Fatalf("scan failed recoverable run: %s", latest.FailureMessage)
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("recovery scan did not finish the native checkpoint")
}
