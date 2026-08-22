package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const (
	providerCancellationLeaseDuration = time.Minute
	providerCancellationMaxAttempts   = 41
)

type providerCancellationOutcome string

type geminiOperation map[string]any

const (
	providerCancellationPending   providerCancellationOutcome = "pending"
	providerCancellationConfirmed providerCancellationOutcome = "confirmed"
	providerCancellationSucceeded providerCancellationOutcome = "succeeded"
	providerCancellationFailed    providerCancellationOutcome = "failed"
)

func (s *Service) startProviderCancellationReconciliation() {
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			task, err := s.repo.ClaimNextTaskProviderCancellation("provider-cancel:"+s.workerID, providerCancellationLeaseDuration)
			if err != nil || task == nil {
				continue
			}
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			if err := s.reconcileProviderCancellation(ctx, task); err != nil {
				_ = s.log(task.UserID, task.ID, "error", "上游取消状态对账失败", err.Error())
			}
			cancel()
		}
	}()
}

func (s *Service) requestProviderCancellation(ctx context.Context, task *model.Task) error {
	if task == nil || task.ID == "" {
		return errors.New("任务取消状态无效")
	}
	s.hydrateTaskProviderRequestID(task)
	if task.ProviderRequestID != "" {
		if err := s.repo.UpdateTaskProviderState(task.ID, task.ProviderRequestID, task.PollStage, task.NextPollAt); err != nil {
			return err
		}
	}
	if err := s.repo.ClaimTaskProviderCancellation(task.UserID, task.ID, time.Now()); err != nil {
		if errors.Is(err, repository.ErrTaskProviderCancellationConflict) {
			return nil
		}
		return err
	}
	if task.ProviderRequestID == "" {
		return s.markProviderCancellationUncertain(task, "上游未返回任务 ID，无法发送取消请求，费用待核对")
	}

	input, err := s.providerCancellationInput(task)
	if err != nil {
		return s.markProviderCancellationUncertain(task, "读取上游取消配置失败，费用待核对："+err.Error())
	}
	if !supportsProviderCancellation(input.Config.InterfaceType) {
		return s.markProviderCancellationUncertain(task, "当前上游协议不支持取消，费用待核对")
	}

	requestCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	requestTask := *task
	requestTask.InputJSON = mustJSON(input)
	requestCtx = withProviderRequestKind(withProviderAnalytics(requestCtx, s, requestTask), "cancel")
	requestCtx = withProviderOutboundPolicy(requestCtx, input.Config)
	if err := cancelProviderTask(requestCtx, input.Config, task.ProviderRequestID); err != nil {
		return s.markProviderCancellationUncertain(task, "上游取消请求结果不明确，费用待核对："+safeProviderLogError(err))
	}
	_ = s.log(task.UserID, task.ID, "info", "已请求上游取消，等待供应商确认", task.ProviderRequestID)
	return nil
}

