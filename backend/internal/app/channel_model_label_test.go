package app

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestChannelModelLabelSaveAndCatalogPreserveChannelIdentity(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	enabled := true
	request := ChannelModelRequest{
		ModelKey: "gpt-test", ProviderModelKey: "upstream-text", DisplayName: "GPT Test", Icon: "OpenAI",
		ChannelLabel: "  优惠渠道-993  ", Capability: "text", Protocol: string(model.ChannelInterfaceChatCompletion),
		Description:      "  适合分镜脚本，请先确认输入要求。  ",
		Tags:             []model.ChannelModelTag{{Text: " 限时特价 ", Color: "purple"}, {Text: "官方1折", Color: "gold"}},
		CapabilityConfig: DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "gpt-test"),
		PriceTiers:       []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", UnitPriceMicrocredits: 300000, PriceConfigured: true, Enabled: &enabled}},
		Enabled:          &enabled,
	}
	var firstID string
	for _, id := range []string{"channel-a", "channel-b"} {
		channel := model.ModelChannel{ID: id, Scope: model.ChannelScopeSystem, Enabled: true, Name: "Test", BaseURL: "https://example.invalid/v1", APIKey: "synthetic", ModelsJSON: `[]`}
		if err := db.Create(&channel).Error; err != nil {
			t.Fatal(err)
		}
		saved, err := svc.SaveAdminChannelModel(admin, id, "", request)
		if err != nil {
			t.Fatal(err)
		}
		var stored model.ChannelModel
		if err := db.First(&stored, "id = ?", saved.ID).Error; err != nil {
			t.Fatal(err)
		}
		if stored.ChannelLabel != "优惠渠道-993" || stored.ModelKey != "gpt-test" || stored.ProviderModelKey != "upstream-text" || stored.ChannelID != id {
			t.Fatalf("stored channel model: %#v", stored)
		}
		legacy := publicChannel(channel, false, []model.ChannelModel{*saved})
		if len(stored.Tags) != 2 || stored.Tags[0].Text != "限时特价" || stored.Tags[1].Color != "gold" || len(legacy.ModelCosts[0].Tags) != 2 {
			t.Fatalf("tags not persisted or projected: %#v", stored.Tags)
		}
		if stored.Description != "适合分镜脚本，请先确认输入要求。" || legacy.ModelCosts[0].Description != stored.Description {
			t.Fatal("model description was not persisted or projected")
		}
		if legacy.ModelCosts[0].ChannelLabel != "优惠渠道-993" {
			t.Fatal("session projection lost channel label")
		}
		if id == "channel-a" {
			firstID = saved.ID
		}
	}
	catalog, err := svc.ModelCatalog(nil)
	if err != nil || len(catalog.Channels) != 2 {
		t.Fatalf("catalog: %#v, %v", catalog, err)
	}
	for _, channel := range catalog.Channels {
		if len(channel.Models) != 1 || len(channel.Models[0].Tags) != 2 || channel.Models[0].Tags[0].Text != "限时特价" {
			t.Fatalf("catalog lost tags: %#v", channel)
		}
		if len(channel.Models) == 1 && channel.Models[0].Description != "适合分镜脚本，请先确认输入要求。" {
			t.Fatal("catalog lost model description")
		}
		if len(channel.Models) != 1 || channel.Models[0].ChannelLabel != "优惠渠道-993" || !channel.Models[0].Available || channel.Models[0].PriceTiers[0].UnitPriceMicrocredits != 300000 {
			t.Fatalf("catalog lost label or pricing: %#v", channel)
		}
	}
	invalidTags := request
	invalidTags.Tags = []model.ChannelModelTag{{Text: "限时特价", Color: "invalid"}}
	if _, err := svc.SaveAdminChannelModel(admin, "channel-a", firstID, invalidTags); err == nil {
		t.Fatal("accepted invalid tag color")
	}
	var unchanged model.ChannelModel
	if err := db.First(&unchanged, "id = ?", firstID).Error; err != nil || len(unchanged.Tags) != 2 || unchanged.Tags[0].Color != "purple" {
		t.Fatalf("invalid write changed persisted tags: %#v, %v", unchanged.Tags, err)
	}
	request.ChannelLabel = strings.Repeat("字", 81)
	if _, err := svc.SaveAdminChannelModel(admin, "channel-a", firstID, request); err == nil {
		t.Fatal("accepted oversized channel label")
	}
	request.ChannelLabel = " "
	request.Description = strings.Repeat("字", 501)
	if _, err := svc.SaveAdminChannelModel(admin, "channel-a", firstID, request); err == nil {
		t.Fatal("accepted oversized description")
	}
	request.Description = strings.Repeat("字", 500)
	if _, err := svc.SaveAdminChannelModel(admin, "channel-a", firstID, request); err != nil {
		t.Fatalf("rejected valid 500-character description: %v", err)
	}
	request.Description = "  "
	request.Tags = []model.ChannelModelTag{}
	updated, err := svc.SaveAdminChannelModel(admin, "channel-a", firstID, request)
	if err != nil || updated.ChannelLabel != "" || updated.Description != "" || updated.ID != firstID {
		t.Fatalf("label clearing changed identity: %#v, %v", updated, err)
	}
	var cleared model.ChannelModel
	if err := db.First(&cleared, "id = ?", firstID).Error; err != nil || len(cleared.Tags) != 0 {
		t.Fatalf("tags not cleared: %#v %v", cleared.Tags, err)
	}
	if _, err := svc.SaveAdminChannelModel(&model.User{ID: "user", Role: model.UserRoleUser}, "channel-a", firstID, request); err == nil {
		t.Fatal("non-admin changed channel label")
	}
}
