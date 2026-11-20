// Package providercatalog 解析 ai.yingce.tv 托管的服务商目录（静态 JSON），
// 按推广期过滤，并把推荐模型的人民币成本换算为积分成本与加价售价。
//
// 目录决定管理员 API Key 会被发往哪个 Base URL，因此这里只接受 https 地址，
// 并对每个字段做长度与取值校验；协议是否被当前版本支持由调用方判断。
package providercatalog

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	SchemaVersion        = 1
	MaxRecommendedModels = 100
	MaxProviders         = 200
	MaxCatalogBytes      = 2 << 20
	// 1 元 = 1 积分；积分以 microcredits 存储。
	MicrocreditsPerYuan = 1_000_000
	MaxMarkupPercent    = 1000
)

var (
	idPattern       = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)
	tagTones        = map[string]bool{"blue": true, "violet": true, "amber": true, "green": true, "pink": true, "red": true, "cyan": true, "neutral": true}
	ErrInvalidInput = errors.New("服务商目录格式无效")
)

type Catalog struct {
	SchemaVersion int        `json:"schemaVersion"`
	UpdatedAt     string     `json:"updatedAt"`
	Tags          []Tag      `json:"tags"`
	Providers     []Provider `json:"providers"`
}

type Tag struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Tone  string `json:"tone"`
}

type Provider struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Tags       []string   `json:"tags"`
	Logo       string     `json:"logo"`
	Summary    string     `json:"summary"`
	Website    string     `json:"website"`
	Rank       int        `json:"rank"`
	StartsAt   time.Time  `json:"startsAt"`
	EndsAt     time.Time  `json:"endsAt"`
	Permanent  bool       `json:"permanent"`
	Connection Connection `json:"connection"`
	KeyGuide   KeyGuide   `json:"keyGuide"`
	Models     []Model    `json:"models"`
}

// Connection 只描述 OpenAI 兼容的 Base URL；验证固定请求 GET {baseUrl}/models。
type Connection struct {
	BaseURL string `json:"baseUrl"`
}

type KeyGuide struct {
	URL        string   `json:"url"`
	Steps      []string `json:"steps"`
	KeyPattern string   `json:"keyPattern"`
	Promo      string   `json:"promo"`
}

type ModelTag struct {
	Text  string `json:"text"`
	Color string `json:"color"`
}

type Model struct {
	ChannelLabel     string          `json:"channelLabel"`
	Tags             []ModelTag      `json:"tags"`
	ModelKey         string          `json:"modelKey"`
	ProviderModelKey string          `json:"providerModelKey"`
	DisplayName      string          `json:"displayName"`
	Capability       string          `json:"capability"`
	Protocol         string          `json:"protocol"`
	Description      string          `json:"description"`
	Icon             string          `json:"icon"`
	CapabilityConfig json.RawMessage `json:"capabilityConfig,omitempty"`
	PriceTiers       []PriceTier     `json:"priceTiers"`
}

// PriceTier 的金额均为人民币元。按次/按秒用 Cost，token 用每百万 token 单价。
type PriceTier struct {
	Selector         map[string]string `json:"selector,omitempty"`
	BillingMode      string            `json:"billingMode"`
	ProviderModelKey string            `json:"providerModelKey,omitempty"`
	Cost             float64           `json:"cost,omitempty"`
	InputPerMillion  float64           `json:"inputPerMillion,omitempty"`
	OutputPerMillion float64           `json:"outputPerMillion,omitempty"`
	CachedPerMillion float64           `json:"cachedPerMillion,omitempty"`
}

