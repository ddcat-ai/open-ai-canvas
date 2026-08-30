package repository

import (
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrDailyUploadLimitExceeded = errors.New("daily upload limit exceeded")

var ErrTaskProviderRecoveryConflict = errors.New("task provider recovery is already running")

var ErrTaskProviderCancellationConflict = errors.New("task provider cancellation is already claimed")

var ErrTaskStateConflict = errors.New("task state changed concurrently")

var ErrTextReplayQuotaExceeded = errors.New("text replay quota exceeded")

var ErrTextReplayClosed = errors.New("text replay task is closed")

var ErrProjectAssetFolderNotEmpty = errors.New("project asset folder is not empty")

var ErrProjectHasActiveTasks = errors.New("project has active tasks")

var ErrProjectUnitShotsChanged = errors.New("project unit shots changed")

type Repository struct {
	db *gorm.DB
}

type UserStorageUsage struct {
	AssetCount   int64 `json:"assetCount"`
	AssetBytes   int64 `json:"assetBytes"`
	CanvasCount  int64 `json:"canvasCount"`
	CanvasBytes  int64 `json:"canvasBytes"`
	SessionCount int64 `json:"sessionCount"`
	SessionBytes int64 `json:"sessionBytes"`
	TaskCount    int64 `json:"taskCount"`
	TaskBytes    int64 `json:"taskBytes"`
	APICallCount int64 `json:"apiCallCount"`
}

func New(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Dialect() string {
	return r.db.Dialector.Name()
}

func (r *Repository) ReleaseTaskLease(id string, owner string) error {
	return r.db.Model(&model.Task{}).
		Where("id = ? AND status = ? AND lease_owner = ?", id, model.TaskStatusRunning, owner).
		Updates(map[string]any{"lease_owner": "", "lease_expires_at": nil, "updated_at": time.Now()}).Error
}

// NextPrefixedID 在数据库事务中递增序列，避免 UUID/父子字符串拼接导致的不可读和不可排序 ID。
// prefix 只决定展示前缀，关联关系仍由独立外键维护。
func (r *Repository) NextPrefixedID(prefix string) (string, error) {
	return r.nextPrefixedID(r.db, prefix)
}

func (r *Repository) nextPrefixedID(db *gorm.DB, prefix string) (string, error) {
	prefix = strings.ToUpper(strings.TrimSpace(prefix))
	if prefix == "" || len(prefix) > 16 {
		return "", errors.New("invalid id prefix")
	}
	sequence := "id:" + prefix
	var item model.IDSequence
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.IDSequence{Name: sequence, UpdatedAt: time.Now()}).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.IDSequence{}).Where("name = ?", sequence).Updates(map[string]any{
			"value":      gorm.Expr("value + ?", 1),
			"updated_at": time.Now(),
		}).Error; err != nil {
			return err
		}
		return tx.First(&item, "name = ?", sequence).Error
	})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s_%06d", prefix, item.Value), nil
}

func (r *Repository) UserStorageUsage(userID string) (UserStorageUsage, error) {
	var usage UserStorageUsage
	query := `
		SELECT
			(SELECT COUNT(*) FROM assets WHERE user_id = ?) AS asset_count,
			(SELECT COALESCE(SUM(length(CAST(COALESCE(payload_json, '') AS BLOB))), 0) FROM assets WHERE user_id = ?) AS asset_bytes,
			(SELECT COUNT(*) FROM canvas_projects WHERE user_id = ?) AS canvas_count,
			(SELECT COALESCE(SUM(length(CAST(COALESCE(payload_json, '') AS BLOB))), 0) FROM canvas_projects WHERE user_id = ?) AS canvas_bytes,
			(SELECT COUNT(*) FROM sessions WHERE user_id = ?) AS session_count,
			(SELECT COALESCE(SUM(length(CAST(COALESCE(prompt, '') AS BLOB)) + length(CAST(COALESCE(canvas_snapshot_json, '') AS BLOB)) + length(CAST(COALESCE(canvas_ops_json, '') AS BLOB))), 0) FROM sessions WHERE user_id = ?)
			+ (SELECT COALESCE(SUM(length(CAST(COALESCE(content, '') AS BLOB)) + length(CAST(COALESCE(payload, '') AS BLOB))), 0) FROM messages WHERE user_id = ?) AS session_bytes,
			(SELECT COUNT(*) FROM tasks WHERE user_id = ?) AS task_count,
			(SELECT COALESCE(SUM(length(CAST(COALESCE(prompt, '') AS BLOB)) + length(CAST(COALESCE(input_json, '') AS BLOB)) + length(CAST(COALESCE(result_json, '') AS BLOB)) + length(CAST(COALESCE(text_draft, '') AS BLOB)) + length(CAST(COALESCE(error, '') AS BLOB))), 0) FROM tasks WHERE user_id = ?)
			+ (SELECT COALESCE(SUM(length(CAST(COALESCE(message, '') AS BLOB)) + length(CAST(COALESCE(payload, '') AS BLOB))), 0) FROM task_logs WHERE user_id = ?)
			+ (SELECT COALESCE(SUM(length(CAST(COALESCE(url, '') AS BLOB)) + length(CAST(COALESCE(payload, '') AS BLOB))), 0) FROM results WHERE user_id = ?)
			+ (SELECT COALESCE(SUM(byte_count), 0) FROM task_text_delta WHERE user_id = ?)
			+ (SELECT COALESCE(SUM(length(CAST(COALESCE(path, '') AS BLOB)) + length(CAST(COALESCE(model, '') AS BLOB)) + length(CAST(COALESCE(provider_request_id, '') AS BLOB)) + length(CAST(COALESCE(error_code, '') AS BLOB)) + length(CAST(COALESCE(error, '') AS BLOB)) + length(CAST(COALESCE(upstream_url, '') AS BLOB)) + length(CAST(COALESCE(request_body, '') AS BLOB)) + length(CAST(COALESCE(response_body, '') AS BLOB))), 0) FROM api_call_logs WHERE user_id = ?) AS task_bytes,
			(SELECT COUNT(*) FROM api_call_logs WHERE user_id = ?) AS api_call_count
	`
	if r.Dialect() == "postgres" {
		query = strings.ReplaceAll(query, "length(CAST(COALESCE(", "octet_length(COALESCE(")
		query = strings.ReplaceAll(query, ", '') AS BLOB))", ", ''))")
	}
	err := r.db.Raw(query, userID, userID, userID, userID, userID, userID, userID, userID, userID, userID, userID, userID, userID, userID).Scan(&usage).Error
	return usage, err
}

// Create 是低层兼容入口；业务写路径应优先使用带领域约束的显式方法。
func (r *Repository) Create(value any) error {
	return r.db.Create(value).Error
}

// Save 是低层兼容入口；涉及状态机或权限边界的写入不得绕过显式事务方法。
func (r *Repository) Save(value any) error {
	return r.db.Save(value).Error
}

func (r *Repository) AllTasks() ([]model.Task, error) {
	var tasks []model.Task
	return tasks, r.db.Find(&tasks).Error
}

func (r *Repository) AllAssets() ([]model.Asset, error) {
	var assets []model.Asset
	return assets, r.db.Find(&assets).Error
}

func (r *Repository) AllCanvasProjects() ([]model.CanvasProject, error) {
	var projects []model.CanvasProject
	return projects, r.db.Find(&projects).Error
}

func (r *Repository) CleanupDuplicateTaskPayloads() error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.TaskLog{}).Where("length(payload) > ?", 4000).Update("payload", "").Error; err != nil {
			return err
		}
		return tx.Delete(&model.Result{}, "kind = ? AND session_id = ?", "generation_result", "").Error
	})
}

func (r *Repository) BackupSQLite(path string) error {
	if r.Dialect() != "sqlite" {
		return errors.New("当前数据库不是 SQLite，不能执行 SQLite 备份")
	}
	escaped := strings.ReplaceAll(path, "'", "''")
	return r.db.Exec("VACUUM INTO '" + escaped + "'").Error
}

func (r *Repository) Vacuum() error {
	if r.Dialect() != "sqlite" {
		return nil
	}
	return r.db.Exec("VACUUM").Error
}

// Delete 是低层兼容入口；删除业务数据应使用带用户/项目作用域和关联清理的显式方法。
func (r *Repository) Delete(value any, query any, args ...any) error {
	conds := append([]any{query}, args...)
	return r.db.Delete(value, conds...).Error
}

func (r *Repository) UserCount() (int64, error) {
	var count int64
	err := r.db.Model(&model.User{}).Count(&count).Error
	return count, err
}

