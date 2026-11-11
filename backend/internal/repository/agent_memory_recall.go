package repository

import (
	"strings"

	"yingce/backend/internal/model"
)

// AgentMemoryRecallRuns reads only owned, completed work. Journal bodies remain
// paged separately so opening a new conversation never hydrates full transcripts.
func (r *Repository) AgentMemoryRecallRuns(userID, excludeRunID, keyword string, limit int) ([]model.CloudAgentExecution, error) {
	rows := []model.CloudAgentExecution{}
	if strings.TrimSpace(userID) == "" || limit < 1 {
		return rows, nil
	}
	query := r.db.Table("cloud_agent_executions e").
		Select("e.id, e.user_id, e.conversation_id, e.title, e.canvas_id, e.status, e.event_count, e.created_at, e.updated_at").
		Where("e.user_id = ? AND e.status = ? AND e.cleanup_pending = ?", userID, "completed", false)
	if excludeRunID != "" {
		query = query.Where(`NOT EXISTS (SELECT 1 FROM cloud_agent_executions x
			WHERE x.user_id = e.user_id AND x.id = ?
			AND COALESCE(NULLIF(x.conversation_id, ''), x.id) = COALESCE(NULLIF(e.conversation_id, ''), e.id))`, excludeRunID)
	}
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		for _, term := range strings.Fields(keyword) {
			like := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(strings.ToLower(term)) + "%"
			query = query.Where(`(LOWER(e.title) LIKE ? ESCAPE '!' OR EXISTS
				(SELECT 1 FROM cloud_agent_event_records m WHERE m.user_id = e.user_id AND m.run_id = e.id
				AND LOWER(m.event_json) LIKE ? ESCAPE '!'))`, like, like)
		}
	} else {
		// One recent completed turn per conversation; a long conversation must
		// not crowd every other conversation out of the automatic recall window.
		query = query.Where(`NOT EXISTS (SELECT 1 FROM cloud_agent_executions n
			WHERE n.user_id = e.user_id AND n.status = 'completed' AND n.cleanup_pending = false
			AND COALESCE(NULLIF(n.conversation_id, ''), n.id) = COALESCE(NULLIF(e.conversation_id, ''), e.id)
			AND (n.created_at > e.created_at OR (n.created_at = e.created_at AND n.id > e.id)))`)
	}
	err := query.Order("e.updated_at DESC, e.id DESC").Limit(min(limit, 15)).Find(&rows).Error
	return rows, err
}
