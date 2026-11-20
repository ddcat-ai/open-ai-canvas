package app

import (
	"errors"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func videoReferenceQuote(t *testing.T, svc *Service, channelID string, modelKey string, references int) *LogicalModelQuote {
	t.Helper()
	intent := ModelRequestIntent{Capability: "video", Options: map[string]any{"vquality": "720p", "size": "16:9", "videoSeconds": 5}}
	if references > 0 {
		intent.Inputs = map[string]int{"video": references}
	}
	quote, err := svc.QuoteChannelModel(testGroupUserID(svc), ChannelModelQuoteRequest{ChannelID: channelID, ModelKey: modelKey, Intent: intent})
	if err != nil {
		t.Fatalf("QuoteChannelModel() error = %v", err)
	}
	return quote
}

func TestVideoTokenReferenceBillingDisabledIgnoresReferenceVideos(t *testing.T) {
	svc, db, channel, channelModel, _ := newVideoTokenQuoteFixture(t)
	quote := videoReferenceQuote(t, svc, channel.ID, channelModel.ModelKey, 1)
	// 开关关闭：挂参考视频的报价与不挂完全一致，只按 5 秒生成时长计 Token。
	assertVideoTokenQuote(t, quote, 1_900_800)
	assertVideoQuoteHasNoFinancialWrites(t, db)
}

func TestVideoTokenReferenceBillingEnabledUsesReferencePrice(t *testing.T) {
	svc, db, channel, channelModel, _ := newVideoTokenQuoteFixture(t)
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", channelModel.ID).Update("reference_video_billing", true).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", "video-audio").Update("reference_video_output_token_price_microcredits", 32_000_000).Error; err != nil {
		t.Fatal(err)
	}
	// 不挂参考视频仍用原价。
	assertVideoTokenQuote(t, videoReferenceQuote(t, svc, channel.ID, channelModel.ModelKey, 0), 1_900_800)

	// 挂参考视频：沿用含参考视频的公式（报价未知时长按 15 秒预估），乘以带参考视频的 Token 单价。
	quote := videoReferenceQuote(t, svc, channel.ID, channelModel.ModelKey, 1)
	if quote.VideoTokenEstimate == nil || quote.VideoTokenEstimate.ReferenceSeconds != 15 || quote.VideoTokenEstimate.FormulaTokens != 432_000 {
		t.Fatalf("reference estimate = %#v", quote.VideoTokenEstimate)
	}
	if quote.Quantity != 475_200 || quote.AmountMicrocredits != 15_206_400 {
		t.Fatalf("reference quote = %#v, want 475200 tokens and 15206400 microcredits", quote)
	}
	assertVideoQuoteHasNoFinancialWrites(t, db)
}

func TestVideoTokenReferenceBillingRejectsMissingReferencePrice(t *testing.T) {
	svc, db, channel, channelModel, _ := newVideoTokenQuoteFixture(t)
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", channelModel.ID).Update("reference_video_billing", true).Error; err != nil {
		t.Fatal(err)
	}
	intent := ModelRequestIntent{Capability: "video", Inputs: map[string]int{"video": 1}, Options: map[string]any{"vquality": "720p", "size": "16:9", "videoSeconds": 5}}
	if _, err := svc.QuoteChannelModel(testGroupUserID(svc), ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: channelModel.ModelKey, Intent: intent}); err == nil || !strings.Contains(err.Error(), "带参考视频的价格") {
		t.Fatalf("missing reference price must be rejected, got %v", err)
	}
}