func (r *Repository) User(id string) (*model.User, error) {
	var user model.User
	if err := r.db.First(&user, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *Repository) UserByAccount(account string) (*model.User, error) {
	var user model.User
	if err := r.db.Where("lower(username) = lower(?) OR lower(email) = lower(?)", account, account).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *Repository) UserByUsername(username string) (*model.User, error) {
	var user model.User
	if err := r.db.Where("lower(username) = lower(?)", username).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *Repository) UserByEmail(email string) (*model.User, error) {
	var user model.User
	if err := r.db.Where("email <> '' AND lower(email) = lower(?)", email).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *Repository) Users() ([]model.User, error) {
	var users []model.User
	err := r.db.Order("created_at desc").Find(&users).Error
	return users, err
}

func (r *Repository) AdminUsers(keyword string, role model.UserRole, status model.UserStatus, limit int, offset int) ([]model.User, int64, error) {
	var users []model.User
	var total int64
	query := r.db.Model(&model.User{})
	if value := strings.TrimSpace(keyword); value != "" {
		pattern := "%" + strings.ToLower(value) + "%"
		query = query.Where("lower(username) LIKE ? OR lower(display_name) LIKE ? OR lower(email) LIKE ?", pattern, pattern, pattern)
	}
	if role == model.UserRoleAdmin || role == model.UserRoleUser {
		query = query.Where("role = ?", role)
	}
	if status == model.UserStatusActive || status == model.UserStatusDisabled {
		query = query.Where("status = ?", status)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Order("created_at desc").Limit(limit).Offset(offset).Find(&users).Error; err != nil {
		return nil, 0, err
	}
	return users, total, nil
}

func (r *Repository) AdminUserReferences() ([]model.User, error) {
	var users []model.User
	err := r.db.Select("id", "username", "display_name").Order("created_at desc").Limit(100).Find(&users).Error
	return users, err
}

func (r *Repository) ActiveAdminCountExcluding(userID string) (int64, error) {
	var count int64
	query := r.db.Model(&model.User{}).Where("role = ? AND status = ?", model.UserRoleAdmin, model.UserStatusActive)
	if userID != "" {
		query = query.Where("id <> ?", userID)
	}
	err := query.Count(&count).Error
	return count, err
}

func (r *Repository) AuthSession(id string) (*model.AuthSession, error) {
	var session model.AuthSession
	if err := r.db.First(&session, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *Repository) DeleteAuthSession(id string) error {
	return r.db.Delete(&model.AuthSession{}, "id = ?", id).Error
}

func (r *Repository) DeleteExpiredAuthSessions() error {
	return r.db.Delete(&model.AuthSession{}, "expires_at <= ?", time.Now()).Error
}

func (r *Repository) DeleteUserAuthSessions(userID string) error {
	return r.db.Delete(&model.AuthSession{}, "user_id = ?", userID).Error
}

func (r *Repository) LatestEmailVerificationCode(email string, purpose string) (*model.EmailVerificationCode, error) {
	var code model.EmailVerificationCode
	if err := r.db.Where("email = ? AND purpose = ? AND used_at IS NULL", email, purpose).Order("created_at desc").First(&code).Error; err != nil {
		return nil, err
	}
	return &code, nil
}

func (r *Repository) MarkEmailVerificationCodeUsed(id string, usedAt time.Time) error {
	return r.db.Model(&model.EmailVerificationCode{}).Where("id = ? AND used_at IS NULL", id).Update("used_at", usedAt).Error
}

func (r *Repository) DeleteEmailVerificationCode(id string) error {
	return r.db.Delete(&model.EmailVerificationCode{}, "id = ?", id).Error
}

func (r *Repository) CreateUserWithEmailVerification(user *model.User, verificationCodeID string, usedAt time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.EmailVerificationCode{}).Where("id = ? AND used_at IS NULL AND expires_at > ?", verificationCodeID, usedAt).Update("used_at", usedAt)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("email verification code is no longer valid")
		}
		return tx.Create(user).Error
	})
}

func (r *Repository) DeleteExpiredEmailVerificationCodes(now time.Time) error {
	return r.db.Delete(&model.EmailVerificationCode{}, "expires_at <= ? OR used_at IS NOT NULL", now).Error
}

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
		Where("id = ? AND status = ? AND lease_owner = ?", id, model.TaskStatusRunning, owner).
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
	result := r.db.Model(&model.Task{}).
		Where("id = ? AND status = ? AND lease_owner = ?", id, model.TaskStatusRunning, owner).
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

func (r *Repository) SaveTaskCompletion(task *model.Task, expected model.TaskStatus, session *model.Session, message *model.Message, results []model.Result) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		updated := tx.Model(&model.Task{}).
			Where("id = ? AND status = ?", task.ID, expected).
			Select("*").Omit("id", "created_at").Updates(task)
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrTaskStateConflict
		}
		if session != nil {
			if err := tx.Save(session).Error; err != nil {
				return err
			}
		}
		if message != nil {
			if err := tx.Create(message).Error; err != nil {
				return err
			}
		}
		for index := range results {
			if err := tx.Create(&results[index]).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *Repository) UpdateTaskTerminalState(id string, expected model.TaskStatus, status model.TaskStatus, stage string, errorText string, completedAt time.Time) (bool, error) {
	result := r.db.Model(&model.Task{}).
		Where("id = ? AND status = ?", id, expected).
		Updates(map[string]any{
			"status": status, "stage": stage, "error": errorText, "completed_at": &completedAt,
			"lease_owner": "", "lease_expires_at": nil, "updated_at": completedAt,
		})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) CancelTaskIfStatus(userID string, id string, expected model.TaskStatus, now time.Time) (bool, error) {
	result := r.db.Model(&model.Task{}).
		Where("id = ? AND user_id = ? AND status = ?", id, userID, expected).
		Updates(map[string]any{
			"status": model.TaskStatusCancelled, "stage": "任务已取消", "error": "任务已取消", "completed_at": &now,
			"lease_owner": "", "lease_expires_at": nil, "updated_at": now,
		})
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
	query := r.db.Select("id", "session_id", "project_id", "type", "status", "stage", "progress", "prompt", "operation", "provider", "model", "input_json", "result_json", "billing_order_id", "provider_request_id", "provider_cancel_status", "provider_cancel_error", "provider_cancel_attempts", "provider_cancel_requested_at", "provider_cancelled_at", "provider_cancel_next_check_at", "attempts", "started_at", "completed_at", "created_at", "updated_at").
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

func (r *Repository) Session(id string) (*model.Session, error) {
	var session model.Session
	if err := r.db.First(&session, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *Repository) SessionForUser(userID string, id string) (*model.Session, error) {
	var session model.Session
	if err := r.db.First(&session, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *Repository) DeleteSessionDraft(userID string, id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var taskIDs []string
		if err := tx.Model(&model.Task{}).Where("user_id = ? AND session_id = ?", userID, id).Pluck("id", &taskIDs).Error; err != nil {
			return err
		}
		if len(taskIDs) > 0 {
			if err := tx.Delete(&model.TaskTextDelta{}, "user_id = ? AND task_id IN ?", userID, taskIDs).Error; err != nil {
				return err
			}
		}
		if err := tx.Delete(&model.Message{}, "user_id = ? AND session_id = ?", userID, id).Error; err != nil {
			return err
		}
		return tx.Delete(&model.Session{}, "id = ? AND user_id = ?", id, userID).Error
	})
}

func (r *Repository) SessionMessages(userID string, sessionID string) ([]model.Message, error) {
	var messages []model.Message
	err := r.db.Order("created_at asc").Find(&messages, "user_id = ? AND session_id = ?", userID, sessionID).Error
	return messages, err
}

func (r *Repository) SessionTasks(userID string, sessionID string) ([]model.Task, error) {
	var tasks []model.Task
	err := r.db.Select("id", "user_id", "session_id", "project_id", "type", "status", "prompt", "operation", "provider", "model", "attempts", "started_at", "completed_at", "created_at", "updated_at").
		Order("created_at asc").
		Find(&tasks, "user_id = ? AND session_id = ?", userID, sessionID).Error
	return tasks, err
}

func (r *Repository) SessionResults(userID string, sessionID string) ([]model.Result, error) {
	var results []model.Result
	err := r.db.Order("created_at asc").Find(&results, "user_id = ? AND session_id = ?", userID, sessionID).Error
	return results, err
}

func (r *Repository) TaskLogs(userID string, taskID string) ([]model.TaskLog, error) {
	var logs []model.TaskLog
	err := r.db.Order("created_at asc").Find(&logs, "user_id = ? AND task_id = ?", userID, taskID).Error
	return logs, err
}

func (r *Repository) SystemChannels(includeDisabled bool) ([]model.ModelChannel, error) {
	var channels []model.ModelChannel
	query := r.db.Order("created_at asc").Where("scope = ?", model.ChannelScopeSystem)
	if !includeDisabled {
		query = query.Where("enabled = ?", true)
	}
	err := query.Find(&channels).Error
	return channels, err
}

func (r *Repository) HistoricalSystemChannelReferences() ([]model.ModelChannel, error) {
	var channels []model.ModelChannel
	err := r.db.Unscoped().Select("id", "name").Where("scope = ?", model.ChannelScopeSystem).Order("created_at asc").Find(&channels).Error
	return channels, err
}

func (r *Repository) AdminSystemChannels(keyword string, status string, limit int, offset int) ([]model.ModelChannel, int64, error) {
	var channels []model.ModelChannel
	var total int64
	query := r.db.Model(&model.ModelChannel{}).Where("scope = ?", model.ChannelScopeSystem)
	if value := strings.TrimSpace(keyword); value != "" {
		pattern := "%" + strings.ToLower(value) + "%"
		query = query.Where("lower(name) LIKE ? OR lower(base_url) LIKE ?", pattern, pattern)
	}
	if status == "enabled" {
		query = query.Where("enabled = ?", true)
	} else if status == "disabled" {
		query = query.Where("enabled = ?", false)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Order("created_at desc").Limit(limit).Offset(offset).Find(&channels).Error; err != nil {
		return nil, 0, err
	}
	return channels, total, nil
}

func (r *Repository) AdminSystemChannelReferences() ([]model.ModelChannel, error) {
	var channels []model.ModelChannel
	err := r.db.Select("id", "name", "enabled").Where("scope = ?", model.ChannelScopeSystem).Order("created_at asc").Find(&channels).Error
	return channels, err
}

func (r *Repository) SystemChannel(id string) (*model.ModelChannel, error) {
	var channel model.ModelChannel
	if err := r.db.First(&channel, "id = ? AND scope = ? AND enabled = ?", id, model.ChannelScopeSystem, true).Error; err != nil {
		return nil, err
	}
	return &channel, nil
}

func (r *Repository) AdminSystemChannel(id string) (*model.ModelChannel, error) {
	var channel model.ModelChannel
	if err := r.db.First(&channel, "id = ? AND scope = ?", id, model.ChannelScopeSystem).Error; err != nil {
		return nil, err
	}
	return &channel, nil
}

func (r *Repository) DeleteSystemChannel(id string) error {
	now := time.Now()
	return r.db.Transaction(func(tx *gorm.DB) error {
		channelResult := tx.Model(&model.ModelChannel{}).
			Where("id = ? AND scope = ?", id, model.ChannelScopeSystem).
			Updates(map[string]any{"api_key": "", "secret_key": "", "enabled": false, "updated_at": now})
		if channelResult.Error != nil {
			return channelResult.Error
		}
		if channelResult.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		if err := tx.Model(&model.ChannelModel{}).Where("channel_id = ?", id).Updates(map[string]any{"enabled": false, "updated_at": now}).Error; err != nil {
			return err
		}
		if err := tx.Where("channel_id = ?", id).Delete(&model.ChannelModel{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND scope = ?", id, model.ChannelScopeSystem).Delete(&model.ModelChannel{}).Error
	})
}

func (r *Repository) ApiCallLogs(userID string, admin bool, limit int) ([]model.ApiCallLog, error) {
	var logs []model.ApiCallLog
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	query := r.db.Order("created_at desc").Limit(limit)
	if !admin {
		query = query.Where("user_id = ?", userID)
	}
	err := query.Omit("RequestBody", "ResponseBody").Find(&logs).Error
	return logs, err
}

func (r *Repository) SystemSetting(key string) (*model.SystemSetting, error) {
	var setting model.SystemSetting
	if err := r.db.First(&setting, "key = ?", key).Error; err != nil {
		return nil, err
	}
	return &setting, nil
}

func (r *Repository) SaveSystemSetting(setting *model.SystemSetting) error {
	return r.db.Save(setting).Error
}

func (r *Repository) SaveSystemSettings(settings ...*model.SystemSetting) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		for _, setting := range settings {
			if err := tx.Save(setting).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *Repository) ArkPrivateAssetBinding(resourceID string, projectName string) (*model.ArkPrivateAssetBinding, error) {
	var binding model.ArkPrivateAssetBinding
	if err := r.db.Where("resource_id = ? AND project_name = ?", resourceID, projectName).First(&binding).Error; err != nil {
		return nil, err
	}
	return &binding, nil
}

// CreateArkPrivateAssetBinding establishes a single uploader for a resource
// and Ark Project. Other workers can wait for that binding instead of
// importing the same image repeatedly.
func (r *Repository) CreateArkPrivateAssetBinding(binding *model.ArkPrivateAssetBinding) (bool, error) {
	result := r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "resource_id"}, {Name: "project_name"}},
		DoNothing: true,
	}).Create(binding)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

func (r *Repository) SaveArkPrivateAssetBinding(binding *model.ArkPrivateAssetBinding) error {
	return r.db.Save(binding).Error
}

func (r *Repository) DeleteSystemSetting(key string) error {
	return r.db.Delete(&model.SystemSetting{}, "key = ?", key).Error
}

func (r *Repository) LatestUserOSSSetting(userID string) (*model.UserOSSSetting, error) {
	var setting model.UserOSSSetting
	if err := r.db.Where("user_id = ?", userID).Order("created_at desc, id desc").First(&setting).Error; err != nil {
		return nil, err
	}
	return &setting, nil
}

func (r *Repository) UserOSSSettingsForUser(userID string) ([]model.UserOSSSetting, error) {
	var settings []model.UserOSSSetting
	err := r.db.Where("user_id = ?", userID).Order("created_at desc, id desc").Find(&settings).Error
	return settings, err
}

func (r *Repository) UserOSSSettingForUser(userID string, id string) (*model.UserOSSSetting, error) {
	var setting model.UserOSSSetting
	if err := r.db.First(&setting, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &setting, nil
}

func (r *Repository) CreateUserOSSSetting(setting *model.UserOSSSetting) error {
	return r.db.Create(setting).Error
}

func (r *Repository) StorageLocation(id string) (*model.StorageLocation, error) {
	var location model.StorageLocation
	if err := r.db.First(&location, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &location, nil
}

func (r *Repository) StorageLocationByDigest(scope string, ownerID string, provider string, digest string) (*model.StorageLocation, error) {
	var location model.StorageLocation
	if err := r.db.First(&location, "scope = ? AND owner_id = ? AND provider = ? AND location_digest = ?", scope, ownerID, provider, digest).Error; err != nil {
		return nil, err
	}
	return &location, nil
}

func (r *Repository) StorageLocationHistoryCount(scope string, ownerID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.StorageLocation{}).Where("scope = ? AND owner_id = ?", scope, ownerID).Count(&count).Error
	return count, err
}

func (r *Repository) StorageLocationResourceCount(id string) (int64, error) {
	var count int64
	err := r.db.Model(&model.Resource{}).Where("storage_setting_id = ?", id).Count(&count).Error
	return count, err
}

func (r *Repository) CreateStorageLocation(location *model.StorageLocation) error {
	return r.db.Create(location).Error
}

func (r *Repository) SaveStorageLocation(location *model.StorageLocation) error {
	return r.db.Save(location).Error
}

func (r *Repository) ActivateStorageLocation(scope string, ownerID string, id string, active bool) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.StorageLocation{}).Where("scope = ? AND owner_id = ? AND active = ?", scope, ownerID, true).Update("active", false).Error; err != nil {
			return err
		}
		if !active {
			return nil
		}
		result := tx.Model(&model.StorageLocation{}).Where("id = ? AND scope = ? AND owner_id = ?", id, scope, ownerID).Update("active", true)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}