// Parse 解码并校验目录。单个服务商或模型无效时丢弃该条并记入 warnings，
// 不让一处笔误清空整个目录；整体结构无效时返回错误，调用方继续使用旧快照。
func Parse(body []byte, logoBase string) (*Catalog, []string, error) {
	if len(body) == 0 || len(body) > MaxCatalogBytes {
		return nil, nil, fmt.Errorf("%w：大小超出限制", ErrInvalidInput)
	}
	var raw Catalog
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, nil, fmt.Errorf("%w：%v", ErrInvalidInput, err)
	}
	if raw.SchemaVersion != SchemaVersion {
		return nil, nil, fmt.Errorf("%w：不支持的 schemaVersion %d", ErrInvalidInput, raw.SchemaVersion)
	}
	warnings := []string{}
	result := &Catalog{SchemaVersion: raw.SchemaVersion, UpdatedAt: strings.TrimSpace(raw.UpdatedAt)}
	knownTags := map[string]bool{}
	for _, tag := range raw.Tags {
		tag.ID, tag.Label, tag.Tone = strings.TrimSpace(tag.ID), strings.TrimSpace(tag.Label), strings.TrimSpace(tag.Tone)
		if !idPattern.MatchString(tag.ID) || tag.Label == "" || len([]rune(tag.Label)) > 16 || knownTags[tag.ID] {
			warnings = append(warnings, "忽略无效标签："+tag.ID)
			continue
		}
		if !tagTones[tag.Tone] {
			tag.Tone = "neutral"
		}
		knownTags[tag.ID] = true
		result.Tags = append(result.Tags, tag)
	}
	seen := map[string]bool{}
	for index, provider := range raw.Providers {
		if len(result.Providers) >= MaxProviders {
			warnings = append(warnings, "服务商数量超过上限，其余已忽略")
			break
		}
		normalized, providerWarnings, err := normalizeProvider(provider, knownTags, logoBase)
		warnings = append(warnings, providerWarnings...)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("忽略第 %d 个服务商 %q：%v", index+1, provider.ID, err))
			continue
		}
		if seen[normalized.ID] {
			warnings = append(warnings, "忽略重复服务商："+normalized.ID)
			continue
		}
		seen[normalized.ID] = true
		result.Providers = append(result.Providers, normalized)
	}
	return result, warnings, nil
}

func normalizeProvider(p Provider, knownTags map[string]bool, logoBase string) (Provider, []string, error) {
	warnings := []string{}
	p.ID = strings.TrimSpace(p.ID)
	p.Name = strings.TrimSpace(p.Name)
	p.Summary = truncate(strings.TrimSpace(p.Summary), 80)
	if !idPattern.MatchString(p.ID) {
		return p, nil, errors.New("id 只能包含小写字母、数字和连字符")
	}
	if p.Name == "" || len([]rune(p.Name)) > 40 {
		return p, nil, errors.New("name 必填且不超过 40 字")
	}
	if p.StartsAt.IsZero() || (!p.Permanent && (p.EndsAt.IsZero() || !p.EndsAt.After(p.StartsAt))) {
		return p, nil, errors.New("startsAt / endsAt 必填且 endsAt 晚于 startsAt")
	}
	baseURL, err := httpsURL(p.Connection.BaseURL)
	if err != nil {
		return p, nil, fmt.Errorf("connection.baseUrl %v", err)
	}
	p.Connection.BaseURL = strings.TrimRight(baseURL, "/")
	if p.Website, err = optionalHTTPSURL(p.Website); err != nil {
		warnings = append(warnings, p.ID+"：website 无效已忽略")
		p.Website = ""
	}
	if p.KeyGuide.URL, err = optionalHTTPSURL(p.KeyGuide.URL); err != nil {
		warnings = append(warnings, p.ID+"：keyGuide.url 无效已忽略")
		p.KeyGuide.URL = ""
	}
	p.Logo = resolveLogo(p.Logo, logoBase)
	steps := make([]string, 0, len(p.KeyGuide.Steps))
	for _, step := range p.KeyGuide.Steps {
		if step = truncate(strings.TrimSpace(step), 80); step != "" && len(steps) < 6 {
			steps = append(steps, step)
		}
	}
	p.KeyGuide.Steps = steps
	p.KeyGuide.Promo = truncate(strings.TrimSpace(p.KeyGuide.Promo), 60)
	p.KeyGuide.KeyPattern = strings.TrimSpace(p.KeyGuide.KeyPattern)
	if p.KeyGuide.KeyPattern != "" {
		if _, compileErr := regexp.Compile(p.KeyGuide.KeyPattern); compileErr != nil || len(p.KeyGuide.KeyPattern) > 200 {
			warnings = append(warnings, p.ID+"：keyGuide.keyPattern 无效已忽略")
			p.KeyGuide.KeyPattern = ""
		}
	}
	tags := make([]string, 0, len(p.Tags))
	for _, tag := range p.Tags {
		if tag = strings.TrimSpace(tag); knownTags[tag] && !contains(tags, tag) {
			tags = append(tags, tag)
		}
	}
	p.Tags = tags
	models := make([]Model, 0, MaxRecommendedModels)
	seenModels := map[string]bool{}
	for _, item := range p.Models {
		if len(models) >= MaxRecommendedModels {
			warnings = append(warnings, fmt.Sprintf("%s：推荐模型超过 %d 个，其余已忽略", p.ID, MaxRecommendedModels))
			break
		}
		normalized, modelErr := normalizeModel(item)
		if modelErr != nil {
			warnings = append(warnings, fmt.Sprintf("%s：忽略模型 %q：%v", p.ID, item.ModelKey, modelErr))
			continue
		}
		key := strings.ToLower(normalized.ModelKey)
		if seenModels[key] {
			continue
		}
		seenModels[key] = true
		models = append(models, normalized)
	}
	if len(models) == 0 {
		return p, warnings, errors.New("没有有效的推荐模型")
	}
	p.Models = models
	return p, warnings, nil
}

