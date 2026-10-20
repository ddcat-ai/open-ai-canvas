package repository

import (
	"encoding/json"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func (r *Repository) CreationHistoryBytes(userID string) (int64, error) {
	var size int64
	expression := "COALESCE(SUM(length(CAST(checkpoint_json AS BLOB))), 0)"
	if r.Dialect() == "postgres" {
		expression = "COALESCE(SUM(octet_length(checkpoint_json)), 0)"
	}
	err := r.db.Model(&model.AgentSession{}).Where("user_id = ?", userID).Select(expression).Scan(&size).Error
	return size, err
}

// Only the caller's ordinary tasks can establish history associations.
func (r *Repository) CreationSessionTasks(userID, sessionID, sourceID string) ([]model.Task, error) {
	query := r.db.Model(&model.Task{}).Where("user_id = ? AND agent_run_id = '' AND project_id = '' AND type IN ?", userID, []string{"canvas_text", "canvas_image", "canvas_video"})
	if sourceID == "" {
		sourceID = sessionID
	}
	if r.Dialect() == "postgres" {
		query = query.Where("NULLIF(input_json, '')::jsonb -> 'metadata' ->> 'creationSessionId' = ? OR (NULLIF(input_json, '')::jsonb -> 'metadata' ->> 'source' = 'create-page' AND NULLIF(input_json, '')::jsonb -> 'metadata' ->> 'conversationId' IN ?)", sessionID, []string{sessionID, sourceID})
	} else {
		query = query.Where("json_extract(NULLIF(input_json, ''), '$.metadata.creationSessionId') = ? OR (json_extract(NULLIF(input_json, ''), '$.metadata.source') = 'create-page' AND json_extract(NULLIF(input_json, ''), '$.metadata.conversationId') IN ?)", sessionID, []string{sessionID, sourceID})
	}
	var tasks []model.Task
	metadata := "json_object('metadata', json_extract(NULLIF(input_json, ''), '$.metadata')) AS input_json"
	if r.Dialect() == "postgres" {
		metadata = "jsonb_build_object('metadata', NULLIF(input_json, '')::jsonb -> 'metadata')::text AS input_json"
	}
	err := query.Select("id, status, updated_at, " + metadata).Order("created_at, id").Find(&tasks).Error
	return tasks, err
}

func (r *Repository) ExpiredCreationSessions(cutoff time.Time, after string, limit int) ([]model.AgentSession, error) {
	var rows []model.AgentSession
	err := r.db.Select("id", "user_id").Where("surface = 'creation' AND status <> ? AND updated_at < ? AND id > ?", AgentSessionDeleted, cutoff, after).Order("id").Limit(limit).Find(&rows).Error
	return rows, err
}

func (r *Repository) DeletedCreationSessionIDs(userID string) ([]string, error) {
	ids := []string{}
	err := r.db.Model(&model.AgentSession{}).Where("user_id = ? AND surface = 'creation' AND status = ?", userID, AgentSessionDeleted).Pluck("id", &ids).Error
	return ids, err
}

func (r *Repository) ExpireCreationSession(userID, id string, cutoff time.Time) error {
	return r.deleteAgentSession(userID, id, &cutoff)
}

func creationTaskSessionID(inputJSON string) (string, error) {
	if strings.TrimSpace(inputJSON) == "" {
		return "", nil
	}
	var input struct {
		Metadata struct {
			SessionID string `json:"creationSessionId"`
		} `json:"metadata"`
	}
	if err := json.Unmarshal([]byte(inputJSON), &input); err != nil {
		return "", err
	}
	return strings.TrimSpace(input.Metadata.SessionID), nil
}

func requireActiveCreationSessionForTask(tx *gorm.DB, task *model.Task) error {
	id, err := creationTaskSessionID(task.InputJSON)
	if err != nil || id == "" {
		return err
	}
	result := tx.Model(&model.AgentSession{}).Where("id = ? AND user_id = ? AND surface = 'creation' AND status <> ?", id, task.UserID, AgentSessionDeleted).
		Updates(map[string]any{"updated_at": time.Now(), "revision": gorm.Expr("revision + 1")})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrAgentSessionUnavailable
	}
	return nil
}
