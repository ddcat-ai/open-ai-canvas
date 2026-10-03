package app

import (
	"encoding/json"
	"errors"
	"strings"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

// Direct system-channel image tasks use the same persisted attempts and atomic
// billing switch as logical routes. Only the selected public model can change
// channels; its prompt, inputs and requested specifications remain fixed.
func (s *Service) switchTaskToNextImageChannel(task *model.Task, attempts []model.RouteAttempt) (*model.RouteAttempt, error) {
	if task.Type != "canvas_image" {
		return nil, nil
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
	intent := ModelRequestIntentFromTaskInput(input, task.Type, task.Operation)
	tried := map[string]bool{channelID: true}
	for _, attempt := range attempts {
		tried[attempt.ChannelID] = true
	}
	channels, err := s.repo.SystemChannels(false)
	if err != nil {
		return nil, err
	}
	var order *model.BillingOrder
	if task.BillingOrderID != "" {
		order, err = s.repo.BillingOrder(task.BillingOrderID)
		if err != nil {
			return nil, err
		}
	}
	for _, channel := range channels {
		if tried[channel.ID] {
			continue
		}
		models, err := s.repo.ChannelModels(channel.ID, false)
		if err != nil {
			return nil, err
		}
		for _, candidate := range models {
			if candidate.ModelKey != original.ModelKey && (strings.TrimSpace(original.DisplayName) == "" || !strings.EqualFold(strings.TrimSpace(candidate.DisplayName), strings.TrimSpace(original.DisplayName))) {
				continue
			}
			matched, matchErr := s.channelModelMatchesIntent(&candidate, &intent)
			if matchErr != nil || !matched || s.logicalRouteBlocked(cachedLogicalRoute{ChannelModel: candidate}) {
				continue
			}
			var nextInput map[string]any
			if err := json.Unmarshal([]byte(decrypted), &nextInput); err != nil {
				return nil, err
			}
			nextConfig := nextInput["config"].(map[string]any)
			nextConfig["channelId"], nextConfig["model"] = channel.ID, candidate.ModelKey
			nextInput, err = s.resolveSystemChannelModelSelection(nextInput, task.Type, task.Operation)
			if err != nil || s.ValidateTaskCapability(nextInput) != nil {
				continue
			}
			nextConfig = nextInput["config"].(map[string]any)
			var replacement *model.BillingOrder
			if order != nil {
				replacement, err = s.newBillingOrderWithPriceTierAt(task.UserID, task.ID, "image-channel-switch:"+task.ID+":"+channel.ID, channel.ID, candidate.ModelKey, "image", firstNonEmpty(task.Operation, task.Type), requestedBillingQuantity("image", nextConfig), estimateTaskBillingTokens(nextInput, "image"), stringValue(nextConfig["priceTierId"]), order.CreatedAt)
				if err != nil || replacement.AmountMicrocredits > order.AmountMicrocredits || order.ChargeLimitMicrocredits > 0 && replacement.AmountMicrocredits > order.ChargeLimitMicrocredits {
					continue
				}
				replacement.Model = order.Model
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
			if err := s.repo.SwitchTaskLogicalRoute(task.ID, task.RouteID, candidate.ID, string(encoded), task.BillingOrderID, channel.ID, candidate.ID, replacement, cost); err != nil {
				return nil, err
			}
			task.RouteID, task.ChannelModelID, task.InputJSON = candidate.ID, candidate.ID, string(encoded)
			task.ProviderRequestID, task.PollStage, task.NextPollAt = "", "", nil
			return s.createDirectTaskAttempt(task)
		}
	}
	return nil, nil
}

func safeImageRouteRejection(err error) bool {
	var payload providerPayloadError
	if errors.As(err, &payload) {
		return true
	}
	var upstream providerHTTPError
	return errors.As(err, &upstream) && (upstream.StatusCode == 400 || upstream.StatusCode == 422)
}
