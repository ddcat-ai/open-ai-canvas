package app

import (
	"encoding/json"
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

type CreateAdminUserRequest struct {
	Username    string           `json:"username"`
	DisplayName string           `json:"displayName"`
	Email       string           `json:"email"`
	Password    string           `json:"password"`
	Role        model.UserRole   `json:"role"`
	Status      model.UserStatus `json:"status"`
}

type UpdateUserRequest struct {
	DisplayName string           `json:"displayName"`
	Email       string           `json:"email"`
	Password    string           `json:"password"`
	Role        model.UserRole   `json:"role"`
	Status      model.UserStatus `json:"status"`
}

type BulkDisableUsersRequest struct {
	UserIDs []string `json:"userIds"`
}

type BulkDisableUsersResult struct {
	Users         []model.User `json:"users"`
	DisabledCount int          `json:"disabledCount"`
}

type AdminListQuery struct {
	Keyword string
	Status  string
	Type    string
	Page    int
	Limit   int
}

type AdminUserPage struct {
	Users []AdminUser `json:"users"`
	Total int64       `json:"total"`
	Page  int         `json:"page"`
	Limit int         `json:"pageSize"`
}

type AdminUser struct {
	model.User
	AvailableMicrocredits int64 `json:"availableMicrocredits"`
	ReservedMicrocredits  int64 `json:"reservedMicrocredits"`
}

type AdminChannelPage struct {
	Channels []PublicModelChannel `json:"channels"`
	Total    int64                `json:"total"`
	Page     int                  `json:"page"`
	Limit    int                  `json:"pageSize"`
}

type AdminUserReference struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

type AdminChannelReference struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Enabled           bool     `json:"enabled"`
	Models            []string `json:"models"`
	ModelDisplayNames []string `json:"modelDisplayNames"`
}

type AdminReferenceData struct {
	Users    []AdminUserReference    `json:"users"`
	Channels []AdminChannelReference `json:"channels"`
}

type ChannelRequest struct {
	Name                 string           `json:"name"`
	SortOrder            *int             `json:"sortOrder"`
	BaseURL              string           `json:"baseUrl"`
	APIKey               string           `json:"apiKey"`
	SecretKey            string           `json:"secretKey"`
	ConcurrencyLimit     *int             `json:"concurrencyLimit"`
	UseGlobalConcurrency *bool            `json:"useGlobalConcurrency"`
	Models               []string         `json:"models"`
	Headers              []OutboundHeader `json:"headers"`
	Enabled              *bool            `json:"enabled"`
}

type PublicModelChannel struct {
	ID               string                    `json:"id"`
	UserID           string                    `json:"userId"`
	Scope            model.ChannelScope        `json:"scope"`
	Enabled          bool                      `json:"enabled"`
	Name             string                    `json:"name"`
	SortOrder        int                       `json:"sortOrder"`
	BaseURL          string                    `json:"baseUrl"`
	APIKey           string                    `json:"apiKey"`
	APIFormat        string                    `json:"apiFormat"`
	ConcurrencyLimit int                       `json:"concurrencyLimit"`
	Models           []string                  `json:"models"`
	ModelCosts       []PublicChannelModelPrice `json:"modelCosts"`
	Headers          []OutboundHeader          `json:"headers,omitempty"`
	HasAPIKey        bool                      `json:"hasApiKey"`
	HasSecretKey     bool                      `json:"hasSecretKey"`
	CreatedAt        time.Time                 `json:"createdAt"`
	UpdatedAt        time.Time                 `json:"updatedAt"`
}

type PublicChannelModelPrice struct {
	Model                        string                     `json:"model"`
	DisplayName                  string                     `json:"displayName"`
	ChannelLabel                 string                     `json:"channelLabel"`
	Tags                         []model.ChannelModelTag    `json:"tags"`
	Description                  string                     `json:"description"`
	Icon                         string                     `json:"icon"`
	Capability                   string                     `json:"capability"`
	Protocol                     model.ChannelInterfaceType `json:"protocol"`
	BillingMode                  string                     `json:"billingMode"`
	UnitPriceMicrocredits        int64                      `json:"unitPriceMicrocredits"`
	InputTokenPriceMicrocredits  int64                      `json:"inputTokenPriceMicrocredits"`
	OutputTokenPriceMicrocredits int64                      `json:"outputTokenPriceMicrocredits"`
	CachedTokenPriceMicrocredits int64                      `json:"cachedTokenPriceMicrocredits"`
	CapabilityConfig             *ModelCapabilityConfig     `json:"capabilityConfig,omitempty"`
}

func channelFromRequest(req ChannelRequest, channel model.ModelChannel) (model.ModelChannel, error) {
	return (&Service{}).channelFromRequest(req, channel)
}

