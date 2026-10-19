package app

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

const preferredMediaRouteAttemptLimit = 3

// Direct media tasks keep their admitted prompt, references, specifications and
// per-task charge cap. A persisted preference permits compatible model fallback;
// an explicit model constraint only permits equivalent public-model channels.
func (s *Service) switchTaskToNextImageChannel(task *model.Task, attempts []model.RouteAttempt) (*model.RouteAttempt, error) {
	if task == nil || task.AgentRunID == "" || task.LogicalModelID != "" || (task.Type != "canvas_image" && task.Type != "canvas_video") || task.ProviderRequestID != "" || len(attempts) == 0 || len(attempts) >= preferredMediaRouteAttemptLimit || attempts[len(attempts)-1].DispatchState != "rejected_no_job" {
		return nil, nil
	}
	for _, attempt := range attempts {
		if attempt.DispatchState != "rejected_no_job" || attempt.ProviderRequestID != "" || cloudAgentMediaContentRejection(attempt.FailureCode) || cloudAgentMediaContentRejection(attempt.FailureMessage) {
			return nil, nil
		}
	}
	decrypted, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return nil, err
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(decrypted), &input); err != nil {
		return nil, err
	}
	config, _ := input["config"].(map[string]any)
	channelID := stringValue(config["channelId"])
	if channelID == "" || taskInputUsesWorkflowProvider(input) {
		return nil, nil
	}
	original, err := s.repo.ChannelModelByKey(channelID, firstNonEmpty(stringValue(config["channelModelKey"]), stringValue(config["model"])))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	preferred, err := s.taskAllowsPreferredMediaFallback(task, input)
	if err != nil {
		return nil, err
	}
	intent := ModelRequestIntentFromTaskInput(input, task.Type, task.Operation)
	tried := map[string]bool{original.ID: true}
	legacyChannels := map[string]bool{}
	for _, attempt := range attempts {
		if attempt.ChannelModelID != "" {
			tried[attempt.ChannelModelID] = true
		} else if attempt.ChannelID != channelID || len(attempts) > 1 {
			// Older direct attempts did not persist a channel model ID. Avoid
			// revisiting a channel whose exact attempted model cannot be recovered.
			legacyChannels[attempt.ChannelID] = true
		}
	}
	var order *model.BillingOrder
	if task.BillingOrderID != "" {
		order, err = s.repo.BillingOrder(task.BillingOrderID)
		if err != nil {
			return nil, err
		}
	}
	candidates, err := s.directMediaFallbackCandidates(*original, preferred, tried, legacyChannels)
	if err != nil {
		return nil, err
	}
	for _, candidate := range candidates {
		matched, matchErr := s.channelModelMatchesIntent(&candidate, &intent)
		if matchErr != nil || !matched || s.logicalRouteBlocked(cachedLogicalRoute{ChannelModel: candidate}) {
			continue
		}
		var nextInput map[string]any
		if err := json.Unmarshal([]byte(decrypted), &nextInput); err != nil {
			return nil, err
		}
		nextConfig := nextInput["config"].(map[string]any)
		nextConfig["channelId"], nextConfig["model"], nextConfig["channelModelKey"] = candidate.ChannelID, candidate.ModelKey, candidate.ModelKey
		nextInput, err = s.resolveSystemChannelModelSelection(nextInput, task.Type, task.Operation)
		if err != nil || s.ValidateTaskCapability(nextInput) != nil || validateCloudAgentResolvedMediaOptions(config, nextInput) != nil {
			continue
		}
		nextConfig = nextInput["config"].(map[string]any)
		var replacement *model.BillingOrder
		if order != nil {
			capability := capabilityFromTaskType(task.Type)
			replacement, err = s.newBillingOrderWithPriceTier(task.UserID, task.ID, "media-model-switch:"+task.ID+":"+candidate.ID, candidate.ChannelID, candidate.ModelKey, capability, firstNonEmpty(task.Operation, task.Type), requestedBillingQuantity(capability, nextConfig), estimateTaskBillingTokens(nextInput, capability), stringValue(nextConfig["priceTierId"]), intent)
			if err != nil || replacement.AmountMicrocredits > order.AmountMicrocredits || order.ChargeLimitMicrocredits > 0 && replacement.AmountMicrocredits > order.ChargeLimitMicrocredits {
				continue
			}
			replacement.Model = candidate.ModelKey
		}
		if err := s.protectTaskSecrets(nextInput); err != nil {
			return nil, err
		}
		encoded, err := json.Marshal(nextInput)
		if err != nil {
			return nil, err
		}
		var cost model.BillingCostSnapshot
		if replacement != nil {
			cost = replacement.BillingCostSnapshot
		}
		if err := s.repo.SwitchTaskLogicalRoute(task.ID, task.RouteID, candidate.ID, string(encoded), task.BillingOrderID, candidate.ChannelID, candidate.ID, replacement, cost, candidate.ModelKey); err != nil {
			return nil, err
		}
		task.RouteID, task.ChannelModelID, task.InputJSON = candidate.ID, candidate.ID, string(encoded)
		task.Model = candidate.ModelKey
		task.ProviderRequestID, task.PollStage, task.NextPollAt = "", "", nil
		return s.createDirectTaskAttempt(task)
	}
	return nil, nil
}

func (s *Service) directMediaFallbackCandidates(original model.ChannelModel, preferred bool, tried, excludedChannels map[string]bool) ([]model.ChannelModel, error) {
	channels, err := s.repo.SystemChannels(false)
	if err != nil {
		return nil, err
	}
	var candidates []model.ChannelModel
	for _, channel := range channels {
		if excludedChannels[channel.ID] {
			continue
		}
		models, err := s.repo.ChannelModels(channel.ID, false)
		if err != nil {
			return nil, err
		}
		for _, candidate := range models {
			if tried[candidate.ID] || !preferred && !samePublicMediaModel(original, candidate) {
				continue
			}
			candidates = append(candidates, candidate)
		}
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		return samePublicMediaModel(original, candidates[i]) && !samePublicMediaModel(original, candidates[j])
	})
	return candidates, nil
}

func samePublicMediaModel(a, b model.ChannelModel) bool {
	return a.ModelKey == b.ModelKey || strings.TrimSpace(a.DisplayName) != "" && strings.EqualFold(strings.TrimSpace(a.DisplayName), strings.TrimSpace(b.DisplayName))
}

func (s *Service) taskAllowsPreferredMediaFallback(task *model.Task, input map[string]any) (bool, error) {
	metadata, _ := input["metadata"].(map[string]any)
	if stringValue(metadata["modelSelectionMode"]) == "fixed" {
		return false, nil
	}
	run, err := s.repo.CloudAgent(task.UserID, task.AgentRunID)
	if err != nil {
		return false, err
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		return false, err
	}
	if state.Request.Surface != "creation" || state.Request.MediaSettings == nil {
		return false, nil
	}
	choice := state.Request.MediaSettings.Image
	if task.Type == "canvas_video" {
		choice = state.Request.MediaSettings.Video
	}
	// Metadata can narrow the authorization, never grant it. Older persisted
	// runs without a selection policy retain their original fixed-model behavior.
	return choice != nil && choice.SelectionMode == "preferred", nil
}

func safeImageRouteRejection(err error) bool {
	var upstream providerHTTPError
	return errors.As(err, &upstream) && (upstream.StatusCode == 400 || upstream.StatusCode == 422)
}
