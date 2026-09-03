package repository

import (
	"errors"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

var ErrAgentRunNotFound = errors.New("agent run not found")

var ErrAgentRunAccessDenied = errors.New("agent run access denied")

func (r *Repository) CreateAgentRun(run *model.AgentRun) error {
	return r.db.Create(run).Error
}

func (r *Repository) AgentRunForUser(userID, id string) (*model.AgentRun, error) {
	var run model.AgentRun
	err := r.db.Where("id = ? AND user_id = ?", id, userID).First(&run).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrAgentRunNotFound
	}
	if err != nil {
		return nil, err
	}
	return &run, nil
}

// TransitionAgentRunStatus 条件更新 AgentRun 状态：仅当当前状态为 running 时才允许迁移到目标状态。
// 返回受影响的行数（0 表示该 run 已处于终态或不存在，1 表示状态迁移成功）。
// 这保证了 completed/failed 终态不会被竞态的 SSE/错误路径覆盖。
func (r *Repository) TransitionAgentRunStatus(runID, userID, targetStatus string, completedAt *time.Time, errorMessage string) (int64, error) {
	updates := map[string]any{
		"status":     targetStatus,
		"updated_at": time.Now(),
	}
	if completedAt != nil {
		updates["completed_at"] = *completedAt
	}
	if errorMessage != "" {
		updates["error_message"] = errorMessage
	}
	result := r.db.Model(&model.AgentRun{}).
		Where("id = ? AND user_id = ? AND status = ?", runID, userID, "running").
		Updates(updates)
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}

func (r *Repository) UpdateAgentRunThreadID(runID, userID, threadID string) error {
	return r.db.Model(&model.AgentRun{}).
		Where("id = ? AND user_id = ?", runID, userID).
		Updates(map[string]any{"thread_id": threadID, "updated_at": time.Now()}).Error
}
