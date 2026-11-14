package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

const systemProxyTaskIDSentinel = "yingce-proxy-task-id-sentinel"

type SystemProxyAsyncResult struct {
	TaskID                string
	Status                protocol.Status
	HasResult             bool
	RequiresResultRequest bool
}

func (s *Service) SystemProxySupportsPolling(protocolID string) bool {
	metadata, ok := s.protocolMetadata(protocolID)
	return ok && strings.TrimSpace(metadata.Poll) != ""
}

func (s *Service) MatchSystemProxyAsyncRequest(protocolID string, capability string, modelKey string, taskID string, method string, requestPath string, query url.Values) (string, string, bool) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" || len(taskID) > 160 || !utf8.ValidString(taskID) || strings.ContainsAny(taskID, "\r\n\x00") || strings.Contains(taskID, systemProxyTaskIDSentinel) {
		return "", "", false
	}
	adapter, ok := s.protocolRegistry().Resolve(strings.TrimSpace(protocolID))
	if !ok {
		return "", "", false
	}
	metadata := adapter.Metadata()
	request := protocol.GenerationRequest{Capability: protocol.Capability(capability), Model: modelKey}
	pollContext := protocol.PollContext{Model: modelKey, TaskID: systemProxyTaskIDSentinel, Request: request}
	contracts := make([]struct {
		operation string
		spec      protocol.RequestSpec
	}, 0, 2)
	if strings.TrimSpace(metadata.Poll) != "" {
		if spec, err := adapter.BuildPoll(context.Background(), pollContext); err == nil {
			contracts = append(contracts, struct {
				operation string
				spec      protocol.RequestSpec
			}{operation: "poll", spec: spec})
		}
	}
	if strings.EqualFold(strings.TrimSpace(method), "GET") {
		resultAdapter, supportsResult := adapter.(protocol.ResultAdapter)
		resultCapability, hasResult := adapter.(protocol.ResultCapability)
		if supportsResult && hasResult && resultCapability.ResultAvailable() {
			if spec, err := resultAdapter.BuildResult(context.Background(), pollContext); err == nil {
				contracts = append(contracts, struct {
					operation string
					spec      protocol.RequestSpec
				}{operation: "result", spec: spec})
			}
		}
	}
	actualPath, err := url.PathUnescape(requestPath)
	if err != nil || strings.ContainsAny(actualPath, "\\\x00") || strings.Contains(strings.ToLower(requestPath), "%2f") {
		return "", "", false
	}
	for _, contract := range contracts {
		spec := contract.spec
		if !strings.EqualFold(spec.Method, method) || strings.TrimSpace(spec.Path) == "" {
			continue
		}
		expected, parseErr := url.ParseRequestURI(spec.Path)
		if parseErr != nil || !strings.HasPrefix(expected.Path, "/") {
			continue
		}
		if strings.ReplaceAll(expected.Path, systemProxyTaskIDSentinel, taskID) != actualPath {
			continue
		}
		expectedQuery := expected.Query()
		for key, values := range spec.Query {
			for _, value := range values {
				expectedQuery.Add(key, value)
			}
		}
		actualKeys := make(map[string]struct{}, len(query))
		for key := range query {
			actualKeys[key] = struct{}{}
		}
		if len(actualKeys) != len(expectedQuery) {
			continue
		}
		matched := true
		for key, expectedValues := range expectedQuery {
			actualValues := query[key]
			if len(actualValues) != len(expectedValues) {
				matched = false
				break
			}
			for index, expectedValue := range expectedValues {
				if strings.ReplaceAll(expectedValue, systemProxyTaskIDSentinel, taskID) != actualValues[index] {
					matched = false
					break
				}
			}
			if !matched {
				break
			}
		}
		if matched {
			return taskID, contract.operation, true
		}
	}
	return "", "", false
}

