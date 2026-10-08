// 任务路由尝试（route attempt）的生命周期：创建、派发、失败切换、重试与收尾。
//
// 一个任务可能依次尝试多条路由：上游返回可重试错误时切到下一条，并把失败路由短暂熔断
// （blockLogicalRouteForFailure）。派发结果不确定（请求已发出但没拿到响应）时绝不切换，
// 避免同一请求在两个供应商处各扣一次费。

package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func (s *Service) createRouteAttempt(task *model.Task, routed *RoutedModel, attemptNumber int) (*model.RouteAttempt, error) {
	id, err := s.repo.NextPrefixedID("ATTEMPT")
	if err != nil {
		return nil, err
	}
	channelModel, err := s.repo.ChannelModelByID(routed.ChannelModel.ChannelID, routed.ChannelModel.ID)
	if err != nil {
		return nil, err
	}
	attempt := &model.RouteAttempt{ID: id, TaskID: task.ID, RouteRun: task.RouteRun, AttemptNumber: attemptNumber, LogicalModelID: routed.LogicalModel.ID, LogicalModelRevisionID: routed.Revision.ID, RouteID: routed.Route.ID, ChannelModelID: channelModel.ID, ChannelID: channelModel.ChannelID, Status: "selected", DispatchState: "not_sent", StartedAt: time.Now()}
	if err := s.repo.CreateRouteAttempt(attempt); err != nil {
		return nil, err
	}
	return attempt, nil
}

func (s *Service) beginTaskRouteAttempt(task *model.Task) (*model.RouteAttempt, error) {
	if task == nil {
		return nil, nil
	}
	attempts, err := s.repo.RouteAttempts(task.ID, task.RouteRun)
	if err != nil {
		return nil, err
	}
	if len(attempts) > 0 {
		existing := &attempts[len(attempts)-1]
		switch existing.DispatchState {
		case "not_sent":
			return existing, nil
		case "accepted":
			if existing.ProviderRequestID != "" || task.ProviderRequestID != "" {
				if task.ProviderRequestID == "" {
					task.ProviderRequestID = existing.ProviderRequestID
					if err := s.repo.UpdateTaskProviderState(task.ID, task.ProviderRequestID, task.PollStage, task.NextPollAt); err != nil {
						return nil, err
					}
				}
				return existing, nil
			}
			return nil, routeDispatchUncertainError{"上游已接受请求，但没有可恢复的任务 ID"}
		case "submission_unknown":
			if existing.ProviderRequestID != "" || task.ProviderRequestID != "" {
				if task.ProviderRequestID == "" {
					task.ProviderRequestID = existing.ProviderRequestID
					if err := s.repo.UpdateTaskProviderState(task.ID, task.ProviderRequestID, task.PollStage, task.NextPollAt); err != nil {
						return nil, err
					}
				}
				existing.DispatchState = "accepted"
				if err := s.repo.SaveRouteAttempt(existing); err != nil {
					return nil, err
				}
				return existing, nil
			}
			return nil, routeDispatchUncertainError{"上一次提交结果不明确，为避免重复扣费已停止自动重发"}
		case "rejected_no_job":
			if task.LogicalModelID == "" {
				return nil, errors.New("上游已拒绝本次请求，请检查渠道配置后再试")
			}
			return s.switchTaskToNextRoute(task, attempts)
		}
	}
	if task.LogicalModelID == "" {
		return s.createDirectTaskAttempt(task)
	}
	routed, routeErr := s.routedModelForTaskSelection(task)
	if routeErr != nil {
		return s.switchTaskToNextRoute(task, attempts)
	}
	return s.createRouteAttempt(task, routed, len(attempts)+1)
}

func (s *Service) markRouteAttemptDispatching(attempt *model.RouteAttempt) error {
	if attempt == nil || attempt.DispatchState != "not_sent" {
		return nil
	}
	// A stale worker must not dispatch the same selected attempt a second time.
	if err := s.repo.MarkRouteAttemptDispatching(attempt.ID); err != nil {
		return routeDispatchUncertainError{"提交状态未能独占确认，为避免重复扣费已停止自动重发"}
	}
	attempt.Status, attempt.DispatchState = "dispatching", "submission_unknown"
	return nil
}

type routeDispatchUncertainError struct{ message string }

func (e routeDispatchUncertainError) Error() string { return e.message }

func isRouteDispatchUncertain(err error) bool {
	var target routeDispatchUncertainError
	return errors.As(err, &target)
}

