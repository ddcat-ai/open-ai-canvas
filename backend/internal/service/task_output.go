package service

import (
	"encoding/json"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

// TaskSummary 是任务列表/会话详情的读模型，不直接复用数据库 Task，避免把
// 渠道模型、供应线路和受保护输入泄露到普通用户接口。
type TaskSummary struct {
	ID                        string                     `json:"id"`
	SessionID                 string                     `json:"sessionId,omitempty"`
	ProjectID                 string                     `json:"projectId,omitempty"`
	Type                      string                     `json:"type"`
	Status                    model.TaskStatus           `json:"status"`
	Stage                     string                     `json:"stage"`
	Progress                  int                        `json:"progress"`
	Prompt                    string                     `json:"prompt"`
	Operation                 string                     `json:"operation,omitempty"`
	Provider                  string                     `json:"provider,omitempty"`
	Model                     string                     `json:"model,omitempty"`
	ProviderRequestID         string                     `json:"providerRequestId,omitempty"`
	ProviderCancelStatus      model.ProviderCancelStatus `json:"providerCancelStatus,omitempty"`
	ProviderCancelError       string                     `json:"providerCancelError,omitempty"`
	ProviderCancelAttempts    int                        `json:"providerCancelAttempts,omitempty"`
	ProviderCancelRequestedAt *time.Time                 `json:"providerCancelRequestedAt,omitempty"`
	ProviderCancelledAt       *time.Time                 `json:"providerCancelledAt,omitempty"`
	ErrorCode                 string                     `json:"errorCode,omitempty"`
	PreviewURL                string                     `json:"previewUrl,omitempty"`
	PreviewKind               string                     `json:"previewKind,omitempty"`
	Attempts                  int                        `json:"attempts"`
	StartedAt                 *time.Time                 `json:"startedAt"`
	CompletedAt               *time.Time                 `json:"completedAt"`
	CreatedAt                 time.Time                  `json:"createdAt"`
	UpdatedAt                 time.Time                  `json:"updatedAt"`
	Billing                   *TaskBillingSummary        `json:"billing,omitempty"`
	ClientContext             *TaskClientContext         `json:"clientContext,omitempty"`
}

type TaskClientContext struct {
	ConversationID string `json:"conversationId"`
	MessageID      string `json:"messageId"`
	BatchIndex     int    `json:"batchIndex,omitempty"`
	BatchCount     int    `json:"batchCount,omitempty"`
}

type TaskBillingSummary struct {
	AmountMicrocredits int64               `json:"amountMicrocredits"`
	Status             model.BillingStatus `json:"status"`
}

func taskSummariesForOutput(tasks []model.Task) []TaskSummary {
	return taskSummariesForOutputWithBilling(tasks, nil)
}

func taskSummariesForOutputWithBilling(tasks []model.Task, orders map[string]model.BillingOrder) []TaskSummary {
	result := make([]TaskSummary, 0, len(tasks))
	for _, task := range tasks {
		summary := taskSummaryForOutput(task)
		if order, ok := orders[task.ID]; ok {
			summary.Billing = &TaskBillingSummary{AmountMicrocredits: order.AmountMicrocredits, Status: order.Status}
			if summary.ProviderRequestID == "" {
				summary.ProviderRequestID = order.ProviderRequestID
			}
		}
		result = append(result, summary)
	}
	return result
}

func taskBillingTaskIDs(tasks []model.Task) []string {
	ids := make([]string, 0, len(tasks))
	seen := map[string]struct{}{}
	for _, task := range tasks {
		if task.BillingOrderID == "" {
			continue
		}
		if _, ok := seen[task.ID]; ok {
			continue
		}
		seen[task.ID] = struct{}{}
		ids = append(ids, task.ID)
	}
	return ids
}

func taskSummaryForOutput(task model.Task) TaskSummary {
	errorCode := ""
	if isContentModerationFailure(task.Error) {
		errorCode = contentModerationErrorCode
	}
	previewURL, previewKind := taskMediaPreview(task.ResultJSON, task.Type)
	return TaskSummary{
		ID:                        task.ID,
		SessionID:                 task.SessionID,
		ProjectID:                 task.ProjectID,
		Type:                      task.Type,
		Status:                    task.Status,
		Stage:                     task.Stage,
		Progress:                  task.Progress,
		Prompt:                    truncateRunes(task.Prompt, 500),
		Operation:                 task.Operation,
		Provider:                  task.Provider,
		Model:                     task.Model,
		ProviderRequestID:         task.ProviderRequestID,
		ProviderCancelStatus:      task.ProviderCancelStatus,
		ProviderCancelError:       task.ProviderCancelError,
		ProviderCancelAttempts:    task.ProviderCancelAttempts,
		ProviderCancelRequestedAt: task.ProviderCancelRequestedAt,
		ProviderCancelledAt:       task.ProviderCancelledAt,
		ErrorCode:                 errorCode,
		PreviewURL:                previewURL,
		PreviewKind:               previewKind,
		Attempts:                  task.Attempts,
		StartedAt:                 task.StartedAt,
		CompletedAt:               task.CompletedAt,
		CreatedAt:                 task.CreatedAt,
		UpdatedAt:                 task.UpdatedAt,
		ClientContext:             taskClientContext(task.InputJSON),
	}
}

// 列表只暴露创作页恢复所需的关联 ID，不下发完整任务输入或其他 metadata。
func taskClientContext(raw string) *TaskClientContext {
	var input struct {
		Metadata struct {
			Source         string `json:"source"`
			ConversationID string `json:"conversationId"`
			MessageID      string `json:"messageId"`
			BatchIndex     int    `json:"batchIndex"`
			BatchCount     int    `json:"batchCount"`
		} `json:"metadata"`
	}
	if json.Unmarshal([]byte(raw), &input) != nil || input.Metadata.Source != "create-page" || input.Metadata.ConversationID == "" || input.Metadata.MessageID == "" {
		return nil
	}
	return &TaskClientContext{
		ConversationID: input.Metadata.ConversationID,
		MessageID:      input.Metadata.MessageID,
		BatchIndex:     input.Metadata.BatchIndex,
		BatchCount:     input.Metadata.BatchCount,
	}
}

// 列表只暴露首个可访问媒体地址，避免把完整生成结果和内嵌数据带回前端。
func taskMediaPreview(raw string, taskType string) (string, string) {
	if strings.TrimSpace(raw) == "" {
		return "", ""
	}
	var payload any
	if json.Unmarshal([]byte(raw), &payload) != nil {
		return "", ""
	}
	defaultKind := "image"
	if strings.Contains(strings.ToLower(taskType), "video") {
		defaultKind = "video"
	}
	return findTaskMediaPreview(payload, defaultKind)
}

func findTaskMediaPreview(value any, hint string) (string, string) {
	switch item := value.(type) {
	case string:
		text := strings.TrimSpace(item)
		if !strings.HasPrefix(text, "/api/resources/") && !strings.HasPrefix(text, "http://") && !strings.HasPrefix(text, "https://") {
			return "", ""
		}
		kind := hint
		lower := strings.ToLower(text)
		if strings.Contains(lower, ".mp4") || strings.Contains(lower, ".webm") || strings.Contains(lower, ".mov") {
			kind = "video"
		} else if kind != "video" {
			kind = "image"
		}
		return text, kind
	case []any:
		for _, child := range item {
			if previewURL, previewKind := findTaskMediaPreview(child, hint); previewURL != "" {
				return previewURL, previewKind
			}
		}
	case map[string]any:
		for _, key := range []string{"images", "image", "video", "dataUrl", "url", "resultUrl", "outputUrl"} {
			child, exists := item[key]
			if !exists {
				continue
			}
			childHint := hint
			if key == "video" {
				childHint = "video"
			} else if key == "images" || key == "image" {
				childHint = "image"
			}
			if previewURL, previewKind := findTaskMediaPreview(child, childHint); previewURL != "" {
				return previewURL, previewKind
			}
		}
	}
	return "", ""
}

func truncateRunes(value string, limit int) string {
	text := []rune(value)
	if len(text) <= limit {
		return value
	}
	return string(text[:limit]) + "..."
}

func taskForOutput(task model.Task) *model.Task {
	task.InputJSON = publicTaskInputJSON(task.InputJSON)
	// 普通任务接口只暴露前台模型身份；渠道模型和供应线路属于管理员内部信息。
	task.LogicalModelRevisionID = ""
	task.RouteID = ""
	task.ChannelModelID = ""
	return &task
}

func publicTaskInputJSON(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		return ""
	}
	public := map[string]any{}
	// 任务完成后仍需依靠这些非敏感 ID 恢复项目产物归属；密钥等配置继续被过滤。
	for _, key := range []string{"mode", "metadata", "workflowStepId", "domainProjectId", "assetVersionId", "resourceId", "mediaType", "role"} {
		if value, ok := input[key]; ok {
			public[key] = value
		}
	}
	if len(public) == 0 {
		return ""
	}
	data, _ := json.Marshal(public)
	return string(data)
}
