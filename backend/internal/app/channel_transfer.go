package app

// 系统渠道导入导出：用于把本地配置好的渠道、模型、能力参数和价格档迁移到其他环境。
//   - 导出文件不包含任何凭证：API Key、Secret Key、自定义请求头（可能携带鉴权值）和代理地址（可能含账号密码）都不导出；
//   - 导入按渠道名称匹配：已存在的渠道保留原有凭证，只更新地址与并发；不存在的渠道新建为停用状态，等管理员填入密钥后再启用；
//   - 模型按 modelKey 匹配并走与后台手动保存相同的校验路径；导出文件中没有的模型保持不变。

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

const (
	SystemChannelExportFormat  = "yingce.system-channels"
	SystemChannelExportVersion = 1
	maxImportedSystemChannels  = 200
	maxImportedChannelModels   = 500
)

type SystemChannelExport struct {
	Format     string                       `json:"format"`
	Version    int                          `json:"version"`
	ExportedAt time.Time                    `json:"exportedAt"`
	Channels   []SystemChannelExportChannel `json:"channels"`
}

type SystemChannelExportChannel struct {
	Name              string                     `json:"name"`
	BaseURL           string                     `json:"baseUrl"`
	SortOrder         int                        `json:"sortOrder"`
	Enabled           bool                       `json:"enabled"`
	ConcurrencyLimit  int                        `json:"concurrencyLimit"`
	CatalogProviderID string                     `json:"catalogProviderId,omitempty"`
	Models            []SystemChannelExportModel `json:"models"`
}

type SystemChannelExportModel struct {
	ChannelModelRequest
	SortOrder int `json:"sortOrder"`
}

type SystemChannelImportResult struct {
	CreatedChannels []string `json:"createdChannels"`
	UpdatedChannels []string `json:"updatedChannels"`
	SavedModels     int      `json:"savedModels"`
	Errors          []string `json:"errors"`
}

// ExportSystemChannels 导出指定（为空时全部）系统渠道；结果不含任何密钥。
func (s *Service) ExportSystemChannels(actor *model.User, ids []string) (*SystemChannelExport, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channels, err := s.repo.SystemChannels(true)
	if err != nil {
		return nil, err
	}
	wanted := map[string]bool{}
	for _, id := range ids {
		if id = strings.TrimSpace(id); id != "" {
			wanted[id] = true
		}
	}
	result := &SystemChannelExport{Format: SystemChannelExportFormat, Version: SystemChannelExportVersion, ExportedAt: time.Now().UTC(), Channels: []SystemChannelExportChannel{}}
	for _, channel := range channels {
		if len(wanted) > 0 && !wanted[channel.ID] {
			continue
		}
		items, err := s.repo.ChannelModels(channel.ID, true)
		if err != nil {
			return nil, err
		}
		exported := SystemChannelExportChannel{
			Name: channel.Name, BaseURL: channel.BaseURL, SortOrder: channel.SortOrder, Enabled: channel.Enabled,
			ConcurrencyLimit: channel.ConcurrencyLimit, CatalogProviderID: channel.CatalogProviderID,
			Models: make([]SystemChannelExportModel, 0, len(items)),
		}
		for _, item := range items {
			exportedModel, err := exportChannelModel(item)
			if err != nil {
				return nil, fmt.Errorf("导出渠道 %s 的模型 %s 失败：%w", channel.Name, item.ModelKey, err)
			}
			exported.Models = append(exported.Models, exportedModel)
		}
		result.Channels = append(result.Channels, exported)
	}
	return result, nil
}

func exportChannelModel(item model.ChannelModel) (SystemChannelExportModel, error) {
	capabilityConfig, err := DecodeModelCapabilityConfig(item.CapabilityConfigJSON)
	if err != nil {
		return SystemChannelExportModel{}, err
	}
	enabled := item.Enabled
	tiers := make([]ChannelModelPriceTierRequest, 0, len(item.PriceTiers))
	for _, tier := range item.PriceTiers {
		tierEnabled := tier.Enabled
		selector := tier.Selector
		if selector == nil {
			selector = model.DecodeSKUSelector(tier.SelectorJSON)
		}
		tiers = append(tiers, ChannelModelPriceTierRequest{
			CostPricing: tier.CostPricing, Selector: selector, Resolution: tier.Resolution, VideoSeconds: tier.VideoSeconds,
			ProviderModelKey: tier.ProviderModelKey, BillingMode: tier.BillingMode, UnitPriceMicrocredits: tier.UnitPriceMicrocredits,
			InputTokenPriceMicrocredits: tier.InputTokenPriceMicrocredits, OutputTokenPriceMicrocredits: tier.OutputTokenPriceMicrocredits,
			CachedTokenPriceMicrocredits: tier.CachedTokenPriceMicrocredits, PriceConfigured: tier.PriceConfigured, Enabled: &tierEnabled,
		})
	}
	priceCurrency := firstNonEmpty(item.PriceCurrency, model.PriceCurrencyCredits)
	return SystemChannelExportModel{
		SortOrder: item.SortOrder,
		ChannelModelRequest: ChannelModelRequest{
			ModelKey: item.ModelKey, ProviderModelKey: item.ProviderModelKey, DisplayName: item.DisplayName, ChannelLabel: item.ChannelLabel,
			Tags: item.Tags, Description: item.Description, Icon: item.Icon, Capability: item.Capability, Protocol: string(item.Protocol),
			BillingMode: item.BillingMode, UnitPriceMicrocredits: item.UnitPriceMicrocredits, InputTokenPriceMicrocredits: item.InputTokenPriceMicrocredits,
			OutputTokenPriceMicrocredits: item.OutputTokenPriceMicrocredits, CachedTokenPriceMicrocredits: item.CachedTokenPriceMicrocredits,
			PriceConfigured: item.PriceConfigured, Enabled: &enabled, CapabilityConfig: capabilityConfig, PriceTiers: tiers,
			PriceCurrency: &priceCurrency,
		},
	}, nil
}

