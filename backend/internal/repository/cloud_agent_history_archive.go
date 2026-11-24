package repository

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

const cloudAgentHistoryArchiveVersion = 3

type cloudAgentHistoryArchiveMutation struct {
	ID                 string     `json:"id"`
	RunID              string     `json:"runId"`
	UserID             string     `json:"userId"`
	CanvasID           string     `json:"canvasId"`
	StepID             string     `json:"stepId"`
	Operation          string     `json:"operation"`
	BeforeSnapshotHash string     `json:"beforeSnapshotHash"`
	AfterSnapshotHash  string     `json:"afterSnapshotHash"`
	BeforeJSON         string     `json:"beforeJson"`
	HasSubmittedTask   bool       `json:"hasSubmittedTask"`
	Status             string     `json:"status"`
	CreatedAt          time.Time  `json:"createdAt"`
	UndoneAt           *time.Time `json:"undoneAt,omitempty"`
}

type cloudAgentHistoryArchivePayload struct {
	Version   int                                `json:"version"`
	StateJSON string                             `json:"stateJson,omitempty"`
	Session   *model.CloudAgentPiSession         `json:"session,omitempty"`
	Events    []model.CloudAgentEventRecord      `json:"events,omitempty"`
	Messages  []model.CloudAgentMessageRecord    `json:"messages,omitempty"`
	Mutations []cloudAgentHistoryArchiveMutation `json:"mutations,omitempty"`
}

func encodeCloudAgentHistoryArchive(payload cloudAgentHistoryArchivePayload) ([]byte, int64, error) {
	payload.Version = cloudAgentHistoryArchiveVersion
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, err
	}
	var compressed bytes.Buffer
	writer, err := gzip.NewWriterLevel(&compressed, gzip.BestSpeed)
	if err != nil {
		return nil, 0, err
	}
	if _, err := writer.Write(raw); err != nil {
		_ = writer.Close()
		return nil, 0, err
	}
	if err := writer.Close(); err != nil {
		return nil, 0, err
	}
	return compressed.Bytes(), int64(len(raw)), nil
}

func decodeCloudAgentHistoryArchive(archive *model.CloudAgentHistoryArchive) (cloudAgentHistoryArchivePayload, error) {
	if archive == nil || len(archive.PayloadGZIP) == 0 {
		return cloudAgentHistoryArchivePayload{}, errors.New("Agent 历史归档为空")
	}
	reader, err := gzip.NewReader(bytes.NewReader(archive.PayloadGZIP))
	if err != nil {
		return cloudAgentHistoryArchivePayload{}, fmt.Errorf("读取 Agent 历史归档失败: %w", err)
	}
	defer reader.Close()
	raw, err := io.ReadAll(reader)
	if err != nil {
		return cloudAgentHistoryArchivePayload{}, fmt.Errorf("读取 Agent 历史归档失败: %w", err)
	}
	var header struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal(raw, &header); err != nil {
		return cloudAgentHistoryArchivePayload{}, fmt.Errorf("解析 Agent 历史归档失败: %w", err)
	}
	if header.Version == 1 {
		var legacy struct {
			Version   int                              `json:"version"`
			Session   *model.CloudAgentPiSession       `json:"session,omitempty"`
			Events    []model.CloudAgentEventRecord    `json:"events,omitempty"`
			Messages  []model.CloudAgentMessageRecord  `json:"messages,omitempty"`
			Mutations []model.CloudAgentCanvasMutation `json:"mutations,omitempty"`
		}
		if err := json.Unmarshal(raw, &legacy); err != nil {
			return cloudAgentHistoryArchivePayload{}, fmt.Errorf("解析 Agent 历史归档失败: %w", err)
		}
		mutations := make([]cloudAgentHistoryArchiveMutation, len(legacy.Mutations))
		for index, mutation := range legacy.Mutations {
			mutations[index] = cloudAgentHistoryArchiveMutationFromModel(mutation)
		}
		return cloudAgentHistoryArchivePayload{Version: cloudAgentHistoryArchiveVersion, Session: legacy.Session, Events: legacy.Events, Messages: legacy.Messages, Mutations: mutations}, nil
	}
	if header.Version != 2 && header.Version != cloudAgentHistoryArchiveVersion {
		return cloudAgentHistoryArchivePayload{}, fmt.Errorf("不支持的 Agent 历史归档版本 %d", header.Version)
	}
	var payload cloudAgentHistoryArchivePayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return cloudAgentHistoryArchivePayload{}, fmt.Errorf("解析 Agent 历史归档失败: %w", err)
	}
	return payload, nil
}

