package app

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func addUnconfiguredBatchModel(t *testing.T, db *gorm.DB, id string) {
	t.Helper()
	item := model.ChannelModel{ID: id, ChannelID: "channel", ModelKey: id, ProviderModelKey: id, DisplayName: "未分类", BillingMode: "fixed_request", PriceVersion: 1}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
}

func TestUnifiedBatchInitializesNewModelWithProtocolDefaults(t *testing.T) {
	for _, pair := range [][2]string{{"text", "chat-completion"}, {"image", "openai-image"}, {"video", "newapi"}, {"audio", "openai-audio"}} {
		t.Run(pair[0], func(t *testing.T) {
			svc, db, admin := seedBatchUpdates(t)
			addUnconfiguredBatchModel(t, db, "new-model")
			changes := BatchChannelModelChanges{Capability: batchText(pair[0]), Protocol: batchText(pair[1])}
			if n, err := svc.BatchUpdateAdminChannelModels(admin, "channel", []BatchChannelModelUpdate{batchRequest(t, svc, "new-model", changes)}); err != nil || n != 1 {
				t.Fatalf("n=%d err=%v", n, err)
			}
			item, _ := svc.repo.ChannelModelByID("channel", "new-model")
			if item.Capability != pair[0] || string(item.Protocol) != pair[1] || item.CapabilityVersion != 1 || item.Enabled || item.PriceConfigured || len(item.PriceTiers) != 0 || item.PriceVersion != 1 {
				t.Fatalf("unexpected initialized model: %+v", item)
			}
			if pair[0] != "audio" {
				if _, err := normalizedChannelModelCapability(item, svc.protocolRegistry()); err != nil {
					t.Fatalf("initialized capability cannot be used: %v", err)
				}
			}
		})
	}
}

func TestUnifiedBatchCapabilityTemplatePreservesEachProtocolAndVersions(t *testing.T) {
	for _, legacy := range []string{"", "removed-plugin", "openai-image"} {
		t.Run("legacy="+legacy, func(t *testing.T) {
			svc, db, admin := seedBatchUpdates(t)
			if err := db.Model(&model.ChannelModel{}).Where("id = ?", "b").Update("protocol", "openai-response").Error; err != nil {
				t.Fatal(err)
			}
			before := map[string]*model.ChannelModel{}
			requests := []BatchChannelModelUpdate{}
			for _, id := range []string{"a", "b"} {
				before[id], _ = svc.repo.ChannelModelByID("channel", id)
				config := DefaultModelCapabilityConfig("chat-completion")
				config.Text.References.MaxImages = 3
				config.Text.References.MaxImageBytes = 10 << 20
				requests = append(requests, batchRequest(t, svc, id, BatchChannelModelChanges{CapabilityTemplate: &BatchModelCapabilityTemplate{Protocol: legacy, CapabilityConfig: config}}))
			}
			if n, err := svc.BatchUpdateAdminAllChannelModels(admin, requests); err != nil || n != 2 {
				t.Fatalf("n=%d err=%v", n, err)
			}
			for _, id := range []string{"a", "b"} {
				after, _ := svc.repo.ChannelModelByID("channel", id)
				config, err := DecodeModelCapabilityConfig(after.CapabilityConfigJSON)
				if err != nil || config.Text.References.MaxImages != 3 || after.Protocol != before[id].Protocol || after.CapabilityVersion != before[id].CapabilityVersion+1 || after.PriceVersion != before[id].PriceVersion || !reflect.DeepEqual(after.PriceTiers, before[id].PriceTiers) {
					t.Fatalf("template altered protocol/prices or missed capability: %+v err=%v", after, err)
				}
				// Applying the same final capability again does not bump its version.
				changes := BatchChannelModelChanges{CapabilityTemplate: &BatchModelCapabilityTemplate{Protocol: legacy, CapabilityConfig: config}}
				if _, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{batchRequest(t, svc, id, changes)}); err != nil {
					t.Fatal(err)
				}
				repeated, _ := svc.repo.ChannelModelByID("channel", id)
				if repeated.CapabilityVersion != after.CapabilityVersion || repeated.PriceVersion != after.PriceVersion {
					t.Fatal("unchanged template bumped versions")
				}
			}
		})
	}
}

