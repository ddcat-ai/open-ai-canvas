package app

import (
	"encoding/json"
	"errors"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// A user-requested replay gets a new quote against the remaining run budget.
// Unlike an in-flight fallback, this quote may exceed the original item's price;
// normal preparation/approval still authorizes and admits the returned request.
func (s *Service) chooseCloudAgentReplayModel(userID string, original *model.Task, req CreateTaskRequest, choice *CloudAgentCreationMediaChoice, remaining int64) (CreateTaskRequest, error) {
	policy, err := s.cloudAgentMediaRetryPolicy(userID, original)
	if err != nil {
		return req, err
	}
	if policy.RequiresPromptChange {
		return req, BadAuthRequest("内容审核拒绝需要先调整提示词")
	}
	if original.LogicalModelID != "" || req.LogicalModelID != "" || (original.Type != "canvas_image" && original.Type != "canvas_video") || taskInputUsesWorkflowProvider(req.Input) {
		return req, nil
	}
	config, _ := req.Input["config"].(map[string]any)
	if config == nil {
		return req, BadAuthRequest("原生成参数无法恢复")
	}
	selected, err := s.repo.ChannelModelByKeyIncludingDisabled(stringValue(config["channelId"]), firstNonEmpty(stringValue(config["channelModelKey"]), stringValue(config["model"])))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return req, nil
	}
	if err != nil {
		return req, err
	}
	metadata, _ := req.Input["metadata"].(map[string]any)
	preferred := choice != nil && choice.SelectionMode == "preferred" && stringValue(metadata["modelSelectionMode"]) != "fixed"
	attempts, err := s.repo.RouteAttempts(original.ID, original.RouteRun)
	if err != nil {
		return req, err
	}
	tried := map[string]bool{selected.ID: true}
	for _, attempt := range attempts {
		if attempt.ChannelModelID != "" {
			tried[attempt.ChannelModelID] = true
		}
	}
	candidates, err := s.directMediaFallbackCandidates(*selected, preferred, tried, nil)
	if err != nil {
		return req, err
	}
	intent := ModelRequestIntentFromTaskInput(req.Input, req.Type, req.Operation)
	raw, err := json.Marshal(req.Input)
	if err != nil {
		return req, err
	}
	quoted := 0
	for _, candidate := range candidates {
		matched, err := s.channelModelMatchesIntent(&candidate, &intent)
		if err != nil || !matched || s.logicalRouteBlocked(cachedLogicalRoute{ChannelModel: candidate}) {
			continue
		}
		if quoted >= preferredMediaRouteAttemptLimit {
			break
		}
		quoted++
		next := req
		next.Input = nil
		if err := json.Unmarshal(raw, &next.Input); err != nil {
			return req, err
		}
		nextConfig := next.Input["config"].(map[string]any)
		nextConfig["channelId"], nextConfig["channelModelKey"], nextConfig["model"] = candidate.ChannelID, candidate.ModelKey, candidate.ModelKey
		next.Model = candidate.ModelKey
		quote := next
		quote.IdempotencyKey = ""
		quote.creationPrepare = &creationTaskPreparation{DeferActiveTaskLimit: true}
		if quote.admission != nil {
			admission := *quote.admission
			admission.ID, admission.MaxCharge = "", remaining
			quote.admission = &admission
		}
		dryTask, err := s.CreateTask(userID, quote)
		if err != nil || quote.creationPrepare.Order == nil || quote.creationPrepare.Order.AmountMicrocredits > remaining {
			continue
		}
		var resolved map[string]any
		if err := json.Unmarshal([]byte(dryTask.InputJSON), &resolved); err != nil {
			return req, err
		}
		if validateCloudAgentResolvedMediaOptions(config, resolved) != nil {
			continue
		}
		return next, nil
	}
	// The user explicitly requested a retry. If no alternative is compatible,
	// normal admission may retry the original model or expose its exact error.
	return req, nil
}