func (s *Service) routedModelForTaskSelection(task *model.Task) (*RoutedModel, error) {
	route, err := s.repo.LogicalModelRoute(task.RouteID)
	if err != nil {
		return nil, err
	}
	if !route.Enabled || route.Weight <= 0 || route.LogicalModelRevisionID != task.LogicalModelRevisionID {
		return nil, errors.New("任务使用的模型服务配置已失效")
	}
	if route.ChannelModelID != task.ChannelModelID {
		return nil, errors.New("任务使用的模型服务配置已失效")
	}
	channelModel, err := s.repo.ChannelModel(task.ChannelModelID)
	if err != nil {
		return nil, err
	}
	if !channelModel.Enabled {
		return nil, errors.New("任务使用的模型服务配置已失效")
	}
	if _, err := s.repo.SystemChannel(channelModel.ChannelID); err != nil {
		return nil, err
	}
	logicalModel, err := s.repo.LogicalModel(task.LogicalModelID)
	if err != nil {
		return nil, err
	}
	revision, err := s.repo.LogicalModelRevision(task.LogicalModelRevisionID)
	if err != nil {
		return nil, err
	}
	if revision.LogicalModelID != logicalModel.ID {
		return nil, errors.New("任务前台模型版本不一致")
	}
	productSpec, err := DecodeCapabilitySpec(revision.CapabilitySpecJSON)
	if err != nil {
		return nil, err
	}
	defaults, err := decodeLogicalDefaults(revision.DefaultOptionsJSON, productSpec)
	if err != nil {
		return nil, err
	}
	capabilitySpec, err := channelModelCapabilitySpec(*channelModel)
	if err != nil || s.logicalRouteBlocked(cachedLogicalRoute{Route: *route, CapabilitySpec: capabilitySpec, ChannelModel: *channelModel}) {
		return nil, errors.New("当前模型服务暂不可用")
	}
	if logicalModel.PricePolicy == "channel" && !channelModel.PriceConfigured {
		return nil, errors.New("任务使用的模型服务价格配置已失效")
	}
	if logicalModel.PricePolicy == "unified" && logicalModel.BillingMode == "token" && !supportsTokenBilling(logicalModel.Capability, channelModel.Protocol) {
		return nil, errors.New("任务使用的模型服务不再支持当前 Token 计费配置")
	}
	routed := &RoutedModel{LogicalModel: *logicalModel, Revision: *revision, Route: *route, ChannelModel: *channelModel, Defaults: defaults}
	return routed, nil
}