func newPerSecondReferenceFixture(t *testing.T, enabled bool) (*Service, model.ModelChannel, model.ChannelModel) {
	t.Helper()
	svc, db, channel, channelModel, _ := newVideoTokenQuoteFixture(t)
	if err := db.Model(&model.ChannelModelPriceTier{}).Where("channel_model_id = ?", channelModel.ID).Updates(map[string]any{
		"billing_mode": "per_second", "unit_price_microcredits": 1_000_000, "output_token_price_microcredits": 0,
		"reference_video_unit_price_microcredits": 2_000_000,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", channelModel.ID).Update("reference_video_billing", enabled).Error; err != nil {
		t.Fatal(err)
	}
	return svc, channel, channelModel
}

func perSecondReferenceOrder(t *testing.T, svc *Service, channel model.ModelChannel, channelModel model.ChannelModel, measure func() (int64, error)) (*model.BillingOrder, error) {
	t.Helper()
	intent := ModelRequestIntent{Capability: "video", Inputs: map[string]int{"video": 1}, Options: map[string]any{"vquality": "720p", "size": "16:9", "videoSeconds": 5, "videoGenerateAudio": true}}
	estimate := tokenBillingEstimate{ReferenceVideos: referenceVideoUsage{Count: 1, RecordedMillis: 3_000, RecordedKnown: true, Measure: measure}}
	return svc.newBillingOrderWithPriceTier("quote-user", "task", "reference-test", channel.ID, channelModel.ModelKey, "video", "test", 5, estimate, "", intent)
}

func TestPerSecondReferenceBillingAddsMeasuredSeconds(t *testing.T) {
	svc, channel, channelModel := newPerSecondReferenceFixture(t, true)
	order, err := perSecondReferenceOrder(t, svc, channel, channelModel, func() (int64, error) { return 7_200, nil })
	if err != nil {
		t.Fatal(err)
	}
	// 5 秒生成 + 实测 7.2 秒参考视频（向上取整 8 秒）= 13 秒，按带参考视频单价 2 积分/秒。
	if order.Quantity != 13 || order.UnitPriceMicrocredits != 2_000_000 || order.AmountMicrocredits != 26_000_000 {
		t.Fatalf("order = quantity %d unit %d amount %d", order.Quantity, order.UnitPriceMicrocredits, order.AmountMicrocredits)
	}
	if !order.ReferenceVideoBilled || order.ReferenceVideoCount != 1 || order.ReferenceVideoMillis != 7_200 {
		t.Fatalf("reference snapshot = %#v", order)
	}
}

func TestPerSecondReferenceBillingRejectsUnmeasuredReference(t *testing.T) {
	svc, channel, channelModel := newPerSecondReferenceFixture(t, true)
	measureErr := BadAuthRequest("第 1 个参考视频时长无法测量")
	if _, err := perSecondReferenceOrder(t, svc, channel, channelModel, func() (int64, error) { return 0, measureErr }); !errors.Is(err, measureErr) && (err == nil || !strings.Contains(err.Error(), "无法测量")) {
		t.Fatalf("unmeasured reference must be rejected, got %v", err)
	}
}

func TestPerSecondReferenceBillingDisabledChargesGeneratedSecondsOnly(t *testing.T) {
	svc, channel, channelModel := newPerSecondReferenceFixture(t, false)
	order, err := perSecondReferenceOrder(t, svc, channel, channelModel, func() (int64, error) {
		t.Fatal("reference duration must not be measured when reference billing is disabled")
		return 0, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if order.Quantity != 5 || order.UnitPriceMicrocredits != 1_000_000 || order.AmountMicrocredits != 5_000_000 {
		t.Fatalf("order = quantity %d unit %d amount %d", order.Quantity, order.UnitPriceMicrocredits, order.AmountMicrocredits)
	}
	if order.ReferenceVideoBilled || order.ReferenceVideoCount != 1 || order.ReferenceVideoMillis != 3_000 {
		t.Fatalf("reference snapshot = %#v", order)
	}
}

func TestPerSecondReferenceBillingTaskPathRejectsReferenceOutsideResourceLibrary(t *testing.T) {
	svc, channel, channelModel := newPerSecondReferenceFixture(t, true)
	intent := ModelRequestIntent{Capability: "video", Options: map[string]any{"vquality": "720p", "size": "16:9", "videoSeconds": 5}}
	input := quoteInput(intent, channelModel.ModelKey)
	input["config"].(map[string]any)["channelId"] = channel.ID
	resolved, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), input, "canvas_video", "")
	if err != nil {
		t.Fatal(err)
	}
	// 客户端声明的 durationMs 不能替代后端实测。
	resolved["referenceVideos"] = []any{map[string]any{"url": "https://example.com/reference.mp4", "durationMs": 3000}}
	_, err = svc.taskBillingOrder("quote-user", &model.Task{ID: "video-task", Type: "canvas_video"}, resolved)
	if err == nil || !strings.Contains(err.Error(), "无法测量时长") {
		t.Fatalf("reference outside resource library must be rejected, got %v", err)
	}
}

func TestValidateReferenceVideoTierPrices(t *testing.T) {
	perSecond := model.ChannelModelPriceTier{BillingMode: "per_second", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true}
	token := model.ChannelModelPriceTier{BillingMode: "token", OutputTokenPriceMicrocredits: 1, PriceConfigured: true, Enabled: true}
	if err := validateReferenceVideoTierPrices(false, []model.ChannelModelPriceTier{perSecond, token}); err != nil {
		t.Fatalf("disabled switch must not require reference prices: %v", err)
	}
	if err := validateReferenceVideoTierPrices(true, []model.ChannelModelPriceTier{perSecond}); err == nil {
		t.Fatal("per-second tier without reference price must be rejected")
	}
	if err := validateReferenceVideoTierPrices(true, []model.ChannelModelPriceTier{token}); err == nil {
		t.Fatal("token tier without reference price must be rejected")
	}
	perSecond.ReferenceVideoUnitPriceMicrocredits, token.ReferenceVideoOutputTokenPriceMicrocredits = 2, 2
	if err := validateReferenceVideoTierPrices(true, []model.ChannelModelPriceTier{perSecond, token}); err != nil {
		t.Fatalf("configured reference prices rejected: %v", err)
	}
}

func TestPerSecondReferenceQuoteUsesDeclaredDurationsAndBreakdown(t *testing.T) {
	svc, channel, channelModel := newPerSecondReferenceFixture(t, true)
	intent := ModelRequestIntent{Capability: "video", Inputs: map[string]int{"video": 2}, ReferenceVideoDurationsMs: []int64{3_000, 4_500},
		Options: map[string]any{"vquality": "720p", "size": "16:9", "videoSeconds": 5}}
	quote, err := svc.QuoteChannelModel(testGroupUserID(svc), ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: channelModel.ModelKey, Intent: intent})
	if err != nil {
		t.Fatal(err)
	}
	want := QuoteReferenceVideo{Count: 2, Billed: true, GeneratedSeconds: 5, ReferenceSeconds: 7.5, BilledSeconds: 8}
	if quote.ReferenceVideo == nil || *quote.ReferenceVideo != want || quote.Quantity != 13 || quote.AmountMicrocredits != 26_000_000 || quote.Estimated {
		t.Fatalf("quote = %#v reference = %#v", quote, quote.ReferenceVideo)
	}

	intent.ReferenceVideoDurationsMs = nil
	quote, err = svc.QuoteChannelModel(testGroupUserID(svc), ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: channelModel.ModelKey, Intent: intent})
	if err != nil {
		t.Fatal(err)
	}
	if quote.ReferenceVideo == nil || !quote.ReferenceVideo.Estimated || quote.ReferenceVideo.BilledSeconds != 15 || !quote.Estimated {
		t.Fatalf("unknown durations must be estimated: %#v", quote.ReferenceVideo)
	}

	intent.ReferenceVideoDurationsMs = []int64{3_000}
	if _, err := svc.QuoteChannelModel(testGroupUserID(svc), ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: channelModel.ModelKey, Intent: intent}); err == nil {
		t.Fatal("duration count mismatch must be rejected")
	}
}