func (s *Service) SystemProxyBillingOrderForTask(userID string, channelID string, taskIDs []string) (*model.BillingOrder, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(channelID) == "" || len(taskIDs) == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	orders := make(map[string]*model.BillingOrder)
	for _, taskID := range taskIDs {
		if strings.TrimSpace(taskID) == "" {
			continue
		}
		order, err := s.repo.BillingOrderForProviderRequest(userID, channelID, taskID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		orders[order.ID] = order
	}
	if len(orders) == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	if len(orders) != 1 {
		return nil, errors.New("上游任务标识对应多个计费订单")
	}
	for _, order := range orders {
		switch order.Status {
		case model.BillingStatusRunning, model.BillingStatusUncertain, model.BillingStatusSettled:
		default:
			return nil, gorm.ErrRecordNotFound
		}
		return order, nil
	}
	return nil, gorm.ErrRecordNotFound
}

func (s *Service) LinkSystemProxyBillingTask(orderID string, userID string, channelID string, taskID string) error {
	if len(taskID) == 0 || len(taskID) > 160 || !utf8.ValidString(taskID) || strings.ContainsAny(taskID, "\r\n\x00") {
		return errors.New("上游任务标识无效，费用状态待核对")
	}
	order, err := s.repo.BillingOrder(orderID)
	if err != nil {
		return err
	}
	if order.UserID != userID || order.ChannelID != channelID || order.Status != model.BillingStatusRunning {
		return errors.New("上游任务与计费订单无法安全关联")
	}
	if order.ProviderRequestID == taskID {
		return nil
	}
	if order.ProviderRequestID != "" {
		return errors.New("异步任务已关联其他上游标识")
	}
	return s.repo.LinkBillingProviderRequestID(orderID, userID, channelID, taskID)
}

func (s *Service) ParseSystemProxyAsyncResponse(protocolID string, capability string, modelKey string, taskID string, operation string, body []byte) (*SystemProxyAsyncResult, error) {
	adapter, ok := s.protocolRegistry().Resolve(strings.TrimSpace(protocolID))
	if !ok || (operation != "create" && operation != "poll") {
		return nil, fmt.Errorf("异步模型协议不可用")
	}
	request := protocol.GenerationRequest{Capability: protocol.Capability(capability), Model: modelKey}
	ctx := context.Background()
	if operation == "create" {
		var result protocol.CreateResult
		if parser, ok := adapter.(protocol.RequestAwareCreateParser); ok {
			parsed, err := parser.ParseCreateWithRequest(ctx, request, body)
			if err != nil {
				return nil, err
			}
			result = parsed
		} else {
			parsed, err := adapter.ParseCreate(ctx, body)
			if err != nil {
				return nil, err
			}
			result = parsed
		}
		return &SystemProxyAsyncResult{TaskID: strings.TrimSpace(result.TaskID), Status: result.Status, HasResult: systemProxyResultHasContent(result.Result), RequiresResultRequest: resultAdapterAvailable(adapter)}, nil
	}
	parsed, err := adapter.ParsePoll(ctx, protocol.PollContext{Model: modelKey, TaskID: taskID, Request: request}, body)
	if err != nil {
		return nil, err
	}
	return &SystemProxyAsyncResult{TaskID: firstNonEmpty(strings.TrimSpace(parsed.TaskID), taskID), Status: parsed.Status, HasResult: systemProxyResultHasContent(parsed.Result), RequiresResultRequest: resultAdapterAvailable(adapter)}, nil
}

func resultAdapterAvailable(adapter protocol.Adapter) bool {
	capability, ok := adapter.(protocol.ResultCapability)
	return ok && capability.ResultAvailable()
}

func systemProxyResultHasContent(result *protocol.Result) bool {
	return result != nil && (result.Text != "" || result.Reasoning != "" || len(result.Images) > 0 || len(result.Videos) > 0 || len(result.Audios) > 0)
}

func ParseSystemProxyStatusJSON(body []byte) (protocol.Status, error) {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", err
	}
	status := protocol.NormalizeStatus(systemProxyStatusValue(payload))
	if status == "" {
		return "", fmt.Errorf("上游没有返回可识别的任务状态")
	}
	return status, nil
}

func systemProxyStatusValue(payload map[string]any) string {
	for _, key := range []string{"status", "state", "task_status"} {
		if value, ok := payload[key].(string); ok && strings.TrimSpace(value) != "" {
			return value
		}
	}
	for _, key := range []string{"task", "data", "response"} {
		if nested, ok := payload[key].(map[string]any); ok {
			if value := systemProxyStatusValue(nested); value != "" {
				return value
			}
		}
	}
	if done, ok := payload["done"].(bool); ok && done {
		return string(protocol.StatusSucceeded)
	}
	if done, ok := payload["done"].(bool); ok && !done {
		return string(protocol.StatusProcessing)
	}
	return ""
}
