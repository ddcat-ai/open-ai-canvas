package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"infinite-canvas/backend/internal/model"
)

type ChannelModelsRequest struct {
	BaseURL   string `json:"baseUrl"`
	APIKey    string `json:"apiKey"`
	APIFormat string `json:"apiFormat"`
}

type channelModelsPayload struct {
	Data   []channelModelItem `json:"data"`
	Models []channelModelItem `json:"models"`
	Error  *providerError     `json:"error"`
	Code   *int               `json:"code"`
	Msg    string             `json:"msg"`
}

type channelModelItem struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (s *Service) FetchChannelModels(ctx context.Context, actor *model.User, input ChannelModelsRequest) ([]string, error) {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return nil, Unauthorized("请先登录")
	}
	baseURL := strings.TrimRight(strings.TrimSpace(input.BaseURL), "/")
	apiKey := strings.TrimSpace(input.APIKey)
	if baseURL == "" {
		return nil, BadAuthRequest("请填写 Base URL")
	}
	if apiKey == "" {
		return nil, BadAuthRequest("请填写 API Key")
	}
	apiFormat := strings.ToLower(strings.TrimSpace(input.APIFormat))
	if apiFormat == "" {
		apiFormat = "openai"
	}
	if apiFormat != "openai" && apiFormat != "gemini" {
		return nil, BadAuthRequest("接口协议不支持拉取模型")
	}

	target := apiURL(baseURL, "/models")
	if apiFormat == "gemini" {
		if !strings.HasSuffix(strings.ToLower(baseURL), "/v1beta") {
			baseURL += "/v1beta"
		}
		target = baseURL + "/models"
	}
	if _, err := ValidateOutboundURL(target); err != nil {
		return nil, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, BadAuthRequest("模型服务地址无效")
	}
	if apiFormat == "gemini" {
		request.Header.Set("x-goog-api-key", apiKey)
	} else {
		request.Header.Set("Authorization", "Bearer "+apiKey)
	}

	// 只代理固定的模型目录 GET；用户密钥仅用于本次请求，不写入数据库或日志。
	data, _, err := doBinary(request)
	if err != nil {
		return nil, channelModelsUpstreamError(err)
	}
	var payload channelModelsPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, &AuthError{Status: http.StatusBadGateway, Message: "模型服务返回的不是有效 JSON"}
	}
	if payload.Error != nil && strings.TrimSpace(payload.Error.Message) != "" {
		return nil, &AuthError{Status: http.StatusBadGateway, Message: payload.Error.Message}
	}
	if payload.Code != nil && *payload.Code != 0 {
		return nil, &AuthError{Status: http.StatusBadGateway, Message: firstNonEmpty(strings.TrimSpace(payload.Msg), "模型服务返回失败")}
	}

	items := payload.Data
	if apiFormat == "gemini" {
		items = payload.Models
	}
	seen := make(map[string]bool, len(items))
	models := make([]string, 0, len(items))
	for _, item := range items {
		name := strings.TrimPrefix(strings.TrimSpace(firstNonEmpty(item.ID, item.Name)), "models/")
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		models = append(models, name)
	}
	sort.Strings(models)
	return models, nil
}

func channelModelsUpstreamError(err error) error {
	var authErr *AuthError
	if errors.As(err, &authErr) {
		return authErr
	}
	var httpErr providerHTTPError
	if !errors.As(err, &httpErr) {
		return &AuthError{Status: http.StatusBadGateway, Message: "连接模型服务失败：" + err.Error()}
	}
	switch httpErr.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return &AuthError{Status: http.StatusBadGateway, Message: "模型服务鉴权失败，请检查 API Key"}
	case http.StatusNotFound:
		return &AuthError{Status: http.StatusBadGateway, Message: "模型服务未提供 /models 接口"}
	case http.StatusTooManyRequests:
		return &AuthError{Status: http.StatusBadGateway, Message: "模型服务请求过于频繁或额度不足"}
	default:
		return &AuthError{Status: http.StatusBadGateway, Message: fmt.Sprintf("模型服务请求失败：HTTP %d", httpErr.StatusCode)}
	}
}
