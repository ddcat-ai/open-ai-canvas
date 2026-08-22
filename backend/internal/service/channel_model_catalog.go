package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"

	"infinite-canvas/backend/internal/model"
)

type ChannelModelsRequest struct {
	BaseURL           string           `json:"baseUrl"`
	AllowLocalChannel bool             `json:"allowLocalChannel"`
	APIKey            string           `json:"apiKey"`
	APIFormat         string           `json:"apiFormat"`
	Headers           []OutboundHeader `json:"headers"`
}

type channelModelsPayload struct {
	Data   []channelModelItem `json:"data"`
	Models []channelModelItem `json:"models"`
	Error  *providerError     `json:"error"`
	Code   *int               `json:"code"`
	Msg    string             `json:"msg"`
}

type channelModelItem struct {
	ID                     string                        `json:"id"`
	Name                   string                        `json:"name"`
	DisplayName            string                        `json:"display_name"`
	ModelType              string                        `json:"model_type"`
	SupportedEndpointTypes []string                      `json:"supported_endpoint_types"`
	DefaultParameters      channelModelCatalogParameters `json:"default_parameters"`
	Options                channelModelCatalogOptions    `json:"options"`
	SupportsImages         *bool                         `json:"supports_images"`
	MinImages              *int                          `json:"min_images"`
	MaxImages              *int                          `json:"max_images"`
}

type channelModelCatalogParameters struct {
	AspectRatio     string `json:"aspect_ratio"`
	DurationSeconds string `json:"duration_seconds"`
	Resolution      string `json:"resolution"`
}

type channelModelCatalogOptions struct {
	AspectRatio     []ChannelModelCatalogOption `json:"aspect_ratio"`
	DurationSeconds []ChannelModelCatalogOption `json:"duration_seconds"`
	Resolution      []ChannelModelCatalogOption `json:"resolution"`
}

func (s *Service) FetchChannelModels(ctx context.Context, actor *model.User, input ChannelModelsRequest) ([]string, error) {
	items, err := s.FetchChannelModelCatalog(ctx, actor, input)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]bool, len(items))
	models := make([]string, 0, len(items))
	for _, item := range items {
		name := strings.TrimSpace(item.ID)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		models = append(models, name)
	}
	sort.Strings(models)
	return models, nil
}

// ChannelModelCatalogItem 是前端自定义渠道拉取模型目录后的最小合同；
// 协议、能力和可选参数均来自上游公开元数据，不展开供应商内部兼容模型。
type ChannelModelCatalogItem struct {
	ID                     string                               `json:"id"`
	DisplayName            string                               `json:"displayName,omitempty"`
	ModelType              string                               `json:"modelType,omitempty"`
	SupportedEndpointTypes []string                             `json:"supportedEndpointTypes,omitempty"`
	DefaultParameters      ChannelModelCatalogDefaultParameters `json:"defaultParameters,omitempty"`
	Options                ChannelModelCatalogOptions           `json:"options,omitempty"`
	SupportsImages         *bool                                `json:"supportsImages,omitempty"`
	MinImages              *int                                 `json:"minImages,omitempty"`
	MaxImages              *int                                 `json:"maxImages,omitempty"`
}

type ChannelModelCatalogDefaultParameters struct {
	AspectRatio     string `json:"aspectRatio,omitempty"`
	DurationSeconds string `json:"durationSeconds,omitempty"`
	Resolution      string `json:"resolution,omitempty"`
}

type ChannelModelCatalogOptions struct {
	AspectRatio     []ChannelModelCatalogOption `json:"aspectRatio,omitempty"`
	DurationSeconds []ChannelModelCatalogOption `json:"durationSeconds,omitempty"`
	Resolution      []ChannelModelCatalogOption `json:"resolution,omitempty"`
}

type ChannelModelCatalogOption struct {
	Value string `json:"value"`
	Label string `json:"label,omitempty"`
}

