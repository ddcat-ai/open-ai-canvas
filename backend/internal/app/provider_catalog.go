// 服务商目录：读取 ai.yingce.tv 托管的推荐服务商，验证管理员 Key，并一键创建
// 系统渠道 + 推荐模型 + 规格档（成本与加价售价）。
//
// 目录只提供模板；Base URL、协议、成本一律从服务端快照重新读取，不信任浏览器传值。
// 已接入渠道与目录解耦：推广期结束只影响目录展示和新接入，不改动已有渠道。

package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/providercatalog"
)

type ProviderCatalogView struct {
	Source    providercatalog.SourceState `json:"source"`
	Notice    string                      `json:"notice,omitempty"`
	UpdatedAt string                      `json:"updatedAt,omitempty"`
	FetchedAt *time.Time                  `json:"fetchedAt,omitempty"`
	Tags      []providercatalog.Tag       `json:"tags"`
	Providers []ProviderCatalogItem       `json:"providers"`
}

type ProviderCatalogItem struct {
	ID             string                   `json:"id"`
	Name           string                   `json:"name"`
	Tags           []string                 `json:"tags"`
	Logo           string                   `json:"logo,omitempty"`
	Summary        string                   `json:"summary,omitempty"`
	Website        string                   `json:"website,omitempty"`
	StartsAt       time.Time                `json:"startsAt"`
	EndsAt         time.Time                `json:"endsAt"`
	Permanent      bool                     `json:"permanent"`
	BaseURL        string                   `json:"baseUrl"`
	KeyGuide       providercatalog.KeyGuide `json:"keyGuide"`
	Models         []ProviderCatalogModel   `json:"models"`
	InstalledCount int64                    `json:"installedCount"`
}

type ProviderCatalogModel struct {
	ModelKey          string                     `json:"modelKey"`
	ProviderModelKey  string                     `json:"providerModelKey"`
	DisplayName       string                     `json:"displayName"`
	Capability        string                     `json:"capability"`
	Protocol          string                     `json:"protocol"`
	Description       string                     `json:"description,omitempty"`
	Icon              string                     `json:"icon,omitempty"`
	Supported         bool                       `json:"supported"`
	UnsupportedReason string                     `json:"unsupportedReason,omitempty"`
	PriceTiers        []ProviderCatalogPriceTier `json:"priceTiers"`
}

// ProviderCatalogPriceTier 的成本已按 1 元 = 1 积分换算为 microcredits。
type ProviderCatalogPriceTier struct {
	Selector               map[string]string `json:"selector,omitempty"`
	BillingMode            string            `json:"billingMode"`
	CostUnitMicrocredits   int64             `json:"costUnitMicrocredits"`
	CostInputMicrocredits  int64             `json:"costInputMicrocredits"`
	CostOutputMicrocredits int64             `json:"costOutputMicrocredits"`
	CostCachedMicrocredits int64             `json:"costCachedMicrocredits"`
}

type ProviderCatalogVerifyRequest struct {
	APIKey string `json:"apiKey"`
}

type ProviderCatalogVerifyResult struct {
	UpstreamModelCount int      `json:"upstreamModelCount"`
	AvailableModels    []string `json:"availableModels"`
	MissingModels      []string `json:"missingModels"`
}

type ProviderCatalogInstallModel struct {
	ModelKey      string   `json:"modelKey"`
	MarkupPercent *float64 `json:"markupPercent"`
}

type ProviderCatalogInstallRequest struct {
	Name          string                        `json:"name"`
	APIKey        string                        `json:"apiKey"`
	MarkupPercent float64                       `json:"markupPercent"`
	Models        []ProviderCatalogInstallModel `json:"models"`
	Enabled       *bool                         `json:"enabled"`
}

func catalogProviderForAdmin(channel model.ModelChannel, admin bool) string {
	if !admin {
		return ""
	}
	return channel.CatalogProviderID
}

func (s *Service) providerCatalogSource() *providercatalog.Source {
	s.providerCatalogOnce.Do(func() {
		if s.providerCatalog == nil {
			s.providerCatalog = providercatalog.NewSource(s.dataDir, OutboundHTTPClient(15*time.Second))
		}
	})
	return s.providerCatalog
}

