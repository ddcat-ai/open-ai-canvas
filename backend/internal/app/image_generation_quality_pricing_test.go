package app

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestImageGenerationQualityDoesNotChangeResolutionPrice(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-2")
	qualities := []string{"auto", "low", "medium", "high", "xhigh", "max"}
	profile.Image.Quality.Values = qualities
	tiers := []model.ChannelModelPriceTier{
		newSelectionPriceTier("tier-1k", `{"quality":"1k"}`, "provider-image", "fixed_request"),
		newSelectionPriceTier("tier-2k", `{"quality":"2k"}`, "provider-image", "fixed_request"),
		newSelectionPriceTier("tier-4k", `{"quality":"4k"}`, "provider-image", "fixed_request"),
	}
	for index := range tiers {
		tiers[index].UnitPriceMicrocredits = int64(index+1) * 100_000
	}
	svc, db, channel, cm := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceOpenAIImage, profile, tiers)
	if err := db.AutoMigrate(&model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	for _, sample := range []struct{ size, tier string }{{"4:3", "tier-1k"}, {"1024x1024", "tier-1k"}, {"2048x2048", "tier-2k"}, {"3840x2160", "tier-4k"}} {
		for _, quality := range qualities {
			t.Run(sample.size+"/"+quality, func(t *testing.T) {
				intent := ModelRequestIntent{Capability: "image", Inputs: map[string]int{"image": 1}, Options: map[string]any{"size": sample.size, "quality": quality}}
				quote, err := svc.QuoteChannelModel(ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: cm.ModelKey, Intent: intent})
				if err != nil {
					t.Fatalf("quality affected a valid resolution quote: %v", err)
				}
				input := quoteInput(intent, cm.ModelKey)
				input["config"].(map[string]any)["channelId"] = channel.ID
				resolved, err := svc.resolveSystemChannelModelSelection(input, "canvas_image", "image")
				if err != nil {
					t.Fatal(err)
				}
				config := resolved["config"].(map[string]any)
				if config["priceTierId"] != sample.tier || config["quality"] != quality {
					t.Fatalf("billing changed the selected quality or resolution: %#v", config)
				}
				order, err := svc.taskBillingOrder("user", &model.Task{ID: "dry-task", Type: "canvas_image", Operation: "image"}, resolved)
				if err != nil || order == nil || order.PriceTierID != sample.tier || order.AmountMicrocredits != quote.AmountMicrocredits {
					t.Fatalf("quote and actual billing disagree: quote=%#v order=%#v err=%v", quote, order, err)
				}
			})
		}
	}
}
