package app

import (
	"encoding/json"
	"fmt"
	"strings"

	"yingce/backend/internal/model"
)

type CloudAgentCreationRetry struct {
	RunID   string   `json:"runId"`
	TaskID  string   `json:"taskId,omitempty"`
	TaskIDs []string `json:"taskIds,omitempty"`
}

// A retry is an explicit button action, not an invented user chat message.
// Resolve its scope server-side before any new model or media task is admitted.
func (s *Service) cloudAgentCreationRetryContext(userID string, req *CloudAgentRequest, parentID string) (string, error) {
	if req.Surface != "creation" || parentID == "" || req.Retry == nil || req.Retry.RunID == "" {
		return "", BadAuthRequest("重试必须指定当前首页会话中的失败轮次")
	}
	run, err := s.repo.CloudAgent(userID, req.Retry.RunID)
	if err != nil || run.Surface != "creation" || run.SessionID != req.SessionID || !cloudAgentRunTerminal(run.Status) || run.CleanupPending {
		return "", BadAuthRequest("只能重试本会话中已结束的失败步骤")
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		return "", err
	}
	targets := req.Retry.TaskIDs
	if len(targets) > 20 || (req.Retry.TaskID != "" && len(targets) > 0) {
		return "", BadAuthRequest("重试须选择单个任务或最多 20 个失败任务，不能混用")
	}
	if req.Retry.TaskID != "" {
		targets = []string{req.Retry.TaskID}
	}
	references := state.Request
	if len(targets) > 0 {
		references.Attachments = nil
	}
	seenTasks, seenReferences := map[string]bool{}, map[string]bool{}
	for _, taskID := range targets {
		if validateCloudAgentID(taskID, "失败任务 ID", 80) != nil || seenTasks[taskID] {
			return "", BadAuthRequest("重试任务 ID 无效或重复")
		}
		seenTasks[taskID] = true
		task, err := cloudAgentCreationSessionTask(s.repo, userID, &state, taskID)
		if err != nil || task.AgentRunID != run.ID || task.Status != model.TaskStatusFailed || task.MediaRecoveryJSON != "" {
			return "", BadAuthRequest("原任务仍在生成、已完成或有待恢复产物，请先读取原任务，不重复生成")
		}
		if _, err := s.cloudAgentMediaRetryPolicy(userID, task); err != nil {
			return "", err
		}
		var input map[string]any
		if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
			return "", BadAuthRequest("原任务输入无法恢复，请重新选择素材")
		}
		for _, kind := range []string{"image", "video", "audio"} {
			for _, item := range creationMaps(input[cloudAgentReferenceAdapters[kind].PayloadField]) {
				key := stringField(item, "storageKey")
				if !strings.HasPrefix(key, "resource:") {
					return "", BadAuthRequest("原任务缺少稳定素材标识，请重新选择素材")
				}
				id := strings.TrimPrefix(key, "resource:")
				if seenReferences[key] {
					continue
				}
				seenReferences[key] = true
				references.Attachments = append(references.Attachments, CloudAgentAttachment{ResourceID: id, StorageKey: key, Kind: kind, Role: firstNonEmpty(stringField(item, "role"), "reference"), Name: firstNonEmpty(stringField(item, "name"), id)})
			}
		}
	}
	if len(targets) == 0 && run.Status != "failed" {
		return "", BadAuthRequest("该轮次未失败，请指定实际失败的媒体任务")
	} else if len(targets) == 0 {
		references, err = cloudAgentCreationRequestWithOutputs(s.repo, userID, &state)
		if err != nil {
			return "", err
		}
	}
	// A retry can target an older turn. Its source set must not come from the
	// latest conversation turn or the unsent composer draft.
	references.AttachmentMode = "replace"
	if err := s.resolveCloudAgentCreationAttachments(userID, &references, nil); err != nil {
		return "", err
	}
	req.Attachments, req.AttachmentMode = references.Attachments, "replace"
	return fmt.Sprintf("用户点击了重试失败项（服务端已逐项核对归属与失败状态）。目标 runId=%s，taskIds=%s。原轮用户要求：%s。保留历史中已确认的约束及成功结果，只处理列出的全部失败项；列表为空时只恢复该轮失败步骤。逐项查询原任务，并按每项原素材映射恢复，不能把合并后的素材清单全部塞进每张图片；进行中、已成功或结果未知的任务不得重发。普通创作不加载专业工作流；原步骤属于电商计划时按需读取对应技能并加载 commerce，已有失败交付逐项用 retryFailedTaskId 和原 commerceItemId 重试，不重新提交或改写同版本计划。仅参数校验失败且未提交时，修正参数再执行。不要把重试指令写给用户让其再次发送。当前权限与预算仍有效。", run.ID, mustMarshal(targets), truncateRunes(state.Request.Prompt, 4000)), nil
}