func (s *Service) reconcileProviderCancellation(ctx context.Context, task *model.Task) error {
	billing := s.taskBilling()
	if task.ProviderCancelAttempts >= providerCancellationMaxAttempts {
		return s.markProviderCancellationUncertain(task, "上游取消状态长时间未确认，费用待核对")
	}
	input, err := s.providerCancellationInput(task)
	if err != nil {
		return s.markProviderCancellationUncertain(task, "读取上游对账配置失败，费用待核对："+err.Error())
	}
	queryTask := *task
	queryTask.InputJSON = mustJSON(input)
	queryCtx := withProviderRequestKind(withProviderAnalytics(ctx, s, queryTask), "cancel-query")
	queryCtx = withProviderOutboundPolicy(queryCtx, input.Config)
	outcome, providerStatus, err := queryProviderCancellation(queryCtx, input.Config, task.ProviderRequestID)
	if err != nil {
		if task.ProviderCancelAttempts >= providerCancellationMaxAttempts-1 {
			return s.markProviderCancellationUncertain(task, "连续查询上游取消状态失败，费用待核对："+safeProviderLogError(err))
		}
		next := time.Now().Add(30 * time.Second)
		return s.repo.UpdateTaskProviderCancellation(task.ID, model.ProviderCancelStatusRequested, model.ProviderCancelStatusRequested, safeProviderLogError(err), &next, nil)
	}

	switch outcome {
	case providerCancellationConfirmed:
		if err := billing.RefundBilling(task.BillingOrderID, "上游已确认取消"); err != nil {
			return s.deferProviderCancellation(task, "上游已取消，但积分退回失败："+err.Error())
		}
		now := time.Now()
		if err := s.repo.UpdateTaskProviderCancellation(task.ID, model.ProviderCancelStatusRequested, model.ProviderCancelStatusConfirmed, "", nil, &now); err != nil {
			return err
		}
		_ = s.log(task.UserID, task.ID, "info", "上游已确认取消，积分已退回", providerStatus)
	case providerCancellationSucceeded:
		errorText := "取消请求发出前上游已完成，费用已结算"
		var billingErr error
		if err := billing.SettleBilling(task.BillingOrderID, task.ProviderRequestID); err != nil {
			errorText = "取消请求发出前上游已完成，但费用结算失败，需人工核对：" + err.Error()
			billingErr = fmt.Errorf("取消确认后的计费结算失败：%w", err)
			if uncertainErr := billing.MarkBillingUncertain(task.BillingOrderID, errorText); uncertainErr != nil {
				billingErr = errors.Join(billingErr, fmt.Errorf("记录取消确认后的计费待核对状态失败：%w", uncertainErr))
			}
		}
		if err := s.repo.UpdateTaskProviderCancellation(task.ID, model.ProviderCancelStatusRequested, model.ProviderCancelStatusUncertain, errorText, nil, nil); err != nil {
			return err
		}
		_ = s.log(task.UserID, task.ID, "warn", "上游任务在取消确认前已完成", providerStatus)
		if billingErr != nil {
			return billingErr
		}
	case providerCancellationFailed:
		errorText := "上游任务已失败，取消状态无法确认，积分已退回"
		if err := billing.RefundBilling(task.BillingOrderID, errorText); err != nil {
			return s.deferProviderCancellation(task, "上游任务已失败，但积分退回失败："+err.Error())
		}
		if err := s.repo.UpdateTaskProviderCancellation(task.ID, model.ProviderCancelStatusRequested, model.ProviderCancelStatusUncertain, errorText, nil, nil); err != nil {
			return err
		}
		_ = s.log(task.UserID, task.ID, "warn", errorText, providerStatus)
	default:
		next := time.Now().Add(15 * time.Second)
		return s.repo.UpdateTaskProviderCancellation(task.ID, model.ProviderCancelStatusRequested, model.ProviderCancelStatusRequested, "", &next, nil)
	}
	return nil
}

func (s *Service) deferProviderCancellation(task *model.Task, errorText string) error {
	next := time.Now().Add(30 * time.Second)
	return s.repo.UpdateTaskProviderCancellation(task.ID, model.ProviderCancelStatusRequested, model.ProviderCancelStatusRequested, truncateRunes(errorText, 1000), &next, nil)
}

func (s *Service) markProviderCancellationUncertain(task *model.Task, errorText string) error {
	message := truncateRunes(errorText, 1000)
	if err := s.repo.UpdateTaskProviderCancellation(task.ID, model.ProviderCancelStatusRequested, model.ProviderCancelStatusUncertain, message, nil, nil); err != nil {
		return err
	}
	if err := s.taskBilling().MarkBillingUncertain(task.BillingOrderID, message); err != nil {
		_ = s.log(task.UserID, task.ID, "error", "上游取消已转入人工核对，但计费状态更新失败", err.Error())
		return err
	}
	_ = s.log(task.UserID, task.ID, "warn", "上游取消无法确认", message)
	return nil
}

