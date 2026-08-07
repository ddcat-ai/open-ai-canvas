package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

type ChannelModelRequest struct {
	ModelKey                     string                 `json:"modelKey"`
	DisplayName                  string                 `json:"displayName"`
	Capability                   string                 `json:"capability"`
	Protocol                     string                 `json:"protocol"`
	BillingMode                  string                 `json:"billingMode"`
	UnitPriceMicrocredits        int64                  `json:"unitPriceMicrocredits"`
	InputTokenPriceMicrocredits  int64                  `json:"inputTokenPriceMicrocredits"`
	OutputTokenPriceMicrocredits int64                  `json:"outputTokenPriceMicrocredits"`
	CachedTokenPriceMicrocredits int64                  `json:"cachedTokenPriceMicrocredits"`
	PriceConfigured              bool                   `json:"priceConfigured"`
	Enabled                      *bool                  `json:"enabled"`
	CapabilityConfig             *ModelCapabilityConfig `json:"capabilityConfig"`
}

// AdminChannelModelFetchResult 是管理员从上游拉目录后的汇总：models 为去重后的标识，added 为本次新建条数。
type AdminChannelModelFetchResult struct {
	Models []string `json:"models"`
	Added  int64    `json:"added"`
}

type AdminChannelModelTestResult struct {
	DurationMs int64 `json:"durationMs"`
}

