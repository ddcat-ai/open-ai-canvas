package app

import (
	"encoding/json"
	"errors"
	"reflect"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/repository"
)

// This checkpoint is a browser presentation record. Native Agent messages,
// tool receipts, permissions and task results remain server-owned records.
type CreationHistory struct {
	Version              int                      `json:"version"`
	SourceConversationID string                   `json:"sourceConversationId"`
	Messages             []CreationHistoryMessage `json:"messages"`
}

type CreationHistoryRequest struct {
	SourceConversationID string                   `json:"sourceConversationId"`
	Title                *string                  `json:"title,omitempty"`
	Messages             []CreationHistoryMessage `json:"messages"`
}

type CreationHistoryAttachment struct {
	ID         string `json:"id"`
	StorageKey string `json:"storageKey"`
	Name       string `json:"name"`
	Type       string `json:"type"`
	Role       string `json:"role,omitempty"`
}

// Reference labels are presentation metadata, never executable skill content.
type CreationHistoryReference struct {
	ID           string `json:"id"`
	Kind         string `json:"kind"`
	Label        string `json:"label"`
	MentionToken string `json:"mentionToken"`
	AttachmentID string `json:"attachmentId,omitempty"`
}

type CreationHistoryMessage struct {
	ID                string                      `json:"id"`
	Role              string                      `json:"role"`
	Mode              string                      `json:"mode"`
	Content           string                      `json:"content"`
	CreatedAt         time.Time                   `json:"createdAt"`
	Model             string                      `json:"model,omitempty"`
	Settings          map[string]string           `json:"settings,omitempty"`
	Attachments       []CreationHistoryAttachment `json:"attachments,omitempty"`
	References        []CreationHistoryReference  `json:"references,omitempty"`
	TaskIDs           []string                    `json:"taskIds,omitempty"`
	ClientOperationID string                      `json:"clientOperationId,omitempty"`
}

func decodeCreationHistory(raw string) (*CreationHistory, error) {
	history := &CreationHistory{Version: 1, Messages: []CreationHistoryMessage{}}
	if raw == "" {
		return history, nil
	}
	if err := json.Unmarshal([]byte(raw), history); err != nil {
		return nil, err
	}
	if history.Version != 1 {
		return nil, kernel.NewAppError(409, "会话历史版本不支持，请刷新后重试")
	}
	return history, nil
}

func (s *Service) DeletedCreationSessionIDs(userID string) ([]string, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	return s.repo.DeletedCreationSessionIDs(userID)
}

func (s *Service) CreationHistory(userID, sessionID string) (*CreationHistory, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	if err := validateCloudAgentID(sessionID, "会话 ID", 80); err != nil {
		return nil, err
	}
	row, err := s.repo.AgentSession(userID, sessionID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.NotFound("创作会话不存在")
	}
	if err != nil {
		return nil, err
	}
	if row.Surface != "creation" || row.Status == repository.AgentSessionDeleted {
		return nil, kernel.NotFound("创作会话不存在")
	}
	history, err := decodeCreationHistory(row.CheckpointJSON)
	if err != nil {
		return nil, err
	}
	// Include accepted ordinary tasks even when the browser lost the POST reply
	// before it could persist their IDs. This is read-only recovery.
	tasks, err := s.repo.CreationSessionTasks(userID, sessionID, history.SourceConversationID)
	if err != nil {
		return nil, err
	}
	byMessage := make(map[string][]string)
	for _, task := range tasks {
		if context := taskClientContext(task.InputJSON); context != nil {
			byMessage[context.MessageID] = append(byMessage[context.MessageID], task.ID)
		}
	}
	for i := range history.Messages {
		message := &history.Messages[i]
		if message.Role != "assistant" {
			continue
		}
		message.TaskIDs = appendUniqueCreationIDs(message.TaskIDs, byMessage[message.ID]...)
	}
	return history, nil
}

func appendUniqueCreationIDs(ids []string, incoming ...string) []string {
	for _, id := range incoming {
		found := false
		for _, previous := range ids {
			if previous == id {
				found = true
				break
			}
		}
		if !found {
			ids = append(ids, id)
		}
	}
	return ids
}