func (s *Service) AdminProviderCatalog(ctx context.Context, actor *model.User, refresh bool) (*ProviderCatalogView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	source := s.providerCatalogSource()
	var snapshot providercatalog.Snapshot
	if refresh {
		snapshot = source.Refresh(ctx)
	} else {
		snapshot = source.Get(ctx)
	}
	view := &ProviderCatalogView{Source: snapshot.State, Tags: []providercatalog.Tag{}, Providers: []ProviderCatalogItem{}}
	if snapshot.State == providercatalog.SourceUnavailable {
		view.Notice = "无法访问 ai.yingce.tv 服务商目录，请确认远程目录已部署且 HTTPS 可用。可继续使用自定义配置。"
	} else if snapshot.State == providercatalog.SourceCache {
		view.Notice = "远程目录暂不可用，正在使用本地缓存。"
	}
	if snapshot.Catalog == nil {
		return view, nil
	}
	fetchedAt := snapshot.FetchedAt
	view.FetchedAt = &fetchedAt
	view.UpdatedAt = snapshot.Catalog.UpdatedAt
	view.Tags = append(view.Tags, snapshot.Catalog.Tags...)
	counts, err := s.repo.CatalogProviderChannelCounts()
	if err != nil {
		return nil, err
	}
	for _, provider := range snapshot.Catalog.Active(source.Now()) {
		view.Providers = append(view.Providers, s.providerCatalogItem(provider, counts[provider.ID]))
	}
	return view, nil
}

func (s *Service) providerCatalogItem(provider providercatalog.Provider, installed int64) ProviderCatalogItem {
	item := ProviderCatalogItem{
		ID: provider.ID, Name: provider.Name, Tags: append([]string{}, provider.Tags...), Logo: provider.Logo,
		Summary: provider.Summary, Website: provider.Website, StartsAt: provider.StartsAt, EndsAt: provider.EndsAt, Permanent: provider.Permanent,
		BaseURL: provider.Connection.BaseURL, KeyGuide: provider.KeyGuide, InstalledCount: installed,
		Models: make([]ProviderCatalogModel, 0, len(provider.Models)),
	}
	if item.KeyGuide.Steps == nil {
		item.KeyGuide.Steps = []string{}
	}
	for _, entry := range provider.Models {
		view := ProviderCatalogModel{
			ModelKey: entry.ModelKey, ProviderModelKey: entry.ProviderModelKey, DisplayName: entry.DisplayName,
			Capability: entry.Capability, Protocol: entry.Protocol, Description: entry.Description, Icon: entry.Icon,
			PriceTiers: make([]ProviderCatalogPriceTier, 0, len(entry.PriceTiers)),
		}
		if protocolID, reason := s.catalogModelProtocol(entry); reason != "" {
			view.UnsupportedReason = reason
		} else {
			view.Protocol = protocolID
			view.Supported = true
		}
		for _, tier := range entry.PriceTiers {
			price := providercatalog.PriceFor(entry.Capability, tier, 0)
			view.PriceTiers = append(view.PriceTiers, ProviderCatalogPriceTier{
				Selector: tier.Selector, BillingMode: tier.BillingMode,
				CostUnitMicrocredits: price.CostUnit, CostInputMicrocredits: price.CostInput,
				CostOutputMicrocredits: price.CostOutput, CostCachedMicrocredits: price.CostCached,
			})
		}
		item.Models = append(item.Models, view)
	}
	return item
}

// catalogModelProtocol 解析目录模型的协议；返回不支持原因时该模型不可接入。
func (s *Service) catalogModelProtocol(entry providercatalog.Model) (string, string) {
	adapter, ok := s.protocolRegistry().Resolve(entry.Protocol)
	if !ok || !adapter.Metadata().Enabled || adapter.Metadata().UnavailableReason != "" {
		return "", "当前版本不支持该模型协议"
	}
	protocolID := adapter.Metadata().ID
	if expected := protocolCapabilityFromMetadata(adapter.Metadata()); expected != "" && expected != entry.Capability {
		return "", "模型能力与协议不匹配"
	}
	// 是否需要第二把密钥按插件声明的 auth.secretField 判断，不再只认即梦协议名。
	if s.protocolRequiresSecretKey(protocolID) {
		return "", "该协议需要 AK/SK，请使用自定义配置"
	}
	return protocolID, ""
}

func (s *Service) activeCatalogProvider(ctx context.Context, id string) (providercatalog.Provider, error) {
	source := s.providerCatalogSource()
	snapshot := source.Get(ctx)
	provider, ok := snapshot.Catalog.FindActive(strings.TrimSpace(id), source.Now())
	if !ok {
		return providercatalog.Provider{}, NotFound("服务商不存在或推广期已结束")
	}
	return provider, nil
}