func (s *Service) providerCancellationInput(task *model.Task) (canvasGenerationInput, error) {
	decrypted, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return canvasGenerationInput{}, err
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(decrypted), &input); err != nil {
		return canvasGenerationInput{}, err
	}
	config, err := s.resolveProviderConfig(input.Config)
	if err != nil {
		return canvasGenerationInput{}, err
	}
	input.Config = config
	return input, nil
}

func supportsProviderCancellation(interfaceType string) bool {
	return interfaceType == string(model.ChannelInterfaceGeminiVeo) || interfaceType == string(model.ChannelInterfaceVolcengineArkVideo)
}

func cancelProviderTask(ctx context.Context, config providerConfig, providerRequestID string) error {
	switch config.InterfaceType {
	case string(model.ChannelInterfaceGeminiVeo):
		path := "/" + strings.TrimLeft(providerRequestID, "/") + ":cancel"
		return postGeminiJSON(ctx, config, path, map[string]any{}, &map[string]any{})
	case string(model.ChannelInterfaceVolcengineArkVideo):
		path := "/contents/generations/tasks/" + url.PathEscape(providerRequestID)
		return deleteProviderTask(ctx, config, path)
	default:
		return errors.New("当前上游协议不支持取消")
	}
}

func deleteProviderTask(ctx context.Context, config providerConfig, path string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, apiURL(config.BaseURL, path), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+config.APIKey)
	ApplyOutboundHeaders(req, config.Headers)
	data, _, err := doBinary(req)
	if err != nil {
		return err
	}
	if len(bytes.TrimSpace(data)) > 0 && !json.Valid(data) {
		return errors.New("上游取消接口返回了无法识别的内容")
	}
	return nil
}

func queryProviderCancellation(ctx context.Context, config providerConfig, providerRequestID string) (providerCancellationOutcome, string, error) {
	switch config.InterfaceType {
	case string(model.ChannelInterfaceGeminiVeo):
		// Gemini 用 operation.error 表示取消终态，此处必须保留该字段再判断，
		// 不能让通用 JSON 解包提前把它转换成请求失败。
		var operation geminiOperation
		if err := getGeminiJSON(ctx, config, "/"+strings.TrimLeft(providerRequestID, "/"), &operation); err != nil {
			return "", "", err
		}
		if done, _ := operation["done"].(bool); !done {
			return providerCancellationPending, "running", nil
		}
		if errorValue, ok := operation["error"].(map[string]any); ok {
			code := strings.TrimSpace(fmt.Sprint(errorValue["code"]))
			message := strings.ToLower(stringField(errorValue, "message"))
			if code == "1" || code == "1.0" || strings.Contains(message, "cancel") {
				return providerCancellationConfirmed, "cancelled", nil
			}
			return providerCancellationFailed, firstNonEmpty(message, "failed"), nil
		}
		return providerCancellationSucceeded, "succeeded", nil
	case string(model.ChannelInterfaceVolcengineArkVideo):
		var state map[string]any
		if err := getJSON(ctx, config, "/contents/generations/tasks/"+url.PathEscape(providerRequestID), &state); err != nil {
			return "", "", err
		}
		if data, ok := state["data"].(map[string]any); ok {
			state = data
		}
		status := strings.ToLower(strings.TrimSpace(stringField(state, "status")))
		switch status {
		case "cancelled", "canceled":
			return providerCancellationConfirmed, status, nil
		case "succeeded", "completed":
			return providerCancellationSucceeded, status, nil
		case "failed", "expired":
			return providerCancellationFailed, status, nil
		case "queued", "running", "processing", "pending":
			return providerCancellationPending, status, nil
		default:
			return providerCancellationPending, firstNonEmpty(status, "unknown"), nil
		}
	default:
		return "", "", errors.New("当前上游协议不支持取消状态查询")
	}
}

func mustJSON(value any) string {
	data, _ := json.Marshal(value)
	return string(data)
}
