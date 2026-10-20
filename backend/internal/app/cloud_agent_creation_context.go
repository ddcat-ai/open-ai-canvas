package app

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/model"
)

type CloudAgentCreationContextEntry struct {
	Role        string   `json:"role"`
	Mode        string   `json:"mode"`
	Content     string   `json:"content,omitempty"`
	TaskIDs     []string `json:"taskIds,omitempty"`
	ResourceIDs []string `json:"resourceIds,omitempty"`
}

func validateCloudAgentCreationContext(req *CloudAgentRequest) error {
	if len(req.CreationContext) == 0 {
		return nil
	}
	if req.Surface != "creation" || len(req.CreationContext) > 20 {
		return BadAuthRequest("普通创作上下文仅适用于首页，最多 20 条")
	}
	chars, tasks, resources := 0, 0, 0
	for _, entry := range req.CreationContext {
		if (entry.Role != "user" && entry.Role != "assistant") || (entry.Mode != "image" && entry.Mode != "video" && entry.Mode != "text") || !utf8.ValidString(entry.Content) {
			return BadAuthRequest("普通创作上下文类型无效")
		}
		chars += utf8.RuneCountInString(entry.Content)
		tasks += len(entry.TaskIDs)
		resources += len(entry.ResourceIDs)
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
	if chars > 12000 || tasks > 32 || resources > 32 {
		return BadAuthRequest("普通创作上下文超过 12000 字符、32 个任务或 32 个素材，请缩小范围")
	}
	return nil
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
func (s *Service) cloudAgentCreationContext(userID string, req CloudAgentRequest) (string, error) {
	if len(req.CreationContext) == 0 {
		return "", nil
	}
	entries := make([]map[string]any, 0, len(req.CreationContext))
	seen := map[string]bool{}
	seenResources := map[string]bool{}
	for _, entry := range req.CreationContext {
		item := map[string]any{"role": entry.Role, "mode": entry.Mode}
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
		entries = append(entries, item)
	}
	frame := map[string]any{"source": "creation_mode_history", "dialogueTrust": "user_provided_untrusted", "taskFactsSource": "owned_server_records", "snapshot": "current_at_admission", "entries": entries}
	for {
		encoded, err := json.Marshal(frame)
		if err != nil || len(encoded) <= 64<<10 {
			return string(encoded), err
		}
		entries = entries[1:]
		frame["entries"], frame["olderEntriesTruncated"] = entries, true
	}
}
