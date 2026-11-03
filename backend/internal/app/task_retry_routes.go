package app

import (
	"encoding/json"
	"fmt"
	"strings"

	"yingce/backend/internal/model"
)

type TaskRetryRouteRequest struct {
	ChannelID                  string `json:"channelId"`
	ModelKey                   string `json:"modelKey"`
	RouteRun                   int    `json:"routeRun"`
	ApprovedAmountMicrocredits *int64 `json:"approvedAmountMicrocredits"`
	PriceVersion               string `json:"priceVersion"`
}

type TaskRetryRoute struct {
	ChannelID          string `json:"channelId"`
	ModelKey           string `json:"modelKey"`
	Label              string `json:"label"`
	ModelName          string `json:"modelName"`
	AmountMicrocredits int64  `json:"amountMicrocredits"`
	PriceVersion       string `json:"priceVersion"`
	RouteRun           int    `json:"routeRun"`
}

func retryRoutePrice(order *model.BillingOrder) (int64, string) {
	if order == nil {
		return 0, "free"
	}
	return order.AmountMicrocredits, fmt.Sprintf("%s:%d:%d", order.PriceTierID, order.PriceVersion, order.PriceTierVersion)
}

func (s *Service) retrySourceModel(task *model.Task, input map[string]any) (*model.ChannelModel, error) {
	if task.LogicalModelID != "" || (task.Type != "canvas_image" && task.Type != "canvas_video") {
		return nil, BadAuthRequest("此任务请回到原创作入口选择线路")
	}
	if task.Stage == "submission_unknown" || task.ProviderCancelStatus == model.ProviderCancelStatusUncertain {
		return nil, BadAuthRequest("上次提交结果尚未确认，请先核对任务结果")
	}
	if task.BillingOrderID != "" {
		order, err := s.repo.BillingOrder(task.BillingOrderID)
		if err != nil {
			return nil, err
		}
		if order == nil || (order.Status != model.BillingStatusSettled && order.Status != model.BillingStatusRefunded) {
			return nil, BadAuthRequest("上次调用费用尚未处理完成，请稍后再选择线路")
		}
	}
	config, _ := input["config"].(map[string]any)
	source, err := s.repo.ChannelModelByKey(stringValue(config["channelId"]), stringValue(config["model"]))
	if err != nil {
		return nil, BadAuthRequest("原模型已不存在，请回到创作入口选择模型")
	}
	return source, nil
}

func sameRetryModel(source, target *model.ChannelModel) bool {
	return source.Capability == target.Capability && strings.TrimSpace(firstNonEmpty(source.DisplayName, source.ModelKey)) == strings.TrimSpace(firstNonEmpty(target.DisplayName, target.ModelKey))
}

func (s *Service) prepareTaskRetryRoute(userID string, task *model.Task, input map[string]any, channelID, modelKey string) error {
	source, err := s.retrySourceModel(task, input)
	if err != nil {
		return err
	}
	target, err := s.repo.ChannelModelByKey(channelID, modelKey)
	if err != nil || !target.Enabled || !sameRetryModel(source, target) || target.ID == source.ID {
		return BadAuthRequest("请选择同一模型的其他可用线路")
	}
	intent := ModelRequestIntentFromTaskInput(input, task.Type, task.Operation)
	matched, err := s.channelModelMatchesIntent(target, &intent)
	if err != nil {
		return err
	}
	if !matched {
		return BadAuthRequest("此线路不支持原任务的参数或参考素材，请回到创作入口调整")
	}
	access, err := s.userGroupAccess(userID)
	if err != nil {
		return err
	}
	config := input["config"].(map[string]any)
	config["channelId"], config["model"] = channelID, modelKey
	if _, err := s.resolveSystemChannelModelSelection(access, input, task.Type, task.Operation); err != nil {
		return err
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return err
	}
	var execution canvasGenerationInput
	if err := json.Unmarshal(encoded, &execution); err != nil {
		return BadAuthRequest("原任务参数格式无效，请回到创作入口调整后提交")
	}
	if err := s.ValidateTaskCapability(input); err != nil {
		return err
	}
	task.Model, task.ChannelModelID = target.ModelKey, target.ID
	// resolveSystemChannelModelSelection replaces config with the validated configuration.
	resolved, _ := input["config"].(map[string]any)
	task.Provider = stringValue(resolved["apiFormat"])
	return nil
}

func (s *Service) TaskRetryRoutes(userID, id string) ([]TaskRetryRoute, error) {
	task, err := s.loadRetryableTask(userID, id)
	if err != nil {
		return nil, err
	}
	raw, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return nil, err
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		return nil, err
	}
	source, err := s.retrySourceModel(task, input)
	if err != nil {
		return nil, err
	}
	access, err := s.userGroupAccess(userID)
	if err != nil {
		return nil, err
	}
	channels, err := s.repo.SystemChannels(true)
	if err != nil {
		return nil, err
	}
	routes := []TaskRetryRoute{}
	for _, channel := range channels {
		if !channel.Enabled || !access.allowsChannel(channel.ID) {
			continue
		}
		models, err := s.repo.ChannelModels(channel.ID, false)
		if err != nil {
			return nil, err
		}
		for _, candidate := range models {
			if !candidate.Enabled || candidate.ID == source.ID || !sameRetryModel(source, &candidate) {
				continue
			}
			var clonedInput map[string]any
			if err := json.Unmarshal([]byte(raw), &clonedInput); err != nil {
				return nil, err
			}
			prepared := *task
			if err := s.prepareTaskRetryRoute(userID, &prepared, clonedInput, channel.ID, candidate.ModelKey); err != nil {
				continue
			}
			order, err := s.taskBillingOrder(userID, &prepared, clonedInput)
			if err != nil {
				continue
			}
			amount, version := retryRoutePrice(order)
			routes = append(routes, TaskRetryRoute{ChannelID: channel.ID, ModelKey: candidate.ModelKey, Label: firstNonEmpty(candidate.ChannelLabel, candidate.ModelKey), ModelName: firstNonEmpty(candidate.DisplayName, candidate.ModelKey), AmountMicrocredits: amount, PriceVersion: version, RouteRun: task.RouteRun})
		}
	}
	return routes, nil
}

func (s *Service) RetryTaskOnRoute(userID, id string, req TaskRetryRouteRequest) (*model.Task, error) {
	task, err := s.loadRetryableTask(userID, id)
	if err != nil {
		return nil, err
	}
	return s.submitTaskRetry(userID, task, &req)
}
