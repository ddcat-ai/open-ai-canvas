package repository

import (
	"errors"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

func (r *Repository) requireAgentHistoryNotCleared(userID, runID string) error {
	var cleared bool
	err := r.db.Raw(`SELECT EXISTS (SELECT 1 FROM tasks t WHERE t.id = ? AND t.user_id = ?
		AND t.operation = 'cloud_agent' AND t.agent_execution_ready = true
		AND NOT EXISTS (SELECT 1 FROM cloud_agent_executions e WHERE e.id = t.id AND e.user_id = t.user_id))`, runID, userID).Scan(&cleared).Error
	if err != nil {
		return err
	}
	if cleared {
		return kernel.NotFound("该轮 Agent 历史已清理，请新建对话")
	}
	return nil
}

// The caller's transaction also commits the admin audit. Hold admission and
// payload locks until then so a continuation cannot lose its parent mid-write.
func (r *Repository) ClearIdleAgentHistory(userID string) (int64, error) {
	if err := lockAgentRunAdmissions(r.db, userID); err != nil {
		return 0, err
	}
	if _, err := r.User(userID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, kernel.NotFound("用户不存在")
		}
		return 0, err
	}
	if err := r.beginAgentStorageWrite(userID); err != nil {
		return 0, err
	}
	var busy bool
	err := r.db.Raw(`SELECT EXISTS (SELECT 1 FROM cloud_agent_executions WHERE user_id = ?
		AND (status NOT IN ('completed', 'failed', 'cancelled', 'rejected') OR cleanup_pending = true))
		OR EXISTS (SELECT 1 FROM tasks t WHERE t.user_id = ? AND t.operation = 'cloud_agent'
		AND t.agent_execution_ready = false AND t.status NOT IN ('succeeded', 'failed', 'cancelled')
		AND NOT EXISTS (SELECT 1 FROM cloud_agent_executions e WHERE e.id = t.id AND e.user_id = t.user_id))`, userID, userID).Scan(&busy).Error
	if err != nil {
		return 0, err
	}
	if busy {
		return 0, kernel.NewAppError(kernel.CodeConflict, "该账号仍有未结束或正在收尾的 Agent 对话，请先完成或停止对话，待收尾结束后再清理")
	}
	used, err := r.AgentStoredBytes(userID)
	if err != nil {
		return 0, err
	}
	if err := r.db.Exec(`UPDATE tasks SET agent_execution_ready = true
		WHERE user_id = ? AND operation = 'cloud_agent' AND agent_execution_ready = false`, userID).Error; err != nil {
		return 0, err
	}
	for _, payload := range []any{&model.CloudAgentEventRecord{}, &model.CloudAgentMessageRecord{}, &model.CloudAgentPiSession{}, &model.CloudAgentCanvasMutation{}, &model.CloudAgentExecution{}} {
		if err := r.db.Where("user_id = ?", userID).Delete(payload).Error; err != nil {
			return 0, err
		}
	}
	return used, r.changeAgentStoredBytes(userID, -used)
}