func cloudAgentHistoryArchiveMutationFromModel(mutation model.CloudAgentCanvasMutation) cloudAgentHistoryArchiveMutation {
	return cloudAgentHistoryArchiveMutation{
		ID: mutation.ID, RunID: mutation.RunID, UserID: mutation.UserID, CanvasID: mutation.CanvasID,
		StepID: mutation.StepID, Operation: mutation.Operation, BeforeSnapshotHash: mutation.BeforeSnapshotHash,
		AfterSnapshotHash: mutation.AfterSnapshotHash, BeforeJSON: mutation.BeforeJSON, HasSubmittedTask: mutation.HasSubmittedTask,
		Status: mutation.Status, CreatedAt: mutation.CreatedAt, UndoneAt: mutation.UndoneAt,
	}
}

func (mutation cloudAgentHistoryArchiveMutation) model() model.CloudAgentCanvasMutation {
	return model.CloudAgentCanvasMutation{
		ID: mutation.ID, RunID: mutation.RunID, UserID: mutation.UserID, CanvasID: mutation.CanvasID,
		StepID: mutation.StepID, Operation: mutation.Operation, BeforeSnapshotHash: mutation.BeforeSnapshotHash,
		AfterSnapshotHash: mutation.AfterSnapshotHash, BeforeJSON: mutation.BeforeJSON, HasSubmittedTask: mutation.HasSubmittedTask,
		Status: mutation.Status, CreatedAt: mutation.CreatedAt, UndoneAt: mutation.UndoneAt,
	}
}

func (r *Repository) cloudAgentHistoryArchive(userID, runID string) (*cloudAgentHistoryArchivePayload, error) {
	var archive model.CloudAgentHistoryArchive
	if err := r.db.Where("run_id = ? AND user_id = ?", runID, userID).First(&archive).Error; err != nil {
		return nil, err
	}
	payload, err := decodeCloudAgentHistoryArchive(&archive)
	if err != nil {
		return nil, err
	}
	return &payload, nil
}

func cloudAgentHistoryArchiveUnavailable(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table") || strings.Contains(message, "undefined table") || (strings.Contains(message, "relation") && strings.Contains(message, "does not exist"))
}

func cloudAgentArchivePayloadBytes(payload cloudAgentHistoryArchivePayload) int64 {
	var total int64
	if payload.Session != nil {
		total += int64(len(payload.Session.SessionJSONL))
	}
	total += int64(len(payload.StateJSON))
	for _, event := range payload.Events {
		total += int64(len(event.EventJSON))
	}
	for _, message := range payload.Messages {
		total += int64(len(message.MessageJSON))
	}
	for _, mutation := range payload.Mutations {
		total += int64(len(mutation.BeforeJSON))
	}
	return total
}

// CompactCloudAgentRun moves terminal payloads out of the hot tables while
// keeping a lossless compressed copy for reads and future continuations.
func (r *Repository) CompactCloudAgentRun(userID, runID string) (int64, error) {
	if userID == "" || runID == "" {
		return 0, gorm.ErrInvalidData
	}
	var released int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		repo := New(tx)
		if err := repo.beginAgentStorageWrite(userID); err != nil {
			return err
		}
		freed, err := repo.compactCloudAgentRunLocked(userID, runID)
		if err != nil {
			return err
		}
		if freed == 0 {
			return nil
		}
		if err := repo.decrementAgentStoredBytesLocked(userID, freed); err != nil {
			return err
		}
		released = freed
		return nil
	})
	return released, err
}

func (r *Repository) compactOldestCloudAgentHistoryLocked(userID string, before time.Time, required int64) (int64, error) {
	if required <= 0 {
		return 0, nil
	}
	var runs []model.CloudAgentExecution
	err := r.db.Where("user_id = ? AND history_compacted = false AND cleanup_pending = false AND status IN ? AND updated_at < ?", userID, []string{"completed", "failed", "cancelled", "rejected"}, before).
		Order("updated_at ASC, id ASC").Limit(32).Find(&runs).Error
	if err != nil {
		return 0, err
	}
	var freed int64
	for _, run := range runs {
		amount, err := r.compactCloudAgentRunLocked(userID, run.ID)
		if err != nil {
			return freed, err
		}
		if amount == 0 {
			continue
		}
		if err := r.decrementAgentStoredBytesLocked(userID, amount); err != nil {
			return freed, err
		}
		freed += amount
		if freed >= required {
			break
		}
	}
	return freed, nil
}

