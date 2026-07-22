package repository

import (
	"errors"
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
	AssetCount   int64
	AssetBytes   int64
	CanvasCount  int64
	CanvasBytes  int64
	SessionCount int64
	SessionBytes int64
	TaskCount    int64
	TaskBytes    int64
	APICallCount int64
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
	err := r.db.Select("id", "kind", "title", "created_at", "updated_at").Order("updated_at desc").Find(&assets, "user_id = ?", userID).Error
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
		Updates(map[string]any{"kind": asset.Kind, "title": asset.Title, "payload_json": asset.PayloadJSON, "updated_at": asset.UpdatedAt})
	if result.Error != nil || result.RowsAffected > 0 {
		return result.Error
	}
	return r.db.Create(asset).Error
}

func (r *Repository) DeleteAsset(userID string, id string) error {
	return r.db.Delete(&model.Asset{}, "id = ? AND user_id = ?", id, userID).Error
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
		Updates(map[string]any{"title": project.Title, "payload_json": project.PayloadJSON, "updated_at": project.UpdatedAt})
	if result.Error != nil || result.RowsAffected > 0 {
		return result.Error
	}
	return r.db.Create(project).Error
}

func (r *Repository) DeleteCanvasProject(userID string, id string) error {
	return r.db.Delete(&model.CanvasProject{}, "id = ? AND user_id = ?", id, userID).Error
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