func (s *Service) EnsureSystemChannelModels() error {
	channels, err := s.repo.SystemChannels(true)
	if err != nil {
		return err
	}
	for index := range channels {
		items, err := s.repo.ChannelModels(channels[index].ID, true)
		if err != nil {
			return err
		}
		if len(items) == 0 {
			if err := s.syncInitialChannelModels(&channels[index], channelModelNames(channels[index])); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) AdminChannelModels(actor *model.User, channelID string) ([]model.ChannelModel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if _, err := s.repo.AdminSystemChannel(channelID); err != nil {
		return nil, err
	}
	items, err := s.ensureChannelModels(channelID, true)
	if err != nil {
		return nil, err
	}
	for index := range items {
		if strings.TrimSpace(items[index].CapabilityConfigJSON) == "" {
			continue
		}
		var config map[string]any
		if json.Unmarshal([]byte(items[index].CapabilityConfigJSON), &config) == nil {
			items[index].CapabilityConfig = config
		}
	}
	return items, nil
}

func (s *Service) SystemChannelModel(channelID string, modelKey string) (*model.ChannelModel, error) {
	return s.repo.ChannelModelByKey(channelID, strings.TrimPrefix(strings.TrimSpace(modelKey), "models/"))
}

func (s *Service) FetchAdminChannelModels(ctx context.Context, actor *model.User, channelID string) (*AdminChannelModelFetchResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.repo.AdminSystemChannel(channelID)
	if err != nil {
		return nil, err
	}
	headers, err := ParseOutboundHeadersJSON(channel.HeadersJSON)
	if err != nil {
		return nil, err
	}
	// 使用服务端保存的渠道密钥和请求头访问上游，避免敏感配置再次经过浏览器。
	models, err := s.FetchChannelModels(ctx, actor, ChannelModelsRequest{BaseURL: channel.BaseURL, APIKey: channel.APIKey, APIFormat: channel.APIFormat, Headers: headers})
	if err != nil {
		return nil, err
	}
	// 只按当前未删除记录去重；重新拉取已删除模型时应生成新的待配置记录。
	existing, err := s.repo.ChannelModels(channelID, true)
	if err != nil {
		return nil, err
	}
	known := make(map[string]struct{}, len(existing))
	for _, item := range existing {
		known[item.ModelKey] = struct{}{}
	}
	missing := make([]model.ChannelModel, 0, len(models))
	for _, name := range models {
		if _, ok := known[name]; ok {
			continue
		}
		// 自动发现不能绕过定价边界；新模型由管理员定价后再手动启用。
		missing = append(missing, model.ChannelModel{ID: newID(), ChannelID: channelID, ModelKey: name, DisplayName: name, BillingMode: "fixed_request", Enabled: false, PriceVersion: 1})
	}
	added, err := s.repo.CreateMissingChannelModels(missing)
	if err != nil {
		return nil, err
	}
	return &AdminChannelModelFetchResult{Models: models, Added: added}, nil
}

func (s *Service) SaveAdminChannelModel(actor *model.User, channelID string, id string, req ChannelModelRequest) (*model.ChannelModel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.repo.AdminSystemChannel(channelID)
	if err != nil {
		return nil, err
	}
	modelKey, capability, protocol, err := normalizeChannelModelContract(channel, req)
	if err != nil {
		return nil, err
	}
	if capability == "image" || capability == "video" {
		if _, err := NormalizeModelCapabilityConfig(capability, string(protocol), req.CapabilityConfig); err != nil {
			return nil, err
		}
	}
	billingMode := strings.TrimSpace(req.BillingMode)
	if billingMode == "" {
		billingMode = "fixed_request"
	}
	if billingMode != "fixed_request" && billingMode != "per_second" && billingMode != "token" {
		return nil, BadAuthRequest("模型计费方式仅支持按次、按秒或 Token")
	}
	if billingMode == "per_second" && capability != "video" {
		return nil, BadAuthRequest("只有视频模型可以按秒计费")
	}
	if billingMode == "token" && capability != "text" {
		return nil, BadAuthRequest("只有文本模型可以按 Token 计费")
	}
	if req.UnitPriceMicrocredits < 0 || req.InputTokenPriceMicrocredits < 0 || req.OutputTokenPriceMicrocredits < 0 || req.CachedTokenPriceMicrocredits < 0 {
		return nil, BadAuthRequest("模型积分价格不能小于 0")
	}
	if billingMode == "token" && req.InputTokenPriceMicrocredits == 0 && req.OutputTokenPriceMicrocredits == 0 && req.CachedTokenPriceMicrocredits == 0 {
		return nil, BadAuthRequest("Token 计费至少需要配置一项价格")
	}
	const maxTokenPriceMicrocredits = int64(1_000_000) * CreditScale
	if req.InputTokenPriceMicrocredits > maxTokenPriceMicrocredits || req.OutputTokenPriceMicrocredits > maxTokenPriceMicrocredits || req.CachedTokenPriceMicrocredits > maxTokenPriceMicrocredits {
		return nil, BadAuthRequest("Token 每百万用量价格不能超过 1,000,000 积分")
	}
	item := &model.ChannelModel{ID: newID(), ChannelID: channelID, Enabled: true, PriceVersion: 1}
	if id != "" {
		item, err = s.repo.ChannelModelByID(channelID, id)
		if err != nil {
			return nil, err
		}
		item.PriceVersion++
	}
	conflict, conflictErr := s.repo.ChannelModelByKeyIncludingDisabled(channelID, modelKey)
	if conflictErr != nil && !errors.Is(conflictErr, gorm.ErrRecordNotFound) {
		return nil, conflictErr
	}
	if conflict != nil && conflict.ID != item.ID {
		return nil, BadAuthRequest("该渠道已存在模型 " + modelKey + "，请直接编辑已有模型")
	}
	item.ModelKey = modelKey
	item.DisplayName = strings.TrimSpace(req.DisplayName)
	if item.DisplayName == "" {
		item.DisplayName = modelKey
	}
	item.Capability = capability
	item.Protocol = protocol
	item.BillingMode = billingMode
	item.UnitPriceMicrocredits = req.UnitPriceMicrocredits
	item.InputTokenPriceMicrocredits = req.InputTokenPriceMicrocredits
	item.OutputTokenPriceMicrocredits = req.OutputTokenPriceMicrocredits
	item.CachedTokenPriceMicrocredits = req.CachedTokenPriceMicrocredits
	item.PriceConfigured = req.PriceConfigured
	if capability == "image" || capability == "video" {
		capabilityConfig, normalizeErr := NormalizeModelCapabilityConfig(capability, string(protocol), req.CapabilityConfig)
		if normalizeErr != nil {
			return nil, normalizeErr
		}
		encoded, encodeErr := json.Marshal(capabilityConfig)
		if encodeErr != nil {
			return nil, encodeErr
		}
		if item.CapabilityConfigJSON != string(encoded) {
			item.CapabilityVersion++
		}
		item.CapabilityConfigJSON = string(encoded)
	} else {
		item.CapabilityConfigJSON = ""
		item.CapabilityVersion = 0
	}
	if req.Enabled != nil {
		item.Enabled = *req.Enabled
	}
	if err := s.repo.SaveChannelModel(item); err != nil {
		return nil, err
	}
	if err := s.syncChannelModelNames(channel); err != nil {
		return nil, err
	}
	return item, nil
}

func (s *Service) TestAdminChannelModel(ctx context.Context, actor *model.User, channelID string, req ChannelModelRequest) (*AdminChannelModelTestResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.repo.AdminSystemChannel(channelID)
	if err != nil {
		return nil, err
	}
	modelKey, capability, protocol, err := normalizeChannelModelContract(channel, req)
	if err != nil {
		return nil, err
	}
	if capability == "image" || capability == "video" {
		if _, err := NormalizeModelCapabilityConfig(capability, string(protocol), req.CapabilityConfig); err != nil {
			return nil, err
		}
	}
	if strings.TrimSpace(channel.BaseURL) == "" || strings.TrimSpace(channel.APIKey) == "" {
		return nil, BadAuthRequest("请先在渠道中配置 Base URL 和 API Key")
	}
	headers, err := ParseOutboundHeadersJSON(channel.HeadersJSON)
	if err != nil {
		return nil, err
	}

	prompt := map[string]string{
		"text":  "Reply with OK.",
		"image": "A simple gray circle on a white background.",
		"video": "A static gray circle on a white background.",
		"audio": "Model test.",
	}[capability]
	videoSeconds := "6"
	videoSecondsValue := 6
	if protocol == model.ChannelInterfaceVolcengineJiMengVideo {
		videoSeconds = "5"
		videoSecondsValue = 5
	}
	input := canvasGenerationInput{
		Mode:   capability,
		Prompt: prompt,
		Config: providerConfig{
			ChannelID:          channel.ID,
			APIFormat:          channel.APIFormat,
			InterfaceType:      string(protocol),
			BaseURL:            channel.BaseURL,
			APIKey:             channel.APIKey,
			SecretKey:          channel.SecretKey,
			Headers:            headers,
			Model:              modelKey,
			Size:               map[string]string{"image": "1024x1024", "video": "16:9"}[capability],
			Quality:            "auto",
			Count:              "1",
			VideoSeconds:       videoSeconds,
			VQuality:           "720",
			VideoGenerateAudio: "false",
			VideoWatermark:     "false",
			AudioVoice:         "alloy",
			AudioFormat:        "mp3",
			AudioSpeed:         "1",
		},
		Metadata: map[string]interface{}{},
	}
	if capability == "image" {
		profile, normalizeErr := NormalizeModelCapabilityConfig(capability, string(protocol), req.CapabilityConfig)
		if normalizeErr != nil {
			return nil, normalizeErr
		}
		input.ImageCapability = profile.Image
	}

	// 测试复用真实生成协议、运行时并发和熔断策略，但不创建用户任务或计费订单。
	testCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	testCtx = context.WithValue(testCtx, providerAnalyticsKey{}, providerAnalyticsContext{
		Service: s, UserID: actor.ID, ChannelID: channel.ID, Capability: capability,
		Operation: "admin_model_test", Model: modelKey, VideoSeconds: videoSecondsValue,
	})
	startedAt := time.Now()
	switch capability {
	case "text":
		_, err = runTextTask(testCtx, input)
	case "image":
		_, err = runImageTask(testCtx, input)
	case "video":
		_, err = runVideoTask(testCtx, input)
	case "audio":
		_, err = runAudioTask(testCtx, input)
	}
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, context.DeadlineExceeded) {
			status = http.StatusGatewayTimeout
		}
		return nil, &AuthError{Status: status, Message: "模型测试失败：" + truncateRunes(err.Error(), 1000)}
	}
	return &AdminChannelModelTestResult{DurationMs: time.Since(startedAt).Milliseconds()}, nil
}

