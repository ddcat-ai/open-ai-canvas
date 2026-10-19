package repository

import (
	"encoding/json"
	"errors"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// 显式重试不能绕过原任务状态校验；与任务创建、积分预占在同一事务内检查。
// 调用方先锁用户，与原任务的 /retry 保持一致，避免重试和新建交错预占。
func requireTaskRetrySource(tx *gorm.DB, task *model.Task) error {
	if task.InputJSON == "" {
		return nil
	}
	var input struct {
		Metadata map[string]json.RawMessage `json:"metadata"`
	}
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return kernel.BadAuthRequest("任务输入格式无效")
	}
	raw, exists := input.Metadata["retryOf"]
	if !exists {
		return nil
	}
	var sourceID string
	if err := json.Unmarshal(raw, &sourceID); err != nil || strings.TrimSpace(sourceID) == "" {
		return kernel.BadAuthRequest("重试来源任务无效")
	}
	var source model.Task
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&source, "id = ? AND user_id = ?", sourceID, task.UserID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return kernel.NotFound("重试来源任务不存在")
	}
	if err != nil {
		return err
	}
	if source.MediaRecoveryJSON != "" {
		return kernel.BadAuthRequest("作品已生成，请使用重试保存，不要重复生成")
	}
	if source.Status == model.TaskStatusSucceeded {
		return kernel.BadAuthRequest("原任务已完成，请刷新查看生成结果")
	}
	if source.Status != model.TaskStatusFailed && source.Status != model.TaskStatusCancelled {
		return kernel.BadAuthRequest("原任务仍在处理中，请等待结果，不要重复生成")
	}
	if source.ProviderCancelStatus == model.ProviderCancelStatusRequested {
		return kernel.BadAuthRequest("原任务正在取消，请稍后再试")
	}
	if err := requireTaskRetryDispatch(tx, &source); err != nil {
		return err
	}
	if source.BillingOrderID == "" {
		return nil
	}
	var order model.BillingOrder
	if err := tx.First(&order, "id = ? AND user_id = ? AND task_id = ?", source.BillingOrderID, task.UserID, source.ID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return kernel.BadAuthRequest("原任务账务记录不可用，请稍后重试或联系管理员")
		}
		return err
	}
	if order.Status != model.BillingStatusRefunded && order.Status != model.BillingStatusSettled {
		return kernel.BadAuthRequest("原任务账务尚未确认，请等待核对完成后重试")
	}
	return nil
}

// A local refund does not prove that an upstream request was never accepted.
func requireTaskRetryDispatch(tx *gorm.DB, source *model.Task) error {
	if source.Type != "canvas_image" && source.Type != "canvas_video" && source.Type != "canvas_audio" {
		return nil
	}
	var attempts []model.RouteAttempt
	if err := tx.Where("task_id = ? AND route_run = ?", source.ID, source.RouteRun).Find(&attempts).Error; err != nil {
		return err
	}
	unknown := func() error {
		return kernel.BadAuthRequest("原任务的上游提交结果尚未确认，请先查询原任务，不能重复生成")
	}
	confirmedUnsent := len(attempts) > 0 && source.ProviderRequestID == ""
	for _, attempt := range attempts {
		if attempt.DispatchState == "submission_unknown" {
			return unknown()
		}
		if attempt.ProviderRequestID != "" {
			confirmedUnsent = false
		}
		switch attempt.DispatchState {
		case "rejected_no_job":
			confirmedUnsent = confirmedUnsent && attempt.Status == "failed"
		case "not_sent":
			confirmedUnsent = confirmedUnsent && (attempt.Status == "failed" || attempt.Status == "selected")
		default:
			confirmedUnsent = false
		}
	}
	if source.ExecutionDiagnosticJSON != "" {
		var diagnostic model.TaskExecutionDiagnostic
		if json.Unmarshal([]byte(source.ExecutionDiagnosticJSON), &diagnostic) != nil {
			return unknown()
		}
		if (diagnostic.SubmissionOutcome == "unknown" || diagnostic.RetryClass == "reconcile_submission") && !confirmedUnsent {
			return unknown()
		}
	}
	return nil
}