func TestReferenceQuoteReportsUnbilledReferences(t *testing.T) {
	svc, channel, channelModel := newPerSecondReferenceFixture(t, false)
	intent := ModelRequestIntent{Capability: "video", Inputs: map[string]int{"video": 1}, ReferenceVideoDurationsMs: []int64{8_000},
		Options: map[string]any{"vquality": "720p", "size": "16:9", "videoSeconds": 5}}
	quote, err := svc.QuoteChannelModel(testGroupUserID(svc), ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: channelModel.ModelKey, Intent: intent})
	if err != nil {
		t.Fatal(err)
	}
	want := QuoteReferenceVideo{Count: 1, GeneratedSeconds: 5, ReferenceSeconds: 8}
	if quote.ReferenceVideo == nil || *quote.ReferenceVideo != want || quote.Quantity != 5 || quote.AmountMicrocredits != 5_000_000 {
		t.Fatalf("quote = %#v reference = %#v", quote, quote.ReferenceVideo)
	}
}

func TestCatalogPublishesReferenceVideoBilling(t *testing.T) {
	svc, db, _, channelModel, _ := newVideoTokenQuoteFixture(t)
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", channelModel.ID).Update("reference_video_billing", true).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModelPriceTier{}).Where("channel_model_id = ?", channelModel.ID).Update("reference_video_output_token_price_microcredits", 32_000_000).Error; err != nil {
		t.Fatal(err)
	}
	item, err := svc.repo.ChannelModelByKey(channelModel.ChannelID, channelModel.ModelKey)
	if err != nil {
		t.Fatal(err)
	}
	public, err := svc.sanitizeChannelModel(item)
	if err != nil {
		t.Fatal(err)
	}
	if !public.ReferenceVideoBilling || len(public.PriceTiers) == 0 || public.PriceTiers[0].ReferenceVideoOutputTokenPriceMicrocredits != 32_000_000 {
		t.Fatalf("catalog model = %#v", public)
	}
	item.ReferenceVideoBilling = false
	if public, err = svc.sanitizeChannelModel(item); err != nil || public.ReferenceVideoBilling || public.PriceTiers[0].ReferenceVideoOutputTokenPriceMicrocredits != 0 {
		t.Fatalf("disabled switch must hide reference prices: %#v %v", public, err)
	}
}

