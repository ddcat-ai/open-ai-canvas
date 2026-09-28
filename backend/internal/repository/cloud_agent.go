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

// CloudAgentJournalWindow 是载入执行状态时读取的事件窗口条数。
//
// 事件全量在 cloud_agent_event_records（append-only，主键 run_id + sequence），
// 内存只保留最近这一窗：摘要、卡死判定与个人记忆提取只看最近事件，运行详情与
// SSE 需要更早的记录时按 seq 分页读表。若在这里全量载入，长跑的 run 每读一次
// 运行详情（以及调度器每轮扫描的每个活动 run）都要把整份 journal 拉进内存。
const CloudAgentJournalWindow = 40

func (r *Repository) hydrateCloudAgent(run *model.CloudAgentExecution) error {
	if run.CheckpointVersion < 2 {
		return nil
	}
	// 只取最近一窗，再翻回升序：与 EventCount 的尾部对齐（不变量见 app 侧解码）。
	window := []model.CloudAgentEventRecord{}
	if err := r.db.Where("run_id = ? AND user_id = ?", run.ID, run.UserID).
		Order("sequence DESC").Limit(CloudAgentJournalWindow).Find(&window).Error; err != nil {
		return err
	}
	run.Journal = make([]model.CloudAgentEventRecord, 0, len(window))
	for index := len(window) - 1; index >= 0; index-- {
		run.Journal = append(run.Journal, window[index])
	}
	if err := r.db.Where("run_id = ? AND user_id = ?", run.ID, run.UserID).Order("kind, sequence").Find(&run.Transcript).Error; err != nil {
		return err
	}
	return nil
}

// CloudAgentEventRecords 取 seq > afterSeq 的事件（升序），keyset 分页走
// (run_id, sequence) 主键，用于增量拉取与 SSE 断线重连。
func (r *Repository) CloudAgentEventRecords(userID, runID string, afterSeq, limit int) ([]model.CloudAgentEventRecord, error) {
	if limit <= 0 {
		limit = CloudAgentJournalWindow
	}
	records := []model.CloudAgentEventRecord{}
	err := r.db.Where("run_id = ? AND user_id = ? AND sequence > ?", runID, userID, afterSeq).
		Order("sequence ASC").Limit(limit).Find(&records).Error
	return records, err
}

// CloudAgentEventRecordsBefore 取 seq < beforeSeq 的**最近** limit 条（升序返回），
// 供"请求的页比内存窗口更深、要往前补"的读路径使用。
func (r *Repository) CloudAgentEventRecordsBefore(userID, runID string, beforeSeq, limit int) ([]model.CloudAgentEventRecord, error) {
	if limit <= 0 {
		limit = CloudAgentJournalWindow
	}
	records := []model.CloudAgentEventRecord{}
	err := r.db.Where("run_id = ? AND user_id = ? AND sequence < ?", runID, userID, beforeSeq).
		Order("sequence DESC").Limit(limit).Find(&records).Error
	if err != nil {
		return nil, err
	}
	for left, right := 0, len(records)-1; left < right; left, right = left+1, right-1 {
		records[left], records[right] = records[right], records[left]
	}
	return records, nil
}

// CloudAgentEventRecordCount 是该运行已入库的事件条数；只做计数，不载入正文。
func (r *Repository) CloudAgentEventRecordCount(userID, runID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.CloudAgentEventRecord{}).
		Where("run_id = ? AND user_id = ?", runID, userID).Count(&count).Error
	return count, err
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
		if run.EventCount < previousEvents {
			return fmt.Errorf("cloud Agent journal cannot be truncated")
		}
		// journal 是 append-only：本次转移之前已经载入的事件不许改写。
		// 内存里只有最近一窗，窗口右移后更早的行会落在新窗口之外——那些行不在
		// run.Journal 里，也不会被下面的 Create 循环碰到（只追加 seq > 水位的新行），
		// 因此只要求它们确实比新窗口更早，而不是要求它们仍在窗口内。
		current := make(map[int]string, len(run.Journal))
		for _, event := range run.Journal {
			current[event.Sequence] = event.EventJSON
		}
		for sequence, body := range previousEventBodies {
			updated, present := current[sequence]
			if !present {
				if len(run.Journal) == 0 || sequence >= run.Journal[0].Sequence {
					return fmt.Errorf("cloud Agent journal is append-only")
				}
				continue
			}
			if !sameJSONDocument(updated, body) {
				return fmt.Errorf("cloud Agent journal is append-only")
			}
		}
		// 水位与窗口必须自洽：窗口最后一条就是要落库的最后一条，否则说明写入端
		// 算错了窗口起点，或行被删掉过。
		if len(run.Journal) > 0 && run.Journal[len(run.Journal)-1].Sequence != run.EventCount {
			return fmt.Errorf("cloud Agent journal watermark is inconsistent")
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

// GeminiCacheByKey returns an official Gemini CachedContent owned by the user.
func (r *Repository) GeminiCacheByKey(userID, cacheKey string) (*model.CloudAgentGeminiCache, error) {
	var cache model.CloudAgentGeminiCache
	if err := r.db.Where("user_id = ? AND cache_key = ?", userID, cacheKey).First(&cache).Error; err != nil {
		return nil, err
	}
	return &cache, nil
}

// UpsertGeminiCache persists the resource name and expiry returned by Gemini.
func (r *Repository) UpsertGeminiCache(cache *model.CloudAgentGeminiCache) error {
	return r.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}, {Name: "cache_key"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"user_id", "base_url", "model", "credential_hash", "resource_name", "expire_time", "updated_at",
		}),
	}).Create(cache).Error
}

func (r *Repository) DeleteGeminiCache(userID, cacheKey string) error {
	return r.db.Where("user_id = ? AND cache_key = ?", userID, cacheKey).Delete(&model.CloudAgentGeminiCache{}).Error
}

// DeleteGeminiCacheIfResourceMatches prevents a late request using an old
// CachedContent resource from deleting a newer cache for the same identity.
func (r *Repository) DeleteGeminiCacheIfResourceMatches(userID, cacheKey, resourceName string) (bool, error) {
	result := r.db.Where("user_id = ? AND cache_key = ? AND resource_name = ?", userID, cacheKey, resourceName).Delete(&model.CloudAgentGeminiCache{})
	return result.RowsAffected == 1, result.Error
}
