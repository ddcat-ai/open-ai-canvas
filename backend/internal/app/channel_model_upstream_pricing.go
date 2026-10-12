package app

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

// 上游价格目录（New API / one-api 系聚合端点）。
//
// 这类部署把每个模型的价格放在公开的 GET {origin}/api/pricing 上，而 OpenAI 标准的
// /v1/models 只给模型 ID，所以价格必须另取一次。形态随部署而异，且不是每家都有，
// 因此这里是**尽力而为**：任何一步失败都只是这次拿不到价格，绝不影响模型目录拉取。
//
// 价格只写入 ChannelModel.UpstreamPriceNote（仅后台可见），不进入公开投影。

type upstreamPricingPayload struct {
	Data       []upstreamPricingItem `json:"data"`
	GroupRatio map[string]float64    `json:"group_ratio"`
}

type upstreamPricingItem struct {
	ModelName    string                `json:"model_name"`
	ModelPrice   *float64              `json:"model_price"`
	ModelRatio   *float64              `json:"model_ratio"`
	BillingMode  string                `json:"billing_mode"`
	EnableGroups []string              `json:"enable_groups"`
	VideoPricing *upstreamVideoPricing `json:"video_pricing"`
}

type upstreamVideoPricing struct {
	OutputPerSecond     *float64           `json:"output_per_second"`
	ResolutionPerSecond map[string]float64 `json:"resolution_per_second"`
}

// upstreamPricingURL 由渠道 Base URL 还原出价格接口地址：价格挂在站点根路径，
// 与渠道是否带 /v1、/v1beta 无关。
func upstreamPricingURL(baseURL string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || parsed.Host == "" {
		return "", false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", false
	}
	return parsed.Scheme + "://" + parsed.Host + "/api/pricing", true
}

func parseUpstreamPricing(data []byte) ([]upstreamPricingItem, map[string]float64) {
	var payload upstreamPricingPayload
	if err := json.Unmarshal(data, &payload); err == nil && len(payload.Data) > 0 {
		return payload.Data, payload.GroupRatio
	}
	// 少数部署直接返回数组。
	var list []upstreamPricingItem
	if err := json.Unmarshal(data, &list); err == nil && len(list) > 0 {
		return list, nil
	}
	return nil, nil
}

// fetchUpstreamPriceNotes 返回「模型标识 -> 价格摘要」。取不到时返回 nil。
func (s *Service) fetchUpstreamPriceNotes(ctx context.Context, input ChannelModelsRequest) map[string]string {
	if strings.ToLower(strings.TrimSpace(input.APIFormat)) == "gemini" {
		return nil
	}
	target, ok := upstreamPricingURL(input.BaseURL)
	if !ok {
		return nil
	}
	if _, err := ValidateOutboundURL(target); err != nil {
		return nil
	}
	headers, err := NormalizeOutboundHeaders(input.Headers)
	if err != nil {
		return nil
	}
	// 目录拉取是用户点击后的同步动作，这里给价格请求单独设上限，避免慢端点拖住整个预览。
	priceCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(priceCtx, http.MethodGet, target, nil)
	if err != nil {
		return nil
	}
	if apiKey := strings.TrimSpace(input.APIKey); apiKey != "" {
		request.Header.Set("Authorization", "Bearer "+apiKey)
	}
	request.Header.Set("Accept", "application/json")
	ApplyOutboundHeaders(request, headers)

	data, _, err := doBinary(request)
	if err != nil {
		return nil
	}
	items, groupRatio := parseUpstreamPricing(data)
	if len(items) == 0 {
		return nil
	}
	notes := make(map[string]string, len(items))
	for _, item := range items {
		name := strings.TrimPrefix(strings.TrimSpace(item.ModelName), "models/")
		if name == "" {
			continue
		}
		if note := formatUpstreamPriceNote(item, groupRatio); note != "" {
			notes[name] = note
		}
	}
	if len(notes) == 0 {
		return nil
	}
	return notes
}

