package service

import (
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

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
