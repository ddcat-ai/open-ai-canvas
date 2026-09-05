package repository

import (
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

// CountComfyBridgeRequestsByTask 统计同一 Task 已派发过的 Bridge 请求数。
//
// 用于计算 AttemptNo（D-020：Retry = 同一 GenerationTask 新增一个 ComfyJob，
// Regenerate = 新建一个 GenerationTask）。AttemptNo 属于执行尝试（Job），不属于用户意图（Task）。
func (r *Repository) CountComfyBridgeRequestsByTask(taskID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.ComfyBridgeRequest{}).Where("task_id = ?", taskID).Count(&count).Error
	return count, err
}

// SaveTaskChainContext 回写任务的 canonical 任务链字段（D-027 / D-039 自愈）。
//
// 背景：tasks.shot_id / canvas_node_id / workflow_step_id 是 W1-01 新增列，
// 所有历史任务这三列都是空的，但 inputJson.metadata 里其实有对应值。
// 兼容性 helper 解析成功后调用本方法写回 canonical 列，让旧数据逐步自愈，
// 从而避免「一半代码读 column、一半代码读 metadata」的退化（D-039）。
//
// 只补空值，不覆盖已有 canonical 值——canonical 列一旦写入即为权威。
func (r *Repository) SaveTaskChainContext(taskID string, shotID string, canvasNodeID string, workflowStepID string) error {
	updates := map[string]any{}
	if shotID != "" {
		updates["shot_id"] = shotID
	}
	if canvasNodeID != "" {
		updates["canvas_node_id"] = canvasNodeID
	}
	if workflowStepID != "" {
		updates["workflow_step_id"] = workflowStepID
	}
	if len(updates) == 0 {
		return nil
	}
	// 只补空值：条件里带上 IS NULL / = '' 保证不覆盖已有 canonical 值
	return r.db.Model(&model.Task{}).
		Where("id = ? AND (shot_id IS NULL OR shot_id = '')"+
			" OR id = ? AND (canvas_node_id IS NULL OR canvas_node_id = '')"+
			" OR id = ? AND (workflow_step_id IS NULL OR workflow_step_id = '')",
			taskID, taskID, taskID).
		Updates(updates).Error
}

// ComfyBridgeRequestsByTask 按任务读取全部 Bridge 请求（即 ComfyJob 列表，D-020），
// 供 /tasks/:id/chain 返回执行轨迹。按创建时间正序，AttemptNo 自然递增。
func (r *Repository) ComfyBridgeRequestsByTask(taskID string) ([]model.ComfyBridgeRequest, error) {
	var requests []model.ComfyBridgeRequest
	err := r.db.Where("task_id = ?", taskID).Order("created_at asc").Find(&requests).Error
	return requests, err
}

// ShotArtifactsByTask 按任务读取产物（D-035：产物统一落 shot_artifacts）。
func (r *Repository) ShotArtifactsByTask(taskID string) ([]model.ShotArtifact, error) {
	var artifacts []model.ShotArtifact
	err := r.db.Where("task_id = ?", taskID).Order("type asc, version asc").Find(&artifacts).Error
	return artifacts, err
}

// ShotArtifactsByShot 按分镜读取产物（含 project/unit 归属，供 ownership 校验）。
func (r *Repository) ShotArtifactsByShot(shotID string) ([]model.ShotArtifact, error) {
	var artifacts []model.ShotArtifact
	err := r.db.Where("shot_id = ?", shotID).Order("type asc, version asc").Find(&artifacts).Error
	return artifacts, err
}

// TaskForShot 读取属于指定分镜的任务，供 retry / regenerate 的逐层归属校验（D-024）。
func (r *Repository) TaskForShot(userID string, shotID string, taskID string) (*model.Task, error) {
	var task model.Task
	if err := r.db.Where("id = ? AND user_id = ? AND shot_id = ?", taskID, userID, shotID).First(&task).Error; err != nil {
		return nil, err
	}
	return &task, nil
}

// BridgeOutputAssetsByRequest 按 Bridge 请求读取产物，供幂等桥（D-035）。
func (r *Repository) BridgeOutputAssetsByRequest(requestID string) ([]model.ShotArtifact, error) {
	var artifacts []model.ShotArtifact
	err := r.db.Where("request_id = ?", requestID).Order("asset_index asc").Find(&artifacts).Error
	return artifacts, err
}

// ShotRevisionsByShotIDs 批量读取分镜版本，供 Timeline DTO 取实际时长（D-033）。
func (r *Repository) ShotRevisionsByShotIDs(shotIDs []string) ([]model.ShotRevision, error) {
	var revisions []model.ShotRevision
	if len(shotIDs) == 0 {
		return revisions, nil
	}
	err := r.db.Where("shot_id IN ?", shotIDs).Order("shot_id asc, version desc").Find(&revisions).Error
	return revisions, err
}

// SelectedArtifactsByShotIDs 批量读取分镜当前选中的产物，供 Timeline DTO 取实际媒体时长（D-033）。
// 只取 selected 且非 stale 的——被淘汰的历史产物不该影响 Timeline 长度。
func (r *Repository) SelectedArtifactsByShotIDs(shotIDs []string) ([]model.ShotArtifact, error) {
	var artifacts []model.ShotArtifact
	if len(shotIDs) == 0 {
		return artifacts, nil
	}
	err := r.db.Where("shot_id IN ? AND selected = ? AND status <> ?", shotIDs, true, model.ShotArtifactStatusStale).
		Order("shot_id asc, updated_at desc").Find(&artifacts).Error
	return artifacts, err
}

// NextShotArtifactVersion 取 (shot_id, type) 的下一个版本号（事务内外都可用）。
func (r *Repository) NextShotArtifactVersion(db *gorm.DB, shotID string, artifactType string) (int, error) {
	if db == nil {
		db = r.db
	}
	var current int
	if err := db.Model(&model.ShotArtifact{}).
		Where("shot_id = ? AND type = ?", shotID, artifactType).
		Select("COALESCE(MAX(version), 0)").Scan(&current).Error; err != nil {
		return 0, err
	}
	return current + 1, nil
}

// TouchShotLatestTask 回写分镜的「最近一次成功生成任务」指针（F-25 / W1-02）。
//
// 唯一调用方是 task_terminal.handleSuccess（全 Provider 统一成功收口）——
// 语义为 provider 无关的「最近一次**成功**任务」，与 Bridge completion 的
// Job 级指针（updateShotLatestPointers，最近一次尝试）是两个层次。
// 失败任务不得走到这里：重试失败任务走既有 Retry（同 Task 新 Job）链路。
func (r *Repository) TouchShotLatestTask(shotID string, taskID string, now time.Time) error {
	if shotID == "" || taskID == "" {
		return nil
	}
	return r.db.Model(&model.Shot{}).Where("id = ?", shotID).
		Updates(map[string]any{"latest_task_id": taskID, "updated_at": now}).Error
}