func (s *Service) VerifyProviderCatalogKey(ctx context.Context, actor *model.User, providerID string, req ProviderCatalogVerifyRequest) (*ProviderCatalogVerifyResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	provider, err := s.activeCatalogProvider(ctx, providerID)
	if err != nil {
		return nil, err
	}
	apiKey := strings.TrimSpace(req.APIKey)
	if apiKey == "" {
		return nil, BadAuthRequest("请填写 API Key")
	}
	models, err := s.FetchChannelModels(ctx, actor, ChannelModelsRequest{BaseURL: provider.Connection.BaseURL, APIKey: apiKey, APIFormat: "openai"})
	if err != nil {
		return nil, err
	}
	upstream := make(map[string]bool, len(models))
	for _, name := range models {
		upstream[channelModelCatalogKey(name)] = true
	}
	result := &ProviderCatalogVerifyResult{UpstreamModelCount: len(models), AvailableModels: []string{}, MissingModels: []string{}}
	for _, entry := range provider.Models {
		if upstream[channelModelCatalogKey(entry.ProviderModelKey)] {
			result.AvailableModels = append(result.AvailableModels, entry.ModelKey)
		} else {
			result.MissingModels = append(result.MissingModels, entry.ModelKey)
		}
	}
	return result, nil
}

func (s *Service) InstallProviderCatalog(ctx context.Context, actor *model.User, providerID string, req ProviderCatalogInstallRequest) (*PublicModelChannel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	provider, err := s.activeCatalogProvider(ctx, providerID)
	if err != nil {
		return nil, err
	}
	apiKey := strings.TrimSpace(req.APIKey)
	if apiKey == "" {
		return nil, BadAuthRequest("请填写 API Key")
	}
	defaultMarkup, err := providercatalog.MarkupBasisPoints(req.MarkupPercent)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	byKey := make(map[string]providercatalog.Model, len(provider.Models))
	for _, entry := range provider.Models {
		byKey[entry.ModelKey] = entry
	}
	if len(req.Models) == 0 {
		return nil, BadAuthRequest("请至少选择一个推荐模型")
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = provider.Name
	}
	useGlobal := true
	enabled := req.Enabled == nil || *req.Enabled
	channelID, err := s.repo.NextPrefixedID("CHANNEL")
	if err != nil {
		return nil, err
	}
	channel, err := s.channelFromRequest(ChannelRequest{Name: name, BaseURL: provider.Connection.BaseURL, APIKey: apiKey, UseGlobalConcurrency: &useGlobal, Enabled: &enabled},
		model.ModelChannel{ID: channelID, UserID: actor.ID, Scope: model.ChannelScopeSystem, Enabled: true})
	if err != nil {
		return nil, err
	}
	channel.CatalogProviderID = provider.ID

	channelModels := make([]model.ChannelModel, 0, len(req.Models))
	priceTiers := make([]model.ChannelModelPriceTier, 0)
	modelKeys := make([]string, 0, len(req.Models))
	seen := make(map[string]bool, len(req.Models))
	for _, choice := range req.Models {
		entry, ok := byKey[strings.TrimSpace(choice.ModelKey)]
		if !ok {
			return nil, BadAuthRequest("所选模型不在该服务商的推荐列表中：" + choice.ModelKey)
		}
		if seen[entry.ModelKey] {
			continue
		}
		seen[entry.ModelKey] = true
		markup := defaultMarkup
		if choice.MarkupPercent != nil {
			if markup, err = providercatalog.MarkupBasisPoints(*choice.MarkupPercent); err != nil {
				return nil, BadAuthRequest(entry.DisplayName + "：" + err.Error())
			}
		}
		item, tiers, buildErr := s.buildCatalogChannelModel(&channel, entry, markup, len(channelModels))
		if buildErr != nil {
			return nil, prefixAppError(entry.DisplayName, buildErr)
		}
		channelModels = append(channelModels, item)
		priceTiers = append(priceTiers, tiers...)
		modelKeys = append(modelKeys, entry.ModelKey)
	}
	modelsJSON, _ := json.Marshal(modelKeys)
	channel.ModelsJSON = string(modelsJSON)
	if err := s.encryptSystemChannelSecrets(&channel); err != nil {
		return nil, err
	}
	// 渠道、模型、规格档同一事务写入，避免“渠道建好但模型缺一半”。
	if err := s.repo.CreateDuplicatedSystemChannel(&channel, channelModels, priceTiers); err != nil {
		return nil, err
	}
	s.invalidateRouteCatalog()
	items, err := s.repo.ChannelModels(channel.ID, true)
	if err != nil {
		return nil, err
	}
	public := publicChannel(channel, true, items)
	return &public, nil
}

