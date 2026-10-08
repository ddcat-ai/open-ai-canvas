// 生成任务的持久化：领取、租约续期、Provider 进度与终态写回。
//
// 所有「执行中」写入都带租约校验（taskLeaseWriter）：进程被新执行者接管后，旧执行者的
// 迟到写入会因租约不匹配被丢弃，避免覆盖新结果或重复扣费。

package repository

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

func (r *Repository) Task(id string) (*model.Task, error) {
	var task model.Task
	if err := r.db.First(&task, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &task, nil
}

func (r *Repository) TaskForUser(userID string, id string) (*model.Task, error) {
	var task model.Task
	if err := r.db.First(&task, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &task, nil
}

func (r *Repository) ActiveTaskCountForUser(userID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.Task{}).Where("user_id = ? AND status IN ?", userID, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}).Count(&count).Error
	return count, err
}

func (r *Repository) ActiveTaskCountForProjectIDs(userID string, projectIDs []string) (int64, error) {
	if len(projectIDs) == 0 {
		return 0, nil
	}
	var count int64
	err := r.db.Model(&model.Task{}).
		Where("user_id = ? AND project_id IN ? AND status IN ?", userID, projectIDs, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}).
		Count(&count).Error
	return count, err
}

// 任务领取以数据库租约为真相；PostgreSQL 锁行跳过竞争任务，SQLite 继续依赖条件更新保证单实例原子性。
func (r *Repository) ClaimNextTask(owner string, leaseDuration time.Duration) (*model.Task, error) {
	var task model.Task
	now := time.Now()
	leaseExpiresAt := now.Add(leaseDuration)
	err := r.db.Transaction(func(tx *gorm.DB) error {
		query := tx.Where("(status = ? OR (status = ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?))) AND (next_poll_at IS NULL OR next_poll_at <= ?)", model.TaskStatusQueued, model.TaskStatusRunning, now, now).
			Order("created_at asc").Limit(1)
		if r.Dialect() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})
		}
		result := query.Find(&task)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			task = model.Task{}
			return nil
		}
		claim := tx.Model(&model.Task{}).Where("id = ?", task.ID)
		if r.Dialect() != "postgres" {
			claim = claim.Where("(status = ? OR (status = ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?))) AND (next_poll_at IS NULL OR next_poll_at <= ?)", model.TaskStatusQueued, model.TaskStatusRunning, now, now)
		}
		updated := claim.
			Updates(map[string]any{
				"status":           model.TaskStatusRunning,
				"stage":            "后端接管任务",
				"progress":         15,
				"attempts":         gorm.Expr("attempts + ?", 1),
				"started_at":       gorm.Expr("COALESCE(started_at, ?)", now),
				"lease_owner":      owner,
				"lease_expires_at": leaseExpiresAt,
				"next_poll_at":     nil,
				"updated_at":       now,
			})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected == 0 {
			task = model.Task{}
			return nil
		}
		return tx.First(&task, "id = ?", task.ID).Error
	})
	if err != nil || task.ID == "" {
		return nil, err
	}
	return &task, nil
}