func TestUnifiedBatchExplicitProtocolIgnoresLegacyTemplateProtocol(t *testing.T) {
	svc, db, admin := seedBatchUpdates(t)
	changes := BatchChannelModelChanges{Protocol: batchText("openai-response"), CapabilityTemplate: &BatchModelCapabilityTemplate{Protocol: "removed-plugin", CapabilityConfig: DefaultModelCapabilityConfig("chat-completion")}}
	if _, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{batchRequest(t, svc, "a", changes)}); err != nil {
		t.Fatal(err)
	}
	item, _ := svc.repo.ChannelModelByID("channel", "a")
	if item.Protocol != model.ChannelInterfaceOpenAIResponse {
		t.Fatal("explicit protocol was replaced")
	}
	addUnconfiguredBatchModel(t, db, "fresh")
	changes.Protocol, changes.Capability = nil, batchText("text")
	changes.CapabilityTemplate.Protocol = "chat-completion"
	before := groupedProtocolRows(t, svc)
	if _, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{batchRequest(t, svc, "fresh", changes)}); err == nil || !strings.Contains(err.Error(), "请求协议") {
		t.Fatalf("missing explicit protocol accepted: %v", err)
	}
	if !reflect.DeepEqual(before, groupedProtocolRows(t, svc)) {
		t.Fatal("rejected initialization changed state")
	}
}

func TestUnifiedBatchCapabilityTemplateJSONCompatibility(t *testing.T) {
	for _, payload := range []string{`{"capabilityConfig":{"version":1}}`, `{"protocol":"removed-plugin","capabilityConfig":{"version":1}}`} {
		var template BatchModelCapabilityTemplate
		if err := json.Unmarshal([]byte(payload), &template); err != nil {
			t.Fatalf("supported template JSON rejected: %v", err)
		}
	}
	for _, payload := range []string{`{}`, `{"protocol":null,"capabilityConfig":{"version":1}}`, `{"protocol":2,"capabilityConfig":{"version":1}}`, `{"capabilityConfig":null}`, `{"capabilityConfig":{"version":1,"unknown":true}}`, `{"capabilityConfig":{"version":1},"unknown":true}`} {
		var template BatchModelCapabilityTemplate
		if err := json.Unmarshal([]byte(payload), &template); err == nil {
			t.Fatalf("invalid template JSON accepted: %s", payload)
		}
	}
}

func TestUnifiedBatchMetadataAndDisableDoNotRequireCallingContract(t *testing.T) {
	for _, kind := range []string{"unconfigured", "unavailable protocol", "broken config"} {
		t.Run(kind, func(t *testing.T) {
			svc, db, admin := seedBatchUpdates(t)
			id := "a"
			switch kind {
			case "unconfigured":
				id = "new-model"
				addUnconfiguredBatchModel(t, db, id)
				if err := db.Model(&model.ChannelModel{}).Where("id = ?", id).Update("unit_price_microcredits", 19).Error; err != nil {
					t.Fatal(err)
				}
			case "unavailable protocol":
				if err := db.Model(&model.ChannelModel{}).Where("id = ?", id).Update("protocol", "removed-plugin").Error; err != nil {
					t.Fatal(err)
				}
			case "broken config":
				if err := db.Model(&model.ChannelModel{}).Where("id = ?", id).Update("capability_config_json", "{").Error; err != nil {
					t.Fatal(err)
				}
			}
			before, _ := svc.repo.ChannelModelByID("channel", id)
			changes := BatchChannelModelChanges{DisplayName: batchText("新展示名"), Description: batchText("新备注"), Enabled: batchBool(false), PricingEnabled: batchBool(false)}
			if _, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{batchRequest(t, svc, id, changes)}); err != nil {
				t.Fatal(err)
			}
			after, _ := svc.repo.ChannelModelByID("channel", id)
			if after.Enabled || after.PriceConfigured || after.UnitPriceMicrocredits != before.UnitPriceMicrocredits || after.Protocol != before.Protocol || after.CapabilityConfigJSON != before.CapabilityConfigJSON || after.CapabilityVersion != before.CapabilityVersion || len(after.PriceTiers) != len(before.PriceTiers) {
				t.Fatalf("deactivation changed unrelated fields: %+v", after)
			}
			for i, tier := range after.PriceTiers {
				if tier.Enabled || tier.PriceConfigured != before.PriceTiers[i].PriceConfigured || tier.UnitPriceMicrocredits != before.PriceTiers[i].UnitPriceMicrocredits || !reflect.DeepEqual(tier.CostPricing, before.PriceTiers[i].CostPricing) {
					t.Fatal("deactivation changed prices or costs")
				}
			}
			for _, activate := range []BatchChannelModelChanges{{Enabled: batchBool(true)}, {PricingEnabled: batchBool(true)}} {
				if _, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{batchRequest(t, svc, id, activate)}); err == nil {
					t.Fatal("activation accepted an invalid calling contract")
				}
			}
		})
	}
}