func (r *Repository) ReserveDailyUpload(userID string, day string, size int64, limit int64) error {
	usage := model.UserDailyUploadUsage{ID: userID + ":" + day, UserID: userID, Day: day}
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&usage).Error; err != nil {
			return err
		}
		result := tx.Model(&model.UserDailyUploadUsage{}).
			Where("id = ? AND bytes + ? < ?", usage.ID, size, limit).
			Updates(map[string]any{"bytes": gorm.Expr("bytes + ?", size), "updated_at": time.Now()})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrDailyUploadLimitExceeded
		}
		return nil
	})
}

func (r *Repository) ReleaseDailyUpload(userID string, day string, size int64) error {
	id := userID + ":" + day
	return r.db.Model(&model.UserDailyUploadUsage{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"bytes":      gorm.Expr("CASE WHEN bytes >= ? THEN bytes - ? ELSE 0 END", size, size),
			"updated_at": time.Now(),
		}).Error
}

func (r *Repository) UserStoredFileBytes(userID string) (int64, error) {
	var total int64
	err := r.db.Raw(`
		SELECT
			(SELECT COALESCE(SUM(size), 0) FROM resources WHERE user_id = ?)
			+ (SELECT COALESCE(SUM(size), 0) FROM session_files WHERE user_id = ?)
	`, userID, userID).Scan(&total).Error
	return total, err
}

func (r *Repository) DailyUploadBytes(userID string, day string) (int64, error) {
	var total int64
	err := r.db.Model(&model.UserDailyUploadUsage{}).Select("COALESCE(bytes, 0)").Where("user_id = ? AND day = ?", userID, day).Scan(&total).Error
	return total, err
}

func (r *Repository) CreateResource(resource *model.Resource) error {
	return r.db.Create(resource).Error
}

func (r *Repository) SaveResource(resource *model.Resource) error {
	return r.db.Save(resource).Error
}

func (r *Repository) DeleteResource(userID string, id string) error {
	return r.db.Delete(&model.Resource{}, "id = ? AND user_id = ?", id, userID).Error
}

func (r *Repository) Resource(id string) (*model.Resource, error) {
	var resource model.Resource
	if err := r.db.First(&resource, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &resource, nil
}

func (r *Repository) ResourceForUser(userID string, id string) (*model.Resource, error) {
	var resource model.Resource
	if err := r.db.First(&resource, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &resource, nil
}

func (r *Repository) Resources(userID string, limit int) ([]model.Resource, error) {
	var resources []model.Resource
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	err := r.db.Order("created_at desc").Limit(limit).Find(&resources, "user_id = ?", userID).Error
	return resources, err
}

func (r *Repository) Assets(userID string) ([]model.Asset, error) {
	var assets []model.Asset
	err := r.db.Order("updated_at desc").Find(&assets, "user_id = ?", userID).Error
	return assets, err
}

func (r *Repository) AssetSummaries(userID string) ([]model.Asset, error) {
	var assets []model.Asset
	err := r.db.Select("id", "kind", "category", "status", "primary_version_id", "title", "created_at", "updated_at").Order("updated_at desc").Find(&assets, "user_id = ?", userID).Error
	return assets, err
}

func (r *Repository) AssetForUser(userID string, id string) (*model.Asset, error) {
	var asset model.Asset
	if err := r.db.First(&asset, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &asset, nil
}

func (r *Repository) UpsertAsset(asset *model.Asset) error {
	result := r.db.Model(&model.Asset{}).
		Where("id = ? AND user_id = ?", asset.ID, asset.UserID).
		Updates(map[string]any{"kind": asset.Kind, "category": asset.Category, "status": asset.Status, "primary_version_id": asset.PrimaryVersionID, "title": asset.Title, "payload_json": asset.PayloadJSON, "updated_at": asset.UpdatedAt})
	if result.Error != nil || result.RowsAffected > 0 {
		return result.Error
	}
	return r.db.Create(asset).Error
}

func (r *Repository) DeleteAsset(userID string, id string) error {
	return r.DeleteAssetAndResources(userID, id, nil, nil)
}

func (r *Repository) ReplaceAssets(userID string, assets []model.Asset) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&model.Asset{}, "user_id = ?", userID).Error; err != nil {
			return err
		}
		if len(assets) == 0 {
			return nil
		}
		return tx.Create(&assets).Error
	})
}

func (r *Repository) CanvasProjects(userID string) ([]model.CanvasProject, error) {
	var projects []model.CanvasProject
	err := r.db.Order("updated_at desc").Find(&projects, "user_id = ?", userID).Error
	return projects, err
}

func (r *Repository) CanvasProjectSummaries(userID string) ([]model.CanvasProject, error) {
	var projects []model.CanvasProject
	err := r.db.Select("id", "title", "created_at", "updated_at").Order("updated_at desc").Find(&projects, "user_id = ?", userID).Error
	return projects, err
}