func (s *Service) SaveCreationHistory(userID, sessionID string, req CreationHistoryRequest) (*CreationHistory, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	if err := validateCloudAgentID(sessionID, "会话 ID", 80); err != nil {
		return nil, err
	}
	if err := validateCloudAgentID(req.SourceConversationID, "原会话 ID", 80); err != nil {
		return nil, err
	}
	if req.Title != nil {
		meta := CloudAgentSessionRequest{Title: *req.Title, Surface: "creation"}
		if err := normalizeCloudAgentSessionRequest(&meta); err != nil {
			return nil, err
		}
		req.Title = &meta.Title
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	var result *CreationHistory
	err = s.repo.Transaction(func(repo *repository.Repository) error {
		if err := repo.LockTaskAdmission(userID); err != nil {
			return err
		}
		row, err := repo.AgentSession(userID, sessionID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return kernel.NotFound("创作会话不存在")
		}
		if err != nil {
			return err
		}
		if row.Status == repository.AgentSessionDeleted || row.Surface != "creation" {
			return kernel.NotFound("创作会话不存在")
		}
		history, err := decodeCreationHistory(row.CheckpointJSON)
		if err != nil {
			return err
		}
		if history.SourceConversationID == "" {
			history.SourceConversationID = req.SourceConversationID
		}
		if req.SourceConversationID != history.SourceConversationID && req.SourceConversationID != sessionID {
			return kernel.NewAppError(409, "会话原始身份不一致")
		}
		positions := make(map[string]int, len(history.Messages))
		for i, message := range history.Messages {
			positions[message.ID] = i
		}
		newActivity := false
		for _, message := range req.Messages {
			if len(message.Settings) == 0 {
				message.Settings = nil
			}
			if len(message.Attachments) == 0 {
				message.Attachments = nil
			}
			if len(message.References) == 0 {
				message.References = nil
			}
			if len(message.TaskIDs) == 0 {
				message.TaskIDs = nil
			}
			if index, exists := positions[message.ID]; exists {
				previous := history.Messages[index]
				additional := message
				additional.TaskIDs = nil
				known := make(map[string]bool, len(previous.TaskIDs))
				for _, id := range previous.TaskIDs {
					known[id] = true
				}
				for _, id := range message.TaskIDs {
					if !known[id] {
						additional.TaskIDs = append(additional.TaskIDs, id)
						known[id] = true
					}
				}
				// Older local messages may acquire an operation ID from their first
				// receipt. Once recorded, stale clients cannot remove or replace it.
				if message.ClientOperationID == "" {
					message.ClientOperationID = previous.ClientOperationID
				}
				if previous.ClientOperationID == "" {
					previous.ClientOperationID = message.ClientOperationID
				}
				// A stale device may append receipts, but never rewrite an existing
				// turn or drop messages appended by another device.
				message.TaskIDs = appendUniqueCreationIDs(previous.TaskIDs, message.TaskIDs...)
				previous.TaskIDs = message.TaskIDs
				if !reflect.DeepEqual(previous, message) {
					return kernel.NewAppError(409, "已有会话消息发生冲突，请重新加载")
				}
				if err := validateCreationHistoryTasks(repo, userID, sessionID, history.SourceConversationID, additional); err != nil {
					return err
				}
				history.Messages[index] = message
			} else {
				if err := validateCreationHistoryMessage(repo, userID, sessionID, history.SourceConversationID, message); err != nil {
					return err
				}
				positions[message.ID] = len(history.Messages)
				history.Messages = append(history.Messages, message)
				newActivity = true
			}
		}
		sort.SliceStable(history.Messages, func(i, j int) bool { return history.Messages[i].CreatedAt.Before(history.Messages[j].CreatedAt) })
		encoded, err := json.Marshal(history)
		if err != nil {
			return err
		}
		result = history
		titleChanged := req.Title != nil && *req.Title != row.Title
		if string(encoded) == row.CheckpointJSON && !titleChanged {
			return nil
		}
		usage, err := repo.UserStructuredStorageUsage(userID)
		if err != nil {
			return err
		}
		bytes, err := repo.CreationHistoryBytes(userID)
		if err != nil {
			return err
		}
		if err := validateStructuredStorageQuotaWithPolicy(usage, "creation", false, bytes+int64(len(encoded)-len(row.CheckpointJSON)), policy.Resource); err != nil {
			return err
		}
		row.CheckpointJSON = string(encoded)
		if titleChanged {
			row.Title = *req.Title
		}
		if newActivity {
			row.UpdatedAt = time.Now()
		}
		row.Revision++
		return repo.UpdateAgentSession(userID, row)
	})
	return result, err
}

func validateCreationHistoryMessage(repo *repository.Repository, userID, sessionID, sourceID string, message CreationHistoryMessage) error {
	if err := validateCloudAgentID(message.ID, "消息 ID", 120); err != nil {
		return err
	}
	if message.Role != "user" && message.Role != "assistant" || message.Mode != "image" && message.Mode != "video" && message.Mode != "text" || message.CreatedAt.IsZero() {
		return BadAuthRequest("普通创作消息无效")
	}
	if message.Role == "assistant" && (message.Content != "" || len(message.Attachments) != 0 || len(message.References) != 0) {
		return BadAuthRequest("生成正文和素材必须从原任务恢复")
	}
	for _, reference := range message.References {
		switch reference.Kind {
		case "image", "video", "audio", "text", "skill", "character", "tool":
		default:
			return BadAuthRequest("创作引用类型无效")
		}
		if reference.ID == "" || reference.Label == "" || !strings.HasPrefix(reference.MentionToken, "@") {
			return BadAuthRequest("创作引用无效")
		}
	}
	for key := range message.Settings {
		switch key {
		case "ratio", "seconds", "quality", "videoQuality", "count", "imageResolution", "imageParameters", "transparentBackground":
		default:
			return BadAuthRequest("创作参数字段无效")
		}
	}
	for _, attachment := range message.Attachments {
		if !strings.HasPrefix(attachment.StorageKey, "resource:") {
			return BadAuthRequest("会话附件必须使用素材身份")
		}
		resource, err := repo.Resource(strings.TrimPrefix(attachment.StorageKey, "resource:"))
		if err != nil || resource.UserID != userID {
			return kernel.NotFound("会话附件不存在")
		}
	}
	return validateCreationHistoryTasks(repo, userID, sessionID, sourceID, message)
}

func validateCreationHistoryTasks(repo *repository.Repository, userID, sessionID, sourceID string, message CreationHistoryMessage) error {
	for _, id := range message.TaskIDs {
		task, err := repo.TaskForUser(userID, id)
		if err != nil {
			return kernel.NotFound("会话任务不存在")
		}
		context := taskClientContext(task.InputJSON)
		if message.Role != "assistant" || task.AgentRunID != "" || task.ProjectID != "" || task.Type != "canvas_"+message.Mode || context == nil || context.MessageID != message.ID || context.ConversationID != sourceID && context.ConversationID != sessionID {
			return BadAuthRequest("任务不属于当前创作消息")
		}
	}
	return nil
}
