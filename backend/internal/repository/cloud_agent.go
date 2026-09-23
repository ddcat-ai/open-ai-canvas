package repository

import (
	"bytes"
	"encoding/json"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"infinite-canvas/backend/internal/model"
)

func (r *Repository) EnsureCloudAgent(run *model.CloudAgentExecution) error {
	if run.ConversationID == "" {
		run.ConversationID = run.ID
		if run.ParentID != "" {
			var parent model.CloudAgentExecution
			if err := r.db.Select("id", "conversation_id", "title").First(&parent, "id = ? AND user_id = ?", run.ParentID, run.UserID).Error; err != nil {
				return err
			}
			if parent.ConversationID != "" {
				run.ConversationID = parent.ConversationID
			} else {
				run.ConversationID = parent.ID
			}
			run.Title = parent.Title
		}
	}
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(run).Error
}
func (r *Repository) CloudAgent(userID, id string) (*model.CloudAgentExecution, error) {
	var run model.CloudAgentExecution
	err := r.db.First(&run, "id = ? AND user_id = ?", id, userID).Error
	if err == nil {
		err = r.hydrateCloudAgent(&run)
	}
	return &run, err
}

func (r *Repository) hydrateCloudAgent(run *model.CloudAgentExecution) error {
	if run.CheckpointVersion < 2 {
		return nil
	}
	if err := r.db.Where("run_id = ? AND user_id = ?", run.ID, run.UserID).Order("sequence").Find(&run.Journal).Error; err != nil {
		return err
	}
	if err := r.db.Where("run_id = ? AND user_id = ?", run.ID, run.UserID).Order("kind, sequence").Find(&run.Transcript).Error; err != nil {
		return err
	}
	return nil
}

func (r *Repository) CloudAgentForActiveTask(userID, taskID string) (*model.CloudAgentExecution, error) {
	var run model.CloudAgentExecution
	err := r.db.Where("user_id = ? AND active_task_id = ? AND status IN ?", userID, taskID, []string{"running", "queued"}).First(&run).Error
	if err == nil {
		err = r.hydrateCloudAgent(&run)
	}
	return &run, err
}
func (r *Repository) CloudAgentRoots() ([]model.Task, error) {
	var tasks []model.Task
	err := r.db.Where("operation = ? AND id NOT IN (SELECT id FROM cloud_agent_executions)", "cloud_agent").Order("created_at").Limit(50).Find(&tasks).Error
	return tasks, err
}

// A stable keyset makes waiting rows yield to later runs without changing business timestamps.
func (r *Repository) ActiveCloudAgentsAfter(after string, limit int) ([]model.CloudAgentExecution, error) {
	var runs []model.CloudAgentExecution
	if limit < 1 || limit > 50 {
		limit = 50
	}
	err := r.db.Where("(status IN ? OR cleanup_pending = ?) AND id > ?", []string{"running", "queued"}, true, after).Order("id").Limit(limit).Find(&runs).Error
	if err == nil {
		for i := range runs {
			if err = r.hydrateCloudAgent(&runs[i]); err != nil {
				break
			}
		}
	}
	return runs, err
}

func (r *Repository) ActiveCloudAgents() ([]model.CloudAgentExecution, error) {
	return r.ActiveCloudAgentsAfter("", 50)
}

// Do not load the transcript, tasks and bills for an unchanged SSE subscription.
func (r *Repository) CloudAgentRevision(userID, id string) (int64, error) {
	var run model.CloudAgentExecution
	err := r.db.Select("id", "revision").Where("id = ? AND user_id = ?", id, userID).First(&run).Error
	return run.Revision, err
}

// RecentCloudAgentEventsForUser returns the journal rows of the caller's most
// recent runs, ordered by event time. Runs are resolved first so a fixed
// event limit cannot cut a run in half; an ongoing run may still add events.
func (r *Repository) RecentCloudAgentEventsForUser(userID string, runLimit int) ([]model.CloudAgentEventRecord, error) {
	if runLimit < 1 {
		return nil, nil
	}
	var runIDs []string
	if err := r.db.Model(&model.CloudAgentExecution{}).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Limit(runLimit).
		Pluck("id", &runIDs).Error; err != nil {
		return nil, err
	}
	if len(runIDs) == 0 {
		return nil, nil
	}
	var records []model.CloudAgentEventRecord
	err := r.db.Where("user_id = ? AND run_id IN ?", userID, runIDs).
		Order("created_at, sequence").
		Find(&records).Error
	return records, err
}