func (r *Repository) CanvasProjectForUser(userID string, id string) (*model.CanvasProject, error) {
	var project model.CanvasProject
	if err := r.db.First(&project, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &project, nil
}

func (r *Repository) UpsertCanvasProject(project *model.CanvasProject) error {
	result := r.db.Model(&model.CanvasProject{}).
		Where("id = ? AND user_id = ?", project.ID, project.UserID).
		Updates(map[string]any{"project_id": project.ProjectID, "title": project.Title, "payload_json": project.PayloadJSON, "updated_at": project.UpdatedAt})
	if result.Error != nil || result.RowsAffected > 0 {
		return result.Error
	}
	return r.db.Create(project).Error
}

func (r *Repository) DeleteCanvasProject(userID string, id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ? AND project_id = ?", userID, id).Delete(&model.CanvasShare{}).Error; err != nil {
			return err
		}
		if err := tx.Where("canvas_id = ?", id).Delete(&model.CanvasUnitLink{}).Error; err != nil {
			return err
		}
		// 任务和会话是审计记录，不随独立画布实体保留归属 ID，避免删除后继续挂住画布上下文。
		if err := tx.Model(&model.Task{}).Where("user_id = ? AND project_id = ?", userID, id).Update("project_id", "").Error; err != nil {
			return err
		}
		if err := tx.Model(&model.Session{}).Where("user_id = ? AND project_id = ?", userID, id).Update("project_id", "").Error; err != nil {
			return err
		}
		return tx.Delete(&model.CanvasProject{}, "id = ? AND user_id = ?", id, userID).Error
	})
}

func (r *Repository) Projects(userID string) ([]model.Project, error) {
	var projects []model.Project
	err := r.db.Where("user_id = ?", userID).Order("updated_at desc").Find(&projects).Error
	return projects, err
}

func (r *Repository) ProjectsPage(userID string, page int, pageSize int) ([]model.Project, int64, error) {
	var projects []model.Project
	var total int64
	query := r.db.Model(&model.Project{}).Where("user_id = ?", userID)
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Order("updated_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&projects).Error; err != nil {
		return nil, 0, err
	}
	return projects, total, nil
}

func (r *Repository) ProjectForUser(userID string, id string) (*model.Project, error) {
	var project model.Project
	if err := r.db.First(&project, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &project, nil
}

func (r *Repository) CreateProject(project *model.Project) error {
	return r.db.Create(project).Error
}

func (r *Repository) UpdateProject(project *model.Project) error {
	return r.db.Model(&model.Project{}).Where("id = ? AND user_id = ?", project.ID, project.UserID).Updates(map[string]any{
		"name": project.Name, "type": project.Type, "aspect_ratio": project.AspectRatio, "source_type": project.SourceType,
		"description": project.Description, "cover_resource_id": project.CoverResourceID,
		"style_preset_id": project.StylePresetID, "style_profile_json": project.StyleProfileJSON,
		"default_image_model": project.DefaultImageModel, "default_video_model": project.DefaultVideoModel,
		"status": project.Status, "revision": project.Revision, "updated_at": project.UpdatedAt,
	}).Error
}

func (r *Repository) DeleteProject(userID string, id string, canvasUpdates []model.CanvasProject) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var canvasIDs []string
		if err := tx.Model(&model.CanvasProject{}).
			Where("user_id = ? AND project_id = ?", userID, id).
			Pluck("id", &canvasIDs).Error; err != nil {
			return err
		}
		projectScopeIDs := append([]string{id}, canvasIDs...)
		var activeTaskCount int64
		if err := tx.Model(&model.Task{}).
			Where("user_id = ? AND project_id IN ? AND status IN ?", userID, projectScopeIDs, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}).
			Count(&activeTaskCount).Error; err != nil {
			return err
		}
		if activeTaskCount > 0 {
			return ErrProjectHasActiveTasks
		}
		if err := tx.Where("user_id = ? AND project_id = ?", userID, id).Delete(&model.CanvasShare{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.CanvasUnitLink{}).Error; err != nil {
			return err
		}
		for _, canvas := range canvasUpdates {
			result := tx.Model(&model.CanvasProject{}).
				Where("id = ? AND user_id = ? AND project_id = ?", canvas.ID, userID, id).
				Updates(map[string]any{"project_id": "", "payload_json": canvas.PayloadJSON, "updated_at": canvas.UpdatedAt})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return gorm.ErrRecordNotFound
			}
		}
		var remainingCanvasCount int64
		if err := tx.Model(&model.CanvasProject{}).Where("user_id = ? AND project_id = ?", userID, id).Count(&remainingCanvasCount).Error; err != nil {
			return err
		}
		if remainingCanvasCount != 0 {
			return fmt.Errorf("项目删除时仍有 %d 个画布关联未处理", remainingCanvasCount)
		}
		shotIDs := tx.Model(&model.Shot{}).Select("id").Where("project_id = ?", id)
		if err := tx.Where("project_id = ?", id).Delete(&model.ProductionTaskLink{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.ShotArtifact{}).Error; err != nil {
			return err
		}
		if err := tx.Where("shot_id IN (?)", shotIDs).Delete(&model.ShotRevision{}).Error; err != nil {
			return err
		}
		if err := tx.Where("shot_id IN (?)", shotIDs).Delete(&model.ShotAssetReference{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.Shot{}).Error; err != nil {
			return err
		}
		instanceIDs := tx.Model(&model.WorkflowInstance{}).Select("id").Where("project_id = ?", id)
		stepIDs := tx.Model(&model.WorkflowStepInstance{}).Select("id").Where("workflow_instance_id IN (?)", instanceIDs)
		if err := tx.Where("workflow_step_id IN (?)", stepIDs).Delete(&model.WorkflowStepTask{}).Error; err != nil {
			return err
		}
		if err := tx.Where("workflow_instance_id IN (?)", instanceIDs).Delete(&model.WorkflowStepInstance{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.WorkflowInstance{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.ProjectAssetLink{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.ProjectAssetFolder{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.ProjectAssetCandidate{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.ProjectUnit{}).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.Task{}).Where("user_id = ? AND project_id = ?", userID, id).Update("project_id", "").Error; err != nil {
			return err
		}
		if err := tx.Model(&model.Session{}).Where("user_id = ? AND project_id = ?", userID, id).Update("project_id", "").Error; err != nil {
			return err
		}
		return tx.Delete(&model.Project{}, "id = ? AND user_id = ?", id, userID).Error
	})
}

func (r *Repository) BumpProjectRevision(projectID string) error {
	return r.db.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
}

func (r *Repository) ProjectUnits(projectID string) ([]model.ProjectUnit, error) {
	var units []model.ProjectUnit
	err := r.db.Where("project_id = ?", projectID).Order("position asc, created_at asc").Find(&units).Error
	return units, err
}

func (r *Repository) ProjectUnitSummaries(projectID string) ([]model.ProjectUnit, error) {
	var units []model.ProjectUnit
	err := r.db.Select("id", "project_id", "kind", "title", "word_count", "status", "position", "created_at", "updated_at").Where("project_id = ?", projectID).Order("position asc, created_at asc").Find(&units).Error
	return units, err
}

func (r *Repository) ProjectAssetCount(projectID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.ProjectAssetLink{}).Where("project_id = ?", projectID).Count(&count).Error
	return count, err
}

func (r *Repository) CreateProjectUnit(unit *model.ProjectUnit) error {
	return r.db.Create(unit).Error
}

func (r *Repository) ImportProjectUnits(projectID string, units []model.ProjectUnit) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// 分批写入仍处于同一事务，避免两千章导入超过 SQLite/PostgreSQL 单语句参数上限。
		if err := tx.CreateInBatches(&units, 100).Error; err != nil {
			return err
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
	})
}

func (r *Repository) ReorderProjectUnits(projectID string, unitIDs []string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		for position, unitID := range unitIDs {
			result := tx.Model(&model.ProjectUnit{}).Where("id = ? AND project_id = ?", unitID, projectID).Updates(map[string]any{"position": position, "updated_at": now})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return gorm.ErrRecordNotFound
			}
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": now}).Error
	})
}

func (r *Repository) ProjectUnit(projectID string, id string) (*model.ProjectUnit, error) {
	var unit model.ProjectUnit
	if err := r.db.First(&unit, "id = ? AND project_id = ?", id, projectID).Error; err != nil {
		return nil, err
	}
	return &unit, nil
}

func (r *Repository) UpdateProjectUnit(unit *model.ProjectUnit, invalidateWorkflow bool) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.ProjectUnit{}).Where("id = ? AND project_id = ?", unit.ID, unit.ProjectID).Updates(map[string]any{
			"parent_id": unit.ParentID, "title": unit.Title, "source_text": unit.SourceText, "word_count": unit.WordCount, "status": unit.Status, "position": unit.Position, "updated_at": unit.UpdatedAt,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		if invalidateWorkflow {
			if err := tx.Model(&model.ShotArtifact{}).Where("project_id = ? AND unit_id = ? AND status NOT IN ?", unit.ProjectID, unit.ID, []string{"failed", "stale"}).Updates(map[string]any{"status": "stale", "selected": false, "updated_at": unit.UpdatedAt}).Error; err != nil {
				return err
			}
			if err := invalidateUnitWorkflowTx(tx, unit.ProjectID, unit.ID, "story", unit.UpdatedAt); err != nil {
				return err
			}
		}
		return tx.Model(&model.Project{}).Where("id = ?", unit.ProjectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": unit.UpdatedAt}).Error
	})
}

