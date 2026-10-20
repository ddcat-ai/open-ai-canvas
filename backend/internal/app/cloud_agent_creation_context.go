package app

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/model"
)

type CloudAgentCreationContextEntry struct {
	MessageID   string   `json:"messageId,omitempty"`
	Role        string   `json:"role"`
	Mode        string   `json:"mode"`
	Content     string   `json:"content,omitempty"`
	TaskIDs     []string `json:"taskIds,omitempty"`
	ResourceIDs []string `json:"resourceIds,omitempty"`
}

type CloudAgentCreationVisibleResult struct {
	MessageID string   `json:"messageId"`
	TaskIDs   []string `json:"taskIds"`
}

func validateCloudAgentCreationContext(req *CloudAgentRequest) error {
	if latest := req.LatestVisibleResult; latest != nil {
		if req.Surface != "creation" || latest.MessageID == "" || len(latest.TaskIDs) == 0 {
			return BadAuthRequest("当前可见成品需要首页消息和任务身份")
		}
		if err := validateCloudAgentID(latest.MessageID, "成品消息 ID", 80); err != nil {
			return err
		}
		for _, id := range latest.TaskIDs {
			if err := validateCloudAgentID(id, "成品任务 ID", 80); err != nil {
				return err
			}
		}
	}
	if len(req.CreationContext) == 0 {
		return nil
	}
	if req.Surface != "creation" {
		return BadAuthRequest("普通创作上下文仅适用于首页")
	}
	seen := map[string]bool{}
	for _, entry := range req.CreationContext {
		if (entry.Role != "user" && entry.Role != "assistant") || (entry.Mode != "image" && entry.Mode != "video" && entry.Mode != "text") || !utf8.ValidString(entry.Content) {
			return BadAuthRequest("普通创作上下文类型无效")
		}
		if entry.MessageID != "" {
			if err := validateCloudAgentID(entry.MessageID, "普通创作消息 ID", 80); err != nil {
				return err
			}
			if seen[entry.MessageID] {
				return BadAuthRequest("普通创作消息 ID 不能重复")
			}
			seen[entry.MessageID] = true
		}
		for _, id := range entry.TaskIDs {
			if err := validateCloudAgentID(id, "普通创作任务 ID", 80); err != nil {
				return err
			}
		}
		for _, id := range entry.ResourceIDs {
			if err := validateCloudAgentID(id, "普通创作素材 ID", 80); err != nil {
				return err
			}
		}
	}
	return nil
}

// 页面位置只是指代线索，不授权新资源；成品事实仍通过原有会话归属边界读取。
func (s *Service) cloudAgentCreationVisibleResult(userID string, req CloudAgentRequest) (map[string]any, error) {
	if req.LatestVisibleResult == nil {
		return nil, nil
	}
	state := cloudAgentRuntime{Request: req}
	tasks := []map[string]any{}
	seen := map[string]bool{}
	for _, id := range req.LatestVisibleResult.TaskIDs {
		if seen[id] {
			continue
		}
		seen[id] = true
		task, err := cloudAgentCreationSessionTask(s.repo, userID, &state, id)
		if err != nil {
			return nil, BadAuthRequest("当前可见成品不属于本会话，请刷新后重试")
		}
		tasks = append(tasks, map[string]any{"taskId": task.ID, "kind": strings.TrimPrefix(task.Type, "canvas_"), "status": task.Status, "outputs": cloudAgentCreationTaskOutputs(task)})
	}
	return map[string]any{"messageId": req.LatestVisibleResult.MessageID, "tasks": tasks}, nil
}

func cloudAgentCreationContextHasTask(req CloudAgentRequest, taskID string) bool {
	for _, entry := range req.CreationContext {
		for _, id := range entry.TaskIDs {
			if id == taskID {
				return true
			}
		}
	}
	return false
}

func cloudAgentCreationContextAllowsTask(req CloudAgentRequest, task *model.Task) bool {
	return task != nil && req.Surface == "creation" && task.ProjectID == "" && task.AgentRunID == "" && task.Operation != cloudAgentOperation &&
		(task.Type == "canvas_image" || task.Type == "canvas_video" || task.Type == "canvas_text") && cloudAgentCreationContextHasTask(req, task.ID)
}

func cloudAgentWithoutPriorCreationContext(history []providerTextMessage) []providerTextMessage {
	current := make([]providerTextMessage, 0, len(history))
	for _, message := range history {
		var frame struct {
			Source string `json:"source"`
		}
		if message.AgentContextSource == "continuation" && json.Unmarshal([]byte(message.Content), &frame) == nil && frame.Source == "creation_mode_history" {
			continue
		}
		current = append(current, message)
	}
	return current
}

// Browser dialogue is untrusted user content. Task status and output identities
// are independently resolved from owned records; URLs and client status never enter.
func (s *Service) cloudAgentCreationContext(userID string, req CloudAgentRequest, nativeSession ...string) (string, error) {
	if len(req.CreationContext) == 0 {
		return "", nil
	}
	entries := make([]map[string]any, 0, len(req.CreationContext))
	var imported map[string]map[string]any
	if len(nativeSession) > 0 {
		imported = cloudAgentCreationContextImports(nativeSession[0])
	}
	seen := map[string]bool{}
	seenResources := map[string]bool{}
	for _, entry := range req.CreationContext {
		item := map[string]any{"role": entry.Role, "mode": entry.Mode}
		if entry.MessageID != "" {
			item["messageId"] = entry.MessageID
		}
		if entry.Content != "" {
			item["userProvidedContent"] = entry.Content
		}
		var tasks []map[string]any
		for _, id := range entry.TaskIDs {
			if seen[id] {
				continue
			}
			seen[id] = true
			task, err := s.repo.TaskForUser(userID, id)
			if err != nil || !cloudAgentCreationContextAllowsTask(req, task) {
				return "", BadAuthRequest("普通创作任务不存在、不属于当前用户或不是普通生成任务")
			}
			s.hydrateTaskProviderRequestID(task)
			if err := s.reconcileRecordedTaskRejection(task); err != nil {
				return "", err
			}
			fact := cloudAgentTaskDiagnostic(s.repo, task)
			fact["kind"], fact["status"], fact["prompt"] = strings.TrimPrefix(task.Type, "canvas_"), task.Status, truncateRunes(task.Prompt, 1200)
			if task.Status == model.TaskStatusSucceeded {
				outputs := cloudAgentCreationTaskOutputs(task)
				if len(outputs) > 10 {
					outputs = outputs[:10]
					fact["outputsTruncated"] = true
				}
				fact["outputs"] = outputs
			}
			tasks = append(tasks, fact)
		}
		if len(tasks) > 0 {
			item["tasks"] = tasks
		}
		var references []map[string]any
		for _, id := range entry.ResourceIDs {
			if seenResources[id] {
				continue
			}
			seenResources[id] = true
			fact, err := cloudAgentCreationReferenceMetadata(s.repo, userID, CloudAgentAttachment{ResourceID: id})
			if err != nil {
				return "", err
			}
			references = append(references, fact)
		}
		if len(references) > 0 {
			item["references"] = references
		}
		if delta := cloudAgentCreationContextDelta(item, imported[entry.MessageID]); len(delta) > 0 {
			entries = append(entries, delta)
		}
	}
	if len(entries) == 0 {
		return "", nil
	}
	frame := map[string]any{"source": "creation_mode_history", "dialogueTrust": "user_provided_untrusted", "taskFactsSource": "owned_server_records", "snapshot": "current_at_admission", "entries": entries}
	encoded, err := json.Marshal(frame)
	return string(encoded), err
}
