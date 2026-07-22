package service

import (
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const (
	MaxUserStructuredDataBytes int64 = 256 << 20
	MaxUserTaskDataBytes       int64 = 1 << 30
	MaxUserAssetCount                = 2_000
	MaxUserCanvasCount               = 1_000
	MaxUserSessionCount              = 1_000
	MaxUserTaskCount                 = 20_000
	MaxUserAPICallLogCount           = 100_000
)

func structuredBytes(usage repository.UserStorageUsage) int64 {
	return usage.AssetBytes + usage.CanvasBytes + usage.SessionBytes
}

func validateStructuredStorageQuota(usage repository.UserStorageUsage, kind string, creating bool, deltaBytes int64) error {
	if structuredBytes(usage)+deltaBytes > MaxUserStructuredDataBytes {
		return BadAuthRequest("账号画布、素材和会话数据已达到 256MB 上限，请先删除不需要的内容")
	}
	if !creating {
		return nil
	}
	switch kind {
	case "asset":
		if usage.AssetCount >= MaxUserAssetCount {
			return BadAuthRequest("账号素材数量已达到 2000 个上限")
		}
	case "canvas":
		if usage.CanvasCount >= MaxUserCanvasCount {
			return BadAuthRequest("账号画布数量已达到 1000 个上限")
		}
	case "session":
		if usage.SessionCount >= MaxUserSessionCount {
			return BadAuthRequest("账号 Agent 会话数量已达到 1000 个上限")
		}
	}
	return nil
}

func validateTaskStorageQuota(usage repository.UserStorageUsage, incomingBytes int64) error {
	if usage.TaskCount >= MaxUserTaskCount {
		return BadAuthRequest("账号任务历史已达到 20000 条上限，请联系管理员归档")
	}
	return validateTaskDataGrowthQuota(usage, incomingBytes)
}

func validateTaskDataGrowthQuota(usage repository.UserStorageUsage, incomingBytes int64) error {
	if usage.TaskBytes+incomingBytes > MaxUserTaskDataBytes {
		return BadAuthRequest("账号任务历史数据已达到 1GB 上限，请联系管理员归档")
	}
	return nil
}

func validateAPICallLogQuota(usage repository.UserStorageUsage, incomingBytes int64) error {
	if usage.APICallCount >= MaxUserAPICallLogCount {
		return BadAuthRequest("账号上游请求日志已达到 100000 条上限，请联系管理员归档")
	}
	return validateTaskDataGrowthQuota(usage, incomingBytes)
}

func validateStructuredReplacementQuota(usage repository.UserStorageUsage, kind string, count int, bytes int64) error {
	deltaBytes := bytes
	switch kind {
	case "asset":
		if count > MaxUserAssetCount {
			return BadAuthRequest("账号素材数量不能超过 2000 个")
		}
		deltaBytes -= usage.AssetBytes
	case "canvas":
		if count > MaxUserCanvasCount {
			return BadAuthRequest("账号画布数量不能超过 1000 个")
		}
		deltaBytes -= usage.CanvasBytes
	}
	return validateStructuredStorageQuota(usage, kind, false, deltaBytes)
}

func (s *Service) createTaskWithinStorageQuota(task *model.Task, billingOrder *model.BillingOrder) error {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	usage, err := s.repo.UserStorageUsage(task.UserID)
	if err != nil {
		return err
	}
	incomingBytes := int64(len([]byte(task.Prompt)) + len([]byte(task.InputJSON)) + len([]byte(task.Error)))
	if err := validateTaskStorageQuota(usage, incomingBytes); err != nil {
		return err
	}
	if billingOrder != nil {
		return s.repo.CreateTaskWithCreditReservation(task, billingOrder)
	}
	return s.repo.CreateTaskWithActiveLimit(task)
}

// 任务完成会同时扩张任务历史和 Agent 会话数据，必须在同一临界区核算并原子写入。
func (s *Service) saveTaskCompletionWithinStorageQuota(task *model.Task, resultJSON []byte, opsJSON []byte, hasCanvasOps bool) error {
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
	if err := validateTaskDataGrowthQuota(usage, taskDelta); err != nil {
		return err
	}
	if err := validateStructuredStorageQuota(usage, "session", false, structuredDelta); err != nil {
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
