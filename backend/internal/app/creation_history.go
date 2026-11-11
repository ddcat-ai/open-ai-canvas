package app

import (
	"encoding/json"
	"errors"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type CreationHistoryMessage struct {
	ID       string         `json:"id"`
	Revision int64          `json:"revision"`
	Data     map[string]any `json:"data"`
	Deleted  bool           `json:"deleted,omitempty"`
}
type CreationHistoryMetadata struct {
	Revision int64  `json:"revision"`
	Title    string `json:"title"`
	CanvasID string `json:"canvasId,omitempty"`
}
type CreationHistoryMutation struct {
	Metadata *CreationHistoryMetadata `json:"metadata,omitempty"`
	Messages []CreationHistoryMessage `json:"messages,omitempty"`
	Delete   bool                     `json:"delete,omitempty"`
}
type CreationHistoryDetail struct {
	model.CreationConversation
	Messages  []CreationHistoryMessage `json:"messages"`
	Conflicts []string                 `json:"conflicts"`
}

var historyID = regexp.MustCompile(`^[a-zA-Z0-9_:\-]{1,160}$`)

func (s *Service) ListCreationHistory(userID, after string) (map[string]any, error) {
	if userID == "" || (after != "" && !historyID.MatchString(after)) {
		return nil, BadAuthRequest("无效的创作历史查询")
	}
	rows, err := s.repo.CreationConversationPage(userID, after)
	next := ""
	if len(rows) == 100 {
		next = rows[len(rows)-1].ID
	}
	return map[string]any{"items": rows, "next": next}, err
}

func historyDetail(repo *repository.Repository, userID, id string) (*CreationHistoryDetail, error) {
	row, err := repo.CreationConversation(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("创作对话不存在")
	}
	if err != nil {
		return nil, err
	}
	detail := &CreationHistoryDetail{CreationConversation: *row, Messages: []CreationHistoryMessage{}, Conflicts: []string{}}
	if row.Deleted {
		return detail, nil
	}
	messages, err := repo.CreationConversationMessages(userID, id)
	if err != nil {
		return nil, err
	}
	for _, message := range messages {
		data := map[string]any{}
		if !message.Deleted {
			if err := json.Unmarshal([]byte(message.PayloadJSON), &data); err != nil {
				return nil, err
			}
		}
		detail.Messages = append(detail.Messages, CreationHistoryMessage{ID: message.ID, Revision: message.Revision, Data: data, Deleted: message.Deleted})
	}
	return detail, nil
}

func (s *Service) GetCreationHistory(userID, id string) (*CreationHistoryDetail, error) {
	if userID == "" || !historyID.MatchString(id) {
		return nil, BadAuthRequest("无效的创作对话 ID")
	}
	var detail *CreationHistoryDetail
	err := s.repo.ReadCreationConversationSnapshot(func(repo *repository.Repository) error {
		var err error
		detail, err = historyDetail(repo, userID, id)
		return err
	})
	return detail, err
}

// Explicit message schemas keep provider credentials, configurations and temporary URLs out of history.
func historyPayload(input map[string]any, id string) (string, []string, time.Time, error) {
	allowed := strings.Fields("id role mode content reasoning createdAt status model resultStorageKeys error generationErrorCode generationOperation attachments references settings taskIds clientOperationId retryOf attemptGroupId generationStage generationEffectKeys errorKind mediaRecoverable syncInterrupted")
	allowedSet := map[string]bool{}
	for _, key := range allowed {
		allowedSet[key] = true
	}
	for key := range input {
		if !allowedSet[key] {
			return "", nil, time.Time{}, BadAuthRequest("创作消息包含未支持的字段")
		}
	}
	if input["id"] != id || (input["role"] != "user" && input["role"] != "assistant") {
		return "", nil, time.Time{}, BadAuthRequest("无效的创作消息")
	}
	if _, ok := input["content"].(string); !ok {
		return "", nil, time.Time{}, BadAuthRequest("缺少消息正文")
	}
	created, err := time.Parse(time.RFC3339Nano, historyString(input["createdAt"]))
	if err != nil {
		return "", nil, time.Time{}, BadAuthRequest("无效的消息时间")
	}
	resources := map[string]bool{}
	validateKey := func(value any) bool {
		key, ok := value.(string)
		if !ok || !strings.HasPrefix(key, "resource:") || !historyID.MatchString(strings.TrimPrefix(key, "resource:")) {
			return false
		}
		resources[strings.TrimPrefix(key, "resource:")] = true
		return true
	}
	for key, value := range input {
		switch key {
		case "mediaRecoverable", "syncInterrupted":
			if _, ok := value.(bool); !ok {
				return "", nil, time.Time{}, BadAuthRequest("无效的消息状态")
			}
		case "attachments", "references":
			items, ok := value.([]any)
			if !ok || len(items) > 100 {
				return "", nil, time.Time{}, BadAuthRequest("无效的消息引用")
			}
			fields := "id name type storageKey previewStorageKey bytes width height durationMs nodeId kind label title text active sourceType assetId category mentionToken attachmentId toolId toolType toolIcon"
			for _, item := range items {
				record, ok := item.(map[string]any)
				if !ok {
					return "", nil, time.Time{}, BadAuthRequest("无效的消息引用")
				}
				for field, v := range record {
					if !strings.Contains(" "+fields+" ", " "+field+" ") {
						return "", nil, time.Time{}, BadAuthRequest("消息引用包含临时地址或未支持的字段")
					}
					if field == "storageKey" || field == "previewStorageKey" {
						if !validateKey(v) {
							return "", nil, time.Time{}, BadAuthRequest("消息媒体必须使用云端资源引用")
						}
					} else {
						switch v.(type) {
						case string, bool, float64:
						default:
							return "", nil, time.Time{}, BadAuthRequest("无效的消息引用字段")
						}
					}
				}
				if key == "attachments" && !validateKey(record["storageKey"]) {
					return "", nil, time.Time{}, BadAuthRequest("附件缺少云端资源引用")
				}
			}
		case "resultStorageKeys", "taskIds", "generationEffectKeys":
			items, ok := value.([]any)
			if !ok || len(items) > 100 {
				return "", nil, time.Time{}, BadAuthRequest("无效的消息标识列表")
			}
			for _, item := range items {
				if key == "resultStorageKeys" {
					if !validateKey(item) {
						return "", nil, time.Time{}, BadAuthRequest("结果缺少云端资源引用")
					}
				} else if _, ok := item.(string); !ok {
					return "", nil, time.Time{}, BadAuthRequest("无效的消息标识")
				}
			}
		case "settings":
			settings, ok := value.(map[string]any)
			if !ok {
				return "", nil, time.Time{}, BadAuthRequest("无效的创作参数")
			}
			for k, v := range settings {
				if !strings.Contains(" ratio seconds quality videoQuality count ", " "+k+" ") {
					return "", nil, time.Time{}, BadAuthRequest("不支持的创作参数")
				}
				if _, ok := v.(string); !ok {
					return "", nil, time.Time{}, BadAuthRequest("无效的创作参数值")
				}
			}
		default:
			if _, ok := value.(string); !ok {
				return "", nil, time.Time{}, BadAuthRequest("无效的消息字段")
			}
		}
	}
	encoded, err := json.Marshal(input)
	if err != nil || len(encoded) > 256<<10 {
		return "", nil, time.Time{}, BadAuthRequest("单条创作消息超过 256 KiB")
	}
	ids := []string{}
	for id := range resources {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return string(encoded), ids, created, nil
}

func historyString(value any) string { text, _ := value.(string); return text }

func (s *Service) SyncCreationHistory(userID, id string, req CreationHistoryMutation) (*CreationHistoryDetail, error) {
	if userID == "" || !historyID.MatchString(id) || len(req.Messages) > 100 {
		return nil, BadAuthRequest("无效的创作历史同步请求")
	}
	if req.Metadata != nil && (req.Metadata.Revision < 0 || utf8.RuneCountInString(req.Metadata.Title) > 120 || strings.TrimSpace(req.Metadata.Title) == "") {
		return nil, BadAuthRequest("无效的创作标题")
	}
	if req.Delete && (req.Metadata != nil || len(req.Messages) > 0) {
		return nil, BadAuthRequest("删除不能混合其他修改")
	}
	conflicts := []string{}
	var result *CreationHistoryDetail
	err := s.repo.MutateCreationConversation(userID, id, func(row *model.CreationConversation, repo *repository.Repository) error {
		if row.Deleted {
			result = &CreationHistoryDetail{CreationConversation: *row, Messages: []CreationHistoryMessage{}, Conflicts: []string{}}
			return nil
		}
		if req.Delete {
			row.Deleted = true
			row.Title = ""
			row.CanvasID = ""
			row.Revision++
			row.UpdatedAt = time.Now().UTC()
			if err := repo.ClearCreationConversationMessages(userID, id); err != nil {
				return err
			}
			result = &CreationHistoryDetail{CreationConversation: *row, Messages: []CreationHistoryMessage{}, Conflicts: []string{}}
			return nil
		}
		changed := false
		if metadata := req.Metadata; metadata != nil {
			if metadata.Title == row.Title && metadata.CanvasID == row.CanvasID { /* idempotent retry */
			} else if metadata.Revision != row.MetadataRevision {
				conflicts = append(conflicts, "metadata")
			} else {
				if metadata.CanvasID != "" {
					if _, err := repo.CanvasProjectForUser(userID, metadata.CanvasID); err != nil {
						return BadAuthRequest("关联画布不存在或无权访问")
					}
				}
				row.Title = metadata.Title
				row.CanvasID = metadata.CanvasID
				row.MetadataRevision++
				changed = true
			}
		}
		messages, err := repo.CreationConversationMessages(userID, id)
		if err != nil {
			return err
		}
		byID := map[string]model.CreationConversationMessage{}
		totalBytes := 0
		var sequence int64
		for _, item := range messages {
			byID[item.ID] = item
			totalBytes += len(item.PayloadJSON)
			if item.Sequence > sequence {
				sequence = item.Sequence
			}
		}
		seen := map[string]bool{}
		for _, item := range req.Messages {
			if !historyID.MatchString(item.ID) || item.Revision < 0 || seen[item.ID] {
				return BadAuthRequest("无效或重复的消息 ID")
			}
			seen[item.ID] = true
			old := byID[item.ID]
			if old.Revision == 0 && len(byID) >= 5000 {
				return BadAuthRequest("创作对话已达到历史容量上限")
			}
			if old.Deleted {
				if !item.Deleted {
					conflicts = append(conflicts, item.ID)
				}
				continue
			}
			if item.Deleted {
				if len(item.Data) > 0 {
					return BadAuthRequest("删除消息不能混合正文")
				}
				if old.Revision != item.Revision {
					conflicts = append(conflicts, item.ID)
					continue
				}
				old.UserID, old.ConversationID, old.ID = userID, id, item.ID
				old.Revision++
				old.Deleted = true
				totalBytes -= len(old.PayloadJSON)
				old.PayloadJSON = ""
				if err := repo.SaveCreationConversationMessage(&old, nil); err != nil {
					return err
				}
				byID[item.ID] = old
				changed = true
				continue
			}
			payload, resources, created, err := historyPayload(item.Data, item.ID)
			if err != nil {
				return err
			}
			if old.PayloadJSON == payload {
				continue
			}
			if old.Revision != item.Revision {
				conflicts = append(conflicts, item.ID)
				continue
			}
			if old.Revision > 0 {
				var previous map[string]any
				if err := json.Unmarshal([]byte(old.PayloadJSON), &previous); err != nil {
					return err
				}
				if previous["status"] == "done" && item.Data["status"] != "done" {
					conflicts = append(conflicts, item.ID)
					continue
				}
			}
			owned, err := repo.CreationHistoryResources(userID, resources)
			if err != nil {
				return err
			}
			if len(owned) != len(resources) {
				return BadAuthRequest("消息引用的资源不存在或无权访问")
			}
			for _, resource := range owned {
				if resource.Status != model.ResourceStatusReady {
					return BadAuthRequest("消息引用的资源尚不可用")
				}
			}
			if tasks, ok := item.Data["taskIds"].([]any); ok {
				for _, taskID := range tasks {
					task, err := repo.Task(historyString(taskID))
					if err != nil || task.UserID != userID {
						return BadAuthRequest("关联任务不存在或无权访问")
					}
				}
			}
			totalBytes += len(payload) - len(old.PayloadJSON)
			if totalBytes > 16<<20 || (old.Revision == 0 && len(byID) >= 5000) {
				return BadAuthRequest("创作对话已达到历史容量上限")
			}
			message := model.CreationConversationMessage{UserID: userID, ConversationID: id, ID: item.ID, Revision: old.Revision + 1, PayloadJSON: payload, CreatedAt: created}
			if old.Revision > 0 {
				message.CreatedAt = old.CreatedAt
				message.Sequence = old.Sequence
			} else {
				sequence++
				message.Sequence = sequence
			}
			if err := repo.SaveCreationConversationMessage(&message, resources); err != nil {
				return err
			}
			byID[item.ID] = message
			changed = true
		}
		if changed {
			row.Revision++
			row.UpdatedAt = time.Now().UTC()
		}
		// Read inside the write transaction so payload and per-message revisions share one snapshot.
		result, err = historyDetail(repo, userID, id)
		if err != nil {
			return err
		}
		result.CreationConversation = *row
		result.Conflicts = conflicts
		return nil
	})
	return result, err
}
