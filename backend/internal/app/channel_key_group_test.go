package app

import (
	"encoding/json"
	"strings"
	"testing"
	"yingce/backend/internal/model"
)

func TestChannelKeyGroupCopiesDraftsWithIndependentSecretsAndPrices(t *testing.T) {
	s, db := newChannelModelTestService(t)
	s.dataDir = t.TempDir()
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	source := model.ModelChannel{ID: "source", Scope: model.ChannelScopeSystem, Name: "特惠", BaseURL: "https://example.com/v1", APIKey: "old-key", SecretKey: "old-secret", Enabled: true, ModelsJSON: `["image"]`}
	if err := s.encryptSystemChannelSecrets(&source); err != nil {
		t.Fatal(err)
	}
	for _, item := range []any{&source,
		&model.ChannelModel{ID: "original-model", ChannelID: source.ID, ModelKey: "image", DisplayName: "Image Model", Enabled: true, Capability: "image"},
		&model.ChannelModelPriceTier{ID: "original-tier", ChannelModelID: "original-model", SelectorKey: "{}", SelectorJSON: "{}", UnitPriceMicrocredits: 100, Enabled: true},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	result, err := s.CreateChannelKeyGroup(admin, source.ID, ChannelKeyGroupRequest{Name: "稳定", APIKey: "new-group-key", CopyModels: true})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	if strings.Contains(string(raw), "new-group-key") || strings.Contains(string(raw), "old-secret") {
		t.Fatal("API leaked credentials")
	}
	var stored model.ModelChannel
	if err := db.First(&stored, "id = ?", result.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.APIKey == "new-group-key" {
		t.Fatal("plaintext credential persisted")
	}
	if err := s.decryptSystemChannelSecrets(&stored); err != nil {
		t.Fatal(err)
	}
	if stored.BaseURL != source.BaseURL || stored.APIKey != "new-group-key" || stored.SecretKey != "" {
		t.Fatal("connection/credential isolation failed")
	}
	models, err := s.repo.ChannelModels(stored.ID, true)
	if err != nil || len(models) != 1 || models[0].Enabled || models[0].DisplayName != "Image Model" || models[0].ChannelLabel != "稳定" || len(models[0].PriceTiers) != 1 {
		t.Fatalf("draft copy = %+v, %v", models, err)
	}
	tier := models[0].PriceTiers[0]
	if tier.ID == "original-tier" || tier.UnitPriceMicrocredits != 100 {
		t.Fatal("price tier not copied independently")
	}
	if err := db.Model(&tier).Update("unit_price_microcredits", 200).Error; err != nil {
		t.Fatal(err)
	}
	var original model.ChannelModelPriceTier
	if err := db.First(&original, "id = ?", "original-tier").Error; err != nil || original.UnitPriceMicrocredits != 100 {
		t.Fatal("source price modified", err)
	}
	empty, err := s.CreateChannelKeyGroup(admin, source.ID, ChannelKeyGroupRequest{Name: "视频", APIKey: "video-key"})
	if err != nil {
		t.Fatal(err)
	}
	emptyModels, err := s.repo.ChannelModels(empty.ID, true)
	if err != nil || len(emptyModels) != 0 {
		t.Fatal("empty group copied models", err)
	}
	if _, err := s.CreateChannelKeyGroup(&model.User{Role: model.UserRoleUser}, source.ID, ChannelKeyGroupRequest{Name: "forbidden", APIKey: "x"}); err == nil {
		t.Fatal("non-admin accepted")
	}
	if _, err := s.CreateChannelKeyGroup(admin, source.ID, ChannelKeyGroupRequest{Name: "empty-key"}); err == nil {
		t.Fatal("empty key accepted")
	}
}
