package app

import (
	"errors"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

type cloudAgentMediaRetryPolicy struct {
	RequiresPromptChange bool
}

// A failed local task does not prove that its provider rejected the request.
// All retry entry points must establish the submission outcome before billing
// another task, independently of whether the prompt will change.
func (s *Service) cloudAgentMediaRetryPolicy(userID string, task *model.Task) (cloudAgentMediaRetryPolicy, error) {
	policy := cloudAgentMediaRetryPolicy{}
	if task == nil || task.UserID != userID || task.Status != model.TaskStatusFailed || task.Type != "canvas_image" && task.Type != "canvas_video" && task.Type != "canvas_audio" {
		return policy, BadAuthRequest("只能重试当前用户已确认失败的媒体任务")
	}
	if task.MediaRecoveryJSON != "" {
		return policy, BadAuthRequest("作品已有待恢复产物，请重试保存，不要重复生成")
	}
	uncertain := func() (cloudAgentMediaRetryPolicy, error) {
		return policy, creationConflict("原任务的上游提交结果尚未确认，请先恢复或核对原任务，不能重复生成")
	}
	if task.ProviderRequestID != "" || task.ProviderCancelStatus == model.ProviderCancelStatusRequested {
		return uncertain()
	}
	attempts, err := s.repo.RouteAttempts(task.ID, task.RouteRun)
	if err != nil {
		return policy, err
	}
	if len(attempts) == 0 {
		diagnostic := taskExecutionDiagnostic(task)
		if diagnostic == nil || diagnostic.TaskSubmitted || diagnostic.SubmissionOutcome != "not_submitted" {
			return uncertain()
		}
		policy.RequiresPromptChange = cloudAgentMediaContentRejection(task.Error)
	}
	for _, attempt := range attempts {
		if attempt.ProviderRequestID != "" {
			return uncertain()
		}
		switch attempt.DispatchState {
		case "not_sent":
			if attempt.Status != "selected" && attempt.Status != "failed" {
				return uncertain()
			}
		case "rejected_no_job", "failed_no_output":
			if attempt.Status != "failed" {
				return uncertain()
			}
		default:
			return uncertain()
		}
		// The last rejected route supplies the current failure reason; an earlier
		// content rejection must not turn a later account outage into prompt repair.
		policy.RequiresPromptChange = cloudAgentMediaContentRejection(attempt.FailureCode) || cloudAgentMediaContentRejection(attempt.FailureMessage)
	}
	if task.BillingOrderID != "" {
		order, err := s.repo.BillingOrder(task.BillingOrderID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return policy, creationConflict("原任务账务记录不可用，请稍后重试或联系管理员")
		}
		if err != nil {
			return policy, err
		}
		if order.UserID != userID || order.TaskID != task.ID {
			return policy, creationConflict("原任务账务记录与任务归属不一致，不能重复生成")
		}
		if order.Status != model.BillingStatusSettled && order.Status != model.BillingStatusRefunded {
			return policy, creationConflict("原任务费用仍在核对中，确认前不能重复生成")
		}
	}
	return policy, nil
}

func cloudAgentMediaContentRejection(message string) bool {
	lower := strings.ToLower(message)
	// Use explicit rejection identifiers/messages, never generic HTTP status,
	// "blocked", "forbidden" or "safety" that may describe service access.
	for _, marker := range []string{
		contentModerationErrorCode, "content_policy_violation", "content_filter", "moderation_blocked",
		"prompt may violate our content policies", "content policy violation", "content violates",
		"rejected by the safety system", "blocked by content moderation", "blocked by the safety filter", "blocked by content policy",
		"未通过模型服务安全审核", "内容审核未通过", "内容安全审核未通过", "内容的防护限制",
	} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}
