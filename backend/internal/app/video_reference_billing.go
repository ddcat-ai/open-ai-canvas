package app

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"

	"yingce/backend/internal/model"
)

// referenceVideoQuoteFallbackMillis 是报价阶段不知道参考视频时长时的预估总时长，与视频 Token
// 估算的上限口径一致。真实任务按秒计费时不使用它，必须由后端实测。
const referenceVideoQuoteFallbackMillis int64 = 15_000

// referenceVideoUsage 描述一次视频请求挂载的参考视频。RecordedMillis 来自任务输入中资源库
// 记录的 durationMs（客户端上传时提供），只用于报价预估和账单展示；按秒计费必须调用 Measure。
type referenceVideoUsage struct {
	Count          int
	RecordedMillis int64
	RecordedKnown  bool
	// Measure 在后端用 ffprobe 实测全部参考视频的总毫秒数。报价没有实际资源，为 nil。
	Measure func() (int64, error)
}

func referenceVideoUsageFromInput(input map[string]any) referenceVideoUsage {
	// 视频处理（画质增强等）的源视频放在 referenceVideos 里，但它是处理对象、不是参考素材：
	// 按秒价格本就按源时长计，再计一次参考视频秒数就重复收费。标记由服务端 admission 写入。
	if metadata, _ := input["metadata"].(map[string]any); metadata != nil {
		if processing, _ := metadata[videoProcessingMetadataKey].(bool); processing {
			return referenceVideoUsage{}
		}
	}
	references, _ := input["referenceVideos"].([]any)
	usage := referenceVideoUsage{Count: len(references), RecordedKnown: len(references) > 0}
	for _, raw := range references {
		media, _ := raw.(map[string]any)
		duration, err := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(media["durationMs"])), 10, 64)
		if media == nil || err != nil || duration <= 0 || duration > math.MaxInt64-usage.RecordedMillis {
			usage.RecordedKnown = false
			continue
		}
		usage.RecordedMillis += duration
	}
	return usage
}

// perSecondMillis 返回按秒计费计入的参考视频总毫秒数。真实任务只接受后端实测结果；
// 报价（Measure 为 nil）使用记录时长，未知时按上限预估并标记 estimated。
func (u referenceVideoUsage) perSecondMillis() (int64, bool, error) {
	if u.Count == 0 {
		return 0, false, nil
	}
	if u.Measure != nil {
		millis, err := u.Measure()
		if err != nil {
			return 0, false, err
		}
		return millis, false, nil
	}
	if u.RecordedKnown {
		return u.RecordedMillis, false, nil
	}
	return max(u.RecordedMillis, referenceVideoQuoteFallbackMillis), true, nil
}

// estimateTaskBilling 在任务计费路径上补充参考视频实测能力；报价路径直接使用 estimateTaskBillingTokens。
func (s *Service) estimateTaskBilling(userID string, input map[string]any, capability string) tokenBillingEstimate {
	estimate := estimateTaskBillingTokens(input, capability)
	if capability == "video" && estimate.ReferenceVideos.Count > 0 {
		references := input["referenceVideos"]
		estimate.ReferenceVideos.Measure = func() (int64, error) {
			return s.measureReferenceVideoMillis(userID, references)
		}
	}
	return estimate
}