func (r *Repository) compactOldestCloudAgentHistoryGlobalLocked(before time.Time, required int64) (int64, error) {
	if required <= 0 {
		return 0, nil
	}
	var runs []model.CloudAgentExecution
	if err := r.db.Where("history_compacted = false AND cleanup_pending = false AND status IN ? AND updated_at < ?", []string{"completed", "failed", "cancelled", "rejected"}, before).
		Order("updated_at ASC, id ASC").Limit(64).Find(&runs).Error; err != nil {
		return 0, err
	}
	var freed int64
	for _, run := range runs {
		if err := r.ensureAgentStorageUsage(run.UserID); err != nil {
			return freed, err
		}
		amount, err := r.compactCloudAgentRunLocked(run.UserID, run.ID)
		if err != nil {
			return freed, err
		}
		if amount == 0 {
			continue
		}
		if err := r.decrementAgentStoredBytesLocked(run.UserID, amount); err != nil {
			return freed, err
		}
		freed += amount
		if freed >= required {
			break
		}
	}
	return freed, nil
}

func (r *Repository) compactCloudAgentRunLocked(userID, runID string) (int64, error) {
	var run model.CloudAgentExecution
	if err := r.db.Where("id = ? AND user_id = ?", runID, userID).First(&run).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, nil
		}
		return 0, err
	}
	if run.HistoryCompacted || run.CleanupPending || !cloudAgentHistoryTerminal(run.Status) {
		return 0, nil
	}
	var archiveExists int64
	if err := r.db.Model(&model.CloudAgentHistoryArchive{}).Where("run_id = ? AND user_id = ?", runID, userID).Count(&archiveExists).Error; err != nil {
		return 0, err
	}
	if archiveExists > 0 {
		return 0, r.db.Model(&model.CloudAgentExecution{}).Where("id = ? AND user_id = ?", runID, userID).Updates(map[string]any{"history_compacted": true, "compacted_at": time.Now()}).Error
	}

	var session model.CloudAgentPiSession
	sessionPtr := &session
	if err := r.db.Where("run_id = ? AND user_id = ?", runID, userID).First(&session).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			sessionPtr = nil
		} else {
			return 0, err
		}
	}
	var events []model.CloudAgentEventRecord
	if err := r.db.Where("run_id = ? AND user_id = ?", runID, userID).Order("sequence ASC").Find(&events).Error; err != nil {
		return 0, err
	}
	var messages []model.CloudAgentMessageRecord
	if err := r.db.Where("run_id = ? AND user_id = ?", runID, userID).Order("kind ASC, sequence ASC").Find(&messages).Error; err != nil {
		return 0, err
	}
	var mutations []model.CloudAgentCanvasMutation
	if err := r.db.Where("run_id = ? AND user_id = ?", runID, userID).Order("created_at ASC, id ASC").Find(&mutations).Error; err != nil {
		return 0, err
	}
	archivedMutations := make([]cloudAgentHistoryArchiveMutation, len(mutations))
	for index, mutation := range mutations {
		archivedMutations[index] = cloudAgentHistoryArchiveMutationFromModel(mutation)
	}
	payload := cloudAgentHistoryArchivePayload{StateJSON: run.StateJSON, Session: sessionPtr, Events: events, Messages: messages, Mutations: archivedMutations}
	compressed, originalBytes, err := encodeCloudAgentHistoryArchive(payload)
	if err != nil {
		return 0, err
	}
	archive := &model.CloudAgentHistoryArchive{RunID: runID, UserID: userID, OriginalBytes: originalBytes, CompressedBytes: int64(len(compressed)), PayloadGZIP: compressed, CreatedAt: time.Now()}
	if err := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(archive).Error; err != nil {
		return 0, err
	}
	if err := r.db.Where("run_id = ? AND user_id = ?", runID, userID).Delete(&model.CloudAgentPiSession{}).Error; err != nil {
		return 0, err
	}
	if err := r.db.Where("run_id = ? AND user_id = ?", runID, userID).Delete(&model.CloudAgentEventRecord{}).Error; err != nil {
		return 0, err
	}
	if err := r.db.Where("run_id = ? AND user_id = ?", runID, userID).Delete(&model.CloudAgentMessageRecord{}).Error; err != nil {
		return 0, err
	}
	if err := r.db.Where("run_id = ? AND user_id = ?", runID, userID).Delete(&model.CloudAgentCanvasMutation{}).Error; err != nil {
		return 0, err
	}
	if err := r.db.Model(&model.CloudAgentExecution{}).Where("id = ? AND user_id = ?", runID, userID).Updates(map[string]any{"history_compacted": true, "compacted_at": time.Now(), "state_json": ""}).Error; err != nil {
		return 0, err
	}
	return cloudAgentArchivePayloadBytes(payload), nil
}

