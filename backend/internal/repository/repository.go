package repository

import (
	"errors"
	"sort"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrDailyUploadLimitExceeded = errors.New("daily upload limit exceeded")

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
			(SELECT COALESCE(SUM(length(CAST(COALESCE(prompt, '') AS BLOB)) + length(CAST(COALESCE(input_json, '') AS BLOB)) + length(CAST(COALESCE(result_json, '') AS BLOB)) + length(CAST(COALESCE(error, '') AS BLOB))), 0) FROM tasks WHERE user_id = ?)
			+ (SELECT COALESCE(SUM(length(CAST(COALESCE(message, '') AS BLOB)) + length(CAST(COALESCE(payload, '') AS BLOB))), 0) FROM task_logs WHERE user_id = ?)
			+ (SELECT COALESCE(SUM(length(CAST(COALESCE(url, '') AS BLOB)) + length(CAST(COALESCE(payload, '') AS BLOB))), 0) FROM results WHERE user_id = ?)
			+ (SELECT COALESCE(SUM(length(CAST(COALESCE(path, '') AS BLOB)) + length(CAST(COALESCE(model, '') AS BLOB)) + length(CAST(COALESCE(provider_request_id, '') AS BLOB)) + length(CAST(COALESCE(error_code, '') AS BLOB)) + length(CAST(COALESCE(error, '') AS BLOB)) + length(CAST(COALESCE(upstream_url, '') AS BLOB))), 0) FROM api_call_logs WHERE user_id = ?) AS task_bytes,
			(SELECT COUNT(*) FROM api_call_logs WHERE user_id = ?) AS api_call_count
	`
	if r.Dialect() == "postgres" {
		query = strings.ReplaceAll(query, "length(CAST(COALESCE(", "octet_length(COALESCE(")
		query = strings.ReplaceAll(query, ", '') AS BLOB))", ", ''))")
	}
	err := r.db.Raw(query, userID, userID, userID, userID, userID, userID, userID, userID, userID, userID, userID, userID, userID).Scan(&usage).Error
	return usage, err
}

func (r *Repository) Create(value any) error {
	return r.db.Create(value).Error
}

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

// 任务领取以数据库租约为真相；PostgreSQL 锁行跳过竞争任务，SQLite 继续依赖条件更新保证单实例原子性。
func (r *Repository) ClaimNextTask(owner string, leaseDuration time.Duration) (*model.Task, error) {
	var task model.Task
	now := time.Now()
	leaseExpiresAt := now.Add(leaseDuration)
	err := r.db.Transaction(func(tx *gorm.DB) error {
		query := tx.Where("status = ? OR (status = ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?))", model.TaskStatusQueued, model.TaskStatusRunning, now).
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
			claim = claim.Where("status = ? OR (status = ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?))", model.TaskStatusQueued, model.TaskStatusRunning, now)
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

func (r *Repository) UpdateTaskProgress(id string, stage string, progress int) error {
	return r.db.Model(&model.Task{}).Where("id = ?", id).Updates(map[string]any{
		"stage": stage, "progress": progress, "updated_at": time.Now(),
	}).Error
}

func (r *Repository) SaveTaskCompletion(task *model.Task, session *model.Session, message *model.Message, results []model.Result) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(task).Error; err != nil {
			return err
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

func (r *Repository) CancelTaskIfStatus(userID string, id string, expected model.TaskStatus, now time.Time) (bool, error) {
	result := r.db.Model(&model.Task{}).
		Where("id = ? AND user_id = ? AND status = ?", id, userID, expected).
		Updates(map[string]any{
			"status": model.TaskStatusCancelled, "stage": "任务已取消", "completed_at": &now, "updated_at": now,
		})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) Tasks(userID string, limit int, projectID string, activeOnly bool) ([]model.Task, error) {
	var tasks []model.Task
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := r.db.Select("id", "session_id", "project_id", "type", "status", "stage", "progress", "prompt", "operation", "provider", "model", "billing_order_id", "attempts", "started_at", "completed_at", "created_at", "updated_at").
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

func (r *Repository) AdminSystemChannels(keyword string, interfaceType string, status string, limit int, offset int) ([]model.ModelChannel, int64, error) {
	var channels []model.ModelChannel
	var total int64
	query := r.db.Model(&model.ModelChannel{}).Where("scope = ?", model.ChannelScopeSystem)
	if value := strings.TrimSpace(keyword); value != "" {
		pattern := "%" + strings.ToLower(value) + "%"
		query = query.Where("lower(name) LIKE ? OR lower(base_url) LIKE ?", pattern, pattern)
	}
	if value := strings.TrimSpace(interfaceType); value != "" && value != "all" {
		query = query.Where("interface_type = ?", value)
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
	err := r.db.Select("id", "name").Where("scope = ?", model.ChannelScopeSystem).Order("created_at asc").Find(&channels).Error
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

func (r *Repository) ApiCallLogs(userID string, admin bool, limit int) ([]model.ApiCallLog, error) {
	var logs []model.ApiCallLog
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	query := r.db.Order("created_at desc").Limit(limit)
	if !admin {
		query = query.Where("user_id = ?", userID)
	}
	err := query.Find(&logs).Error
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
	return r.db.Transaction(func(tx *gorm.DB) error {
		versionIDs := tx.Model(&model.AssetVersion{}).Select("id").Where("asset_id = ?", id)
		if err := tx.Where("asset_version_id IN (?)", versionIDs).Delete(&model.AssetRepresentation{}).Error; err != nil {
			return err
		}
		if err := tx.Where("asset_id = ?", id).Delete(&model.AssetVersion{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.Asset{}, "id = ? AND user_id = ?", id, userID).Error
	})
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
	return r.db.Delete(&model.CanvasProject{}, "id = ? AND user_id = ?", id, userID).Error
}

func (r *Repository) Projects(userID string) ([]model.Project, error) {
	var projects []model.Project
	err := r.db.Where("user_id = ?", userID).Order("updated_at desc").Find(&projects).Error
	return projects, err
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
		"description": project.Description, "status": project.Status, "revision": project.Revision, "updated_at": project.UpdatedAt,
	}).Error
}

func (r *Repository) DeleteProject(userID string, id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.CanvasProject{}).Where("user_id = ? AND project_id = ?", userID, id).Update("project_id", "").Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.CanvasUnitLink{}).Error; err != nil {
			return err
		}
		shotIDs := tx.Model(&model.Shot{}).Select("id").Where("project_id = ?", id)
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
		if err := tx.Where("project_id = ?", id).Delete(&model.ProjectAssetCandidate{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.ProjectUnit{}).Error; err != nil {
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

func (r *Repository) CreateProjectUnit(unit *model.ProjectUnit) error {
	return r.db.Create(unit).Error
}

func (r *Repository) ProjectUnit(projectID string, id string) (*model.ProjectUnit, error) {
	var unit model.ProjectUnit
	if err := r.db.First(&unit, "id = ? AND project_id = ?", id, projectID).Error; err != nil {
		return nil, err
	}
	return &unit, nil
}

func (r *Repository) UpdateProjectUnit(unit *model.ProjectUnit) error {
	return r.db.Model(&model.ProjectUnit{}).Where("id = ? AND project_id = ?", unit.ID, unit.ProjectID).Updates(map[string]any{
		"parent_id": unit.ParentID, "title": unit.Title, "source_text": unit.SourceText, "status": unit.Status, "position": unit.Position, "updated_at": unit.UpdatedAt,
	}).Error
}

func (r *Repository) DeleteProjectUnit(projectID string, id string) error {
	return r.db.Delete(&model.ProjectUnit{}, "id = ? AND project_id = ?", id, projectID).Error
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

func (r *Repository) AssignCanvasToProject(userID string, canvasID string, projectID string) error {
	return r.db.Model(&model.CanvasProject{}).Where("id = ? AND user_id = ?", canvasID, userID).Update("project_id", projectID).Error
}

func (r *Repository) ProjectAssets(userID string, projectID string) ([]model.Asset, error) {
	var assets []model.Asset
	err := r.db.Table("assets").Select("assets.*").Joins("JOIN project_asset_links ON project_asset_links.asset_id = assets.id").Where("assets.user_id = ? AND project_asset_links.project_id = ?", userID, projectID).Order("assets.updated_at desc").Scan(&assets).Error
	return assets, err
}

func (r *Repository) UpsertProjectAssetLink(link *model.ProjectAssetLink) error {
	var count int64
	if err := r.db.Model(&model.ProjectAssetLink{}).Where("project_id = ? AND asset_id = ?", link.ProjectID, link.AssetID).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	return r.db.Create(link).Error
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

func (r *Repository) ShotForProject(projectID string, shotID string) (*model.Shot, error) {
	var shot model.Shot
	if err := r.db.First(&shot, "id = ? AND project_id = ?", shotID, projectID).Error; err != nil {
		return nil, err
	}
	return &shot, nil
}

func (r *Repository) UpsertShotAssetReference(reference *model.ShotAssetReference) error {
	result := r.db.Model(&model.ShotAssetReference{}).Where("shot_id = ? AND asset_version_id = ? AND role = ?", reference.ShotID, reference.AssetVersionID, reference.Role).Updates(map[string]any{"status": reference.Status})
	if result.Error != nil || result.RowsAffected > 0 {
		return result.Error
	}
	return r.db.Create(reference).Error
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
func (r *Repository) RegisterWorkflowTaskOutput(step *model.WorkflowStepInstance, next *model.WorkflowStepInstance, instance *model.WorkflowInstance, projectID string, link *model.WorkflowStepTask, representation *model.AssetRepresentation) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("workflow_step_id = ? AND task_id = ?", link.WorkflowStepID, link.TaskID).FirstOrCreate(link).Error; err != nil {
			return err
		}
		if representation != nil {
			if err := tx.Where("task_id = ? AND role = ?", representation.TaskID, representation.Role).FirstOrCreate(representation).Error; err != nil {
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

func (r *Repository) StoryboardPromptTemplates() ([]model.StoryboardPromptTemplate, error) {
	var templates []model.StoryboardPromptTemplate
	err := r.db.Order("updated_at desc").Find(&templates).Error
	return templates, err
}

func (r *Repository) StoryboardPromptTemplate(id string) (*model.StoryboardPromptTemplate, error) {
	var template model.StoryboardPromptTemplate
	if err := r.db.First(&template, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &template, nil
}

func (r *Repository) ActiveStoryboardPromptTemplate() (*model.StoryboardPromptTemplate, error) {
	var template model.StoryboardPromptTemplate
	if err := r.db.Order("updated_at desc").First(&template, "enabled = ?", true).Error; err != nil {
		return nil, err
	}
	return &template, nil
}

func (r *Repository) StoryboardPromptTemplateCount() (int64, error) {
	var count int64
	err := r.db.Model(&model.StoryboardPromptTemplate{}).Count(&count).Error
	return count, err
}

func (r *Repository) SaveStoryboardPromptTemplate(template *model.StoryboardPromptTemplate) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if template.Enabled {
			if err := tx.Model(&model.StoryboardPromptTemplate{}).Where("id <> ?", template.ID).Update("enabled", false).Error; err != nil {
				return err
			}
		}
		return tx.Save(template).Error
	})
}

func (r *Repository) DeleteStoryboardPromptTemplate(id string) error {
	return r.db.Delete(&model.StoryboardPromptTemplate{}, "id = ?", id).Error
}

func (r *Repository) UserSkillState(userID string, skillDir string) (*model.UserSkillState, error) {
	var state model.UserSkillState
	if err := r.db.First(&state, "user_id = ? AND skill_dir = ?", userID, skillDir).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &state, nil
}

func (r *Repository) UserSkillStates(userID string) ([]model.UserSkillState, error) {
	var states []model.UserSkillState
	err := r.db.Order("updated_at desc").Find(&states, "user_id = ?", userID).Error
	return states, err
}

func (r *Repository) UserSkillStatesByDirs(userID string, skillDirs []string) ([]model.UserSkillState, error) {
	if len(skillDirs) == 0 {
		return nil, nil
	}
	var states []model.UserSkillState
	err := r.db.Find(&states, "user_id = ? AND skill_dir IN ?", userID, skillDirs).Error
	return states, err
}