func (s *Service) FetchChannelModelCatalog(ctx context.Context, actor *model.User, input ChannelModelsRequest) ([]ChannelModelCatalogItem, error) {
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
	headers, err := NormalizeOutboundHeaders(input.Headers)
	if err != nil {
		return nil, err
	}

	target := apiURL(baseURL, "/models")
	if apiFormat == "gemini" {
		if !strings.HasSuffix(strings.ToLower(baseURL), "/v1beta") {
			baseURL += "/v1beta"
		}
		target = baseURL + "/models"
	}
	if _, err := s.validateChannelOutboundURL(target, input.AllowLocalChannel, false); err != nil {
		return nil, err
	}
	requestContext := withProviderOutboundPolicy(ctx, providerConfig{BaseURL: baseURL, AllowLocalChannel: s.effectiveAllowLocalChannel(input.AllowLocalChannel)})
	request, err := http.NewRequestWithContext(requestContext, http.MethodGet, target, nil)
	if err != nil {
		return nil, BadAuthRequest("模型服务地址无效")
	}
	if apiFormat == "gemini" {
		request.Header.Set("x-goog-api-key", apiKey)
	} else {
		request.Header.Set("Authorization", "Bearer "+apiKey)
	}
	ApplyOutboundHeaders(request, headers)

	// 只代理固定的模型目录 GET；用户密钥仅用于本次请求，不写入数据库或日志。
	data, _, err := doBinary(request)
	if err != nil {
		return nil, channelModelsUpstreamError(err)
	}
	var payload channelModelsPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, WrapAppError(http.StatusBadGateway, "模型服务返回的不是有效 JSON", err)
	}
	if payload.Error != nil && strings.TrimSpace(payload.Error.Message) != "" {
		return nil, NewAppError(http.StatusBadGateway, "模型服务返回失败，请检查渠道配置")
	}
	if payload.Code != nil && *payload.Code != 0 {
		return nil, NewAppError(http.StatusBadGateway, "模型服务返回失败，请检查渠道配置")
	}

	items := payload.Data
	if apiFormat == "gemini" {
		items = payload.Models
	}
	seen := make(map[string]bool, len(items))
	catalog := make([]ChannelModelCatalogItem, 0, len(items))
	for _, item := range items {
		name := strings.TrimPrefix(strings.TrimSpace(firstNonEmpty(item.ID, item.Name)), "models/")
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		catalog = append(catalog, ChannelModelCatalogItem{
			ID:                     name,
			DisplayName:            strings.TrimSpace(item.DisplayName),
			ModelType:              normalizeCatalogModelType(item.ModelType),
			SupportedEndpointTypes: normalizeCatalogEndpointTypes(item.SupportedEndpointTypes),
			DefaultParameters: ChannelModelCatalogDefaultParameters{
				AspectRatio:     strings.TrimSpace(item.DefaultParameters.AspectRatio),
				DurationSeconds: strings.TrimSpace(item.DefaultParameters.DurationSeconds),
				Resolution:      strings.TrimSpace(item.DefaultParameters.Resolution),
			},
			Options: ChannelModelCatalogOptions{
				AspectRatio:     normalizeCatalogOptions(item.Options.AspectRatio),
				DurationSeconds: normalizeCatalogOptions(item.Options.DurationSeconds),
				Resolution:      normalizeCatalogOptions(item.Options.Resolution),
			},
			SupportsImages: item.SupportsImages,
			MinImages:      item.MinImages,
			MaxImages:      item.MaxImages,
		})
	}
	sort.Slice(catalog, func(left int, right int) bool {
		return catalog[left].ID < catalog[right].ID
	})
	if s.isPluginEnabled() {
		catalog = extendChannelModelCatalog(baseURL, apiFormat, headers, catalog)
	}
	return catalog, nil
}

func normalizeCatalogModelType(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	switch normalized {
	case "text", "image", "video", "audio":
		return normalized
	default:
		return ""
	}
}

func normalizeCatalogOptions(options []ChannelModelCatalogOption) []ChannelModelCatalogOption {
	seen := make(map[string]bool, len(options))
	normalized := make([]ChannelModelCatalogOption, 0, len(options))
	for _, option := range options {
		value := strings.TrimSpace(option.Value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		normalized = append(normalized, ChannelModelCatalogOption{Value: value, Label: strings.TrimSpace(option.Label)})
	}
	return normalized
}

func normalizeCatalogEndpointTypes(values []string) []string {
	seen := make(map[string]bool, len(values))
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		item := strings.TrimSpace(value)
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		normalized = append(normalized, item)
	}
	return normalized
}

func channelModelsUpstreamError(err error) error {
	var authErr *AuthError
	if errors.As(err, &authErr) {
		return authErr
	}
	var httpErr providerHTTPError
	if !errors.As(err, &httpErr) {
		return WrapAppError(http.StatusBadGateway, "连接模型服务失败，请检查渠道地址和网络", err)
	}
	switch httpErr.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return NewAppError(http.StatusBadGateway, "模型服务鉴权失败，请检查 API Key")
	case http.StatusNotFound:
		return NewAppError(http.StatusBadGateway, "模型服务未提供 /models 接口")
	case http.StatusTooManyRequests:
		return NewAppError(http.StatusBadGateway, "模型服务请求过于频繁或额度不足")
	default:
		return WrapAppError(http.StatusBadGateway, httpErr.Error(), err)
	}
}
