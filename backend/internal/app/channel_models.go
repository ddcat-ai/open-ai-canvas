package app

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
	"yingce/backend/internal/repository"
)

type ChannelModelRequest struct {
	ModelKey                     string                         `json:"modelKey"`
	ProviderModelKey             string                         `json:"providerModelKey"`
	DisplayName                  string                         `json:"displayName"`
	ChannelLabel                 string                         `json:"channelLabel"`
	Tags                         []model.ChannelModelTag        `json:"tags"`
	Description                  string                         `json:"description"`
	Icon                         string                         `json:"icon"`
	Capability                   string                         `json:"capability"`
	Protocol                     string                         `json:"protocol"`
	BillingMode                  string                         `json:"billingMode"`
	UnitPriceMicrocredits        int64                          `json:"unitPriceMicrocredits"`
	InputTokenPriceMicrocredits  int64                          `json:"inputTokenPriceMicrocredits"`
	OutputTokenPriceMicrocredits int64                          `json:"outputTokenPriceMicrocredits"`
	CachedTokenPriceMicrocredits int64                          `json:"cachedTokenPriceMicrocredits"`
	PriceConfigured              bool                           `json:"priceConfigured"`
	Enabled                      *bool                          `json:"enabled"`
	CapabilityConfig             *ModelCapabilityConfig         `json:"capabilityConfig"`
	PriceTiers                   []ChannelModelPriceTierRequest `json:"priceTiers"`
}

const maxAdminChannelModelBatchDeleteCount = 100

// ChannelModelPriceTierRequest 是系统渠道内某个规格的上游 SKU 与结算价格。
// Resolution="*"、VideoSeconds=0 分别表示任意分辨率和任意时长。
type ChannelModelPriceTierRequest struct {
	CostPricing model.CreditCostPricing `json:"costPricing"`
	// Selector 是 SKU 的规范匹配条件。支持 operation、quality、size、vquality、videoSeconds、imageCount、videoGenerateAudio；
	// operation 可区分文生/图生/视频生，避免同一分辨率下错误复用价格。
	Selector                     map[string]string `json:"selector"`
	Resolution                   string            `json:"resolution"`
	VideoSeconds                 int               `json:"videoSeconds"`
	ProviderModelKey             string            `json:"providerModelKey"`
	BillingMode                  string            `json:"billingMode"`
	UnitPriceMicrocredits        int64             `json:"unitPriceMicrocredits"`
	InputTokenPriceMicrocredits  int64             `json:"inputTokenPriceMicrocredits"`
	OutputTokenPriceMicrocredits int64             `json:"outputTokenPriceMicrocredits"`
	CachedTokenPriceMicrocredits int64             `json:"cachedTokenPriceMicrocredits"`
	PriceConfigured              bool              `json:"priceConfigured"`
	Enabled                      *bool             `json:"enabled"`
}

// AdminChannelModelFetchResult 是管理员从上游拉目录后的汇总：models 为去重后的标识，added 为本次新建条数。
type AdminChannelModelFetchResult struct {
	Models []string `json:"models"`
	Added  int64    `json:"added"`
}

type AdminChannelModelImportRequest struct {
	Models []string `json:"models"`
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
	if _, err := s.adminSystemChannel(channelID); err != nil {
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
		config, decodeErr := DecodeModelCapabilityConfig(items[index].CapabilityConfigJSON)
		if decodeErr != nil || config == nil {
			continue
		}
		normalized, normalizeErr := NormalizeModelCapabilityConfigForModel(items[index].Capability, string(items[index].Protocol), firstNonEmpty(items[index].ProviderModelKey, items[index].ModelKey), config)
		if normalizeErr != nil || normalized == nil {
			continue
		}
		encoded, encodeErr := json.Marshal(normalized)
		var value map[string]any
		if encodeErr == nil && json.Unmarshal(encoded, &value) == nil {
			items[index].CapabilityConfig = value
		}
	}
	return items, nil
}

