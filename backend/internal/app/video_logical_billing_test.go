package app

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestUnifiedVideoQuoteAndTaskUseResolvedProviderGeneration(t *testing.T) {
	svc, db, _, channelModel, profile := newVideoTokenQuoteFixture(t)
	const upstream = "doubao-seedance-2-5"
	channelModel.ProviderModelKey = upstream
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", channelModel.ID).Update("provider_model_key", upstream).Error; err != nil {
		t.Fatal(err)
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(profile, "video")
	if err != nil {
		t.Fatal(err)
	}
	specJSON, err := json.Marshal(spec)
	if err != nil {
		t.Fatal(err)
	}
	logical := model.LogicalModel{
		ID: "logical-aliased-video", Code: "video-alias", Capability: "video", Enabled: true,
		ActiveRevisionID: "aliased-video-revision", PricePolicy: "unified", BillingMode: "token", OutputPriceMicrocredits: 16_000_000,
	}
	revision := model.LogicalModelRevision{
		ID: logical.ActiveRevisionID, LogicalModelID: logical.ID, Version: 1, CapabilitySpecJSON: string(specJSON),
		DefaultOptionsJSON: `{"vquality":"480p","size":"16:9","videoSeconds":5,"videoGenerateAudio":true}`,
	}
	route := model.LogicalModelRoute{ID: "aliased-video-route", LogicalModelRevisionID: revision.ID, ChannelModelID: channelModel.ID, Enabled: true, Weight: 1}
	for _, row := range []any{&logical, &revision, &route} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	quote, err := svc.QuoteLogicalModel(logical.ID, ModelRequestIntent{Capability: "video"})
	if err != nil {
		t.Fatal(err)
	}
	routed, input, err := svc.resolveTaskModelSelection(map[string]any{"mode": "video", "config": map[string]any{}}, logical.ID, "canvas_video", "", true)
	if err != nil {
		t.Fatal(err)
	}
	if routed.PriceTier != nil || input["config"].(map[string]any)["providerModelKey"] != upstream {
		t.Fatalf("unified route did not preserve its provider model: %#v", input)
	}
	order, err := svc.taskBillingOrder("quote-user", &model.Task{
		ID: "aliased-video-task", Type: "canvas_video", LogicalModelID: logical.ID,
		LogicalModelRevisionID: revision.ID, RouteID: route.ID, ChannelModelID: channelModel.ID,
	}, input)
	if err != nil {
		t.Fatal(err)
	}
	if quote.VideoTokenEstimate == nil || quote.VideoTokenEstimate.OutputWidth != 854 || quote.VideoTokenEstimate.OutputHeight != 480 || quote.VideoTokenEstimate.DimensionsEstimated {
		t.Fatalf("wrong generation-specific quote: %#v", quote.VideoTokenEstimate)
	}
	if order == nil || order.VideoFormulaTokens != 48038 || order.Quantity != 52842 || order.AmountMicrocredits != 845472 || quote.Quantity != order.Quantity || quote.AmountMicrocredits != order.AmountMicrocredits {
		t.Fatalf("quote/task mismatch: quote=%#v order=%#v", quote, order)
	}
	assertVideoQuoteHasNoFinancialWrites(t, db)
}

func TestRoutedProviderSelectionFallsBackWithoutTierOverride(t *testing.T) {
	for _, test := range []struct {
		name     string
		provider string
		tier     *model.ChannelModelPriceTier
		want     string
	}{
		{name: "unified without tier", provider: "provider-default", want: "provider-default"},
		{name: "empty tier override", provider: "provider-default", tier: &model.ChannelModelPriceTier{ID: "tier"}, want: "provider-default"},
		{name: "tier override", provider: "provider-default", tier: &model.ChannelModelPriceTier{ID: "tier", ProviderModelKey: "provider-tier"}, want: "provider-tier"},
		{name: "model key fallback", tier: &model.ChannelModelPriceTier{ID: "tier"}, want: "model-alias"},
	} {
		t.Run(test.name, func(t *testing.T) {
			input := applyRoutedProviderSelection(map[string]any{"config": map[string]any{"providerModelKey": "untrusted-client-model"}}, &RoutedModel{
				ChannelModel: model.ChannelModel{ChannelID: "channel", ModelKey: "model-alias", ProviderModelKey: test.provider}, PriceTier: test.tier,
			})
			if got := input["config"].(map[string]any)["providerModelKey"]; got != test.want {
				t.Fatalf("providerModelKey = %v, want %s", got, test.want)
			}
		})
	}
}

func TestUnifiedVideoModelSaveRejectsInvalidTokenPricesBeforePersistence(t *testing.T) {
	for _, test := range []struct {
		name          string
		input, output int64
		cached        int64
	}{
		{name: "hidden input", input: 1, output: 16_000_000},
		{name: "hidden cache", output: 16_000_000, cached: 1},
		{name: "too expensive", output: maxChannelModelTokenPriceMicrocredits + 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			// A nil repository proves invalid price fields fail before IDs or revisions are written.
			_, _, _, _, err := (&Service{}).logicalModelBundle(&model.User{ID: "admin"}, "", LogicalModelRequest{
				Code: "video-test", Name: "Video", Capability: "video", PricePolicy: "unified", BillingMode: "token",
				CapabilitySpec:         CapabilitySpec{Version: 1, Capability: "video"},
				InputPriceMicrocredits: test.input, OutputPriceMicrocredits: test.output, CachedPriceMicrocredits: test.cached,
			})
			if err == nil {
				t.Fatal("invalid unified video pricing accepted")
			}
		})
	}
}

func TestUnifiedVideoModelSaveAllowsFreeAndMaximumTokenPrices(t *testing.T) {
	for _, outputPrice := range []int64{0, 16_000_000, maxChannelModelTokenPriceMicrocredits} {
		svc, _, _, channelModel, profile := newVideoTokenQuoteFixture(t)
		spec, err := CapabilitySpecFromModelCapabilityConfig(profile, "video")
		if err != nil {
			t.Fatal(err)
		}
		item, _, _, _, err := svc.logicalModelBundle(&model.User{ID: "admin"}, "", LogicalModelRequest{
			Code: "video-test", Name: "Video", Capability: "video", PricePolicy: "unified", BillingMode: "token", Enabled: true,
			CapabilitySpec: spec, OutputPriceMicrocredits: outputPrice,
			Routes: []LogicalRouteRequest{{ChannelModelID: channelModel.ID, Enabled: true, Weight: 1}},
		})
		if err != nil || item == nil || item.OutputPriceMicrocredits != outputPrice {
			t.Fatalf("output price %d: model=%#v error=%v", outputPrice, item, err)
		}
	}
}