func TestUnifiedBatchProtocolPreservesTypesPricesAndRecordsSelection(t *testing.T) {
	svc, db, admin := seedBatchUpdates(t)
	if err := db.Create(&model.ChannelWebsite{ID: "site", Scope: model.ChannelScopeSystem, Name: "测试网站", BaseURL: "https://example.invalid"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Update("website_id", "site").Error; err != nil {
		t.Fatal(err)
	}
	before, _ := svc.repo.ChannelModelByID("channel", "a")
	changes := BatchChannelModelChanges{Capability: batchText("text"), Protocol: batchText("openai-response")}
	if _, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{batchRequest(t, svc, "a", changes)}); err != nil {
		t.Fatal(err)
	}
	after, _ := svc.repo.ChannelModelByID("channel", "a")
	if after.Protocol != model.ChannelInterfaceOpenAIResponse || after.Capability != before.Capability || after.PriceVersion != before.PriceVersion || after.CapabilityVersion != before.CapabilityVersion+1 || !reflect.DeepEqual(before.PriceTiers, after.PriceTiers) {
		t.Fatalf("protocol-only edit changed prices or type: %+v", after)
	}
	oldConfig, _ := DecodeModelCapabilityConfig(before.CapabilityConfigJSON)
	newConfig, _ := DecodeModelCapabilityConfig(after.CapabilityConfigJSON)
	if newConfig.Text.ContextWindowTokens != oldConfig.Text.ContextWindowTokens || newConfig.Text.References != oldConfig.Text.References {
		t.Fatal("protocol-only edit reset capability settings")
	}
	var selections []model.ChannelProtocolSelection
	if err := db.Find(&selections).Error; err != nil || len(selections) != 1 || selections[0].Protocol != "openai-response" {
		t.Fatalf("selection records: %+v err=%v", selections, err)
	}
	var audit model.AdminAuditEvent
	if err := db.Where("action = ?", "channel_model.batch_update").First(&audit).Error; err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(audit)
	if !strings.Contains(string(encoded), "capability") || !strings.Contains(string(encoded), "protocol") {
		t.Fatal("new contract fields were omitted from audit")
	}
}

func TestUnifiedBatchRejectsContractConflictsAtomically(t *testing.T) {
	for name, changes := range map[string]BatchChannelModelChanges{
		"change existing type": {Capability: batchText("image"), Protocol: batchText("openai-image")},
		"empty type":           {Capability: batchText("")},
		"unknown type":         {Capability: batchText("other")},
		"empty protocol":       {Protocol: batchText("")},
		"unknown protocol":     {Protocol: batchText("missing-protocol")},
		"mismatched protocol":  {Protocol: batchText("openai-image")},
		"template capability conflict": {Protocol: batchText("chat-completion"), CapabilityTemplate: &BatchModelCapabilityTemplate{
			CapabilityConfig: &ModelCapabilityConfig{Version: 1, Image: DefaultImageCapabilityConfig("openai-image", "")},
		}},
	} {
		t.Run(name, func(t *testing.T) {
			svc, _, admin := seedBatchUpdates(t)
			before := groupedProtocolRows(t, svc)
			requests := []BatchChannelModelUpdate{batchRequest(t, svc, "a", BatchChannelModelChanges{Description: batchText("不得写入")}), batchRequest(t, svc, "b", changes)}
			if n, err := svc.BatchUpdateAdminAllChannelModels(admin, requests); err == nil || n != 0 || !strings.Contains(err.Error(), "模型 b") {
				t.Fatalf("n=%d err=%v", n, err)
			}
			if !reflect.DeepEqual(before, groupedProtocolRows(t, svc)) {
				t.Fatal("invalid configuration partially saved")
			}
		})
	}
}

func TestUnifiedBatchTemplatesRepairFinalCombination(t *testing.T) {
	svc, db, admin := seedBatchUpdates(t)
	addUnconfiguredBatchModel(t, db, "new-image")
	config := DefaultModelCapabilityConfig("openai-image")
	config.Image.References.MaxImageBytes = 10 << 20
	changes := BatchChannelModelChanges{Capability: batchText("image"), Protocol: batchText("openai-image"), Enabled: batchBool(true), PricingEnabled: batchBool(true),
		CapabilityTemplate: &BatchModelCapabilityTemplate{CapabilityConfig: config},
		PricingTemplate:    &BatchModelPricingTemplate{PriceCurrency: "credits", PriceTiers: []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", PriceConfigured: true, Enabled: batchBool(true), UnitPriceMicrocredits: 17}}},
	}
	if _, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{batchRequest(t, svc, "new-image", changes)}); err != nil {
		t.Fatal(err)
	}
	item, _ := svc.repo.ChannelModelByID("channel", "new-image")
	actual, err := DecodeModelCapabilityConfig(item.CapabilityConfigJSON)
	if err != nil || actual.Image.References.MaxImageBytes != 10<<20 || !item.Enabled || !item.PriceConfigured || item.PriceTiers[0].UnitPriceMicrocredits != 17 || item.PriceVersion != 2 {
		t.Fatalf("combined setup failed: %+v err=%v", item, err)
	}
	// Repair an old pricing condition and its capability together. The new
	// capability alone is incompatible with the old price; the final pair is valid.
	if err := db.Model(&model.ChannelModelPriceTier{}).Where("channel_model_id = ?", item.ID).Update("selector_json", `{"quality":"high"}`).Error; err != nil {
		t.Fatal(err)
	}
	config.Image.Quality.Supported = false
	for i := range config.Image.Parameters {
		if config.Image.Parameters[i].Name == "quality" {
			config.Image.Parameters[i].Enabled = batchBool(false)
		}
	}
	changes.Capability = nil
	capabilityOnly := changes
	capabilityOnly.PricingTemplate, capabilityOnly.PricingEnabled = nil, nil
	beforeConflict := groupedProtocolRows(t, svc)
	if _, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{batchRequest(t, svc, "a", BatchChannelModelChanges{Description: batchText("不得部分写入")}), batchRequest(t, svc, item.ID, capabilityOnly)}); err == nil || !strings.Contains(err.Error(), "quality") {
		t.Fatal("fixture must reject the new capability with the original quality price condition")
	}
	if !reflect.DeepEqual(beforeConflict, groupedProtocolRows(t, svc)) {
		t.Fatal("capability/price conflict partially wrote the batch")
	}
	if _, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{batchRequest(t, svc, item.ID, changes)}); err != nil {
		t.Fatalf("intermediate old price blocked a valid final configuration: %v", err)
	}
}