func (r *Repository) RenewTaskLease(id string, owner string, leaseDuration time.Duration) error {
	result := r.db.Model(&model.Task{}).
		Where("id = ? AND status = ? AND lease_owner = ? AND lease_expires_at > ?", id, model.TaskStatusRunning, owner, time.Now()).
		Updates(map[string]any{"lease_expires_at": time.Now().Add(leaseDuration), "updated_at": time.Now()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("任务租约已失效")
	}
	return nil
}

func (r *Repository) UpdateTaskProviderState(id string, providerRequestID string, pollStage string, nextPollAt *time.Time) error {
	updates := map[string]any{"poll_stage": pollStage, "next_poll_at": nextPollAt, "updated_at": time.Now()}
	if strings.TrimSpace(providerRequestID) != "" {
		updates["provider_request_id"] = strings.TrimSpace(providerRequestID)
	}
	return r.db.Model(&model.Task{}).Where("id = ?", id).Updates(updates).Error
}

func (r *Repository) DeferRunningTaskForProviderPoll(id string, owner string, stage string, delay time.Duration) error {
	now := time.Now()
	result := taskLeaseWriter(r.db.Model(&model.Task{}), owner).
		Where("id = ? AND status = ?", id, model.TaskStatusRunning).
		Updates(map[string]any{
			"stage": stage, "error": "", "completed_at": nil, "next_poll_at": now.Add(delay),
			"lease_owner": "", "lease_expires_at": nil, "updated_at": now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTaskStateConflict
	}
	return nil
}

// 人工恢复仅锁定失败任务；旧 worker 的租约可覆盖，但未过期的人工恢复租约不能并发抢占。
func (r *Repository) ClaimFailedTaskProviderRecovery(id string, userID string, owner string, leaseDuration time.Duration) error {
	now := time.Now()
	query := r.db.Model(&model.Task{}).Where(
		"id = ? AND status = ? AND (lease_owner = '' OR lease_owner NOT LIKE ? OR lease_expires_at IS NULL OR lease_expires_at <= ?)",
		id, model.TaskStatusFailed, "manual-recovery:%", now,
	)
	if strings.TrimSpace(userID) != "" {
		query = query.Where("user_id = ?", userID)
	}
	result := query.Updates(map[string]any{
		"lease_owner":      owner,
		"lease_expires_at": now.Add(leaseDuration),
		"updated_at":       now,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTaskProviderRecoveryConflict
	}
	return nil
}

func (r *Repository) ReleaseTaskProviderRecovery(id string, owner string) error {
	return r.db.Model(&model.Task{}).
		Where("id = ? AND lease_owner = ?", id, owner).
		Updates(map[string]any{"lease_owner": "", "lease_expires_at": nil, "updated_at": time.Now()}).Error
}

func (r *Repository) UpdateTaskProgress(id string, stage string, progress int) error {
	return r.db.Model(&model.Task{}).Where("id = ? AND status = ?", id, model.TaskStatusRunning).Updates(map[string]any{
		"stage": stage, "progress": progress, "updated_at": time.Now(),
	}).Error
}

func (r *Repository) UpdateTaskProgressForLease(id string, owner string, stage string, progress int) error {
	result := taskLeaseWriter(r.db.Model(&model.Task{}), owner).
		Where("id = ? AND status = ?", id, model.TaskStatusRunning).
		Updates(map[string]any{"stage": stage, "progress": progress, "updated_at": time.Now()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTaskStateConflict
	}
	return nil
}

// 无租约任务仅能写无租约记录；有租约的执行者必须仍持有本次领取的有效 owner。
func taskLeaseWriter(db *gorm.DB, owner string) *gorm.DB {
	if owner == "" {
		return db.Where("(lease_owner = '' OR lease_owner IS NULL)")
	}
	return db.Where("lease_owner = ? AND lease_expires_at > ?", owner, time.Now())
}

// UpdateTaskProviderProgress records upstream-reported progress without allowing
// a delayed or out-of-order poll response to move the public percentage backwards.
func (r *Repository) UpdateTaskProviderProgress(id string, progress int) error {
	progress = max(0, min(100, progress))
	return r.db.Model(&model.Task{}).Where("id = ? AND status = ?", id, model.TaskStatusRunning).Updates(map[string]any{
		"stage":      "上游生成中",
		"progress":   gorm.Expr("CASE WHEN progress < ? THEN ? ELSE progress END", progress, progress),
		"updated_at": time.Now(),
	}).Error
}

func (r *Repository) SaveTaskCompletion(task *model.Task, expected model.TaskStatus, results []model.Result) error {
	return r.SaveTaskCompletionWithRegistration(task, expected, results, nil)
}

// Registration and terminal success commit together; a failed asset write leaves
// the task recoverable and never exposes a false success to the canvas.
func (r *Repository) SaveTaskCompletionWithRegistration(task *model.Task, expected model.TaskStatus, results []model.Result, register func(*Repository) error) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		updated := taskLeaseWriter(tx.Model(&model.Task{}), task.LeaseOwner).
			Where("id = ? AND status = ?", task.ID, expected).
			Select("*").Omit("id", "created_at").Updates(task)
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrTaskStateConflict
		}
		for index := range results {
			if err := tx.Create(&results[index]).Error; err != nil {
				return err
			}
		}
		if register != nil {
			return register(New(tx))
		}
		return nil
	})
}

