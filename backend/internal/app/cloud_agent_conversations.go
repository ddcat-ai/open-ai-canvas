package app

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type CloudAgentConversation struct {
	ID             string    `json:"id"`
	CanvasID       string    `json:"canvasId"`
	Title          string    `json:"title"`
	LatestRunID    string    `json:"latestRunId"`
	Status         string    `json:"status"`
	Revision       int64     `json:"revision"`
	CleanupPending bool      `json:"cleanupPending"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type CloudAgentConversationPage struct {
	Items      []CloudAgentConversation `json:"items"`
	NextCursor string                   `json:"nextCursor,omitempty"`
}

type CloudAgentConversationRunPage struct {
	Items      []*CloudAgentRun `json:"items"`
	NextCursor string           `json:"nextCursor,omitempty"`
}

func cloudAgentHistoryCursor(value string, limit int) (*repository.CloudAgentHistoryCursor, error) {
	if limit < 1 || limit > 100 {
		return nil, BadAuthRequest("会话页大小必须是 1–100 之间的整数")
	}
	if value == "" {
		return nil, nil
	}
	if len(value) > 512 {
		return nil, BadAuthRequest("会话分页游标无效")
	}
	data, err := base64.RawURLEncoding.DecodeString(value)
	var cursor repository.CloudAgentHistoryCursor
	if err != nil || json.Unmarshal(data, &cursor) != nil || cursor.CreatedAt.IsZero() || validateCloudAgentID(cursor.ID, "轮次 ID", 80) != nil {
		return nil, BadAuthRequest("会话分页游标无效")
	}
	return &cursor, nil
}

func encodeCloudAgentHistoryCursor(run model.CloudAgentExecution) string {
	data, _ := json.Marshal(repository.CloudAgentHistoryCursor{CreatedAt: run.CreatedAt, ID: run.ID})
	return base64.RawURLEncoding.EncodeToString(data)
}

// Canvas ownership is checked before directory lookup, including empty results.
// A conversation that visited this canvas retains its global latest turn.
func (s *Service) CloudAgentConversations(userID, canvasID, before string, limit int) (*CloudAgentConversationPage, error) {
	if userID == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	if strings.TrimSpace(canvasID) == "" || validateCloudAgentID(canvasID, "画布 ID", 80) != nil {
		return nil, BadAuthRequest("需要有效的画布 ID")
	}
	cursor, err := cloudAgentHistoryCursor(before, limit)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.CanvasProjectMetadataForUser(userID, canvasID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.NotFound("画布不存在")
		}
		return nil, err
	}
	rows, err := s.repo.CloudAgentConversations(userID, canvasID, cursor, limit+1)
	if err != nil {
		return nil, err
	}
	page := &CloudAgentConversationPage{Items: []CloudAgentConversation{}}
	if len(rows) > limit {
		page.NextCursor = encodeCloudAgentHistoryCursor(rows[limit-1])
		rows = rows[:limit]
	}
	for _, run := range rows {
		id := run.ConversationID
		if id == "" {
			id = run.ID
		}
		page.Items = append(page.Items, CloudAgentConversation{
			ID: id, CanvasID: run.CanvasID, Title: run.Title, LatestRunID: run.ID,
			Status: run.Status, Revision: run.Revision, CleanupPending: run.CleanupPending,
			CreatedAt: run.CreatedAt, UpdatedAt: run.UpdatedAt,
		})
	}
	return page, nil
}

func (s *Service) CloudAgentConversationRuns(userID, conversationID, after string, limit int) (*CloudAgentConversationRunPage, error) {
	if userID == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	if err := validateCloudAgentID(conversationID, "会话 ID", 80); err != nil {
		return nil, err
	}
	cursor, err := cloudAgentHistoryCursor(after, limit)
	if err != nil {
		return nil, err
	}
	exists, err := s.repo.CloudAgentConversationExists(userID, conversationID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, kernel.NotFound("Agent 对话不存在")
	}
	rows, err := s.repo.CloudAgentConversationRuns(userID, conversationID, cursor, limit+1)
	if err != nil {
		return nil, err
	}
	page := &CloudAgentConversationRunPage{Items: []*CloudAgentRun{}}
	if len(rows) > limit {
		page.NextCursor = encodeCloudAgentHistoryCursor(rows[limit-1])
		rows = rows[:limit]
	}
	for _, row := range rows {
		run, err := s.CloudAgentRun(userID, row.ID)
		if err != nil {
			return nil, err
		}
		page.Items = append(page.Items, run)
	}
	return page, nil
}