func TestUnifiedBatchValidatesLegacyPricesBeforeActivation(t *testing.T) {
	for _, changes := range []BatchChannelModelChanges{{Enabled: batchBool(true)}, {Protocol: batchText("openai-response")}} {
		svc, db, admin := seedBatchUpdates(t)
		if err := db.Where("channel_model_id = ?", "a").Delete(&model.ChannelModelPriceTier{}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Model(&model.ChannelModel{}).Where("id = ?", "a").Updates(map[string]any{"enabled": false, "price_configured": true, "unit_price_microcredits": -1}).Error; err != nil {
			t.Fatal(err)
		}
		before, _ := svc.repo.ChannelModelByID("channel", "a")
		if _, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{batchRequest(t, svc, "a", changes)}); err == nil || !strings.Contains(err.Error(), "金额") {
			t.Fatalf("invalid legacy price accepted: %v", err)
		}
		after, _ := svc.repo.ChannelModelByID("channel", "a")
		if !reflect.DeepEqual(before, after) {
			t.Fatal("failed legacy validation wrote prices or configuration")
		}
		if _, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{batchRequest(t, svc, "a", BatchChannelModelChanges{PricingEnabled: batchBool(false)})}); err != nil {
			t.Fatalf("invalid old price prevented deactivation: %v", err)
		}
	}
}

func TestUnifiedBatchSelectionAndAuditFailuresRollBackInitialization(t *testing.T) {
	for _, table := range []string{"channel_protocol_selections", "admin_audit_events"} {
		t.Run(table, func(t *testing.T) {
			svc, db, admin := seedBatchUpdates(t)
			if err := db.Create(&model.ChannelWebsite{ID: "site", Scope: model.ChannelScopeSystem, Name: "测试网站", BaseURL: "https://example.invalid"}).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Update("website_id", "site").Error; err != nil {
				t.Fatal(err)
			}
			addUnconfiguredBatchModel(t, db, "new-model")
			before, _ := svc.repo.ChannelModelByID("channel", "new-model")
			if err := db.Exec(fmt.Sprintf("CREATE TRIGGER fail_unified BEFORE INSERT ON %s BEGIN SELECT RAISE(ABORT, 'unified rollback'); END", table)).Error; err != nil {
				t.Fatal(err)
			}
			changes := BatchChannelModelChanges{Capability: batchText("text"), Protocol: batchText("chat-completion")}
			if _, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{batchRequest(t, svc, before.ID, changes)}); err == nil || !strings.Contains(err.Error(), "unified rollback") {
				t.Fatalf("injected transaction error not returned: %v", err)
			}
			after, _ := svc.repo.ChannelModelByID("channel", before.ID)
			if !reflect.DeepEqual(before, after) {
				t.Fatal("initialization survived failed audit/selection")
			}
			var count int64
			if err := db.Model(&model.ChannelProtocolSelection{}).Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("selection leaked: %d err=%v", count, err)
			}
		})
	}
}