func (s *Service) SystemChannelModel(channelID string, modelKey string) (*model.ChannelModel, error) {
	return s.repo.ChannelModelByKey(channelID, strings.TrimPrefix(strings.TrimSpace(modelKey), "models/"))
}

// SystemChannelHasProtocol 用于没有携带 model 字段的轮询请求：先确认渠道确实配置了该协议，
// 再由 handler 按协议限定请求路径，避免用空模型绕过系统渠道授权。
func (s *Service) SystemChannelHasProtocol(channelID string, protocol model.ChannelInterfaceType) (bool, error) {
	items, err := s.repo.ChannelModels(channelID, false)
	if err != nil {
		return false, err
	}
	for _, item := range items {
		if item.Protocol == protocol {
			return true, nil
		}
	}
	return false, nil
}

func (s *Service) SaveAdminChannelModel(actor *model.User, channelID string, id string, req ChannelModelRequest) (*model.ChannelModel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channelLabel := strings.TrimSpace(req.ChannelLabel)
	tags, err := normalizeChannelModelTags(req.Tags)
	if err != nil {
		return nil, err
	}
	description := strings.TrimSpace(req.Description)
	if len([]rune(description)) > 500 {
		return nil, BadAuthRequest("模型描述不能超过 500 字")
	}
	if len([]rune(channelLabel)) > 80 {
		return nil, BadAuthRequest("渠道展示名不能超过 80 字")
	}
	channel, err := s.repo.AdminSystemChannel(channelID)
	if err != nil {
		return nil, err
	}
	modelKey, providerModelKey, capability, protocol, err := s.normalizeChannelModelContract(channel, req)
	if err != nil {
		return nil, err
	}
	// 先检查同渠道重复模型，避免无关能力校验或生成无用序列号掩盖真正的冲突。
	conflict, conflictErr := s.repo.ChannelModelByKeyIncludingDisabled(channelID, modelKey)
	if conflictErr != nil && !errors.Is(conflictErr, gorm.ErrRecordNotFound) {
		return nil, conflictErr
	}
	if conflict != nil && conflict.ID != strings.TrimSpace(id) {
		return nil, BadAuthRequest("该渠道已存在模型 " + modelKey + "，请直接编辑已有模型")
	}
	if capability == "text" || capability == "image" || capability == "video" {
		if _, err := NormalizeModelCapabilityConfigForModel(capability, string(protocol), providerModelKey, req.CapabilityConfig); err != nil {
			return nil, err
		}
	}
	tiers, err := s.normalizeChannelModelPriceTiers(req, capability, protocol, providerModelKey)
	if err != nil {
		return nil, err
	}
	modelID, err := s.repo.NextPrefixedID("MODEL")
	if err != nil {
		return nil, err
	}
	item := &model.ChannelModel{ID: modelID, ChannelID: channelID, Enabled: true, PriceVersion: 1}
	previousProviderModelKey := ""
	if id != "" {
		item, err = s.repo.ChannelModelByID(channelID, id)
		if err != nil {
			return nil, err
		}
		previousProviderModelKey = strings.TrimPrefix(strings.TrimSpace(item.ProviderModelKey), "models/")
		item.PriceVersion++
	}
	// 模型级上游键重命名时，与旧值相同的档位键属于“跟随模型默认”的隐式固化，必须级联跟随；
	// 否则任务请求会继续把旧上游键发给供应商。管理员显式配置的其他上游 SKU 不受影响。
	if previousProviderModelKey != "" && providerModelKey != previousProviderModelKey {
		for index := range tiers {
			if strings.TrimPrefix(strings.TrimSpace(tiers[index].ProviderModelKey), "models/") == previousProviderModelKey {
				tiers[index].ProviderModelKey = providerModelKey
			}
		}
	}
	item.ModelKey = modelKey
	item.ProviderModelKey = providerModelKey
	item.DisplayName = strings.TrimSpace(req.DisplayName)
	item.ChannelLabel = channelLabel
	item.Tags = tags
	item.Description = description
	if item.DisplayName == "" {
		item.DisplayName = modelKey
	}
	item.Icon = strings.TrimSpace(req.Icon)
	item.Capability = capability
	item.Protocol = protocol
	s.applyChannelModelPriceTierSummary(item, tiers)
	if capability == "text" || capability == "image" || capability == "video" {
		capabilityConfig, normalizeErr := NormalizeModelCapabilityConfigForModel(capability, string(protocol), providerModelKey, req.CapabilityConfig)
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
	if err := validateChannelModelTierCapabilities(tiers, item.CapabilityConfigJSON, capability); err != nil {
		return nil, err
	}
	// 渠道模型及所有价格档必须同时落库，不能出现“能力已开放但规格价格尚未更新”的窗口。
	if err := s.repo.SaveChannelModelWithPriceTiers(item, tiers); err != nil {
		return nil, err
	}
	item.PriceTiers = tiers
	s.invalidateRouteCatalog()
	if err := s.syncChannelModelNames(channel); err != nil {
		return nil, err
	}
	if err := s.syncLogicalModelsFromChannelModel(actor, item); err != nil {
		return nil, err
	}
	return item, nil
}

func normalizeChannelModelContract(channel *model.ModelChannel, req ChannelModelRequest) (string, string, string, model.ChannelInterfaceType, error) {
	return normalizeChannelModelContractWithRegistry(protocol.Builtins(), channel, req)
}

func (s *Service) normalizeChannelModelContract(channel *model.ModelChannel, req ChannelModelRequest) (string, string, string, model.ChannelInterfaceType, error) {
	return normalizeChannelModelContractWithRegistry(s.protocolRegistry(), channel, req)
}

func normalizeChannelModelContractWithRegistry(registry *protocol.Registry, channel *model.ModelChannel, req ChannelModelRequest) (string, string, string, model.ChannelInterfaceType, error) {
	modelKey := strings.TrimPrefix(strings.TrimSpace(req.ModelKey), "models/")
	if modelKey == "" {
		return "", "", "", "", BadAuthRequest("请填写模型标识")
	}
	providerModelKey := strings.TrimPrefix(strings.TrimSpace(req.ProviderModelKey), "models/")
	if providerModelKey == "" {
		providerModelKey = modelKey
	}
	capability := normalizeCapability(req.Capability)
	if capability == "" {
		return "", "", "", "", BadAuthRequest("请选择模型能力")
	}
	adapter, ok := registry.Resolve(strings.TrimSpace(req.Protocol))
	if !ok || !adapter.Metadata().Enabled || adapter.Metadata().UnavailableReason != "" {
		return "", "", "", "", BadAuthRequest("请选择有效的模型请求协议")
	}
	protocol := model.ChannelInterfaceType(adapter.Metadata().ID)
	if expected := protocolCapabilityFromMetadata(adapter.Metadata()); expected != "" && expected != capability {
		return "", "", "", "", BadAuthRequest("模型能力与请求协议不匹配")
	}
	if (protocol == model.ChannelInterfaceVolcengineJiMengImage || protocol == model.ChannelInterfaceVolcengineJiMengVideo) && (strings.TrimSpace(channel.APIKey) == "" || strings.TrimSpace(channel.SecretKey) == "") {
		return "", "", "", "", BadAuthRequest("即梦官方协议需要先在渠道中配置 Access Key 和 Secret Key")
	}
	return modelKey, providerModelKey, capability, protocol, nil
}

func (s *Service) DeleteAdminChannelModel(actor *model.User, channelID string, id string) error {
	_, err := s.DeleteAdminChannelModels(actor, channelID, []string{id})
	return err
}

// DeleteAdminChannelModels validates the complete selection before asking the
// repository to remove it atomically. This deliberately rejects partial success:
// administrators can safely correct an in-use model and retry the same selection.
func (s *Service) DeleteAdminChannelModels(actor *model.User, channelID string, ids []string) (int64, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return 0, err
	}
	if _, err := s.repo.AdminSystemChannel(channelID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, BadAuthRequest("系统渠道不存在或已删除")
		}
		return 0, err
	}
	modelIDs, err := normalizeAdminChannelModelDeleteIDs(ids)
	if err != nil {
		return 0, err
	}
	items, err := s.repo.ChannelModels(channelID, true)
	if err != nil {
		return 0, err
	}
	selected := make(map[string]bool, len(modelIDs))
	for _, id := range modelIDs {
		selected[id] = true
	}
	found := 0
	for _, item := range items {
		if selected[item.ID] {
			found++
		}
	}
	if found != len(modelIDs) {
		return 0, BadAuthRequest("所选渠道模型中存在已删除或不属于当前渠道的记录，请刷新后重试")
	}
	// 删除模型与渠道的兼容模型清单必须同事务提交，避免接口报错但列表已部分变化。
	deleted, err := s.repo.DeleteChannelModels(channelID, modelIDs, time.Now())
	if errors.Is(err, repository.ErrChannelModelInUse) {
		return 0, BadAuthRequest("所选渠道模型中有模型仍被前台模型供应线路或进行中任务使用，本次未删除任何模型")
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, BadAuthRequest("所选渠道模型中存在已删除或不属于当前渠道的记录，请刷新后重试")
	}
	if err == nil {
		s.invalidateRouteCatalog()
	}
	return deleted, err
}