func (r *Repository) DeleteProjectUnit(projectID string, id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("project_id = ? AND unit_id = ?", projectID, id).Delete(&model.CanvasUnitLink{}).Error; err != nil {
			return err
		}
		shotIDs := tx.Model(&model.Shot{}).Select("id").Where("project_id = ? AND unit_id = ?", projectID, id)
		if err := tx.Where("project_id = ? AND unit_id = ?", projectID, id).Delete(&model.ProductionTaskLink{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND unit_id = ?", projectID, id).Delete(&model.ShotArtifact{}).Error; err != nil {
			return err
		}
		if err := tx.Where("shot_id IN (?)", shotIDs).Delete(&model.ShotRevision{}).Error; err != nil {
			return err
		}
		if err := tx.Where("shot_id IN (?)", shotIDs).Delete(&model.ShotAssetReference{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND unit_id = ?", projectID, id).Delete(&model.Shot{}).Error; err != nil {
			return err
		}
		instanceIDs := tx.Model(&model.WorkflowInstance{}).Select("id").Where("project_id = ? AND unit_id = ?", projectID, id)
		stepIDs := tx.Model(&model.WorkflowStepInstance{}).Select("id").Where("workflow_instance_id IN (?)", instanceIDs)
		if err := tx.Where("workflow_step_id IN (?)", stepIDs).Delete(&model.WorkflowStepTask{}).Error; err != nil {
			return err
		}
		if err := tx.Where("workflow_instance_id IN (?)", instanceIDs).Delete(&model.WorkflowStepInstance{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND unit_id = ?", projectID, id).Delete(&model.WorkflowInstance{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND unit_id = ?", projectID, id).Delete(&model.ProjectAssetCandidate{}).Error; err != nil {
			return err
		}
		result := tx.Delete(&model.ProjectUnit{}, "id = ? AND project_id = ?", id, projectID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
	})
}

func (r *Repository) CanvasUnitLink(projectID string, canvasID string, unitID string) (*model.CanvasUnitLink, error) {
	var link model.CanvasUnitLink
	if err := r.db.First(&link, "project_id = ? AND canvas_id = ? AND unit_id = ?", projectID, canvasID, unitID).Error; err != nil {
		return nil, err
	}
	return &link, nil
}

func (r *Repository) UpsertCanvasUnitLink(link *model.CanvasUnitLink) error {
	result := r.db.Model(&model.CanvasUnitLink{}).Where("project_id = ? AND canvas_id = ? AND unit_id = ?", link.ProjectID, link.CanvasID, link.UnitID).Updates(map[string]any{"role": link.Role})
	if result.Error != nil || result.RowsAffected > 0 {
		return result.Error
	}
	return r.db.Create(link).Error
}

func (r *Repository) ProjectCanvasSummaries(userID string, projectID string) ([]model.CanvasProject, error) {
	var canvases []model.CanvasProject
	err := r.db.Select("id", "user_id", "project_id", "title", "created_at", "updated_at").Where("user_id = ? AND project_id = ?", userID, projectID).Order("updated_at desc").Find(&canvases).Error
	return canvases, err
}

func (r *Repository) ProjectCanvasDocuments(userID string, projectID string) ([]model.CanvasProject, error) {
	var canvases []model.CanvasProject
	err := r.db.Select("id", "title", "payload_json").Where("user_id = ? AND project_id = ?", userID, projectID).Find(&canvases).Error
	return canvases, err
}

func (r *Repository) ProjectCanvasUnitLinks(projectID string) ([]model.CanvasUnitLink, error) {
	var links []model.CanvasUnitLink
	err := r.db.Where("project_id = ?", projectID).Order("created_at asc").Find(&links).Error
	return links, err
}

func (r *Repository) DeleteCanvasUnitLink(projectID string, canvasID string, unitID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Delete(&model.CanvasUnitLink{}, "project_id = ? AND canvas_id = ? AND unit_id = ?", projectID, canvasID, unitID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
	})
}

func (r *Repository) AssignCanvasToProject(userID string, canvasID string, projectID string) error {
	return r.db.Model(&model.CanvasProject{}).Where("id = ? AND user_id = ?", canvasID, userID).Update("project_id", projectID).Error
}

func (r *Repository) UnassignCanvasFromProject(userID string, projectID string, canvasID string, payloadJSON string, updatedAt time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("project_id = ? AND canvas_id = ?", projectID, canvasID).Delete(&model.CanvasUnitLink{}).Error; err != nil {
			return err
		}
		result := tx.Model(&model.CanvasProject{}).Where("id = ? AND user_id = ? AND project_id = ?", canvasID, userID, projectID).Updates(map[string]any{
			"project_id": "", "payload_json": payloadJSON, "updated_at": updatedAt,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": updatedAt}).Error
	})
}

func (r *Repository) ProjectAssets(userID string, projectID string) ([]model.Asset, error) {
	var assets []model.Asset
	err := r.db.Table("assets").Select("assets.*").Joins("JOIN project_asset_links ON project_asset_links.asset_id = assets.id").Where("assets.user_id = ? AND project_asset_links.project_id = ?", userID, projectID).Order("assets.updated_at desc").Scan(&assets).Error
	return assets, err
}

func (r *Repository) ProjectAssetLinks(projectID string) ([]model.ProjectAssetLink, error) {
	var links []model.ProjectAssetLink
	err := r.db.Where("project_id = ?", projectID).Order("folder_id asc, position asc, created_at asc").Find(&links).Error
	return links, err
}

func (r *Repository) ProjectAssetLink(projectID string, assetID string) (*model.ProjectAssetLink, error) {
	var link model.ProjectAssetLink
	if err := r.db.First(&link, "project_id = ? AND asset_id = ?", projectID, assetID).Error; err != nil {
		return nil, err
	}
	return &link, nil
}

func (r *Repository) NextProjectAssetPosition(projectID string, folderID string) (int, error) {
	var result struct{ Maximum int }
	err := r.db.Model(&model.ProjectAssetLink{}).
		Select("COALESCE(MAX(position), -1) AS maximum").
		Where("project_id = ? AND folder_id = ?", projectID, folderID).
		Scan(&result).Error
	return result.Maximum + 1, err
}

func (r *Repository) MoveProjectAsset(projectID string, assetID string, folderID string, position int) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.ProjectAssetLink{}).
			Where("project_id = ? AND asset_id = ?", projectID, assetID).
			Updates(map[string]any{"folder_id": folderID, "position": position})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
	})
}

func (r *Repository) ProjectAssetFolders(projectID string) ([]model.ProjectAssetFolder, error) {
	var folders []model.ProjectAssetFolder
	err := r.db.Where("project_id = ?", projectID).Order("parent_id asc, position asc, created_at asc").Find(&folders).Error
	return folders, err
}

func (r *Repository) ProjectAssetFolder(projectID string, folderID string) (*model.ProjectAssetFolder, error) {
	var folder model.ProjectAssetFolder
	if err := r.db.First(&folder, "id = ? AND project_id = ?", folderID, projectID).Error; err != nil {
		return nil, err
	}
	return &folder, nil
}

func (r *Repository) CreateProjectAssetFolder(folder *model.ProjectAssetFolder) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(folder).Error; err != nil {
			return err
		}
		return tx.Model(&model.Project{}).Where("id = ?", folder.ProjectID).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": folder.UpdatedAt}).Error
	})
}

func (r *Repository) UpdateProjectAssetFolder(folder *model.ProjectAssetFolder) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.ProjectAssetFolder{}).
			Where("id = ? AND project_id = ?", folder.ID, folder.ProjectID).
			Updates(map[string]any{"parent_id": folder.ParentID, "name": folder.Name, "name_key": folder.NameKey, "style": folder.Style, "theme": folder.Theme, "position": folder.Position, "updated_at": folder.UpdatedAt})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return tx.Model(&model.Project{}).Where("id = ?", folder.ProjectID).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": folder.UpdatedAt}).Error
	})
}

func (r *Repository) DeleteProjectAssetFolder(projectID string, folderID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var childCount int64
		if err := tx.Model(&model.ProjectAssetFolder{}).Where("project_id = ? AND parent_id = ?", projectID, folderID).Count(&childCount).Error; err != nil {
			return err
		}
		var assetCount int64
		if err := tx.Model(&model.ProjectAssetLink{}).Where("project_id = ? AND folder_id = ?", projectID, folderID).Count(&assetCount).Error; err != nil {
			return err
		}
		if childCount > 0 || assetCount > 0 {
			return ErrProjectAssetFolderNotEmpty
		}
		result := tx.Delete(&model.ProjectAssetFolder{}, "id = ? AND project_id = ?", folderID, projectID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
	})
}

// LinkProjectAsset 将首版本、素材领域字段、项目引用和修订号原子提交，避免产生半关联资产。
func (r *Repository) LinkProjectAsset(asset *model.Asset, version *model.AssetVersion, link *model.ProjectAssetLink) (bool, error) {
	createdLink := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		created := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "project_id"}, {Name: "asset_id"}}, DoNothing: true}).Create(link)
		if created.Error != nil {
			return created.Error
		}
		if created.RowsAffected == 0 {
			return nil
		}
		createdLink = true
		if version != nil {
			if err := tx.Create(version).Error; err != nil {
				return err
			}
		}
		result := tx.Model(&model.Asset{}).Where("id = ? AND user_id = ?", asset.ID, asset.UserID).Updates(map[string]any{
			"category": asset.Category, "status": asset.Status, "primary_version_id": asset.PrimaryVersionID, "updated_at": asset.UpdatedAt,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return tx.Model(&model.Project{}).Where("id = ?", link.ProjectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
	})
	return createdLink, err
}

func (r *Repository) DeleteProjectAssetLink(projectID string, assetID string) error {
	return r.db.Delete(&model.ProjectAssetLink{}, "project_id = ? AND asset_id = ?", projectID, assetID).Error
}

func (r *Repository) ProjectAssetShotReferenceCount(projectID string, assetID string) (int64, error) {
	var count int64
	err := r.db.Table("shot_asset_references").
		Joins("JOIN shots ON shots.id = shot_asset_references.shot_id").
		Joins("JOIN asset_versions ON asset_versions.id = shot_asset_references.asset_version_id").
		Where("shots.project_id = ? AND asset_versions.asset_id = ?", projectID, assetID).
		Count(&count).Error
	return count, err
}

func (r *Repository) ProjectAssetLinked(projectID string, assetID string) (bool, error) {
	var count int64
	err := r.db.Model(&model.ProjectAssetLink{}).Where("project_id = ? AND asset_id = ?", projectID, assetID).Count(&count).Error
	return count > 0, err
}

func (r *Repository) AssetReferenceCount(assetID string) (int64, error) {
	var projectLinks int64
	if err := r.db.Model(&model.ProjectAssetLink{}).Where("asset_id = ?", assetID).Count(&projectLinks).Error; err != nil {
		return 0, err
	}
	var shotLinks int64
	err := r.db.Table("shot_asset_references").Joins("JOIN asset_versions ON asset_versions.id = shot_asset_references.asset_version_id").Where("asset_versions.asset_id = ?", assetID).Count(&shotLinks).Error
	return projectLinks + shotLinks, err
}

func (r *Repository) UpdateAssetDomain(asset *model.Asset) error {
	return r.db.Model(&model.Asset{}).Where("id = ? AND user_id = ?", asset.ID, asset.UserID).Updates(map[string]any{"category": asset.Category, "status": asset.Status, "primary_version_id": asset.PrimaryVersionID, "updated_at": asset.UpdatedAt}).Error
}