func (r *Repository) decrementAgentStoredBytesLocked(userID string, amount int64) error {
	if amount <= 0 {
		return nil
	}
	result := r.db.Model(&model.AgentStorageUsage{}).Where("user_id = ? AND stored_bytes >= ?", userID, amount).
		Updates(map[string]any{"stored_bytes": gorm.Expr("stored_bytes - ?", amount), "updated_at": time.Now()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("Agent storage accounting is inconsistent")
	}
	return nil
}

func cloudAgentHistoryTerminal(status string) bool {
	return status == "completed" || status == "failed" || status == "cancelled" || status == "rejected"
}

// DeleteCloudAgentConversation removes all Agent history rows for one owned
// conversation. Tasks, canvas data, media and billing records remain intact.
func (r *Repository) DeleteCloudAgentConversation(userID, conversationID string) (int64, error) {
	if userID == "" || conversationID == "" {
		return 0, gorm.ErrInvalidData
	}
	returnValue := int64(0)
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockAgentRunAdmissions(tx, userID); err != nil {
			return err
		}
		repo := New(tx)
		if err := repo.beginAgentStorageWrite(userID); err != nil {
			return err
		}
		var runs []model.CloudAgentExecution
		if err := tx.Where("user_id = ? AND "+cloudAgentConversationIdentity+" = ?", userID, conversationID).Find(&runs).Error; err != nil {
			return err
		}
		if len(runs) == 0 {
			return nil
		}
		for _, run := range runs {
			if !cloudAgentHistoryTerminal(run.Status) || run.CleanupPending {
				return kernel.NewAppError(kernel.CodeConflict, "该 Agent 对话仍在执行或收尾，请完成后再删除")
			}
		}
		ids := make([]string, 0, len(runs))
		for _, run := range runs {
			ids = append(ids, run.ID)
			returnValue += int64(len(run.StateJSON))
		}
		for _, table := range []struct {
			model any
			field string
		}{
			{&model.CloudAgentPiSession{}, "session_jsonl"},
			{&model.CloudAgentEventRecord{}, "event_json"},
			{&model.CloudAgentMessageRecord{}, "message_json"},
			{&model.CloudAgentCanvasMutation{}, "before_json"},
		} {
			var bytes int64
			length := "length(CAST(COALESCE(" + table.field + ", '') AS BLOB))"
			if repo.Dialect() == "postgres" {
				length = "octet_length(COALESCE(" + table.field + ", ''))"
			}
			if err := tx.Model(table.model).Where("user_id = ? AND run_id IN ?", userID, ids).Select("COALESCE(SUM(" + length + "), 0)").Scan(&bytes).Error; err != nil {
				return err
			}
			returnValue += bytes
		}
		if err := tx.Exec("UPDATE tasks SET agent_execution_ready = true WHERE user_id = ? AND operation = 'cloud_agent' AND id IN ?", userID, ids).Error; err != nil {
			return err
		}
		for _, value := range []any{&model.CloudAgentPiSession{}, &model.CloudAgentEventRecord{}, &model.CloudAgentMessageRecord{}, &model.CloudAgentCanvasMutation{}, &model.CloudAgentHistoryArchive{}} {
			if err := tx.Where("user_id = ? AND run_id IN ?", userID, ids).Delete(value).Error; err != nil {
				_, archive := value.(*model.CloudAgentHistoryArchive)
				if !archive || !cloudAgentHistoryArchiveUnavailable(err) {
					return err
				}
			}
		}
		if err := tx.Where("user_id = ? AND id IN ?", userID, ids).Delete(&model.CloudAgentExecution{}).Error; err != nil {
			return err
		}
		return repo.decrementAgentStoredBytesLocked(userID, returnValue)
	})
	return returnValue, err
}