func TestReferenceVideoCostSnapshotUsesReferenceCostPrice(t *testing.T) {
	cost := model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 400_000, OutputTokenPriceMicrocredits: 6_000_000, ReferenceVideoUnitPriceMicrocredits: 900_000, ReferenceVideoOutputTokenPriceMicrocredits: 12_000_000}
	perSecond := &model.ChannelModelPriceTier{BillingMode: "per_second", CostPricing: cost}
	// 挂参考视频且计费：成本价换成带参考视频成本价，数量与售价一致（5 秒生成 + 8 秒参考视频）。
	order := &model.BillingOrder{Quantity: 13, ReferenceVideoCount: 1, ReferenceVideoBilled: true}
	snapshotCreditCost(order, perSecond, 5, tokenBillingEstimate{})
	if order.CostPricing.UnitPriceMicrocredits != 900_000 || order.CostQuantity != 13 {
		t.Fatalf("per-second reference cost = unit %d quantity %d", order.CostPricing.UnitPriceMicrocredits, order.CostQuantity)
	}
	// 参考视频不计费：沿用基础成本价，数量只算生成秒数。
	order = &model.BillingOrder{Quantity: 5, ReferenceVideoCount: 1}
	snapshotCreditCost(order, perSecond, 5, tokenBillingEstimate{})
	if order.CostPricing.UnitPriceMicrocredits != 400_000 || order.CostQuantity != 5 {
		t.Fatalf("per-second unbilled cost = unit %d quantity %d", order.CostPricing.UnitPriceMicrocredits, order.CostQuantity)
	}
	token := &model.ChannelModelPriceTier{BillingMode: "token", CostPricing: cost}
	order = &model.BillingOrder{ReferenceVideoCount: 1, ReferenceVideoBilled: true}
	snapshotCreditCost(order, token, 5, tokenBillingEstimate{Video: &VideoTokenEstimate{FormulaTokens: 432_000}})
	if order.CostPricing.OutputTokenPriceMicrocredits != 12_000_000 || order.CostVideoFormulaTokens != 432_000 {
		t.Fatalf("token reference cost = output %d tokens %d", order.CostPricing.OutputTokenPriceMicrocredits, order.CostVideoFormulaTokens)
	}
}

