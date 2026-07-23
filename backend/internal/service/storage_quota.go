package service

import (
	"fmt"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func structuredBytes(usage repository.UserStorageUsage) int64 {
	return usage.AssetBytes + usage.CanvasBytes + usage.SessionBytes
}

func validateStructuredStorageQuotaWithPolicy(usage repository.UserStorageUsage, kind string, creating bool, deltaBytes int64, policy RuntimeResourcePolicy) error {
	if structuredBytes(usage)+deltaBytes > megabytes(policy.StructuredDataMB) {
		return BadAuthRequest(fmt.Sprintf("账号画布、素材和会话数据已达到 %dMB 上限，请先删除不需要的内容", policy.StructuredDataMB))
	}
	if !creating {
		return nil
	}
	switch kind {
	case "asset":
		if usage.AssetCount >= policy.AssetCount {
			return BadAuthRequest(fmt.Sprintf("账号素材数量已达到 %d 个上限", policy.AssetCount))
		}
	case "canvas":
		if usage.CanvasCount >= policy.CanvasCount {
			return BadAuthRequest(fmt.Sprintf("账号画布数量已达到 %d 个上限", policy.CanvasCount))
		}
	case "session":
		if usage.SessionCount >= policy.SessionCount {
			return BadAuthRequest(fmt.Sprintf("账号 Agent 会话数量已达到 %d 个上限", policy.SessionCount))
		}
	}
	return nil
}

func validateTaskStorageQuotaWithPolicy(usage repository.UserStorageUsage, incomingBytes int64, policy RuntimeResourcePolicy) error {
	if usage.TaskCount >= policy.TaskCount {
		return BadAuthRequest(fmt.Sprintf("账号任务历史已达到 %d 条上限，请联系管理员归档", policy.TaskCount))
	}
	return validateTaskDataGrowthQuotaWithPolicy(usage, incomingBytes, policy)
}

func validateTaskDataGrowthQuotaWithPolicy(usage repository.UserStorageUsage, incomingBytes int64, policy RuntimeResourcePolicy) error {
	if usage.TaskBytes+incomingBytes > gigabytes(policy.TaskDataGB) {
		return BadAuthRequest(fmt.Sprintf("账号任务历史数据已达到 %dGB 上限，请联系管理员归档", policy.TaskDataGB))
	}
	return nil
}

func validateAPICallLogQuotaWithPolicy(usage repository.UserStorageUsage, incomingBytes int64, policy RuntimeResourcePolicy) error {
	if usage.APICallCount >= policy.APICallLogCount {
		return BadAuthRequest(fmt.Sprintf("账号上游请求日志已达到 %d 条上限，请联系管理员归档", policy.APICallLogCount))
	}
	return validateTaskDataGrowthQuotaWithPolicy(usage, incomingBytes, policy)
}

func validateStructuredReplacementQuotaWithPolicy(usage repository.UserStorageUsage, kind string, count int, bytes int64, policy RuntimeResourcePolicy) error {
	deltaBytes := bytes
	switch kind {
	case "asset":
		if int64(count) > policy.AssetCount {
			return BadAuthRequest(fmt.Sprintf("账号素材数量不能超过 %d 个", policy.AssetCount))
		}
		deltaBytes -= usage.AssetBytes
	case "canvas":
		if int64(count) > policy.CanvasCount {
			return BadAuthRequest(fmt.Sprintf("账号画布数量不能超过 %d 个", policy.CanvasCount))
		}
		deltaBytes -= usage.CanvasBytes
	}
	return validateStructuredStorageQuotaWithPolicy(usage, kind, false, deltaBytes, policy)
}

func (s *Service) createTaskWithinStorageQuota(task *model.Task, billingOrder *model.BillingOrder, policy RuntimePolicySetting) error {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	usage, err := s.repo.UserStorageUsage(task.UserID)
	if err != nil {
		return err
	}
	incomingBytes := int64(len([]byte(task.Prompt)) + len([]byte(task.InputJSON)) + len([]byte(task.Error)))
	if err := validateTaskStorageQuotaWithPolicy(usage, incomingBytes, policy.Resource); err != nil {
		return err
	}
	if billingOrder != nil {
		return s.repo.CreateTaskWithCreditReservation(task, billingOrder, policy.Task.ActiveTaskLimit)
	}
	return s.repo.CreateTaskWithActiveLimit(task, policy.Task.ActiveTaskLimit)
}

// 任务完成会同时扩张任务历史和 Agent 会话数据，必须在同一临界区核算并原子写入。
func (s *Service) saveTaskCompletionWithinStorageQuota(task *model.Task, resultJSON []byte, opsJSON []byte, hasCanvasOps bool) error {
	policy, err := s.RuntimePolicy()
	if err != nil {
		return err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()

	usage, err := s.repo.UserStorageUsage(task.UserID)
	if err != nil {
		return err
	}
	publicInputJSON := publicTaskInputJSON(task.InputJSON)
	taskDelta := int64(len(resultJSON) + len(publicInputJSON) - len(task.ResultJSON) - len(task.InputJSON))

	var session *model.Session
	var message *model.Message
	results := make([]model.Result, 0, 2)
	structuredDelta := int64(0)
	if task.SessionID != "" {
		session, err = s.repo.SessionForUser(task.UserID, task.SessionID)
		if err != nil {
			return err
		}
		if hasCanvasOps {
			structuredDelta += int64(len(opsJSON) - len(session.CanvasOpsJSON))
			session.CanvasOpsJSON = string(opsJSON)
		}
		session.Status = model.SessionStatusCompleted
		message = &model.Message{
			ID: newID(), UserID: task.UserID, SessionID: task.SessionID, Role: "assistant",
			Content: "已生成影视级工作流分镜和画布回写操作。", Payload: string(resultJSON),
		}
		structuredDelta += int64(len(message.Content) + len(message.Payload))
		results = append(results, model.Result{ID: newID(), UserID: task.UserID, TaskID: task.ID, SessionID: task.SessionID, Kind: "generation_result", Payload: string(resultJSON)})
	}
	if hasCanvasOps {
		results = append(results, model.Result{ID: newID(), UserID: task.UserID, TaskID: task.ID, SessionID: task.SessionID, Kind: "canvas_ops", Payload: string(opsJSON)})
	}
	for index := range results {
		taskDelta += int64(len(results[index].URL) + len(results[index].Payload))
	}
	if err := validateTaskDataGrowthQuotaWithPolicy(usage, taskDelta, policy.Resource); err != nil {
		return err
	}
	if err := validateStructuredStorageQuotaWithPolicy(usage, "session", false, structuredDelta, policy.Resource); err != nil {
		return err
	}

	completed := *task
	completed.Status = model.TaskStatusSucceeded
	completed.Stage = "任务完成"
	completed.Progress = 100
	completed.ResultJSON = string(resultJSON)
	completed.InputJSON = publicInputJSON
	completed.CompletedAt = ptr(time.Now())
	if err := s.repo.SaveTaskCompletion(&completed, session, message, results); err != nil {
		return err
	}
	*task = completed
	return nil
}
