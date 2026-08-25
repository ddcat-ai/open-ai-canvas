package service

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestValidateChannelModelPriceSupportsArkVideoTokensOnly(t *testing.T) {
	const outputPrice = int64(16_000_000)
	if !ValidateChannelModelPrice("token", "video", model.ChannelInterfaceVolcengineArkVideo, 0, 0, outputPrice, 0) {
		t.Fatal("Volcengine Ark video Token price should be valid")
	}
	for _, protocol := range []model.ChannelInterfaceType{model.ChannelInterfaceVolcengineJiMengVideo, model.ChannelInterfaceNewAPIVideo} {
		if ValidateChannelModelPrice("token", "video", protocol, 0, 0, outputPrice, 0) {
			t.Fatalf("video protocol %q should not support Token pricing", protocol)
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
	if HasValidPrice(jimeng) {
		t.Fatal("JiMeng video Token tier should be invalid")
	}
}