func (s *Service) buildCatalogChannelModel(channel *model.ModelChannel, entry providercatalog.Model, markup int64, sortOrder int) (model.ChannelModel, []model.ChannelModelPriceTier, error) {
	protocolID, reason := s.catalogModelProtocol(entry)
	if reason != "" {
		return model.ChannelModel{}, nil, BadAuthRequest(reason)
	}
	capabilityConfig, err := catalogCapabilityConfig(entry, protocolID)
	if err != nil {
		return model.ChannelModel{}, nil, err
	}
	normalized, err := NormalizeModelCapabilityConfigForModel(entry.Capability, protocolID, entry.ProviderModelKey, capabilityConfig, s.protocolRegistry())
	if err != nil {
		return model.ChannelModel{}, nil, err
	}
	req := ChannelModelRequest{CapabilityConfig: normalized}
	for _, tier := range entry.PriceTiers {
		price := providercatalog.PriceFor(entry.Capability, tier, markup)
		enabled := true
		req.PriceTiers = append(req.PriceTiers, ChannelModelPriceTierRequest{
			CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: price.CostUnit, InputTokenPriceMicrocredits: price.CostInput, OutputTokenPriceMicrocredits: price.CostOutput, CachedTokenPriceMicrocredits: price.CostCached},
			Selector:    tier.Selector, ProviderModelKey: tier.ProviderModelKey, BillingMode: tier.BillingMode,
			UnitPriceMicrocredits: price.SaleUnit, InputTokenPriceMicrocredits: price.SaleInput, OutputTokenPriceMicrocredits: price.SaleOutput, CachedTokenPriceMicrocredits: price.SaleCached,
			PriceConfigured: true, Enabled: &enabled,
		})
	}
	protocolType := model.ChannelInterfaceType(protocolID)
	tiers, err := s.normalizeChannelModelPriceTiers(req, entry.Capability, protocolType, entry.ProviderModelKey)
	if err != nil {
		return model.ChannelModel{}, nil, err
	}
	capabilityJSON := ""
	if normalized != nil {
		encoded, encodeErr := json.Marshal(normalized)
		if encodeErr != nil {
			return model.ChannelModel{}, nil, encodeErr
		}
		capabilityJSON = string(encoded)
	}
	if err := validateChannelModelTierCapabilities(tiers, capabilityJSON, entry.Capability, protocolID); err != nil {
		return model.ChannelModel{}, nil, err
	}
	modelID, err := s.repo.NextPrefixedID("MODEL")
	if err != nil {
		return model.ChannelModel{}, nil, err
	}
	tags := make([]model.ChannelModelTag, 0, len(entry.Tags))
	for _, tag := range entry.Tags {
		tags = append(tags, model.ChannelModelTag{Text: tag.Text, Color: tag.Color})
	}
	tags, err = normalizeChannelModelTags(tags)
	if err != nil {
		return model.ChannelModel{}, nil, err
	}
	if len([]rune(entry.ChannelLabel)) > 80 {
		return model.ChannelModel{}, nil, BadAuthRequest("渠道展示名不能超过 80 字")
	}
	item := model.ChannelModel{
		ID: modelID, ChannelID: channel.ID, ModelKey: entry.ModelKey, ProviderModelKey: entry.ProviderModelKey,
		DisplayName: entry.DisplayName, ChannelLabel: entry.ChannelLabel, Tags: tags, Description: entry.Description, Icon: entry.Icon,
		SortOrder: sortOrder, Capability: entry.Capability, Protocol: protocolType, Enabled: true, PriceVersion: 1,
		CapabilityConfigJSON: capabilityJSON, CatalogModelKey: entry.ModelKey,
	}
	if capabilityJSON != "" {
		item.CapabilityVersion = 1
	}
	for index := range tiers {
		tiers[index].ChannelModelID = item.ID
	}
	s.applyChannelModelPriceTierSummary(&item, tiers)
	return item, tiers, nil
}

// catalogCapabilityConfig 优先使用目录下发的能力配置，否则按协议默认能力补齐。
func catalogCapabilityConfig(entry providercatalog.Model, protocolID string) (*ModelCapabilityConfig, error) {
	if len(entry.CapabilityConfig) > 0 && string(entry.CapabilityConfig) != "null" {
		var config ModelCapabilityConfig
		if err := json.Unmarshal(entry.CapabilityConfig, &config); err != nil {
			return nil, BadAuthRequest("目录中的能力配置无效")
		}
		return &config, nil
	}
	defaults := DefaultModelCapabilityConfigForModel(protocolID, entry.ProviderModelKey)
	switch entry.Capability {
	case "text":
		return &ModelCapabilityConfig{Version: 1, Text: defaults.Text}, nil
	case "image":
		return &ModelCapabilityConfig{Version: 1, Image: defaults.Image}, nil
	case "video":
		return &ModelCapabilityConfig{Version: 1, Video: defaults.Video}, nil
	}
	return nil, nil
}

func prefixAppError(prefix string, err error) error {
	if appErr, ok := err.(*AppError); ok && appErr.Status < http.StatusInternalServerError {
		copy := *appErr
		copy.Message = fmt.Sprintf("%s：%s", prefix, appErr.Message)
		return &copy
	}
	return err
}
