package app

import (
	"fmt"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

type AccountFileStorageUsage struct {
	UsedBytes  int64 `json:"usedBytes"`
	TotalBytes int64 `json:"totalBytes"`
}

func (s *Service) AccountFileStorageUsage(userID string) (*AccountFileStorageUsage, error) {
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	usedBytes, err := s.repo.UserStoredFileBytes(userID)
	if err != nil {
		return nil, err
	}
	return &AccountFileStorageUsage{
		UsedBytes:  usedBytes,
		TotalBytes: gigabytes(policy.Resource.StoredFileGB),
	}, nil
}

func structuredBytes(usage repository.UserStorageUsage) int64 {
	return usage.AssetBytes + usage.CanvasBytes
}

func validateStructuredStorageQuotaWithPolicy(usage repository.UserStorageUsage, kind string, creating bool, deltaBytes int64, policy RuntimeResourcePolicy) error {
	if structuredBytes(usage)+deltaBytes > megabytes(policy.StructuredDataMB) {
		return QuotaExceeded(fmt.Sprintf("账号画布和素材数据已达到 %dMB 上限，请先删除不需要的内容", policy.StructuredDataMB))
	}
	if !creating {
		return nil
	}
	switch kind {
	case "asset":
		if usage.AssetCount >= policy.AssetCount {
			return QuotaExceeded(fmt.Sprintf("账号素材数量已达到 %d 个上限", policy.AssetCount))
		}
	case "canvas":
		if usage.CanvasCount >= policy.CanvasCount {
			return QuotaExceeded(fmt.Sprintf("账号画布数量已达到 %d 个上限", policy.CanvasCount))
		}
	}
	return nil
}

func validateTaskStorageQuotaWithPolicy(usage repository.UserStorageUsage, incomingBytes int64, policy RuntimeResourcePolicy) error {
	if usage.TaskCount >= policy.TaskCount {
		return QuotaExceeded(fmt.Sprintf("账号任务历史已达到 %d 条上限，请联系管理员归档", policy.TaskCount))
	}
	return validateTaskDataGrowthQuotaWithPolicy(usage, incomingBytes, policy)
}

func validateTaskDataGrowthQuotaWithPolicy(usage repository.UserStorageUsage, incomingBytes int64, policy RuntimeResourcePolicy) error {
	if usage.TaskBytes+incomingBytes > gigabytes(policy.TaskDataGB) {
		return QuotaExceeded(fmt.Sprintf("账号任务历史数据已达到 %dGB 上限，请联系管理员归档", policy.TaskDataGB))
	}
	return nil
}

func validateAPICallLogQuotaWithPolicy(usage repository.UserStorageUsage, incomingBytes int64, policy RuntimeResourcePolicy) error {
	if usage.APICallCount >= policy.APICallLogCount {
		return QuotaExceeded(fmt.Sprintf("账号上游请求日志已达到 %d 条上限，请联系管理员归档", policy.APICallLogCount))
	}
	return validateTaskDataGrowthQuotaWithPolicy(usage, incomingBytes, policy)
}

func validateStructuredReplacementQuotaWithPolicy(usage repository.UserStorageUsage, kind string, count int, bytes int64, policy RuntimeResourcePolicy) error {
	deltaBytes := bytes
	switch kind {
	case "asset":
		if int64(count) > policy.AssetCount {
			return QuotaExceeded(fmt.Sprintf("账号素材数量不能超过 %d 个", policy.AssetCount))
		}
		deltaBytes -= usage.AssetBytes
	case "canvas":
		if int64(count) > policy.CanvasCount {
			return QuotaExceeded(fmt.Sprintf("账号画布数量不能超过 %d 个", policy.CanvasCount))
		}
		deltaBytes -= usage.CanvasBytes
	}
	return validateStructuredStorageQuotaWithPolicy(usage, kind, false, deltaBytes, policy)
}

func (s *Service) createTaskWithinStorageQuota(task *model.Task, billingOrder *model.BillingOrder, policy RuntimePolicySetting) error {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	return createTaskWithStorageQuotaRepository(s.repo, task, billingOrder, policy)
}

func createTaskWithStorageQuotaRepository(repo *repository.Repository, task *model.Task, billingOrder *model.BillingOrder, policy RuntimePolicySetting) error {
	usage, err := repo.UserStorageUsage(task.UserID)
	if err != nil {
		return err
	}
	incomingBytes := int64(len([]byte(task.Prompt)) + len([]byte(task.InputJSON)) + len([]byte(task.Error)))
	if err := validateTaskStorageQuotaWithPolicy(usage, incomingBytes, policy.Resource); err != nil {
		return err
	}
	if billingOrder != nil {
		return repo.CreateTaskWithCreditReservation(task, billingOrder, policy.Task.ActiveTaskLimit)
	}
	return repo.CreateTaskWithActiveLimit(task, policy.Task.ActiveTaskLimit)
}

// 任务完成会同时扩张任务历史和画布操作数据，必须在同一临界区核算并原子写入。
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

	results := make([]model.Result, 0, 2)
	structuredDelta := int64(0)
	if hasCanvasOps {
		results = append(results, model.Result{ID: newID(), UserID: task.UserID, TaskID: task.ID, Kind: "canvas_ops", Payload: string(opsJSON)})
	}
	for index := range results {
		taskDelta += int64(len(results[index].URL) + len(results[index].Payload))
	}
	if err := validateTaskDataGrowthQuotaWithPolicy(usage, taskDelta, policy.Resource); err != nil {
		return err
	}
	if err := validateStructuredStorageQuotaWithPolicy(usage, "canvas", false, structuredDelta, policy.Resource); err != nil {
		return err
	}

	expectedStatus := task.Status
	completed := *task
	completed.Status = model.TaskStatusSucceeded
	completed.Stage = "任务完成"
	completed.Progress = 100
	completed.ResultJSON = string(resultJSON)
	completed.InputJSON = publicInputJSON
	completed.CompletedAt = ptr(time.Now())
	var register func(*repository.Repository) error
	if task.MediaRecoveryJSON != "" {
		completed.MediaStage = "completed"
		register = func(repo *repository.Repository) error {
			writer := &Service{repo: repo, dataDir: s.dataDir}
			if err := writer.RegisterTaskOutputFromTask(completed); err != nil {
				return err
			}
			return writer.registerRecoveredMediaAssets(completed)
		}
	}
	if err := s.repo.SaveTaskCompletionWithRegistration(&completed, expectedStatus, results, register); err != nil {
		return err
	}
	*task = completed
	return nil
}
