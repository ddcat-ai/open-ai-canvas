package app

import (
	"errors"
	"unicode/utf8"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// Publish upstream deltas to the same durable, revisioned transcript used by
// Agent SSE/replay. Each flush re-reads state; never overwrite a scheduler's
// checkpoint with the snapshot from when the model request started.
func newCloudAgentStreamPublisher(s *Service, userID, taskID, kind string) *taskTextStreamPublisher {
	p := newTaskTextStreamPublisher(s, userID, taskID)
	written := 0
	p.sink = func(delta string) error {
		remaining := 32000 - written
		if remaining <= 0 {
			return nil
		}
		if len(delta) > remaining {
			delta = delta[:remaining]
			for !utf8.ValidString(delta) {
				delta = delta[:len(delta)-1]
			}
		}
		if delta == "" {
			return nil
		}
		for attempt := 0; attempt < 3; attempt++ {
			run, err := s.repo.CloudAgentForActiveTask(userID, taskID)
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			if err != nil {
				return err
			}
			err = s.repo.MutateCloudAgent(userID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				state, err := cloudAgentDecode(current)
				if err != nil {
					return err
				}
				if state.ActiveTaskID != taskID || (current.Status != "running" && current.Status != "queued") {
					return nil
				}
				messageID := taskID
				if kind == "reasoning_delta" {
					messageID += ":reasoning"
				}
				state.event(run.ID, kind, map[string]any{"messageId": messageID, "text": delta})
				return cloudAgentSave(current, &state)
			})
			if errors.Is(err, repository.ErrCreationConflict) {
				continue
			}
			if err == nil {
				written += len(delta)
			}
			return err
		}
		return repository.ErrCreationConflict
	}
	return p
}
