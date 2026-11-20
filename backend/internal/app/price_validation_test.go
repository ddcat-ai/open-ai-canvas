package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestValidateChannelModelPriceSupportsAllVideoTokens(t *testing.T) {
	const outputPrice = int64(16_000_000)
	if !ValidateChannelModelPrice("token", "video", model.ChannelInterfaceVolcengineArkVideo, 0, 0, outputPrice, 0, 0) {
		t.Fatal("Volcengine Ark video Token price should be valid")
	}
	for _, protocol := range []model.ChannelInterfaceType{model.ChannelInterfaceVolcengineJiMengVideo, model.ChannelInterfaceNewAPIVideo} {
		if !ValidateChannelModelPrice("token", "video", protocol, 0, 0, outputPrice, 0, 0) {
			t.Fatalf("video protocol %q should support Token pricing", protocol)
		}
	}
}

func TestHasValidPriceUsesChannelProtocolForTokenTiers(t *testing.T) {
	tier := model.ChannelModelPriceTier{Enabled: true, PriceConfigured: true, BillingMode: "token", OutputTokenPriceMicrocredits: 16_000_000}
	ark := &model.ChannelModel{Capability: "video", Protocol: model.ChannelInterfaceVolcengineArkVideo, PriceTiers: []model.ChannelModelPriceTier{tier}}
	if !HasValidPrice(ark) {
		t.Fatal("Volcengine Ark video Token tier should be valid")
	}

	jimeng := &model.ChannelModel{Capability: "video", Protocol: model.ChannelInterfaceVolcengineJiMengVideo, PriceTiers: []model.ChannelModelPriceTier{tier}}
	if !HasValidPrice(jimeng) {
		t.Fatal("JiMeng video Token tier should be valid")
	}
}

func TestTokenPricesValidateCacheWritePrice(t *testing.T) {
	if err := validateTokenPrices("text", 1_000_000, 2_000_000, 100_000, 1_250_000); err != nil {
		t.Fatalf("text cache write price rejected: %v", err)
	}
	if err := validateTokenPrices("text", 1, 1, 1, -1); err == nil {
		t.Fatal("negative cache write price accepted")
	}
	if err := validateTokenPrices("video", 0, 1, 0, 1); err == nil {
		t.Fatal("video cache write price accepted")
	}
	if err := validateTokenPrices("text", 1, 1, 1, maxChannelModelTokenPriceMicrocredits+1); err == nil {
		t.Fatal("oversized cache write price accepted")
	}
}

func TestTokenReservationCoversCacheWritePrice(t *testing.T) {
	estimate := tokenBillingEstimate{InputTokens: 1_000_000, OutputTokens: 1_000_000}
	base := &model.ChannelModel{InputTokenPriceMicrocredits: 1_000_000, OutputTokenPriceMicrocredits: 2_000_000}
	withWrite := &model.ChannelModel{InputTokenPriceMicrocredits: 1_000_000, OutputTokenPriceMicrocredits: 2_000_000, CacheWriteTokenPriceMicrocredits: 1_250_000}
	baseAmount, err := tokenEstimateAmount(base, estimate, 10_000)
	if err != nil {
		t.Fatal(err)
	}
	writeAmount, err := tokenEstimateAmount(withWrite, estimate, 10_000)
	if err != nil {
		t.Fatal(err)
	}
	// 默认 0 时预留不变；缓存写入价更高时，输入按写入价预留，避免实际费用超出预授权。
	if baseAmount != 3_000_000 || writeAmount != 3_250_000 {
		t.Fatalf("reservation = %d / %d, want 3000000 / 3250000", baseAmount, writeAmount)
	}
}