func (s *Service) switchTaskToNextRoute(task *model.Task, attempts []model.RouteAttempt) (*model.RouteAttempt, error) {
	decrypted, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return nil, err
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(decrypted), &input); err != nil {
		return nil, BadAuthRequest("任务输入格式无效，无法恢复模型服务")
	}
	logicalModel, err := s.repo.LogicalModel(task.LogicalModelID)
	if err != nil {
		return nil, err
	}
	revision, err := s.repo.LogicalModelRevision(task.LogicalModelRevisionID)
	if err != nil || revision.LogicalModelID != logicalModel.ID {
		return nil, errors.New("任务前台模型版本不存在或归属不一致")
	}
	productSpec, err := DecodeCapabilitySpec(revision.CapabilitySpecJSON)
	if err != nil {
		return nil, err
	}
	defaults, err := decodeLogicalDefaults(revision.DefaultOptionsJSON, productSpec)
	if err != nil {
		return nil, err
	}
	intent := ModelRequestIntentFromTaskInput(input, task.Type, task.Operation)
	intent.Options = mergeIntentDefaults(intent.Options, defaults)
	if match := MatchCapability(productSpec, intent); !match.Matched {
		return nil, BadAuthRequest("任务参数不再符合前台模型能力：" + strings.Join(match.Reasons, "；"))
	}
	routes, err := s.repo.LogicalModelRoutes(revision.ID, false)
	if err != nil {
		return nil, err
	}
	channelModelIDs := make([]string, 0, len(routes))
	for _, route := range routes {
		channelModelIDs = append(channelModelIDs, route.ChannelModelID)
	}
	channelModels, err := s.repo.ChannelModelsByIDs(channelModelIDs)
	if err != nil {
		return nil, err
	}
	channelIDs := make([]string, 0, len(channelModels))
	for _, channelModel := range channelModels {
		channelIDs = append(channelIDs, channelModel.ChannelID)
	}
	systemChannels, err := s.repo.SystemChannelsByIDs(channelIDs, false)
	if err != nil {
		return nil, err
	}
	enabledSystemChannels := make(map[string]bool, len(systemChannels))
	for _, channel := range systemChannels {
		enabledSystemChannels[channel.ID] = true
	}
	channelModelByID := make(map[string]model.ChannelModel, len(channelModels))
	for _, channelModel := range channelModels {
		if channelModel.Enabled && enabledSystemChannels[channelModel.ChannelID] && (logicalModel.PricePolicy != "channel" || channelModelHasActivePriceTier(channelModel)) {
			channelModelByID[channelModel.ID] = channelModel
		}
	}
	candidates := make([]cachedLogicalRoute, 0, len(routes))
	for _, route := range routes {
		channelModel, channelOK := channelModelByID[route.ChannelModelID]
		if !channelOK {
			continue
		}
		capabilitySpec, specErr := channelModelCapabilitySpec(channelModel)
		if specErr != nil {
			continue
		}
		candidates = append(candidates, cachedLogicalRoute{Route: route, CapabilitySpec: capabilitySpec, ChannelModel: channelModel})
	}
	tried := make(map[string]bool, len(attempts))
	for _, attempt := range attempts {
		tried[attempt.RouteID] = true
	}
	eligible := s.eligibleLogicalRoutes(candidates, intent, tried, logicalModel.PricePolicy == "channel")
	if len(eligible) == 0 {
		return nil, BadAuthRequest("当前模型暂时无法满足这组输入和参数")
	}
	selected := weightedRoute(eligible)
	var priceTier *model.ChannelModelPriceTier
	if logicalModel.PricePolicy == "channel" {
		priceTier = channelModelPriceTierForIntent(selected.ChannelModel, intent)
		if priceTier == nil {
			return nil, BadAuthRequest("当前模型尚未配置所选规格的价格")
		}
	}
	routed := &RoutedModel{LogicalModel: *logicalModel, Revision: *revision, Route: selected.Route, ChannelModel: selected.ChannelModel, PriceTier: priceTier, Defaults: defaults}
	nextInput := applyRoutedProviderSelection(input, routed)
	if err := s.ValidateTaskCapability(nextInput); err != nil {
		return nil, err
	}
	if err := s.protectTaskSecrets(nextInput); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(nextInput)
	if err != nil {
		return nil, err
	}
	var replacement *model.BillingOrder
	if logicalModel.PricePolicy == "channel" && task.BillingOrderID != "" {
		config, _ := nextInput["config"].(map[string]any)
		capability := normalizeCapability(fmt.Sprint(nextInput["mode"]))
		if capability == "" {
			capability = capabilityFromTaskType(task.Type)
		}
		priceTierID, _ := config["priceTierId"].(string)
		replacement, err = s.newBillingOrderWithPriceTier(task.UserID, task.ID, "route-switch:"+task.ID+":"+selected.Route.ID, selected.ChannelModel.ChannelID, selected.ChannelModel.ModelKey, capability, firstNonEmpty(strings.TrimSpace(task.Operation), task.Type), requestedBillingQuantity(capability, config), estimateTaskBillingTokens(nextInput, capability), strings.TrimSpace(priceTierID), intent)
		if err != nil {
			return nil, err
		}
		replacement.Model = logicalModel.Code
	}
	previousRouteID := task.RouteID
	var costOrder model.BillingOrder
	if replacement != nil {
		costOrder.BillingCostSnapshot = replacement.BillingCostSnapshot
	} else if task.BillingOrderID != "" {
		config, _ := nextInput["config"].(map[string]any)
		capability := selected.ChannelModel.Capability
		snapshotCreditCost(&costOrder, channelModelPriceTierForIntent(selected.ChannelModel, intent), requestedBillingQuantity(capability, config), estimateTaskBillingTokens(nextInput, capability))
	}
	if err := s.repo.SwitchTaskLogicalRoute(task.ID, previousRouteID, selected.Route.ID, string(encoded), task.BillingOrderID, selected.ChannelModel.ChannelID, selected.ChannelModel.ID, replacement, costOrder.BillingCostSnapshot); err != nil {
		if errors.Is(err, repository.ErrInsufficientCredits) {
			return nil, BadAuthRequest("模型服务价格发生变化，当前积分余额不足")
		}
		if errors.Is(err, repository.ErrBillingChargeLimit) {
			return nil, creationConflict("备用线路报价超过已批准费用上限，未切换线路；请重新确认生成报价")
		}
		return nil, err
	}
	task.RouteID = selected.Route.ID
	task.ChannelModelID = selected.ChannelModel.ID
	task.InputJSON = string(encoded)
	task.ProviderRequestID = ""
	return s.createRouteAttempt(task, routed, len(attempts)+1)
}