// measureReferenceVideoMillis 用 ffprobe 测量参考视频总时长。任何一个参考视频测不出来都拒绝提交，
// 不按默认值或客户端声明的时长扣费。
func (s *Service) measureReferenceVideoMillis(userID string, raw any) (int64, error) {
	references, _ := raw.([]any)
	var total int64
	for index, rawReference := range references {
		media, _ := rawReference.(map[string]any)
		resourceID := referenceVideoResourceID(media)
		if resourceID == "" {
			return 0, BadAuthRequest(fmt.Sprintf("第 %d 个参考视频未保存到资源库，无法测量时长，暂不能按秒计费提交", index+1))
		}
		resource, err := s.repo.ResourceForUser(userID, resourceID)
		if err != nil || resource == nil || resource.Status != model.ResourceStatusReady {
			return 0, BadAuthRequest(fmt.Sprintf("第 %d 个参考视频不存在或尚未就绪，无法测量时长", index+1))
		}
		// probeStoredResourceMedia 自带 ffprobe 超时和远程读取看门狗。
		info, probeErr := s.probeStoredResourceMedia(context.Background(), resource)
		if probeErr != nil || info.DurationMs <= 0 {
			return 0, BadAuthRequest(fmt.Sprintf("第 %d 个参考视频时长无法测量，暂不能按秒计费提交，请重新上传后再试", index+1))
		}
		if info.DurationMs > math.MaxInt64-total {
			return 0, BadAuthRequest("参考视频总时长超出计费范围")
		}
		total += info.DurationMs
	}
	return total, nil
}

func referenceVideoResourceID(media map[string]any) string {
	if media == nil {
		return ""
	}
	if key := strings.TrimSpace(stringValue(media["storageKey"])); strings.HasPrefix(key, "resource:") {
		return strings.TrimSpace(strings.TrimPrefix(key, "resource:"))
	}
	for _, field := range []string{"url", "fileUrl"} {
		if id := resourceIDFromFileURL(strings.TrimSpace(stringValue(media[field]))); id != "" {
			return id
		}
	}
	return ""
}

// videoTokenEstimateWithoutReferences 按“只计生成时长”的口径重算视频 Token 公式，
// 用于关闭参考视频计费的模型。尺寸、帧率和余量与原估算一致。
func videoTokenEstimateWithoutReferences(estimate *VideoTokenEstimate) *VideoTokenEstimate {
	if estimate == nil || estimate.ReferenceSeconds == 0 {
		return estimate
	}
	result := *estimate
	pixels := result.OutputWidth * result.OutputHeight
	result.FormulaTokens = (result.OutputSeconds*1000*pixels*result.FramesPerSecond + 1_023_999) / 1_024_000
	result.ReservedTokens = (result.FormulaTokens*(100+result.ReservationMarginPercent) + 99) / 100
	result.ReferenceSeconds = 0
	result.ReferenceDurationEstimated = false
	return &result
}

// referenceVideoBillingEstimate 把模型的参考视频计费开关应用到视频 Token 估算上，
// 账单和报价共用，保证两边口径一致。
func referenceVideoBillingEstimate(item *model.ChannelModel, capability string, estimate tokenBillingEstimate) tokenBillingEstimate {
	if capability != "video" || item == nil || item.ReferenceVideoBilling || estimate.Video == nil {
		return estimate
	}
	estimate.Video = videoTokenEstimateWithoutReferences(estimate.Video)
	estimate.OutputTokens = estimate.Video.ReservedTokens
	return estimate
}

// referenceVideoPricedTier 返回带参考视频请求实际使用的价格档副本。带参考视频价格为 0 而基础价格不为 0
// 时视为未配置，拒绝下单，避免开关开启后挂参考视频反而免费。
func referenceVideoPricedTier(tier *model.ChannelModelPriceTier) (*model.ChannelModelPriceTier, error) {
	priced := *tier
	switch tier.BillingMode {
	case "per_second":
		if tier.ReferenceVideoUnitPriceMicrocredits == 0 && tier.UnitPriceMicrocredits > 0 {
			return nil, BadAuthRequest("当前模型尚未配置带参考视频的价格，请联系管理员")
		}
		priced.UnitPriceMicrocredits = tier.ReferenceVideoUnitPriceMicrocredits
	case "token":
		if tier.ReferenceVideoOutputTokenPriceMicrocredits == 0 && tier.OutputTokenPriceMicrocredits > 0 {
			return nil, BadAuthRequest("当前模型尚未配置带参考视频的价格，请联系管理员")
		}
		priced.OutputTokenPriceMicrocredits = tier.ReferenceVideoOutputTokenPriceMicrocredits
	}
	return &priced, nil
}