func (r *Repository) UpdateTaskTerminalState(id string, owner string, expected model.TaskStatus, status model.TaskStatus, stage string, errorText string, completedAt time.Time) (bool, error) {
	result := taskLeaseWriter(r.db.Model(&model.Task{}), owner).
		Where("id = ? AND status = ?", id, expected).
		Updates(map[string]any{
			"status": status, "stage": stage, "error": errorText, "completed_at": &completedAt,
			"lease_owner": "", "lease_expires_at": nil, "updated_at": completedAt,
		})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) UpdateTaskTerminalDiagnostic(task *model.Task, completedAt time.Time) (bool, error) {
	result := taskLeaseWriter(r.db.Model(&model.Task{}), task.LeaseOwner).
		Where("id = ? AND status = ?", task.ID, model.TaskStatusRunning).
		Updates(map[string]any{
			"status": task.Status, "stage": task.Stage, "error": task.Error, "completed_at": &completedAt,
			"execution_diagnostic_json": task.ExecutionDiagnosticJSON,
			"cancellation_source":       task.CancellationSource, "cancellation_actor_id": task.CancellationActorID,
			"cancellation_requested_at": task.CancellationRequestedAt,
			"lease_owner":               "", "lease_expires_at": nil, "updated_at": completedAt,
		})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) UpdateTaskExecutionDiagnostic(userID, taskID, diagnosticJSON string) error {
	result := r.db.Model(&model.Task{}).
		Where("id = ? AND user_id = ?", taskID, userID).
		Update("execution_diagnostic_json", diagnosticJSON)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) CancelTaskIfStatus(userID string, id string, expected model.TaskStatus, now time.Time, intents ...model.TaskCancellationIntent) (bool, error) {
	updates := map[string]any{
		"status": model.TaskStatusCancelled, "stage": "任务已取消", "error": "任务已取消", "completed_at": &now,
		"lease_owner": "", "lease_expires_at": nil, "updated_at": now,
	}
	if len(intents) > 0 {
		intent := intents[0]
		diagnostic, err := json.Marshal(intent.Diagnostic)
		if err != nil {
			return false, err
		}
		updates["cancellation_source"], updates["cancellation_actor_id"], updates["cancellation_requested_at"] = intent.Source, intent.ActorID, intent.RequestedAt
		updates["execution_diagnostic_json"] = string(diagnostic)
	}
	result := r.db.Model(&model.Task{}).
		Where("id = ? AND user_id = ? AND status = ?", id, userID, expected).
		Updates(updates)
	return result.RowsAffected == 1, result.Error
}

// 上游取消先落库再发请求；条件更新保证并发和重复取消只有一个调用方取得发送权。
func (r *Repository) ClaimTaskProviderCancellation(userID string, id string, now time.Time) error {
	result := r.db.Model(&model.Task{}).
		Where("id = ? AND user_id = ? AND status = ? AND provider_cancel_status = ''", id, userID, model.TaskStatusCancelled).
		Updates(map[string]any{
			"provider_cancel_status":        model.ProviderCancelStatusRequested,
			"provider_cancel_attempts":      1,
			"provider_cancel_requested_at":  &now,
			"provider_cancel_next_check_at": now.Add(15 * time.Second),
			"provider_cancel_error":         "",
			"updated_at":                    now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTaskProviderCancellationConflict
	}
	return nil
}

func (r *Repository) UpdateTaskProviderCancellation(id string, expected model.ProviderCancelStatus, status model.ProviderCancelStatus, errorText string, nextCheckAt *time.Time, cancelledAt *time.Time) error {
	updates := map[string]any{
		"provider_cancel_status":        status,
		"provider_cancel_error":         errorText,
		"provider_cancel_next_check_at": nextCheckAt,
		"lease_owner":                   "",
		"lease_expires_at":              nil,
		"updated_at":                    time.Now(),
	}
	if cancelledAt != nil {
		updates["provider_cancelled_at"] = cancelledAt
	}
	result := r.db.Model(&model.Task{}).Where("id = ? AND status = ? AND provider_cancel_status = ?", id, model.TaskStatusCancelled, expected).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTaskProviderCancellationConflict
	}
	return nil
}

