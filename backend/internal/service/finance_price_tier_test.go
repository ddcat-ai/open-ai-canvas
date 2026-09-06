package service

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestImageSpecificationQuoteAgreesWithTaskBilling(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.ChannelModel{}, &model.ChannelModelPriceTier{}); err != nil {
		t.Fatal(err)
	}
	channelModel := model.ChannelModel{
		ID: "image-channel-model", ChannelID: "image-channel", ModelKey: "image-model", Capability: "image",
		Protocol: model.ChannelInterfaceOpenAIImage, Enabled: true, PriceConfigured: true,
	}
	for operationIndex, operation := range []string{"text_to_image", "image_to_image"} {
		for index, quality := range []string{"1k", "2k", "4k"} {
			selector := fmt.Sprintf(`{"operation":%q,"quality":%q}`, operation, quality)
			channelModel.PriceTiers = append(channelModel.PriceTiers, model.ChannelModelPriceTier{
				ID: operation + "-" + quality, ChannelModelID: channelModel.ID, SelectorKey: selector, SelectorJSON: selector,
				Resolution: "*", BillingMode: "fixed_request", UnitPriceMicrocredits: int64(index+1+operationIndex*3) * 1_000_000,
				Enabled: true, PriceConfigured: true,
			})
		}
	}
	if err := db.Create(&channelModel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&channelModel.PriceTiers).Error; err != nil {
		t.Fatal(err)
	}
	spec := CapabilitySpec{Version: 1, Capability: "image", Inputs: map[string]InputConstraint{"image": {Max: 9}}, Options: map[string]OptionConstraint{"quality": {Values: []any{"1k", "2k", "4k"}}}}
	cached := cachedLogicalModel{
		Model:       model.LogicalModel{ID: "logical-image", PricePolicy: "channel", Capability: "image"},
		ProductSpec: spec, Defaults: map[string]any{"quality": "2k"},
		Routes: []cachedLogicalRoute{{Route: model.LogicalModelRoute{ID: "image-route", Enabled: true, Weight: 1}, CapabilitySpec: spec, ChannelModel: channelModel}},
	}
	svc := &Service{repo: repository.New(db), routeCatalogTTL: time.Hour, routeCatalog: &routeCatalogSnapshot{LoadedAt: time.Now(), Models: map[string]cachedLogicalModel{"logical-image": cached}}}
	for _, tier := range channelModel.PriceTiers {
		selector := model.DecodeSKUSelector(tier.SelectorJSON)
		imageCount := 0
		if selector["operation"] == "image_to_image" {
			imageCount = 1
		}
		input := map[string]any{"mode": "image", "referenceImages": make([]any, imageCount), "config": map[string]any{
			"channelId": channelModel.ChannelID, "model": channelModel.ModelKey, "quality": strings.ToUpper(selector["quality"]),
		}}
		intent := ModelRequestIntentFromTaskInput(input, "canvas_image", "image")
		quote, err := svc.QuoteLogicalModel("logical-image", intent)
		if err != nil {
			t.Fatalf("quote %s: %v", tier.ID, err)
		}
		order, err := svc.taskBillingOrder("user", &model.Task{ID: "task", Type: "canvas_image", Operation: "image"}, input)
		if err != nil {
			t.Fatalf("billing %s: %v", tier.ID, err)
		}
		if quote.AmountMicrocredits != tier.UnitPriceMicrocredits || order.AmountMicrocredits != quote.AmountMicrocredits || order.PriceTierID != tier.ID {
			t.Fatalf("tier %s: quote=%#v order=%#v", tier.ID, quote, order)
		}
	}
	quote, err := svc.QuoteLogicalModel("logical-image", ModelRequestIntent{Capability: "image"})
	if err != nil || quote.AmountMicrocredits != 2_000_000 {
		t.Fatalf("default resolution quote=%#v error=%v", quote, err)
	}
	if _, err := svc.QuoteLogicalModel("logical-image", ModelRequestIntent{Capability: "image", Options: map[string]any{"quality": "8k"}}); err == nil {
		t.Fatal("unconfigured resolution must not be quoted")
	}
}

func TestTaskBillingOrderMatchesSystemImagePriceTierFromRequestedSpec(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.ChannelModel{}, &model.ChannelModelPriceTier{}); err != nil {
		t.Fatal(err)
	}
	channelModel := model.ChannelModel{
		ID: "channel-model-1", ChannelID: "channel-1", ModelKey: "gpt-image-2", ProviderModelKey: "gpt-image-2",
		Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, BillingMode: "fixed_request",
		PriceConfigured: true, Enabled: true, PriceVersion: 1,
	}
	if err := db.Create(&channelModel).Error; err != nil {
		t.Fatal(err)
	}
	tier := model.ChannelModelPriceTier{
		ID: "tier-2k", ChannelModelID: channelModel.ID, SelectorKey: `{"quality":"2k"}`, SelectorJSON: `{"quality":"2k"}`,
		Resolution: "*", ProviderModelKey: channelModel.ProviderModelKey, BillingMode: "fixed_request",
		UnitPriceMicrocredits: 4_000_000, PriceConfigured: true, Enabled: true, PriceVersion: 1,
	}
	if err := db.Create(&tier).Error; err != nil {
		t.Fatal(err)
	}

	svc := New(repository.New(db), t.TempDir())
	order, err := svc.taskBillingOrder("user-1", &model.Task{ID: "task-1", Type: "canvas_image", Operation: "image"}, map[string]any{
		"mode": "image",
		"config": map[string]any{
			"channelId": "channel-1",
			"model":     "gpt-image-2",
			"quality":   "2K",
			"size":      "*",
		},
	})
	if err != nil {
		t.Fatalf("taskBillingOrder() error = %v", err)
	}
	if order == nil || order.PriceTierID != tier.ID || order.AmountMicrocredits != tier.UnitPriceMicrocredits {
		t.Fatalf("taskBillingOrder() = %#v, want tier %s", order, tier.ID)
	}
}