func (r *Repository) AssetVersions(assetID string) ([]model.AssetVersion, error) {
	var versions []model.AssetVersion
	err := r.db.Where("asset_id = ?", assetID).Order("version desc").Find(&versions).Error
	return versions, err
}

func (r *Repository) ProjectAssetUsageRoles(projectID string, assetID string) ([]string, error) {
	var shotRoles []string
	if err := r.db.Table("shot_asset_references").
		Distinct("shot_asset_references.role").
		Joins("JOIN shots ON shots.id = shot_asset_references.shot_id").
		Joins("JOIN asset_versions ON asset_versions.id = shot_asset_references.asset_version_id").
		Where("shots.project_id = ? AND asset_versions.asset_id = ?", projectID, assetID).
		Order("shot_asset_references.role asc").
		Pluck("shot_asset_references.role", &shotRoles).Error; err != nil {
		return nil, err
	}
	var representationRoles []string
	if err := r.db.Table("asset_representations").
		Distinct("asset_representations.role").
		Joins("JOIN asset_versions ON asset_versions.id = asset_representations.asset_version_id").
		Joins("JOIN project_asset_links ON project_asset_links.asset_id = asset_versions.asset_id").
		Where("project_asset_links.project_id = ? AND asset_versions.asset_id = ?", projectID, assetID).
		Pluck("asset_representations.role", &representationRoles).Error; err != nil {
		return nil, err
	}
	seen := make(map[string]struct{}, len(shotRoles)+len(representationRoles))
	for _, role := range append(shotRoles, representationRoles...) {
		if role != "" {
			seen[role] = struct{}{}
		}
	}
	roles := make([]string, 0, len(seen))
	for role := range seen {
		roles = append(roles, role)
	}
	sort.Strings(roles)
	return roles, nil
}

func (r *Repository) AssetVersionForProject(projectID string, versionID string) (*model.AssetVersion, error) {
	var version model.AssetVersion
	err := r.db.Table("asset_versions").Select("asset_versions.*").Joins("JOIN project_asset_links ON project_asset_links.asset_id = asset_versions.asset_id").Where("project_asset_links.project_id = ? AND asset_versions.id = ?", projectID, versionID).First(&version).Error
	if err != nil {
		return nil, err
	}
	return &version, nil
}

func (r *Repository) CreateAssetVersion(version *model.AssetVersion) error {
	return r.db.Create(version).Error
}

func (r *Repository) ProjectShots(projectID string) ([]model.Shot, error) {
	var shots []model.Shot
	err := r.db.Where("project_id = ?", projectID).Order("unit_id asc, position asc").Find(&shots).Error
	return shots, err
}

func (r *Repository) SaveShot(shot *model.Shot, create bool) error {
	if create {
		return r.db.Create(shot).Error
	}
	return r.db.Model(&model.Shot{}).Where("id = ? AND project_id = ?", shot.ID, shot.ProjectID).Updates(map[string]any{
		"unit_id": shot.UnitID, "title": shot.Title, "description": shot.Description, "position": shot.Position,
		"duration_ms": shot.DurationMs, "status": shot.Status, "updated_at": shot.UpdatedAt,
	}).Error
}

// SaveShotWithRevision 原子保存镜头当前值、新版本和下游失效状态。
func (r *Repository) SaveShotWithRevision(shot *model.Shot, revision *model.ShotRevision, create bool) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if create {
			if err := tx.Create(shot).Error; err != nil {
				return err
			}
		} else {
			result := tx.Model(&model.Shot{}).Where("id = ? AND project_id = ?", shot.ID, shot.ProjectID).Updates(map[string]any{
				"unit_id": shot.UnitID, "title": shot.Title, "description": shot.Description, "position": shot.Position,
				"duration_ms": shot.DurationMs, "status": shot.Status, "updated_at": shot.UpdatedAt,
			})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return gorm.ErrRecordNotFound
			}
		}
		var currentVersion int
		if err := tx.Model(&model.ShotRevision{}).Where("shot_id = ?", shot.ID).Select("COALESCE(MAX(version), 0)").Scan(&currentVersion).Error; err != nil {
			return err
		}
		revision.Version = currentVersion + 1
		if err := tx.Create(revision).Error; err != nil {
			return err
		}
		shot.CurrentRevisionID = revision.ID
		if err := tx.Model(&model.Shot{}).Where("id = ? AND project_id = ?", shot.ID, shot.ProjectID).Updates(map[string]any{
			"current_revision_id": revision.ID, "description": shot.Description, "duration_ms": shot.DurationMs,
			"status": shot.Status, "updated_at": shot.UpdatedAt,
		}).Error; err != nil {
			return err
		}
		if !create {
			if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND status NOT IN ?", shot.ID, []string{"failed", "stale"}).Updates(map[string]any{"status": "stale", "selected": false, "updated_at": shot.UpdatedAt}).Error; err != nil {
				return err
			}
		}
		if err := invalidateUnitWorkflowTx(tx, shot.ProjectID, shot.UnitID, "storyboard", shot.UpdatedAt); err != nil {
			return err
		}
		return tx.Model(&model.Project{}).Where("id = ?", shot.ProjectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": shot.UpdatedAt}).Error
	})
}

func (r *Repository) ReplaceProjectUnitShots(projectID string, unitID string, shots []model.Shot, revisions []model.ShotRevision, references []model.ShotAssetReference, expectedShotIDs []string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if expectedShotIDs != nil {
			var currentShotIDs []string
			if err := tx.Model(&model.Shot{}).Where("project_id = ? AND unit_id = ?", projectID, unitID).Order("id asc").Pluck("id", &currentShotIDs).Error; err != nil {
				return err
			}
			expected := append([]string(nil), expectedShotIDs...)
			sort.Strings(expected)
			if !slices.Equal(currentShotIDs, expected) {
				return ErrProjectUnitShotsChanged
			}
		}
		shotIDs := tx.Model(&model.Shot{}).Select("id").Where("project_id = ? AND unit_id = ?", projectID, unitID)
		if err := tx.Where("project_id = ? AND unit_id = ?", projectID, unitID).Delete(&model.ShotArtifact{}).Error; err != nil {
			return err
		}
		if err := tx.Where("shot_id IN (?)", shotIDs).Delete(&model.ShotRevision{}).Error; err != nil {
			return err
		}
		if err := tx.Where("shot_id IN (?)", shotIDs).Delete(&model.ShotAssetReference{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND shot_id IN (?)", projectID, shotIDs).Delete(&model.ProjectAssetCandidate{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND unit_id = ?", projectID, unitID).Delete(&model.Shot{}).Error; err != nil {
			return err
		}
		if err := tx.Create(&shots).Error; err != nil {
			return err
		}
		if len(revisions) > 0 {
			if err := tx.Create(&revisions).Error; err != nil {
				return err
			}
		}
		if len(references) > 0 {
			if err := tx.Create(&references).Error; err != nil {
				return err
			}
		}
		if err := invalidateUnitWorkflowTx(tx, projectID, unitID, "storyboard", time.Now()); err != nil {
			return err
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
	})
}

func (r *Repository) ShotForProject(projectID string, shotID string) (*model.Shot, error) {
	var shot model.Shot
	if err := r.db.First(&shot, "id = ? AND project_id = ?", shotID, projectID).Error; err != nil {
		return nil, err
	}
	return &shot, nil
}

func (r *Repository) ShotRevisionForShot(shotID string, revisionID string) (*model.ShotRevision, error) {
	var revision model.ShotRevision
	if err := r.db.First(&revision, "id = ? AND shot_id = ?", revisionID, shotID).Error; err != nil {
		return nil, err
	}
	return &revision, nil
}

// DeleteProjectShot 原子删除单个镜头的领域关联，并重新压紧同章节镜头顺序。
func (r *Repository) DeleteProjectShot(projectID string, shotID string, updatedAt time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var shot model.Shot
		if err := tx.First(&shot, "id = ? AND project_id = ?", shotID, projectID).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND shot_id = ?", projectID, shotID).Delete(&model.ProductionTaskLink{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND shot_id = ?", projectID, shotID).Delete(&model.ShotArtifact{}).Error; err != nil {
			return err
		}
		if err := tx.Where("shot_id = ?", shotID).Delete(&model.ShotRevision{}).Error; err != nil {
			return err
		}
		if err := tx.Where("shot_id = ?", shotID).Delete(&model.ShotAssetReference{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND shot_id = ?", projectID, shotID).Delete(&model.ProjectAssetCandidate{}).Error; err != nil {
			return err
		}
		result := tx.Where("id = ? AND project_id = ?", shotID, projectID).Delete(&model.Shot{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		var remaining []model.Shot
		if err := tx.Select("id", "position").Where("project_id = ? AND unit_id = ?", projectID, shot.UnitID).Order("position asc, created_at asc, id asc").Find(&remaining).Error; err != nil {
			return err
		}
		for position, item := range remaining {
			if item.Position == position {
				continue
			}
			if err := tx.Model(&model.Shot{}).Where("id = ? AND project_id = ?", item.ID, projectID).Update("position", position).Error; err != nil {
				return err
			}
		}
		if err := invalidateUnitWorkflowTx(tx, projectID, shot.UnitID, "storyboard", updatedAt); err != nil {
			return err
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": updatedAt}).Error
	})
}

func (r *Repository) ProjectShotRevisions(projectID string) ([]model.ShotRevision, error) {
	var revisions []model.ShotRevision
	err := r.db.Table("shot_revisions").Select("shot_revisions.*").
		Joins("JOIN shots ON shots.id = shot_revisions.shot_id").
		Where("shots.project_id = ?", projectID).
		Order("shots.unit_id asc, shots.position asc, shot_revisions.version asc").Scan(&revisions).Error
	return revisions, err
}

func (r *Repository) ProjectShotArtifacts(projectID string) ([]model.ShotArtifact, error) {
	var artifacts []model.ShotArtifact
	err := r.db.Where("project_id = ?", projectID).Order("unit_id asc, shot_id asc, type asc, version asc").Find(&artifacts).Error
	return artifacts, err
}

func (r *Repository) CreateShotArtifact(artifact *model.ShotArtifact) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var currentVersion int
		if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND type = ?", artifact.ShotID, artifact.Type).Select("COALESCE(MAX(version), 0)").Scan(&currentVersion).Error; err != nil {
			return err
		}
		artifact.Version = currentVersion + 1
		if artifact.Selected {
			if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND type = ?", artifact.ShotID, artifact.Type).Updates(map[string]any{"selected": false, "updated_at": artifact.UpdatedAt}).Error; err != nil {
				return err
			}
		}
		return tx.Create(artifact).Error
	})
}