// 对账任务同样使用数据库租约，多实例和服务重启后只会有一个 worker 查询同一上游任务。
func (r *Repository) ClaimNextTaskProviderCancellation(owner string, leaseDuration time.Duration) (*model.Task, error) {
	var task model.Task
	now := time.Now()
	err := r.db.Transaction(func(tx *gorm.DB) error {
		query := tx.Where(
			"status = ? AND provider_cancel_status = ? AND (provider_cancel_next_check_at IS NULL OR provider_cancel_next_check_at <= ?) AND (lease_expires_at IS NULL OR lease_expires_at <= ?)",
			model.TaskStatusCancelled, model.ProviderCancelStatusRequested, now, now,
		).Order("provider_cancel_requested_at asc").Limit(1)
		if r.Dialect() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})
		}
		if result := query.Find(&task); result.Error != nil || result.RowsAffected == 0 {
			task = model.Task{}
			return result.Error
		}
		claim := tx.Model(&model.Task{}).Where(
			"id = ? AND status = ? AND provider_cancel_status = ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)",
			task.ID, model.TaskStatusCancelled, model.ProviderCancelStatusRequested, now,
		).Updates(map[string]any{
			"lease_owner":              owner,
			"lease_expires_at":         now.Add(leaseDuration),
			"provider_cancel_attempts": gorm.Expr("provider_cancel_attempts + 1"),
			"updated_at":               now,
		})
		if claim.Error != nil || claim.RowsAffected == 0 {
			task = model.Task{}
			return claim.Error
		}
		return tx.First(&task, "id = ?", task.ID).Error
	})
	if err != nil || task.ID == "" {
		return nil, err
	}
	return &task, nil
}

func (r *Repository) Tasks(userID string, limit int, projectID string, activeOnly bool) ([]model.Task, error) {
	var tasks []model.Task
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := r.db.Select("id", "project_id", "type", "status", "stage", "media_stage", "media_recovery_json", "progress", "prompt", "operation", "provider", "model", "input_json", "result_json", "billing_order_id", "provider_request_id", "provider_cancel_status", "provider_cancel_error", "provider_cancel_attempts", "provider_cancel_requested_at", "provider_cancelled_at", "provider_cancel_next_check_at", "attempts", "started_at", "completed_at", "created_at", "updated_at", "agent_run_id", "generation_id", "approval_id", "authorized_charge_microcredits", "execution_diagnostic_json", "cancellation_source", "cancellation_actor_id", "cancellation_requested_at").
		Where("user_id = ?", userID)
	if strings.TrimSpace(projectID) != "" {
		query = query.Where("project_id = ?", strings.TrimSpace(projectID))
	}
	if activeOnly {
		query = query.Where("status IN ?", []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning})
	}
	err := query.Order("created_at desc").Limit(limit).Find(&tasks).Error
	return tasks, err
}

// SuccessfulWorkflowTasksForProject 返回需要补偿工作流产物的成功任务。
// 不设分页，供项目详情读取时修复浏览器中断造成的历史断点。
func (r *Repository) SuccessfulWorkflowTasksForProject(userID string, projectID string) ([]model.Task, error) {
	var tasks []model.Task
	err := r.db.Where("user_id = ? AND project_id = ? AND status = ?", userID, projectID, model.TaskStatusSucceeded).
		Order("completed_at asc, created_at asc").Find(&tasks).Error
	return tasks, err
}

func (r *Repository) TaskLogs(userID string, taskID string) ([]model.TaskLog, error) {
	var logs []model.TaskLog
	err := r.db.Order("created_at asc").Find(&logs, "user_id = ? AND task_id = ?", userID, taskID).Error
	return logs, err
}
