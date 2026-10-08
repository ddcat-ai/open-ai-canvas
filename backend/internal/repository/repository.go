package repository

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
)

var ErrDailyUploadLimitExceeded = errors.New("今日上传额度已用完，请明天再试")

var ErrTaskProviderRecoveryConflict = errors.New("任务正在恢复中，请稍后查看")

var ErrTaskProviderCancellationConflict = errors.New("任务正在取消中，请稍后查看")

var ErrTaskStateConflict = errors.New("任务状态已变化，请刷新后重试")

var ErrTextReplayQuotaExceeded = errors.New("文本回放额度已用完")

var ErrTextReplayClosed = errors.New("该文本任务已结束")

var ErrEmailVerificationCodeInvalid = errors.New("邮箱验证码已失效，请重新获取")

var ErrProjectAssetFolderNotEmpty = errors.New("资产文件夹不为空，无法删除")

var ErrProjectHasActiveTasks = errors.New("项目中还有进行中的任务，请等待完成后再操作")

var ErrProjectUnitShotsChanged = errors.New("镜头已被修改，请刷新后重试")

var ErrCanvasRevisionConflict = errors.New("画布已被更新，请刷新后重试")

type Repository struct {
	db *gorm.DB
}

type UserStorageUsage struct {
	AssetCount   int64 `json:"assetCount"`
	AssetBytes   int64 `json:"assetBytes"`
	CanvasCount  int64 `json:"canvasCount"`
	CanvasBytes  int64 `json:"canvasBytes"`
	TaskCount    int64 `json:"taskCount"`
	TaskBytes    int64 `json:"taskBytes"`
	APICallCount int64 `json:"apiCallCount"`
}

func New(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) WithContext(ctx context.Context) *Repository {
	return &Repository{db: r.db.WithContext(ctx)}
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
	return database.AllocatePrefixedID(r.db, prefix)
}

func (r *Repository) UserStorageUsage(userID string) (UserStorageUsage, error) {
	var usage UserStorageUsage
	query := `
		SELECT
			(SELECT COUNT(*) FROM assets WHERE user_id = ?) AS asset_count,
			(SELECT COALESCE(SUM(length(CAST(COALESCE(payload_json, '') AS BLOB))), 0) FROM assets WHERE user_id = ?) AS asset_bytes,
			(SELECT COUNT(*) FROM canvas_projects WHERE user_id = ?) AS canvas_count,
			(SELECT COALESCE(SUM(length(CAST(COALESCE(payload_json, '') AS BLOB))), 0) FROM canvas_projects WHERE user_id = ?) AS canvas_bytes,
			(SELECT COUNT(*) FROM tasks WHERE user_id = ?) AS task_count,
			(SELECT COALESCE(SUM(length(CAST(COALESCE(prompt, '') AS BLOB)) + length(CAST(COALESCE(input_json, '') AS BLOB)) + length(CAST(COALESCE(result_json, '') AS BLOB)) + length(CAST(COALESCE(media_recovery_json, '') AS BLOB)) + length(CAST(COALESCE(text_draft, '') AS BLOB)) + length(CAST(COALESCE(error, '') AS BLOB))), 0) FROM tasks WHERE user_id = ?)
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
	err := r.db.Raw(query, userID, userID, userID, userID, userID, userID, userID, userID, userID, userID, userID).Scan(&usage).Error
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
		return nil
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
