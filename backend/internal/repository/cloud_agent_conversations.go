package repository

import (
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

type CloudAgentHistoryCursor struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
}

const cloudAgentConversationIdentity = "COALESCE(NULLIF(conversation_id, ''), id)"

// Only control columns are needed for directory polling; never hydrate journals.
const cloudAgentHistoryColumns = "id, user_id, conversation_id, parent_id, title, canvas_id, status, revision, cleanup_pending, created_at, updated_at"

func (r *Repository) CloudAgentConversations(userID, canvasID string, before *CloudAgentHistoryCursor, limit int) ([]model.CloudAgentExecution, error) {
	rows := []model.CloudAgentExecution{}
	query := r.db.Table("cloud_agent_executions e").Select("e.id, e.user_id, e.conversation_id, e.parent_id, e.title, e.canvas_id, e.status, e.revision, e.cleanup_pending, e.created_at, e.updated_at").
		Where("e.user_id = ?", userID).
		Where(`EXISTS (SELECT 1 FROM cloud_agent_executions c WHERE c.user_id = e.user_id AND c.canvas_id = ?
			AND COALESCE(NULLIF(c.conversation_id, ''), c.id) = COALESCE(NULLIF(e.conversation_id, ''), e.id))`, canvasID).
		Where(`NOT EXISTS (SELECT 1 FROM cloud_agent_executions n WHERE n.user_id = e.user_id
			AND COALESCE(NULLIF(n.conversation_id, ''), n.id) = COALESCE(NULLIF(e.conversation_id, ''), e.id)
			AND (n.created_at > e.created_at OR (n.created_at = e.created_at AND n.id > e.id)))`)
	if before != nil {
		query = query.Where("e.created_at < ? OR (e.created_at = ? AND e.id < ?)", before.CreatedAt, before.CreatedAt, before.ID)
	}
	err := query.Order("e.created_at DESC, e.id DESC").Limit(limit).Find(&rows).Error
	return rows, err
}

func (r *Repository) CloudAgentConversationRuns(userID, conversationID string, after *CloudAgentHistoryCursor, limit int) ([]model.CloudAgentExecution, error) {
	rows := []model.CloudAgentExecution{}
	query := r.db.Model(&model.CloudAgentExecution{}).Select(cloudAgentHistoryColumns).
		Where("user_id = ? AND "+cloudAgentConversationIdentity+" = ?", userID, conversationID)
	if after != nil {
		query = query.Where("created_at > ? OR (created_at = ? AND id > ?)", after.CreatedAt, after.CreatedAt, after.ID)
	}
	err := query.Order("created_at ASC, id ASC").Limit(limit).Find(&rows).Error
	return rows, err
}

func (r *Repository) CloudAgentConversationExists(userID, conversationID string) (bool, error) {
	var row model.CloudAgentExecution
	err := r.db.Select("id").Where("user_id = ? AND "+cloudAgentConversationIdentity+" = ?", userID, conversationID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	return err == nil, err
}

var ErrCloudAgentStaleParent = errors.New("对话已有更新，请同步最新一轮后再发送")

// 同一父轮的接续先取得数据库行锁，再检查最新轮次与未落检查点的预留任务。
// 该检查和任务、积分预留同事务提交，浏览器不能用旧上下文另开收费分支。
func (r *Repository) requireCurrentCloudAgentParent(task *model.Task) error {
	if task.Operation != "cloud_agent" || task.InputJSON == "" {
		return nil
	}
	var input struct {
		Agent struct {
			ParentID string `json:"parentId"`
		} `json:"cloudAgent"`
	}
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return err
	}
	parentID := input.Agent.ParentID
	if parentID == "" {
		return nil
	}
	locked := r.db.Model(&model.CloudAgentExecution{}).Where("id = ? AND user_id = ?", parentID, task.UserID).
		UpdateColumn("revision", gorm.Expr("revision"))
	if locked.Error != nil {
		return locked.Error
	}
	if locked.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	var parent model.CloudAgentExecution
	if err := r.db.Select(cloudAgentHistoryColumns).First(&parent, "id = ? AND user_id = ?", parentID, task.UserID).Error; err != nil {
		return err
	}
	conversationID := parent.ConversationID
	if conversationID == "" {
		conversationID = parent.ID
	}
	var latest model.CloudAgentExecution
	if err := r.db.Select("id").Where("user_id = ? AND "+cloudAgentConversationIdentity+" = ?", task.UserID, conversationID).
		Order("created_at DESC, id DESC").First(&latest).Error; err != nil {
		return err
	}
	if latest.ID != parentID || !cloudAgentParentTerminal(parent.Status) || parent.CleanupPending {
		return ErrCloudAgentStaleParent
	}
	// A newly admitted child may not have an execution checkpoint yet. Its
	// immutable task input already records the parent, so this gap cannot admit
	// another child, including when the conversation moves to another canvas.
	var reservations []model.Task
	if err := r.db.Select("id", "input_json").Where(`user_id = ? AND operation = 'cloud_agent' AND agent_execution_ready = false
		AND NOT EXISTS (SELECT 1 FROM cloud_agent_executions e WHERE e.id = tasks.id AND e.user_id = tasks.user_id)`, task.UserID).
		Find(&reservations).Error; err != nil {
		return err
	}
	for _, reservation := range reservations {
		if reservation.ID == task.ID {
			continue
		}
		var pending struct {
			Agent struct {
				ParentID string `json:"parentId"`
			} `json:"cloudAgent"`
		}
		if json.Unmarshal([]byte(reservation.InputJSON), &pending) == nil && pending.Agent.ParentID == parentID {
			return ErrCloudAgentStaleParent
		}
	}
	return nil
}

func cloudAgentParentTerminal(status string) bool {
	return status == "completed" || status == "failed" || status == "cancelled" || status == "rejected"
}