func normalizeChannelModelContract(channel *model.ModelChannel, req ChannelModelRequest) (string, string, model.ChannelInterfaceType, error) {
	modelKey := strings.TrimPrefix(strings.TrimSpace(req.ModelKey), "models/")
	if modelKey == "" {
		return "", "", "", BadAuthRequest("请填写模型标识")
	}
	capability := normalizeCapability(req.Capability)
	if capability == "" {
		return "", "", "", BadAuthRequest("请选择模型能力")
	}
	protocol := model.ChannelInterfaceType(strings.TrimSpace(req.Protocol))
	if !validChannelInterfaceType(protocol) {
		return "", "", "", BadAuthRequest("请选择有效的模型请求协议")
	}
	if expected := capabilityForProtocol(protocol); expected != "" && expected != capability {
		return "", "", "", BadAuthRequest("模型能力与请求协议不匹配")
	}
	if (protocol == model.ChannelInterfaceVolcengineJiMengImage || protocol == model.ChannelInterfaceVolcengineJiMengVideo) && (strings.TrimSpace(channel.APIKey) == "" || strings.TrimSpace(channel.SecretKey) == "") {
		return "", "", "", BadAuthRequest("即梦官方协议需要先在渠道中配置 Access Key 和 Secret Key")
	}
	return modelKey, capability, protocol, nil
}