func (s *Service) channelFromRequest(req ChannelRequest, channel model.ModelChannel) (model.ModelChannel, error) {
	name := strings.TrimSpace(req.Name)
	baseURL := strings.TrimSpace(req.BaseURL)
	if name == "" {
		return channel, BadAuthRequest("请填写渠道名称")
	}
	if baseURL == "" {
		return channel, BadAuthRequest("请填写 Base URL")
	}
	// 启用/停用或只修改价格、模型等配置时，不应要求上游域名当前可解析。
	// 只有 Base URL 实际变化时才做出站地址校验。
	connectionChanged := strings.TrimRight(baseURL, "/") != strings.TrimRight(channel.BaseURL, "/")
	if connectionChanged {
		if _, err := ValidateOutboundURL(baseURL); err != nil {
			return channel, err
		}
	}
	models := uniqueNonEmpty(req.Models)
	modelsJSON, _ := json.Marshal(models)
	headersJSON, err := EncodeOutboundHeadersJSON(req.Headers)
	if err != nil {
		return channel, err
	}
	channel.Name = name
	if req.SortOrder != nil {
		if err := validateChannelSortOrder(*req.SortOrder); err != nil {
			return channel, err
		}
		channel.SortOrder = *req.SortOrder
	}
	channel.BaseURL = strings.TrimRight(baseURL, "/")
	if req.APIKey != "" {
		channel.APIKey = req.APIKey
	}
	if req.SecretKey != "" {
		channel.SecretKey = req.SecretKey
	}
	// 系统渠道只保存地址与凭证；实际协议和鉴权方式由所选模型决定。
	channel.APIFormat = "openai"
	if req.UseGlobalConcurrency != nil && *req.UseGlobalConcurrency {
		channel.ConcurrencyLimit = 0
	} else if req.ConcurrencyLimit != nil {
		if *req.ConcurrencyLimit < minChannelConcurrencyLimit || *req.ConcurrencyLimit > maxChannelConcurrencyLimit {
			return channel, BadAuthRequest("最大并发数必须是 1-999 的整数")
		}
		channel.ConcurrencyLimit = *req.ConcurrencyLimit
	} else if req.UseGlobalConcurrency != nil {
		return channel, BadAuthRequest("请填写渠道最大并发数")
	}
	channel.ModelsJSON = string(modelsJSON)
	channel.HeadersJSON = headersJSON
	if req.Enabled != nil {
		channel.Enabled = *req.Enabled
	}
	return channel, nil
}

func mergeChannelRequest(req ChannelRequest, channel model.ModelChannel) ChannelRequest {
	if strings.TrimSpace(req.Name) == "" {
		req.Name = channel.Name
	}
	if strings.TrimSpace(req.BaseURL) == "" {
		req.BaseURL = channel.BaseURL
	}
	if req.Models == nil {
		req.Models = channelModelNames(channel)
	}
	if req.Headers == nil {
		req.Headers, _ = ParseOutboundHeadersJSON(channel.HeadersJSON)
	}
	return req
}

func publicChannel(channel model.ModelChannel, admin bool, channelModels []model.ChannelModel) PublicModelChannel {
	models := make([]string, 0, len(channelModels))
	modelCosts := make([]PublicChannelModelPrice, 0, len(channelModels))
	for _, item := range channelModels {
		if !item.Enabled {
			continue
		}
		models = append(models, item.ModelKey)
		if item.Enabled && item.PriceConfigured {
			capabilityConfig, decodeErr := DecodeModelCapabilityConfig(item.CapabilityConfigJSON)
			if decodeErr == nil && capabilityConfig != nil {
				if normalized, normalizeErr := NormalizeModelCapabilityConfigForModel(item.Capability, string(item.Protocol), firstNonEmpty(item.ProviderModelKey, item.ModelKey), capabilityConfig); normalizeErr == nil {
					capabilityConfig = normalized
				}
			}
			modelCosts = append(modelCosts, PublicChannelModelPrice{Model: item.ModelKey, DisplayName: item.DisplayName, ChannelLabel: item.ChannelLabel, Tags: item.Tags, Description: item.Description, Icon: item.Icon, Capability: item.Capability, Protocol: item.Protocol, BillingMode: item.BillingMode, UnitPriceMicrocredits: item.UnitPriceMicrocredits, InputTokenPriceMicrocredits: item.InputTokenPriceMicrocredits, OutputTokenPriceMicrocredits: item.OutputTokenPriceMicrocredits, CachedTokenPriceMicrocredits: item.CachedTokenPriceMicrocredits, CapabilityConfig: capabilityConfig})
		}
	}
	if len(models) == 0 {
		_ = json.Unmarshal([]byte(channel.ModelsJSON), &models)
	}
	apiKey := ""
	baseURL := channel.BaseURL
	var headers []OutboundHeader
	if channel.Scope == model.ChannelScopeSystem {
		if !admin {
			apiKey = "system"
			baseURL = "/api/ai/system/" + channel.ID
		}
		if admin {
			headers, _ = ParseOutboundHeadersJSON(channel.HeadersJSON)
		}
	} else if admin {
		apiKey = channel.APIKey
	}
	return PublicModelChannel{
		ID:               channel.ID,
		UserID:           channel.UserID,
		Scope:            channel.Scope,
		Enabled:          channel.Enabled,
		Name:             channel.Name,
		SortOrder:        channel.SortOrder,
		BaseURL:          baseURL,
		APIKey:           apiKey,
		APIFormat:        channel.APIFormat,
		ConcurrencyLimit: channel.ConcurrencyLimit,
		Models:           models,
		ModelCosts:       modelCosts,
		Headers:          headers,
		HasAPIKey:        strings.TrimSpace(channel.APIKey) != "",
		HasSecretKey:     strings.TrimSpace(channel.SecretKey) != "",
		CreatedAt:        channel.CreatedAt,
		UpdatedAt:        channel.UpdatedAt,
	}
}

func uniqueNonEmpty(values []string) []string {
	return kernel.UniqueNonEmpty(values)
}