// 只按默认分组倍率换算：渠道密钥实际属于哪个分组只有上游知道，用 default 与上游页面
// 的「分组倍率 1x」一致；倍率不是 1 时在文案里标明，避免把换算后的数字当成原价。
func pricingGroupRatio(groupRatio map[string]float64) float64 {
	if ratio, ok := groupRatio["default"]; ok && ratio > 0 {
		return ratio
	}
	return 1
}

func formatUpstreamPriceNote(item upstreamPricingItem, groupRatio map[string]float64) string {
	ratio := pricingGroupRatio(groupRatio)
	suffix := ""
	if ratio != 1 {
		suffix = "（分组倍率 ×" + formatPriceAmount(ratio) + "）"
	}
	mode := strings.ToLower(strings.TrimSpace(item.BillingMode))
	if item.ModelPrice != nil && *item.ModelPrice > 0 {
		unit := "次"
		if mode == "per_second" || mode == "video_multi" {
			unit = "秒"
		}
		return "¥" + formatPriceAmount(*item.ModelPrice*ratio) + "/" + unit + suffix
	}
	if item.VideoPricing != nil {
		if item.VideoPricing.OutputPerSecond != nil && *item.VideoPricing.OutputPerSecond > 0 {
			return "¥" + formatPriceAmount(*item.VideoPricing.OutputPerSecond*ratio) + "/秒" + suffix
		}
		if len(item.VideoPricing.ResolutionPerSecond) > 0 {
			// 按单价而不是按字典序取一条：文案给的是该模型的最低档单价。
			resolutions := make([]string, 0, len(item.VideoPricing.ResolutionPerSecond))
			for key := range item.VideoPricing.ResolutionPerSecond {
				resolutions = append(resolutions, key)
			}
			sort.Slice(resolutions, func(left, right int) bool {
				leftRate := item.VideoPricing.ResolutionPerSecond[resolutions[left]]
				rightRate := item.VideoPricing.ResolutionPerSecond[resolutions[right]]
				if leftRate != rightRate {
					return leftRate < rightRate
				}
				return resolutions[left] < resolutions[right]
			})
			key := resolutions[0]
			return "¥" + formatPriceAmount(item.VideoPricing.ResolutionPerSecond[key]*ratio) + "/秒(" + key + ")" + suffix
		}
	}
	// 按 token 计费的模型上游只给倍率，没有人民币金额（换算需要站点汇率，渠道配置里没有）。
	if item.ModelRatio != nil && *item.ModelRatio > 0 {
		return "倍率 " + formatPriceAmount(*item.ModelRatio*ratio) + "x" + suffix
	}
	return ""
}

func formatPriceAmount(value float64) string {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return ""
	}
	rounded := math.Round(value*10000) / 10000
	return strconv.FormatFloat(rounded, 'f', -1, 64)
}

// 渠道模型按 channelModelCatalogKey 归并标识，价格表要按同一把钥匙对齐才能命中。
func upstreamPriceNotesByCatalogKey(notes map[string]string) map[string]string {
	if len(notes) == 0 {
		return nil
	}
	keyed := make(map[string]string, len(notes))
	for name, note := range notes {
		if key := channelModelCatalogKey(name); key != "" {
			keyed[key] = note
		}
	}
	return keyed
}

// SyncAdminChannelModelUpstreamPrices 重读上游价格目录，刷新该渠道已有模型的上游价备注。
// 只写备注列：不动价格档、价格版本与启用状态，因此不会影响前台报价与路由。
func (s *Service) SyncAdminChannelModelUpstreamPrices(ctx context.Context, actor *model.User, channelID string) (int64, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return 0, err
	}
	channel, err := s.adminSystemChannel(channelID)
	if err != nil {
		return 0, err
	}
	headers, err := ParseOutboundHeadersJSON(channel.HeadersJSON)
	if err != nil {
		return 0, err
	}
	notes := s.fetchUpstreamPriceNotes(ctx, ChannelModelsRequest{BaseURL: channel.BaseURL, APIKey: channel.APIKey, APIFormat: channel.APIFormat, Headers: headers})
	if len(notes) == 0 {
		return 0, BadAuthRequest("没有读到上游价格目录，该渠道可能不提供 /api/pricing")
	}
	return s.repo.UpdateChannelModelUpstreamPriceNotes(channelID, upstreamPriceNotesByCatalogKey(notes))
}