// ImportSystemChannels 按渠道名称合并导入；单个模型失败不影响其余模型，失败原因逐条返回。
func (s *Service) ImportSystemChannels(actor *model.User, payload SystemChannelExport) (*SystemChannelImportResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if payload.Format != SystemChannelExportFormat {
		return nil, BadAuthRequest("不是系统渠道导出文件")
	}
	if payload.Version != SystemChannelExportVersion {
		return nil, BadAuthRequest(fmt.Sprintf("不支持的导出文件版本：%d", payload.Version))
	}
	if len(payload.Channels) == 0 {
		return nil, BadAuthRequest("导出文件中没有渠道")
	}
	if len(payload.Channels) > maxImportedSystemChannels {
		return nil, BadAuthRequest(fmt.Sprintf("一次最多导入 %d 个渠道", maxImportedSystemChannels))
	}
	seenNames := map[string]bool{}
	for _, channel := range payload.Channels {
		name := strings.TrimSpace(channel.Name)
		if name == "" {
			return nil, BadAuthRequest("导出文件中存在未命名的渠道")
		}
		if seenNames[name] {
			return nil, BadAuthRequest("导出文件中渠道名称重复：" + name)
		}
		seenNames[name] = true
		if len(channel.Models) > maxImportedChannelModels {
			return nil, BadAuthRequest(fmt.Sprintf("渠道 %s 的模型超过 %d 个", name, maxImportedChannelModels))
		}
	}
	existing, err := s.repo.SystemChannels(true)
	if err != nil {
		return nil, err
	}
	byName := make(map[string]model.ModelChannel, len(existing))
	for _, channel := range existing {
		if _, duplicate := byName[channel.Name]; !duplicate {
			byName[channel.Name] = channel
		}
	}
	result := &SystemChannelImportResult{CreatedChannels: []string{}, UpdatedChannels: []string{}, Errors: []string{}}
	for _, imported := range payload.Channels {
		name := strings.TrimSpace(imported.Name)
		channelID, created, err := s.importSystemChannel(actor, imported, byName)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("渠道 %s：%s", name, err.Error()))
			continue
		}
		if created {
			result.CreatedChannels = append(result.CreatedChannels, name)
		} else {
			result.UpdatedChannels = append(result.UpdatedChannels, name)
		}
		for _, importedModel := range imported.Models {
			if err := s.importChannelModel(actor, channelID, importedModel); err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("渠道 %s 模型 %s：%s", name, importedModel.ModelKey, err.Error()))
				continue
			}
			result.SavedModels++
		}
	}
	s.invalidateRouteCatalog()
	return result, nil
}

func (s *Service) importSystemChannel(actor *model.User, imported SystemChannelExportChannel, byName map[string]model.ModelChannel) (string, bool, error) {
	sortOrder := imported.SortOrder
	useGlobal := imported.ConcurrencyLimit <= 0
	req := ChannelRequest{Name: strings.TrimSpace(imported.Name), BaseURL: imported.BaseURL, SortOrder: &sortOrder, UseGlobalConcurrency: &useGlobal}
	if !useGlobal {
		limit := imported.ConcurrencyLimit
		req.ConcurrencyLimit = &limit
	}
	if current, ok := byName[req.Name]; ok {
		// 已有渠道：不传 Models（避免停用导出文件之外的模型），不传密钥（保留目标环境凭证），不改启停状态。
		if _, err := s.UpdateSystemChannel(actor, current.ID, req); err != nil {
			return "", false, err
		}
		return current.ID, false, nil
	}
	// 新渠道没有密钥，先停用，管理员补齐 API Key 后再启用。
	disabled := false
	req.Enabled = &disabled
	channel, err := s.CreateSystemChannel(actor, req)
	if err != nil {
		return "", false, err
	}
	if provider := strings.TrimSpace(imported.CatalogProviderID); provider != "" {
		_ = s.repo.UpdateSystemChannelCatalogProvider(channel.ID, provider, time.Now())
	}
	return channel.ID, true, nil
}

func (s *Service) importChannelModel(actor *model.User, channelID string, imported SystemChannelExportModel) error {
	modelKey := strings.TrimPrefix(strings.TrimSpace(imported.ModelKey), "models/")
	if modelKey == "" {
		return BadAuthRequest("缺少模型标识")
	}
	existingID := ""
	current, err := s.repo.ChannelModelByKeyIncludingDisabled(channelID, modelKey)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if current != nil {
		existingID = current.ID
	}
	saved, err := s.SaveAdminChannelModel(actor, channelID, existingID, imported.ChannelModelRequest)
	if err != nil {
		return err
	}
	if imported.SortOrder != saved.SortOrder && validateChannelSortOrder(imported.SortOrder) == nil {
		return s.repo.UpdateChannelModelSort(channelID, saved.ID, imported.SortOrder, time.Now())
	}
	return nil
}

// MarshalSystemChannelExport 生成带缩进的导出文件内容。
func MarshalSystemChannelExport(value *SystemChannelExport) ([]byte, error) {
	return json.MarshalIndent(value, "", "  ")
}