// Lock before reading: checkpoints, canvas writes and task reservations commit together.
func (r *Repository) MutateCloudAgent(userID, id string, revision int64, fn func(*model.CloudAgentExecution, *Repository) error) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		q := tx.Model(&model.CloudAgentExecution{}).Where("id = ? AND user_id = ? AND revision = ?", id, userID, revision).UpdateColumn("revision", gorm.Expr("revision + 1"))
		if q.Error != nil {
			return q.Error
		}
		if q.RowsAffected != 1 {
			return ErrCreationConflict
		}
		run, err := New(tx).CloudAgent(userID, id)
		if err != nil {
			return err
		}
		previousEvents := run.EventCount
		previousEventBodies := make(map[int]string, len(run.Journal))
		for _, event := range run.Journal {
			previousEventBodies[event.Sequence] = event.EventJSON
		}
		previousMessages := make(map[string]string, len(run.Transcript))
		for _, message := range run.Transcript {
			previousMessages[fmt.Sprintf("%s:%d", message.Kind, message.Sequence)] = message.MessageJSON
		}
		if err = fn(run, New(tx)); err != nil {
			return err
		}
		if run.EventCount < previousEvents || len(run.Journal) != run.EventCount {
			return fmt.Errorf("cloud Agent journal cannot be truncated")
		}
		for sequence, body := range previousEventBodies {
			if sequence > len(run.Journal) || run.Journal[sequence-1].Sequence != sequence || !sameJSONDocument(run.Journal[sequence-1].EventJSON, body) {
				return fmt.Errorf("cloud Agent journal is append-only")
			}
		}
		if err = tx.Omit("Journal", "Transcript").Save(run).Error; err != nil {
			return err
		}
		for _, event := range run.Journal {
			if event.Sequence <= previousEvents {
				continue
			}
			if err = tx.Create(&event).Error; err != nil {
				return err
			}
		}
		for _, message := range run.Transcript {
			key := fmt.Sprintf("%s:%d", message.Kind, message.Sequence)
			if previousMessages[key] == message.MessageJSON {
				continue
			}
			if err = tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "run_id"}, {Name: "kind"}, {Name: "sequence"}}, DoUpdates: clause.AssignmentColumns([]string{"message_json"})}).Create(&message).Error; err != nil {
				return err
			}
		}
		for _, kind := range []string{"canonical", "history"} {
			count := 0
			for _, message := range run.Transcript {
				if message.Kind == kind {
					count++
				}
			}
			if err = tx.Where("run_id = ? AND user_id = ? AND kind = ? AND sequence > ?", run.ID, run.UserID, kind, count).Delete(&model.CloudAgentMessageRecord{}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// sameJSONDocument compares event records by JSON meaning rather than source
// bytes. Event payloads may contain json.RawMessage (for example tool arguments),
// so decode/re-encode can legally normalize whitespace or object key order while
// preserving the immutable event contract.
func sameJSONDocument(left, right string) bool {
	decode := func(raw string) (any, error) {
		decoder := json.NewDecoder(bytes.NewReader([]byte(raw)))
		decoder.UseNumber()
		var value any
		if err := decoder.Decode(&value); err != nil {
			return nil, err
		}
		var extra any
		if err := decoder.Decode(&extra); err == nil {
			return nil, fmt.Errorf("multiple JSON documents")
		}
		return value, nil
	}
	leftValue, leftErr := decode(left)
	rightValue, rightErr := decode(right)
	if leftErr != nil || rightErr != nil {
		return left == right
	}
	leftCanonical, leftErr := json.Marshal(leftValue)
	rightCanonical, rightErr := json.Marshal(rightValue)
	return leftErr == nil && rightErr == nil && bytes.Equal(leftCanonical, rightCanonical)
}

func (r *Repository) CreateCloudAgentCanvasMutation(mutation *model.CloudAgentCanvasMutation) error {
	return r.db.Create(mutation).Error
}

func (r *Repository) LatestCloudAgentCanvasMutation(userID, runID string) (*model.CloudAgentCanvasMutation, error) {
	var mutation model.CloudAgentCanvasMutation
	err := r.db.Where("user_id = ? AND run_id = ?", userID, runID).
		Order("created_at DESC, id DESC").First(&mutation).Error
	return &mutation, err
}

func (r *Repository) MarkCloudAgentCanvasMutationUndone(userID, runID, mutationID string, undoneAt time.Time) error {
	result := r.db.Model(&model.CloudAgentCanvasMutation{}).
		Where("id = ? AND user_id = ? AND run_id = ? AND status = ?", mutationID, userID, runID, "applied").
		Updates(map[string]any{"status": "undone", "undone_at": undoneAt})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrCreationConflict
	}
	return nil
}

// MarkCloudAgentFailed is a terminal CAS transition that does not read or
// rewrite StateJSON. It is deliberately usable when a corrupted runtime state
// can no longer be decoded; leaving such a run in running would make the
// scheduler retry it forever.
func (r *Repository) MarkCloudAgentFailed(userID, id string, revision int64, message ...string) error {
	detail := "Agent 运行状态损坏，本轮已停止"
	if len(message) > 0 {
		detail = message[0]
	}
	result := r.db.Model(&model.CloudAgentExecution{}).
		Where("id = ? AND user_id = ? AND revision = ? AND status IN ?", id, userID, revision, []string{"queued", "running"}).
		Updates(map[string]any{"status": "failed", "cleanup_pending": true, "failure_message": detail, "revision": gorm.Expr("revision + 1")})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrCreationConflict
	}
	return nil
}

// MarkCloudAgentCancelled is the corruption-safe cancellation transition. It
// intentionally does not touch StateJSON: cancellation must still stop the
// scheduler when the orchestration blob can no longer be decoded.
func (r *Repository) MarkCloudAgentCancelled(userID, id string, revision int64) error {
	result := r.db.Model(&model.CloudAgentExecution{}).
		Where("id = ? AND user_id = ? AND revision = ? AND status IN ?", id, userID, revision, []string{"queued", "running", "waiting_approval"}).
		Updates(map[string]any{"status": "cancelled", "cleanup_pending": true, "revision": gorm.Expr("revision + 1")})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrCreationConflict
	}
	return nil
}