func (r *Repository) MarkShotArtifactsStale(shotID string, updatedAt time.Time) error {
	return r.db.Model(&model.ShotArtifact{}).Where("shot_id = ? AND status NOT IN ?", shotID, []string{"failed", "stale"}).Updates(map[string]any{"status": "stale", "selected": false, "updated_at": updatedAt}).Error
}

func (r *Repository) UpsertProductionTaskLink(link *model.ProductionTaskLink) error {
	return r.db.Where("task_id = ? AND shot_id = ? AND artifact_type = ?", link.TaskID, link.ShotID, link.ArtifactType).Assign(map[string]any{
		"project_id": link.ProjectID, "canvas_id": link.CanvasID, "unit_id": link.UnitID, "shot_id": link.ShotID,
		"workflow_step_id": link.WorkflowStepID, "artifact_type": link.ArtifactType, "updated_at": link.UpdatedAt,
	}).FirstOrCreate(link).Error
}

func (r *Repository) UpsertShotAssetReference(reference *model.ShotAssetReference) error {
	result := r.db.Model(&model.ShotAssetReference{}).Where("shot_id = ? AND asset_version_id = ? AND role = ?", reference.ShotID, reference.AssetVersionID, reference.Role).Updates(map[string]any{"status": reference.Status})
	if result.Error != nil || result.RowsAffected > 0 {
		return result.Error
	}
	return r.db.Create(reference).Error
}

func (r *Repository) UpsertShotAssetReferenceAndInvalidate(projectID string, reference *model.ShotAssetReference, updatedAt time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.ShotAssetReference{}).Where("shot_id = ? AND asset_version_id = ? AND role = ?", reference.ShotID, reference.AssetVersionID, reference.Role).Updates(map[string]any{"status": reference.Status})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			if err := tx.Create(reference).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND status NOT IN ?", reference.ShotID, []string{"failed", "stale"}).Updates(map[string]any{"status": "stale", "selected": false, "updated_at": updatedAt}).Error; err != nil {
			return err
		}
		var shot model.Shot
		if err := tx.First(&shot, "id = ? AND project_id = ?", reference.ShotID, projectID).Error; err != nil {
			return err
		}
		if err := invalidateUnitWorkflowTx(tx, projectID, shot.UnitID, "storyboard", updatedAt); err != nil {
			return err
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": updatedAt}).Error
	})
}

func (r *Repository) DeleteShotAssetReferenceAndInvalidate(projectID string, shotID string, referenceID string, updatedAt time.Time) (bool, error) {
	deleted := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Where("id = ? AND shot_id = ?", referenceID, shotID).Delete(&model.ShotAssetReference{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		deleted = true
		if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND status NOT IN ?", shotID, []string{"failed", "stale"}).Updates(map[string]any{"status": "stale", "selected": false, "updated_at": updatedAt}).Error; err != nil {
			return err
		}
		var shot model.Shot
		if err := tx.First(&shot, "id = ? AND project_id = ?", shotID, projectID).Error; err != nil {
			return err
		}
		if err := invalidateUnitWorkflowTx(tx, projectID, shot.UnitID, "storyboard", updatedAt); err != nil {
			return err
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": updatedAt}).Error
	})
	return deleted, err
}

func invalidateUnitWorkflowTx(tx *gorm.DB, projectID string, unitID string, fromStepKey string, updatedAt time.Time) error {
	if strings.TrimSpace(unitID) == "" {
		return nil
	}
	var instances []model.WorkflowInstance
	if err := tx.Where("project_id = ? AND unit_id = ?", projectID, unitID).Find(&instances).Error; err != nil {
		return err
	}
	for _, instance := range instances {
		var steps []model.WorkflowStepInstance
		if err := tx.Where("workflow_instance_id = ?", instance.ID).Order("position asc").Find(&steps).Error; err != nil {
			return err
		}
		fromPosition := -1
		for _, step := range steps {
			if step.StepKey == fromStepKey {
				fromPosition = step.Position
				break
			}
		}
		if fromPosition < 0 {
			continue
		}
		for _, step := range steps {
			if step.Position < fromPosition {
				continue
			}
			status := model.WorkflowStepStatusPending
			if step.Position == fromPosition {
				status = model.WorkflowStepStatusRunning
			}
			if err := tx.Model(&model.WorkflowStepInstance{}).Where("id = ? AND workflow_instance_id = ?", step.ID, instance.ID).Updates(map[string]any{
				"status": status, "error": "", "completed_at": nil, "updated_at": updatedAt,
			}).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&model.WorkflowInstance{}).Where("id = ?", instance.ID).Updates(map[string]any{"status": model.WorkflowStatusActive, "revision": gorm.Expr("revision + 1"), "updated_at": updatedAt}).Error; err != nil {
			return err
		}
	}
	return nil
}

func (r *Repository) ProjectShotAssetReferences(projectID string) ([]model.ShotAssetReference, error) {
	var references []model.ShotAssetReference
	err := r.db.Table("shot_asset_references").Select("shot_asset_references.*").
		Joins("JOIN shots ON shots.id = shot_asset_references.shot_id").
		Where("shots.project_id = ?", projectID).
		Order("shot_asset_references.created_at asc").Scan(&references).Error
	return references, err
}

func (r *Repository) ProjectAssetCandidates(projectID string) ([]model.ProjectAssetCandidate, error) {
	var candidates []model.ProjectAssetCandidate
	err := r.db.Where("project_id = ?", projectID).Order("created_at asc").Find(&candidates).Error
	return candidates, err
}

func (r *Repository) ProjectAssetCandidate(projectID string, candidateID string) (*model.ProjectAssetCandidate, error) {
	var candidate model.ProjectAssetCandidate
	if err := r.db.First(&candidate, "id = ? AND project_id = ?", candidateID, projectID).Error; err != nil {
		return nil, err
	}
	return &candidate, nil
}

func (r *Repository) CreateProjectAssetCandidates(candidates []model.ProjectAssetCandidate) error {
	if len(candidates) == 0 {
		return nil
	}
	return r.db.Create(&candidates).Error
}

// ConfirmProjectAssetCandidate 将正式资产身份、首版本、项目引用和候选状态放在同一事务中，避免出现半确认数据。
func (r *Repository) ConfirmProjectAssetCandidate(candidate *model.ProjectAssetCandidate, asset *model.Asset, version *model.AssetVersion, link *model.ProjectAssetLink, createAsset bool) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if createAsset {
			if err := tx.Create(asset).Error; err != nil {
				return err
			}
			if err := tx.Create(version).Error; err != nil {
				return err
			}
		} else if err := tx.First(&model.Asset{}, "id = ? AND user_id = ?", asset.ID, asset.UserID).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND asset_id = ?", link.ProjectID, link.AssetID).FirstOrCreate(link).Error; err != nil {
			return err
		}
		result := tx.Model(&model.ProjectAssetCandidate{}).
			Where("id = ? AND project_id = ? AND status = ?", candidate.ID, candidate.ProjectID, "pending_confirmation").
			Updates(map[string]any{"status": candidate.Status, "resolved_asset_id": candidate.ResolvedAssetID, "updated_at": candidate.UpdatedAt})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrInvalidData
		}
		return tx.Model(&model.Project{}).Where("id = ?", candidate.ProjectID).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": candidate.UpdatedAt}).Error
	})
}

func (r *Repository) WorkflowTemplateVersion(templateKey string, version int) (*model.WorkflowTemplateVersion, error) {
	var template model.WorkflowTemplateVersion
	if err := r.db.First(&template, "template_key = ? AND version = ?", templateKey, version).Error; err != nil {
		return nil, err
	}
	return &template, nil
}

func (r *Repository) CreateWorkflowTemplateVersion(template *model.WorkflowTemplateVersion) error {
	return r.db.Create(template).Error
}

func (r *Repository) ProjectWorkflowInstances(projectID string) ([]model.WorkflowInstance, error) {
	var instances []model.WorkflowInstance
	err := r.db.Where("project_id = ?", projectID).Order("created_at asc").Find(&instances).Error
	return instances, err
}

func (r *Repository) WorkflowInstanceForScope(projectID string, unitID string, templateVersionID string) (*model.WorkflowInstance, error) {
	var instance model.WorkflowInstance
	if err := r.db.First(&instance, "project_id = ? AND unit_id = ? AND template_version_id = ?", projectID, unitID, templateVersionID).Error; err != nil {
		return nil, err
	}
	return &instance, nil
}

func (r *Repository) WorkflowInstance(id string) (*model.WorkflowInstance, error) {
	var instance model.WorkflowInstance
	if err := r.db.First(&instance, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &instance, nil
}

func (r *Repository) WorkflowSteps(instanceID string) ([]model.WorkflowStepInstance, error) {
	var steps []model.WorkflowStepInstance
	err := r.db.Where("workflow_instance_id = ?", instanceID).Order("position asc").Find(&steps).Error
	return steps, err
}

func (r *Repository) NextWorkflowStep(instanceID string, position int) (*model.WorkflowStepInstance, error) {
	var step model.WorkflowStepInstance
	if err := r.db.Where("workflow_instance_id = ? AND position > ?", instanceID, position).Order("position asc").First(&step).Error; err != nil {
		return nil, err
	}
	return &step, nil
}

func (r *Repository) CreateWorkflowInstance(instance *model.WorkflowInstance, steps []model.WorkflowStepInstance) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(instance).Error; err != nil {
			return err
		}
		if len(steps) == 0 {
			return nil
		}
		return tx.Create(&steps).Error
	})
}