func TestValidateReferenceVideoTierPricesRequiresReferenceCost(t *testing.T) {
	tier := model.ChannelModelPriceTier{BillingMode: "per_second", UnitPriceMicrocredits: 1, ReferenceVideoUnitPriceMicrocredits: 2, PriceConfigured: true, Enabled: true,
		CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 1}}
	if err := validateReferenceVideoTierPrices(true, []model.ChannelModelPriceTier{tier}); err == nil || !strings.Contains(err.Error(), "成本价") {
		t.Fatalf("missing reference cost must be rejected, got %v", err)
	}
	tier.CostPricing.ReferenceVideoUnitPriceMicrocredits = 2
	if err := validateReferenceVideoTierPrices(true, []model.ChannelModelPriceTier{tier}); err != nil {
		t.Fatalf("configured reference cost rejected: %v", err)
	}
	tier.CostPricing = model.CreditCostPricing{UnitPriceMicrocredits: 1}
	if err := validateReferenceVideoTierPrices(true, []model.ChannelModelPriceTier{tier}); err != nil {
		t.Fatalf("unconfigured cost must not require reference cost: %v", err)
	}
}

// 视频处理的源视频在 referenceVideos 里，但不是参考素材：开关开启也不能按参考视频再计一次秒数。
func TestVideoProcessingSourceIsNotReferenceVideo(t *testing.T) {
	input := map[string]any{
		"referenceVideos": []any{map[string]any{"storageKey": "resource:source", "durationMs": 8_000}},
		"metadata":        map[string]any{videoProcessingMetadataKey: true},
	}
	if usage := referenceVideoUsageFromInput(input); usage.Count != 0 || usage.RecordedMillis != 0 {
		t.Fatalf("processing source counted as reference video: %#v", usage)
	}
	delete(input, "metadata")
	if usage := referenceVideoUsageFromInput(input); usage.Count != 1 || usage.RecordedMillis != 8_000 || !usage.RecordedKnown {
		t.Fatalf("generation reference video = %#v", usage)
	}
}

// 按次计费与时长无关：报价不返回“生成 N 秒 + 参考视频 M 秒”的构成。
func TestFixedRequestQuoteHasNoReferenceBreakdown(t *testing.T) {
	order := &model.BillingOrder{Capability: "video", BillingMode: "fixed_request", Quantity: 1}
	estimate := tokenBillingEstimate{ReferenceVideos: referenceVideoUsage{Count: 1, RecordedMillis: 8_000, RecordedKnown: true}}
	if detail := quoteReferenceVideo(order, estimate); detail != nil {
		t.Fatalf("fixed request quote must not describe seconds: %#v", detail)
	}
}

// Token 订单的参考视频时长未知时公式按 15 秒预估；预估值不写进账单快照，流水只记个数。
func TestTokenReferenceSnapshotSkipsEstimatedDuration(t *testing.T) {
	svc, db, channel, channelModel, _ := newVideoTokenQuoteFixture(t)
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", channelModel.ID).Update("reference_video_billing", true).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModelPriceTier{}).Where("channel_model_id = ?", channelModel.ID).Update("reference_video_output_token_price_microcredits", 32_000_000).Error; err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		durations []int64
		want      int64
	}{{nil, 0}, {[]int64{8_000}, 8_000}} {
		intent := ModelRequestIntent{Capability: "video", Inputs: map[string]int{"video": 1}, ReferenceVideoDurationsMs: tc.durations, Options: map[string]any{"vquality": "720p", "size": "16:9", "videoSeconds": 5, "videoGenerateAudio": true}}
		estimate := estimateTaskBillingTokens(quoteInput(intent, channelModel.ModelKey), "video")
		order, err := svc.newBillingOrderWithPriceTier("quote-user", "task", "reference-token", channel.ID, channelModel.ModelKey, "video", "test", 5, estimate, "", intent)
		if err != nil {
			t.Fatal(err)
		}
		if !order.ReferenceVideoBilled || order.ReferenceVideoMillis != tc.want {
			t.Fatalf("durations %v: billed=%v millis=%d, want %d", tc.durations, order.ReferenceVideoBilled, order.ReferenceVideoMillis, tc.want)
		}
	}
}