func normalizeModel(m Model) (Model, error) {
	m.ModelKey = strings.TrimPrefix(strings.TrimSpace(m.ModelKey), "models/")
	m.ProviderModelKey = strings.TrimPrefix(strings.TrimSpace(m.ProviderModelKey), "models/")
	if m.ModelKey == "" || len(m.ModelKey) > 120 {
		return m, errors.New("modelKey 必填且不超过 120 字符")
	}
	if m.ProviderModelKey == "" {
		m.ProviderModelKey = m.ModelKey
	}
	if len(m.ProviderModelKey) > 120 {
		return m, errors.New("providerModelKey 不超过 120 字符")
	}
	m.DisplayName = truncate(strings.TrimSpace(m.DisplayName), 80)
	if m.DisplayName == "" {
		m.DisplayName = m.ModelKey
	}
	m.Capability = strings.ToLower(strings.TrimSpace(m.Capability))
	switch m.Capability {
	case "text", "image", "video", "audio":
	default:
		return m, errors.New("capability 只能是 text、image、video、audio")
	}
	m.Protocol = strings.TrimSpace(m.Protocol)
	if m.Protocol == "" {
		return m, errors.New("protocol 必填")
	}
	m.Description = truncate(strings.TrimSpace(m.Description), 200)
	m.Icon = truncate(strings.TrimSpace(m.Icon), 80)
	if len(m.PriceTiers) == 0 || len(m.PriceTiers) > 50 {
		return m, errors.New("priceTiers 需要 1 到 50 个规格")
	}
	for index := range m.PriceTiers {
		tier := &m.PriceTiers[index]
		tier.BillingMode = strings.TrimSpace(tier.BillingMode)
		if tier.BillingMode == "" {
			tier.BillingMode = "fixed_request"
		}
		if tier.BillingMode != "fixed_request" && tier.BillingMode != "per_second" && tier.BillingMode != "token" {
			return m, errors.New("billingMode 只能是 fixed_request、per_second、token")
		}
		for _, value := range []float64{tier.Cost, tier.InputPerMillion, tier.OutputPerMillion, tier.CachedPerMillion} {
			if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1_000_000 {
				return m, errors.New("价格必须在 0 到 1000000 元之间")
			}
		}
		tier.ProviderModelKey = strings.TrimPrefix(strings.TrimSpace(tier.ProviderModelKey), "models/")
	}
	return m, nil
}

// Active 返回推广期内（startsAt ≤ now < endsAt）的服务商，按 rank 升序、同 rank 按 endsAt 晚者优先。
func (c *Catalog) Active(now time.Time) []Provider {
	if c == nil {
		return nil
	}
	result := make([]Provider, 0, len(c.Providers))
	for _, provider := range c.Providers {
		if IsActive(provider, now) {
			result = append(result, provider)
		}
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Rank != result[j].Rank {
			return result[i].Rank < result[j].Rank
		}
		if result[i].Permanent != result[j].Permanent {
			return result[i].Permanent
		}
		return result[i].EndsAt.After(result[j].EndsAt)
	})
	return result
}

func IsActive(provider Provider, now time.Time) bool {
	return !now.Before(provider.StartsAt) && (provider.Permanent || now.Before(provider.EndsAt))
}

// FindActive 在推广期内查找服务商；到期或不存在都返回 false。
func (c *Catalog) FindActive(id string, now time.Time) (Provider, bool) {
	if c == nil {
		return Provider{}, false
	}
	for _, provider := range c.Providers {
		if provider.ID == id {
			return provider, IsActive(provider, now)
		}
	}
	return Provider{}, false
}

func httpsURL(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("必须是不带账号、查询参数的 https 地址")
	}
	return value, nil
}

func optionalHTTPSURL(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return "", nil
	}
	value := strings.TrimSpace(raw)
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return "", errors.New("必须是 https 地址")
	}
	return value, nil
}

// resolveLogo 只允许同域相对路径或 https 地址，失败时返回空字符串让前端显示首字母头像。
func resolveLogo(raw string, base string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, "/") && !strings.HasPrefix(value, "//") && !strings.Contains(value, "..") {
		return strings.TrimRight(base, "/") + value
	}
	if parsed, err := url.Parse(value); err == nil && parsed.Scheme == "https" && parsed.Host != "" {
		return value
	}
	return ""
}

func truncate(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