func (s *Service) DeleteAdminChannelModel(actor *model.User, channelID string, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	if _, err := s.repo.AdminSystemChannel(channelID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return BadAuthRequest("系统渠道不存在或已删除")
		}
		return err
	}
	if _, err := s.repo.ChannelModelByID(channelID, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return BadAuthRequest("渠道模型不存在或已删除")
		}
		return err
	}
	items, err := s.repo.ChannelModels(channelID, false)
	if err != nil {
		return err
	}
	names := make([]string, 0, len(items))
	for _, item := range items {
		if item.ID != id {
			names = append(names, item.ModelKey)
		}
	}
	encoded, err := json.Marshal(names)
	if err != nil {
		return err
	}
	// 删除模型与渠道的兼容模型清单必须同事务提交，避免接口报错但列表已部分变化。
	err = s.repo.DeleteChannelModel(channelID, id, string(encoded), time.Now())
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return BadAuthRequest("渠道模型不存在或已删除")
	}
	return err
}

func (s *Service) syncInitialChannelModels(channel *model.ModelChannel, names []string) error {
	existing, err := s.repo.ChannelModels(channel.ID, true)
	if err != nil {
		return err
	}
	byKey := make(map[string]*model.ChannelModel, len(existing))
	for index := range existing {
		byKey[existing[index].ModelKey] = &existing[index]
	}
	desired := make(map[string]bool, len(names))
	for _, name := range uniqueNonEmpty(names) {
		name = strings.TrimPrefix(name, "models/")
		desired[name] = true
		if item := byKey[name]; item != nil {
			if !item.Enabled {
				item.Enabled = true
				item.PriceVersion++
				if err := s.repo.SaveChannelModel(item); err != nil {
					return err
				}
			}
			continue
		}
		item := model.ChannelModel{ID: newID(), ChannelID: channel.ID, ModelKey: name, DisplayName: name, BillingMode: "fixed_request", Enabled: false, PriceVersion: 1}
		if err := s.repo.SaveChannelModel(&item); err != nil {
			return err
		}
	}
	for index := range existing {
		if existing[index].Enabled && !desired[existing[index].ModelKey] {
			existing[index].Enabled = false
			existing[index].PriceVersion++
			if err := s.repo.SaveChannelModel(&existing[index]); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) ensureChannelModels(channelID string, includeDisabled bool) ([]model.ChannelModel, error) {
	items, err := s.repo.ChannelModels(channelID, includeDisabled)
	if err != nil || len(items) > 0 {
		return items, err
	}
	channel, err := s.repo.AdminSystemChannel(channelID)
	if err != nil {
		return nil, err
	}
	if err := s.syncInitialChannelModels(channel, channelModelNames(*channel)); err != nil {
		return nil, err
	}
	return s.repo.ChannelModels(channelID, includeDisabled)
}

func (s *Service) syncChannelModelNames(channel *model.ModelChannel) error {
	items, err := s.repo.ChannelModels(channel.ID, false)
	if err != nil {
		return err
	}
	names := make([]string, 0, len(items))
	for _, item := range items {
		names = append(names, item.ModelKey)
	}
	encoded, err := json.Marshal(names)
	if err != nil {
		return err
	}
	channel.ModelsJSON = string(encoded)
	return s.repo.Save(channel)
}

func capabilityForProtocol(protocol model.ChannelInterfaceType) string {
	switch protocol {
	case model.ChannelInterfaceOpenAIImage, model.ChannelInterfaceGrokImage, model.ChannelInterfaceVolcengineArkImage, model.ChannelInterfaceVolcengineJiMengImage:
		return "image"
	case model.ChannelInterfaceOpenAIAudio, model.ChannelInterfaceAsyncAudio:
		return "audio"
	case model.ChannelInterfaceNewAPIVideo, model.ChannelInterfaceNewAPIChannel1, model.ChannelInterfaceNewAPIChannel2, model.ChannelInterfaceXAIVideo, model.ChannelInterfaceVolcengineArkVideo, model.ChannelInterfaceVolcengineJiMengVideo, model.ChannelInterfaceGeminiVeo:
		return "video"
	case model.ChannelInterfaceChatCompletion, model.ChannelInterfaceOpenAIResponse:
		return "text"
	default:
		return ""
	}
}