func (s *Service) nextRouteAttemptAfterFailure(task *model.Task, attempt *model.RouteAttempt, taskErr error) (*model.RouteAttempt, error) {
	if task == nil || task.LogicalModelID == "" || attempt == nil || attempt.DispatchState != "rejected_no_job" {
		return nil, nil
	}
	if errors.Is(taskErr, context.Canceled) || errors.Is(taskErr, context.DeadlineExceeded) {
		return nil, nil
	}
	s.blockLogicalRouteForFailure(attempt, taskErr)
	attempts, err := s.repo.RouteAttempts(task.ID, task.RouteRun)
	if err != nil {
		return nil, err
	}
	return s.switchTaskToNextRoute(task, attempts)
}

func (s *Service) blockLogicalRouteForFailure(attempt *model.RouteAttempt, taskErr error) {
	if attempt == nil {
		return
	}
	key := ""
	duration := time.Duration(0)
	if attempt.FailureCode == "upstream_401" || attempt.FailureCode == "upstream_403" {
		key, duration = "channel:"+attempt.ChannelID, 10*time.Minute
	} else if attempt.FailureCode == "upstream_404" {
		key, duration = "channel-model:"+attempt.ChannelModelID, 10*time.Minute
	} else if attempt.FailureCode == "upstream_429" {
		key, duration = "channel:"+attempt.ChannelID, 30*time.Second
		var upstream providerHTTPError
		if errors.As(taskErr, &upstream) && upstream.RetryAfter > 0 {
			duration = upstream.RetryAfter
		}
	}
	if key == "" || duration <= 0 {
		return
	}
	until := time.Now().Add(duration)
	s.routeHealthMu.Lock()
	// 本地状态是 Redis 不可用时的降级，也能覆盖 Redis 写入瞬间的网络抖动。
	s.routeHealthBlocked[key] = until
	s.routeHealthMu.Unlock()
	if s.coordinator != nil && s.coordinator.HasRedis() {
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancel()
		if err := s.coordinator.BlockRoute(ctx, key, until); err != nil {
			log.Printf("logical route distributed health update failed key=%s: %v", key, err)
		}
	}
}

func (s *Service) prepareLogicalTaskRetry(task *model.Task, input map[string]any) error {
	if task == nil || task.LogicalModelID == "" {
		return nil
	}
	intent := ModelRequestIntentFromTaskInput(input, task.Type, task.Operation)
	logicalModel, err := s.repo.LogicalModel(task.LogicalModelID)
	if err != nil {
		return err
	}
	var routed *RoutedModel
	if logicalModel.ArchivedAt != nil {
		// 归档只隐藏新任务的公开目录；历史任务重试必须使用任务快照，不能重新从公开目录选路。
		routed, err = s.resolveArchivedTaskRoute(task, intent)
	} else {
		routed, err = s.ResolveLogicalModel(task.LogicalModelID, intent)
	}
	if err != nil {
		return err
	}
	input = applyRoutedProviderSelection(input, routed)
	if err := s.ValidateTaskCapability(input); err != nil {
		return err
	}
	if err := s.protectTaskSecrets(input); err != nil {
		return err
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return err
	}
	task.LogicalModelRevisionID = routed.Revision.ID
	task.RouteID = routed.Route.ID
	task.ChannelModelID = routed.ChannelModel.ID
	task.Model = routed.LogicalModel.Code
	task.Provider = "managed"
	task.InputJSON = string(encoded)
	return nil
}