func (r *Repository) WorkflowStepForProject(projectID string, stepID string) (*model.WorkflowStepInstance, error) {
	var step model.WorkflowStepInstance
	err := r.db.Table("workflow_step_instances").Select("workflow_step_instances.*").Joins("JOIN workflow_instances ON workflow_instances.id = workflow_step_instances.workflow_instance_id").Where("workflow_instances.project_id = ? AND workflow_step_instances.id = ?", projectID, stepID).First(&step).Error
	if err != nil {
		return nil, err
	}
	return &step, nil
}

func (r *Repository) UpdateWorkflowStep(step *model.WorkflowStepInstance) error {
	return r.db.Model(&model.WorkflowStepInstance{}).Where("id = ? AND workflow_instance_id = ?", step.ID, step.WorkflowInstanceID).Updates(map[string]any{"status": step.Status, "output_json": step.OutputJSON, "error": step.Error, "started_at": step.StartedAt, "completed_at": step.CompletedAt, "updated_at": step.UpdatedAt}).Error
}

// UpdateWorkflowProgress 原子保存当前步骤、下一步骤和实例状态，确保刷新后流程依赖仍可恢复。
func (r *Repository) UpdateWorkflowProgress(step *model.WorkflowStepInstance, next *model.WorkflowStepInstance, instance *model.WorkflowInstance, projectID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.WorkflowStepInstance{}).Where("id = ? AND workflow_instance_id = ?", step.ID, step.WorkflowInstanceID).Updates(map[string]any{
			"status": step.Status, "output_json": step.OutputJSON, "error": step.Error, "started_at": step.StartedAt,
			"completed_at": step.CompletedAt, "updated_at": step.UpdatedAt,
		}).Error; err != nil {
			return err
		}
		if next != nil {
			if err := tx.Model(&model.WorkflowStepInstance{}).Where("id = ? AND workflow_instance_id = ?", next.ID, next.WorkflowInstanceID).
				Updates(map[string]any{"status": next.Status, "updated_at": next.UpdatedAt}).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&model.WorkflowInstance{}).Where("id = ? AND project_id = ?", instance.ID, projectID).
			Updates(map[string]any{"status": instance.Status, "revision": instance.Revision, "updated_at": instance.UpdatedAt}).Error; err != nil {
			return err
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": step.UpdatedAt}).Error
	})
}

// RegisterWorkflowTaskOutput 将成功任务、流程步骤和产物表示写入同一事务，重复回填使用任务与用途唯一键幂等。
func (r *Repository) RegisterWorkflowTaskOutput(step *model.WorkflowStepInstance, next *model.WorkflowStepInstance, instance *model.WorkflowInstance, projectID string, link *model.WorkflowStepTask, representation *model.AssetRepresentation, productionLink *model.ProductionTaskLink, artifact *model.ShotArtifact) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var existingLink model.WorkflowStepTask
		if err := tx.Where("workflow_step_id = ? AND task_id = ?", link.WorkflowStepID, link.TaskID).First(&existingLink).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			if err := tx.Create(link).Error; err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		if representation != nil {
			var existingRepresentation model.AssetRepresentation
			if err := tx.Where("task_id = ? AND role = ?", representation.TaskID, representation.Role).First(&existingRepresentation).Error; errors.Is(err, gorm.ErrRecordNotFound) {
				if err := tx.Create(representation).Error; err != nil {
					return err
				}
			} else if err != nil {
				return err
			}
		}
		if productionLink != nil {
			var existingProductionLink model.ProductionTaskLink
			err := tx.Where("task_id = ? AND shot_id = ? AND artifact_type = ?", productionLink.TaskID, productionLink.ShotID, productionLink.ArtifactType).First(&existingProductionLink).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				if err := tx.Create(productionLink).Error; err != nil {
					return err
				}
			} else if err != nil {
				return err
			} else if err := tx.Model(&existingProductionLink).Updates(map[string]any{
				"project_id": productionLink.ProjectID, "canvas_id": productionLink.CanvasID, "unit_id": productionLink.UnitID,
				"workflow_step_id": productionLink.WorkflowStepID, "updated_at": productionLink.UpdatedAt,
			}).Error; err != nil {
				return err
			}
		}
		if artifact != nil {
			var existing model.ShotArtifact
			if err := tx.Where("task_id = ? AND shot_id = ? AND type = ?", artifact.TaskID, artifact.ShotID, artifact.Type).First(&existing).Error; err == nil {
				artifact = nil
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
		if artifact != nil {
			var currentVersion int
			if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND type = ?", artifact.ShotID, artifact.Type).Select("COALESCE(MAX(version), 0)").Scan(&currentVersion).Error; err != nil {
				return err
			}
			artifact.Version = currentVersion + 1
			if artifact.Selected {
				if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND type = ?", artifact.ShotID, artifact.Type).Updates(map[string]any{"selected": false, "updated_at": artifact.UpdatedAt}).Error; err != nil {
					return err
				}
			}
			if err := tx.Create(artifact).Error; err != nil {
				return err
			}
		}
		stepResult := tx.Model(&model.WorkflowStepInstance{}).Where("id = ? AND workflow_instance_id = ?", step.ID, step.WorkflowInstanceID).Updates(map[string]any{
			"status": step.Status, "output_json": step.OutputJSON, "error": step.Error, "started_at": step.StartedAt,
			"completed_at": step.CompletedAt, "updated_at": step.UpdatedAt,
		})
		if stepResult.Error != nil {
			return stepResult.Error
		}
		if stepResult.RowsAffected != 1 {
			return gorm.ErrInvalidData
		}
		if next != nil {
			nextResult := tx.Model(&model.WorkflowStepInstance{}).Where("id = ? AND workflow_instance_id = ?", next.ID, next.WorkflowInstanceID).Updates(map[string]any{"status": next.Status, "updated_at": next.UpdatedAt})
			if nextResult.Error != nil {
				return nextResult.Error
			}
			if nextResult.RowsAffected != 1 {
				return gorm.ErrInvalidData
			}
		}
		instanceResult := tx.Model(&model.WorkflowInstance{}).Where("id = ? AND project_id = ?", instance.ID, projectID).Updates(map[string]any{"status": instance.Status, "revision": instance.Revision, "updated_at": instance.UpdatedAt})
		if instanceResult.Error != nil {
			return instanceResult.Error
		}
		if instanceResult.RowsAffected != 1 {
			return gorm.ErrInvalidData
		}
		projectResult := tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": step.UpdatedAt})
		if projectResult.Error != nil {
			return projectResult.Error
		}
		if projectResult.RowsAffected != 1 {
			return gorm.ErrInvalidData
		}
		return nil
	})
}

func (r *Repository) CanvasShareForProject(userID string, projectID string) (*model.CanvasShare, error) {
	var share model.CanvasShare
	if err := r.db.First(&share, "user_id = ? AND project_id = ?", userID, projectID).Error; err != nil {
		return nil, err
	}
	return &share, nil
}

func (r *Repository) CanvasShareByTokenHash(tokenHash string) (*model.CanvasShare, error) {
	var share model.CanvasShare
	if err := r.db.First(&share, "token_hash = ? AND enabled = ?", tokenHash, true).Error; err != nil {
		return nil, err
	}
	return &share, nil
}

func (r *Repository) DeleteCanvasShare(userID string, projectID string) error {
	return r.db.Delete(&model.CanvasShare{}, "user_id = ? AND project_id = ?", userID, projectID).Error
}

func (r *Repository) ReplaceCanvasProjects(userID string, projects []model.CanvasProject) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&model.CanvasProject{}, "user_id = ?", userID).Error; err != nil {
			return err
		}
		if len(projects) == 0 {
			return nil
		}
		return tx.Create(&projects).Error
	})
}

func (r *Repository) PromptTemplates() ([]model.PromptTemplate, error) {
	var templates []model.PromptTemplate
	err := r.db.Order("operation asc, version desc").Find(&templates).Error
	return templates, err
}

func (r *Repository) PromptTemplate(id string) (*model.PromptTemplate, error) {
	var template model.PromptTemplate
	if err := r.db.First(&template, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &template, nil
}

func (r *Repository) ActivePromptTemplate(operation string) (*model.PromptTemplate, error) {
	var template model.PromptTemplate
	if err := r.db.Order("version desc").First(&template, "operation = ? AND enabled = ?", operation, true).Error; err != nil {
		return nil, err
	}
	return &template, nil
}

func (r *Repository) PromptTemplateCount(operation string) (int64, error) {
	var count int64
	err := r.db.Model(&model.PromptTemplate{}).Where("operation = ?", operation).Count(&count).Error
	return count, err
}

func (r *Repository) NextPromptTemplateVersion(operation string) (int, error) {
	var version int
	err := r.db.Model(&model.PromptTemplate{}).Where("operation = ?", operation).Select("COALESCE(MAX(version), 0)").Scan(&version).Error
	return version + 1, err
}

func (r *Repository) SavePromptTemplate(template *model.PromptTemplate) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if template.Enabled {
			if err := tx.Model(&model.PromptTemplate{}).Where("operation = ? AND id <> ?", template.Operation, template.ID).Update("enabled", false).Error; err != nil {
				return err
			}
		}
		return tx.Save(template).Error
	})
}

func (r *Repository) DeletePromptTemplate(id string) error {
	return r.db.Delete(&model.PromptTemplate{}, "id = ?", id).Error
}

func (r *Repository) UserPromptCustomizations(userID string) ([]model.UserPromptCustomization, error) {
	var customizations []model.UserPromptCustomization
	err := r.db.Where("user_id = ?", userID).Order("operation asc").Find(&customizations).Error
	return customizations, err
}

func (r *Repository) UserPromptCustomization(userID string, operation string) (*model.UserPromptCustomization, error) {
	var customization model.UserPromptCustomization
	if err := r.db.First(&customization, "user_id = ? AND operation = ?", userID, operation).Error; err != nil {
		return nil, err
	}
	return &customization, nil
}

func (r *Repository) SaveUserPromptCustomization(customization *model.UserPromptCustomization) error {
	return r.db.Save(customization).Error
}

func (r *Repository) DeleteUserPromptCustomization(userID string, operation string) error {
	return r.db.Delete(&model.UserPromptCustomization{}, "user_id = ? AND operation = ?", userID, operation).Error
}
