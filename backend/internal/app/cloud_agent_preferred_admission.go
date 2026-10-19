package app

import (
	"encoding/json"
	"errors"

	"yingce/backend/internal/model"
)

// Selection happens before the input and quote are frozen. Re-admission of an
// approved request never chooses a different model.
func (s *Service) prepareCloudAgentPreferredMedia(run *model.CloudAgentExecution, state *cloudAgentRuntime, request *CreateTaskRequest, plan *cloudAgentMediaPlan, quoted int64) (*model.Task, error) {
	if request.creationPrepare == nil {
		return nil, BadAuthRequest("缺少媒体报价准备态")
	}
	raw, err := json.Marshal(request.Input)
	if err != nil {
		return nil, err
	}
	task, initialErr := s.CreateTask(run.UserID, *request)
	if initialErr == nil {
		return task, nil
	}
	var modelErr *ModelError
	var argumentErr *modelCapabilityArgumentError
	capabilityError := errors.As(initialErr, &modelErr) && modelErr.ErrorCode == ErrCodeModelCapabilityNotSupported || errors.As(initialErr, &argumentErr)
	if !capabilityError || state.Request.Surface != "creation" || plan.Prepared != nil || request.LogicalModelID != "" || taskInputUsesWorkflowProvider(request.Input) {
		return nil, initialErr
	}
	if state.Request.MediaSettings == nil {
		return nil, initialErr
	}
	choice := state.Request.MediaSettings.Image
	if plan.Args.Mode == "video" {
		choice = state.Request.MediaSettings.Video
	}
	if choice == nil || choice.SelectionMode != "preferred" {
		return nil, initialErr
	}
	var original map[string]any
	if err := json.Unmarshal(raw, &original); err != nil {
		return nil, err
	}
	metadata, _ := original["metadata"].(map[string]any)
	if stringValue(metadata["modelSelectionMode"]) != "preferred" || plan.Args.RequirePreferredModel {
		return nil, initialErr
	}
	config, _ := original["config"].(map[string]any)
	selected, err := s.repo.ChannelModelByKey(stringValue(config["channelId"]), firstNonEmpty(stringValue(config["channelModelKey"]), stringValue(config["model"])))
	if err != nil {
		return nil, initialErr
	}
	remaining, err := s.cloudAgentRemainingBudget(run.UserID, state)
	if err != nil {
		return nil, err
	}
	remaining -= quoted
	candidates, err := s.directMediaFallbackCandidates(*selected, true, map[string]bool{selected.ID: true}, nil)
	if err != nil {
		return nil, err
	}
	intent := ModelRequestIntentFromTaskInput(original, request.Type, request.Operation)
	attempts, overBudget := 0, false
	for _, candidate := range candidates {
		matched, err := s.channelModelMatchesIntent(&candidate, &intent)
		if err != nil || !matched || s.logicalRouteBlocked(cachedLogicalRoute{ChannelModel: candidate}) {
			continue
		}
		if attempts >= preferredMediaRouteAttemptLimit {
			break
		}
		attempts++
		next := *request
		next.Input = nil
		if err := json.Unmarshal(raw, &next.Input); err != nil {
			return nil, err
		}
		nextConfig := next.Input["config"].(map[string]any)
		nextConfig["channelId"], nextConfig["channelModelKey"], nextConfig["model"] = candidate.ChannelID, candidate.ModelKey, candidate.ModelKey
		next.Model = candidate.ModelKey
		preparation := *request.creationPrepare
		preparation.Order = nil
		next.creationPrepare = &preparation
		task, err := s.CreateTask(run.UserID, next)
		if err != nil {
			continue
		}
		var resolved map[string]any
		if err := json.Unmarshal([]byte(task.InputJSON), &resolved); err != nil {
			return nil, err
		}
		if validateCloudAgentResolvedMediaOptions(config, resolved) != nil {
			continue
		}
		if preparation.Order == nil || remaining < 0 || preparation.Order.AmountMicrocredits > remaining {
			overBudget = true
			continue
		}
		*request.creationPrepare = preparation
		next.creationPrepare = request.creationPrepare
		*request = next
		plan.Args.ChannelID, plan.Args.ChannelModelKey = candidate.ChannelID, candidate.ModelKey
		return task, nil
	}
	if overBudget {
		return nil, BadAuthRequest("兼容模型的生成报价超过累计剩余预算，未提交任务")
	}
	return nil, initialErr
}
