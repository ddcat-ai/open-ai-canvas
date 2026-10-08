package app

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

// ensureFailedProviderAttemptLogged fills the task-level audit gap only when no
// provider log exists. This normally represents a preflight failure; the coarse
// request/state variants also preserve visibility if primary log persistence failed.
func (s *Service) ensureFailedProviderAttemptLogged(task model.Task, taskErr error) {
	if s == nil || s.repo == nil || strings.TrimSpace(task.ID) == "" || taskErr == nil {
		return
	}
	hasVisibleFailure, err := s.repo.HasVisibleFailedAPICallLogForTask(task.ID)
	if err != nil {
		log.Printf("provider attempt log lookup failed: task_id=%s error=%v", task.ID, err)
		return
	}
	// 已有一条管理端默认可看到的失败日志时不再补写。只存在成功日志或被列表隐藏的轮询/下载日志时，
	// 用户看到的失败原因仍然不在请求明细里，需要补一条失败记录。
	if hasVisibleFailure {
		return
	}

	metadata := providerAnalyticsContext{
		UserID:            task.UserID,
		TaskID:            task.ID,
		TraceID:           task.TraceID,
		RequestID:         task.RequestID,
		BillingOrderID:    task.BillingOrderID,
		Capability:        capabilityFromTaskType(task.Type),
		Operation:         task.Operation,
		Model:             task.Model,
		ProviderRequestID: task.ProviderRequestID,
	}
	decodedTask := task
	if decrypted, decryptErr := s.decryptTaskInputJSON(task.InputJSON); decryptErr == nil {
		decodedTask.InputJSON = decrypted
		if value, ok := withProviderAnalytics(context.Background(), s, decodedTask).Value(providerAnalyticsKey{}).(providerAnalyticsContext); ok {
			metadata = value
		}
	}

	now := time.Now()
	startedAt := now
	if task.StartedAt != nil && !task.StartedAt.IsZero() {
		startedAt = *task.StartedAt
	}
	path := "/task/provider-preflight"
	errorCode := "request_not_sent"
	statusCode := 0
	var httpErr providerHTTPError
	if errors.As(taskErr, &httpErr) {
		path = "/task/provider-request"
		errorCode = "provider_request_unlogged"
		statusCode = httpErr.StatusCode
	} else if strings.TrimSpace(metadata.ProviderRequestID) != "" {
		path = "/task/provider-state"
		errorCode = "provider_state_unlogged"
	}
	callLog := model.ApiCallLog{
		UserID:            metadata.UserID,
		TraceID:           metadata.TraceID,
		RequestID:         metadata.RequestID,
		ChannelID:         metadata.ChannelID,
		TaskID:            metadata.TaskID,
		BillingOrderID:    metadata.BillingOrderID,
		Source:            "backend-task",
		Capability:        metadata.Capability,
		Operation:         metadata.Operation,
		RequestKind:       "create",
		Billable:          false,
		APIFormat:         "internal",
		Method:            "INTERNAL",
		Path:              path,
		Model:             metadata.Model,
		Status:            model.ApiCallStatusFailed,
		StatusCode:        statusCode,
		DurationMs:        now.Sub(startedAt).Milliseconds(),
		ProviderRequestID: metadata.ProviderRequestID,
		ErrorCode:         errorCode,
		Error:             truncateRunes(withUserVisibleLogError(taskErr, s.UserFacingErrorMessage(taskErr)), 2_000),
		StartedAt:         startedAt,
		CreatedAt:         now,
	}
	if err := s.LogAPICall(callLog); err != nil {
		log.Printf("provider attempt log write failed: task_id=%s error=%v", task.ID, err)
	}
}