// resolveArchivedTaskRoute 恢复归档模型任务保存的 revision、route 和 channel model 快照。
// 归档模型不得重新进入公开路由目录；原供应线路失效时应明确拒绝重试，避免静默切换到未知配置。
func (s *Service) resolveArchivedTaskRoute(task *model.Task, intent ModelRequestIntent) (*RoutedModel, error) {
	if task == nil || task.LogicalModelID == "" || task.LogicalModelRevisionID == "" || task.RouteID == "" || task.ChannelModelID == "" {
		return nil, BadAuthRequest("历史任务缺少完整的模型服务快照，无法重试")
	}
	logicalModel, err := s.repo.LogicalModel(task.LogicalModelID)
	if err != nil {
		return nil, err
	}
	if logicalModel.ArchivedAt == nil {
		return nil, BadAuthRequest("任务模型已恢复为可用模型，请重新选择后重试")
	}
	revision, err := s.repo.LogicalModelRevision(task.LogicalModelRevisionID)
	if err != nil || revision.LogicalModelID != logicalModel.ID {
		return nil, BadAuthRequest("历史任务前台模型版本不存在或归属不一致")
	}
	route, err := s.repo.LogicalModelRoute(task.RouteID)
	if err != nil || route.LogicalModelRevisionID != revision.ID || route.ChannelModelID != task.ChannelModelID || !route.Enabled || route.Weight <= 0 {
		return nil, BadAuthRequest("历史任务原模型供应线路已失效，无法重试")
	}
	channelModel, err := s.repo.ChannelModel(task.ChannelModelID)
	if err != nil || !channelModel.Enabled {
		return nil, BadAuthRequest("历史任务原模型服务已失效，无法重试")
	}
	if _, err := s.repo.SystemChannel(channelModel.ChannelID); err != nil {
		return nil, BadAuthRequest("历史任务原模型渠道已失效，无法重试")
	}
	productSpec, err := DecodeCapabilitySpec(revision.CapabilitySpecJSON)
	if err != nil {
		return nil, err
	}
	defaults, err := decodeLogicalDefaults(revision.DefaultOptionsJSON, productSpec)
	if err != nil {
		return nil, err
	}
	intent.Options = mergeIntentDefaults(intent.Options, defaults)
	if match := MatchCapability(productSpec, intent); !match.Matched {
		return nil, BadAuthRequest("历史任务不再符合前台模型能力：" + strings.Join(match.Reasons, "；"))
	}
	capabilitySpec, err := channelModelCapabilitySpec(*channelModel)
	if err != nil || s.logicalRouteBlocked(cachedLogicalRoute{Route: *route, CapabilitySpec: capabilitySpec, ChannelModel: *channelModel}) {
		return nil, BadAuthRequest("历史任务原模型供应线路暂不可用，无法重试")
	}
	if logicalModel.PricePolicy == "channel" && !channelModel.PriceConfigured {
		return nil, BadAuthRequest("历史任务原模型价格配置已失效，无法重试")
	}
	return &RoutedModel{LogicalModel: *logicalModel, Revision: *revision, Route: *route, ChannelModel: *channelModel, Defaults: defaults}, nil
}

func (s *Service) finishTaskRouteAttempt(attempt *model.RouteAttempt, task *model.Task, taskErr error) {
	if attempt == nil {
		return
	}
	now := time.Now()
	attempt.CompletedAt = &now
	if task != nil {
		attempt.ProviderRequestID = task.ProviderRequestID
	}
	if taskErr == nil {
		attempt.Status = "succeeded"
		attempt.DispatchState = "accepted"
	} else {
		attempt.Status = "failed"
		attempt.FailureMessage = truncateRunes(taskFailureMessage(taskErr), 1000)
		attempt.FailureCode = routeFailureCode(taskErr)
		if attempt.ProviderRequestID != "" {
			attempt.DispatchState = "accepted"
		} else if safeRouteRejection(taskErr) {
			attempt.DispatchState = "rejected_no_job"
		} else {
			attempt.DispatchState = "submission_unknown"
		}
	}
	if err := s.repo.SaveRouteAttempt(attempt); err != nil {
		log.Printf("route attempt terminal state save failed attempt_id=%s task_id=%s: %v", attempt.ID, attempt.TaskID, err)
	}
}

func routeFailureCode(err error) string {
	if code, _ := ChannelSlotFailureDetails(err); code != "" {
		return code
	}
	var upstream providerHTTPError
	if errors.As(err, &upstream) {
		return fmt.Sprintf("upstream_%d", upstream.StatusCode)
	}
	return "submission_unknown"
}

func safeRouteRejection(err error) bool {
	if err == nil {
		return false
	}
	if code, _ := ChannelSlotFailureDetails(err); code != "" {
		return true
	}
	var upstream providerHTTPError
	if errors.As(err, &upstream) {
		switch upstream.StatusCode {
		case 401, 403, 404, 429:
			return true
		}
	}
	return false
}