func normalizeAdminChannelModelDeleteIDs(values []string) ([]string, error) {
	result := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		id := strings.TrimSpace(value)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, id)
	}
	if len(result) == 0 {
		return nil, BadAuthRequest("请至少选择一个要删除的渠道模型")
	}
	if len(result) > maxAdminChannelModelBatchDeleteCount {
		return nil, BadAuthRequest("单次最多删除 100 个渠道模型")
	}
	return result, nil
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
	retired := retiredChannelModelKeys(channel.RetiredModelsJSON)
	for _, name := range uniqueNonEmpty(names) {
		name = strings.TrimPrefix(name, "models/")
		if retired[channelModelCatalogKey(name)] {
			continue
		}
		desired[name] = true
		if item := byKey[name]; item != nil {
			continue
		}
		modelID, idErr := s.repo.NextPrefixedID("MODEL")
		if idErr != nil {
			return idErr
		}
		item := model.ChannelModel{ID: modelID, ChannelID: channel.ID, ModelKey: name, DisplayName: name, BillingMode: "fixed_request", Enabled: false, PriceConfigured: false, UnitPriceMicrocredits: 0, PriceVersion: 1}
		if err := s.repo.SaveChannelModel(&item); err != nil {
			return err
		}
	}
	for index := range existing {
		if !desired[existing[index].ModelKey] {
			changed := existing[index].Enabled
			existing[index].Enabled = false
			if changed {
				existing[index].PriceVersion++
				if err := s.repo.SaveChannelModel(&existing[index]); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func retiredChannelModelKeys(raw string) map[string]bool {
	var values []string
	_ = json.Unmarshal([]byte(raw), &values)
	result := make(map[string]bool, len(values))
	for _, value := range values {
		if key := channelModelCatalogKey(value); key != "" {
			result[key] = true
		}
	}
	return result
}

func channelModelCatalogKey(value string) string {
	return strings.ToLower(strings.TrimPrefix(strings.TrimSpace(value), "models/"))
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
	return s.repo.SyncChannelModelNames(channel.ID, time.Now())
}

func (s *Service) capabilityForProtocol(protocol model.ChannelInterfaceType) string {
	metadata, ok := s.channelProtocolMetadata(string(protocol))
	if !ok {
		return ""
	}
	return protocolCapabilityFromMetadata(metadata)
}

func protocolCapabilityFromMetadata(metadata protocol.Metadata) string {
	if len(metadata.Categories) == 0 {
		return ""
	}
	return string(metadata.Categories[0])
}
