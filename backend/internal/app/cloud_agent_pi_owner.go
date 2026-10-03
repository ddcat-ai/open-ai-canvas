package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const maxPiProcessRecoveryAttempts = 2

type piRecoveryStep struct {
	Type       string `json:"type"`
	CustomType string `json:"customType"`
	Data       struct {
		RunID   string `json:"runId"`
		StepID  string `json:"stepId"`
		Purpose string `json:"purpose"`
	} `json:"data"`
}

type cloudAgentOwnerContextKey struct{}

func cloudAgentFence(ctx context.Context) *model.CloudAgentFence {
	fence, _ := ctx.Value(cloudAgentOwnerContextKey{}).(*model.CloudAgentFence)
	return fence
}

func cloudAgentBindFence(run *model.CloudAgentExecution, fences []*model.CloudAgentFence) {
	if run != nil && len(fences) > 0 {
		run.ExecutionFence = fences[0]
	}
}

func (s *Service) ownedCloudAgent(ctx context.Context, userID, runID string) (*model.CloudAgentExecution, error) {
	run, err := s.repo.CloudAgent(userID, runID)
	if err == nil {
		run.ExecutionFence = cloudAgentFence(ctx)
		err = s.repo.CheckCloudAgentOwner(run, run.ExecutionFence)
	}
	return run, err
}

func (s *Service) reloadCloudAgent(previous *model.CloudAgentExecution) (*model.CloudAgentExecution, error) {
	run, err := s.repo.CloudAgent(previous.UserID, previous.ID)
	if err == nil {
		run.ExecutionFence = previous.ExecutionFence
	}
	return run, err
}

// No Service copy: the execution credential travels explicitly with this runner.
func (s *Service) runOwnedCloudAgent(ctx context.Context, userID, runID string, fn func(context.Context) error) error {
	fence, err := s.repo.ClaimCloudAgentOwner(userID, runID)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.WithValue(ctx, cloudAgentOwnerContextKey{}, fence))
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := s.repo.RenewCloudAgentOwner(userID, runID, fence); err != nil {
					cancel()
					return
				}
			}
		}
	}()
	for {
		err = fn(ctx)
		if errors.Is(err, errCloudAgentCommercePending) && ctx.Err() == nil {
			continue
		}
		if err == nil || ctx.Err() != nil {
			break
		}
		recoverable, checkErr := s.reservePiProcessRecovery(ctx, userID, runID, err)
		if checkErr != nil {
			err = fmt.Errorf("%w; check Pi recovery: %v", err, checkErr)
			break
		}
		if !recoverable {
			break
		}
	}
	if err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, repository.ErrCloudAgentOwnerLost) {
		s.failPiRunner(runID, userID, errors.New(cloudAgentUserFailureMessage(runID, err)), fence)
	}
	cancel()
	<-finished
	_ = s.repo.ReleaseCloudAgentOwner(userID, runID, fence)
	return err
}

// Only an interrupted Node process with a durable native model step may replay.
// Model, bridge, permission, and unknown-submission errors still fail closed.
func (s *Service) reservePiProcessRecovery(ctx context.Context, userID, runID string, cause error) (bool, error) {
	message := cause.Error()
	if message != "Agent runtime ended before settled" && !strings.HasPrefix(message, "Agent runtime exited: signal: ") {
		return false, nil
	}
	run, err := s.ownedCloudAgent(ctx, userID, runID)
	if err != nil {
		return false, err
	}
	if run.Status != "running" && run.Status != "queued" {
		return false, nil
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		return false, err
	}
	if state.PiRecoveryAttempts >= maxPiProcessRecoveryAttempts {
		return false, nil
	}
	saved, err := s.repo.CloudAgentPiSession(userID, runID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	prompt := firstNonEmpty(state.PiResumePrompt, state.Request.Prompt)
	turnID := firstNonEmpty(state.PiTurnID, runID)
	if !cloudAgentPiCheckpointMatchesPrompt(saved.SessionJSONL, runID, turnID, prompt) {
		return false, nil
	}
	var step piRecoveryStep
	for _, line := range strings.Split(strings.TrimSpace(saved.SessionJSONL), "\n") {
		var candidate piRecoveryStep
		if json.Unmarshal([]byte(line), &candidate) != nil {
			return false, nil
		}
		if candidate.Type == "custom" && candidate.CustomType == "canvas-model-step" && candidate.Data.RunID == runID {
			step = candidate
		}
	}
	if step.Data.StepID == "" || (step.Data.Purpose != "dialogue" && step.Data.Purpose != "compaction") {
		return false, nil
	}
	operation := cloudAgentStepOperation
	if step.Data.Purpose == "compaction" {
		operation = cloudAgentContextCompactionOperation
	}
	verifiedReceipt := false
	for retry := cloudAgentModelStepRetries; retry >= 0; retry-- {
		receipt, err := s.repo.CloudAgentReceipt(userID, runID, "model_step", fmt.Sprintf("%s:%d", step.Data.StepID, retry))
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			return false, err
		}
		if receipt.Name != operation || receipt.TaskID == "" || (receipt.Status != "pending" && receipt.Status != "committed") {
			return false, nil
		}
		task, err := s.repo.TaskForUser(userID, receipt.TaskID)
		if err != nil {
			return false, err
		}
		if task.AgentRunID != runID || task.Operation != operation {
			return false, nil
		}
		verifiedReceipt = task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning || task.Status == model.TaskStatusSucceeded || s.cloudAgentModelTaskRetryable(task.ID)
		break
	}
	if !verifiedReceipt {
		return false, nil
	}
	for attempt := 0; attempt < 4; attempt++ {
		run, err := s.ownedCloudAgent(ctx, userID, runID)
		if err != nil {
			return false, err
		}
		reserved := false
		err = s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			fresh, err := cloudAgentDecode(current)
			if err != nil {
				return err
			}
			if fresh.PiRecoveryAttempts >= maxPiProcessRecoveryAttempts || (current.Status != "running" && current.Status != "queued") {
				return nil
			}
			fresh.PiRecoveryAttempts++
			reserved = true
			return cloudAgentSave(current, &fresh)
		})
		if err == nil {
			return reserved, nil
		}
		if !errors.Is(err, repository.ErrCreationConflict) {
			return false, err
		}
	}
	return false, repository.ErrCreationConflict
}
