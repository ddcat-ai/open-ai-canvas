package app

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func seedBatchUpdates(t *testing.T) (*Service, *gorm.DB, *model.User) {
	t.Helper()
	svc, db, admin := seedBatchProtocolModels(t)
	admin.Username, admin.Email, admin.Status = "batch-admin", "batch@example.invalid", model.UserStatusActive
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	return svc, db, admin
}

func batchRequest(t *testing.T, svc *Service, id string, changes BatchChannelModelChanges) BatchChannelModelUpdate {
	t.Helper()
	items, err := svc.repo.ChannelModelsByIDs([]string{id})
	if err != nil || len(items) != 1 {
		t.Fatalf("read model: %v", err)
	}
	item := items[0]
	return BatchChannelModelUpdate{ModelID: id, PriceVersion: item.PriceVersion, CapabilityVersion: item.CapabilityVersion, UpdatedAt: item.UpdatedAt.Format(time.RFC3339Nano), Changes: changes}
}

func batchBool(value bool) *bool     { return &value }
func batchText(value string) *string { return &value }

func TestBatchModelMetadataPreservesPricingAndIdentity(t *testing.T) {
	svc, db, admin := seedBatchUpdates(t)
	before, _ := svc.repo.ChannelModelByID("channel", "a")
	req := batchRequest(t, svc, "a", BatchChannelModelChanges{DisplayName: batchText(""), Description: batchText("备注"), Enabled: batchBool(false)})
	if n, err := svc.BatchUpdateAdminChannelModels(admin, "channel", []BatchChannelModelUpdate{req}); err != nil || n != 1 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	after, _ := svc.repo.ChannelModelByID("channel", "a")
	if after.DisplayName != "未分类" || after.Description != "备注" || after.Enabled || after.PriceVersion != before.PriceVersion || after.ModelKey != before.ModelKey || after.Protocol != before.Protocol || after.CapabilityConfigJSON != before.CapabilityConfigJSON || !reflect.DeepEqual(after.PriceTiers, before.PriceTiers) {
		t.Fatalf("unexpected sparse update: %+v", after)
	}
	var audits int64
	db.Model(&model.AdminAuditEvent{}).Where("action = ?", "channel_model.batch_update").Count(&audits)
	if audits != 1 {
		t.Fatalf("audit count=%d", audits)
	}
	if _, err := svc.BatchUpdateAdminChannelModels(admin, "channel", []BatchChannelModelUpdate{req}); err == nil {
		t.Fatal("stale timestamp accepted")
	}
}

func TestBatchModelAvailabilityPreservesAmountsAndReenables(t *testing.T) {
	svc, _, admin := seedBatchUpdates(t)
	for _, enabled := range []bool{false, true} {
		req := batchRequest(t, svc, "a", BatchChannelModelChanges{PricingEnabled: &enabled})
		if _, err := svc.BatchUpdateAdminChannelModels(admin, "channel", []BatchChannelModelUpdate{req}); err != nil {
			t.Fatal(err)
		}
		item, _ := svc.repo.ChannelModelByID("channel", "a")
		tier := item.PriceTiers[0]
		if !item.Enabled || tier.Enabled != enabled || !tier.PriceConfigured || tier.UnitPriceMicrocredits != 9 || tier.CostPricing.UnitPriceMicrocredits != 1_000_000 || item.PriceConfigured != enabled {
			t.Fatalf("availability changed other values: %+v", item)
		}
	}
}

func TestBatchModelAvailabilityRoundtripPreservesExplicitZeroPrices(t *testing.T) {
	for _, kind := range []string{"free request", "zero token cache", "legacy free request"} {
		for _, withProtocol := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/protocol=%t", kind, withProtocol), func(t *testing.T) {
				svc, db, admin := seedBatchUpdates(t)
				item, err := svc.repo.ChannelModelByID("channel", "a")
				if err != nil {
					t.Fatal(err)
				}
				tier := item.PriceTiers[0]
				tier.UnitPriceMicrocredits = 0
				if kind == "zero token cache" {
					tier.BillingMode = "token"
					tier.InputTokenPriceMicrocredits, tier.OutputTokenPriceMicrocredits = 11, 22
					tier.CachedTokenPriceMicrocredits, tier.CacheWriteTokenPriceMicrocredits = 0, 0
				}
				if kind == "legacy free request" {
					if err := db.Where("channel_model_id = ?", item.ID).Delete(&model.ChannelModelPriceTier{}).Error; err != nil {
						t.Fatal(err)
					}
					if err := db.Model(&model.ChannelModel{}).Where("id = ?", item.ID).Updates(map[string]any{"price_configured": true, "unit_price_microcredits": 0}).Error; err != nil {
						t.Fatal(err)
					}
				} else if err := db.Save(&tier).Error; err != nil {
					t.Fatal(err)
				}
				changes := BatchChannelModelChanges{PricingEnabled: batchBool(false)}
				if withProtocol {
					changes.Protocol = batchText("openai-response")
				}
				for _, enabled := range []bool{false, true} {
					changes.PricingEnabled = batchBool(enabled)
					if _, err := svc.BatchUpdateAdminChannelModels(admin, "channel", []BatchChannelModelUpdate{batchRequest(t, svc, item.ID, changes)}); err != nil {
						t.Fatalf("availability=%t: %v", enabled, err)
					}
					stored, err := svc.repo.ChannelModelByID("channel", item.ID)
					if err != nil || len(stored.PriceTiers) != 1 {
						t.Fatalf("load saved price tier: %+v err=%v", stored, err)
					}
					actual := stored.PriceTiers[0]
					if actual.Enabled != enabled || !actual.PriceConfigured || stored.PriceConfigured != enabled {
						t.Fatalf("availability=%t lost configured state: %+v", enabled, stored)
					}
					if kind == "legacy free request" {
						if actual.UnitPriceMicrocredits != 0 {
							t.Fatal("legacy free price changed")
						}
					} else {
						actual.Enabled, actual.PriceVersion, actual.UpdatedAt = tier.Enabled, tier.PriceVersion, tier.UpdatedAt
						if !reflect.DeepEqual(actual, tier) {
							t.Fatalf("availability changed price, cost or SKU: before=%+v after=%+v", tier, actual)
						}
					}
				}
			})
		}
	}
}

func TestBatchModelAvailabilityRejectsIncompleteWholeSelection(t *testing.T) {
	for _, token := range []bool{false, true} {
		t.Run(map[bool]string{false: "unconfigured zero", true: "one token amount absent"}[token], func(t *testing.T) {
			svc, db, admin := seedBatchUpdates(t)
			fields := map[string]any{"enabled": false, "price_configured": false, "unit_price_microcredits": 0}
			if token {
				fields["billing_mode"] = "token"
				fields["input_token_price_microcredits"] = 12
				fields["output_token_price_microcredits"] = 13
				fields["cached_token_price_microcredits"] = 14
			}
			if err := db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", "tier-b").Updates(fields).Error; err != nil {
				t.Fatal(err)
			}
			a, _ := svc.repo.ChannelModelByID("channel", "a")
			requests := []BatchChannelModelUpdate{batchRequest(t, svc, "a", BatchChannelModelChanges{Description: batchText("不能写入")}), batchRequest(t, svc, "b", BatchChannelModelChanges{PricingEnabled: batchBool(true)})}
			if n, err := svc.BatchUpdateAdminAllChannelModels(admin, requests); err == nil || n != 0 {
				t.Fatalf("n=%d err=%v", n, err)
			}
			after, _ := svc.repo.ChannelModelByID("channel", "a")
			if !reflect.DeepEqual(a, after) {
				t.Fatal("partial mutation")
			}
		})
	}
}

func TestBatchModelTemplatesComposeBeforeValidation(t *testing.T) {
	svc, db, admin := seedBatchUpdates(t)
	if err := db.Model(&model.ChannelModelPriceTier{}).Where("channel_model_id = ?", "a").Updates(map[string]any{"enabled": false, "price_configured": false, "unit_price_microcredits": 0}).Error; err != nil {
		t.Fatal(err)
	}
	config := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIResponse), "a")
	template := &BatchModelPricingTemplate{PriceCurrency: "USD", PriceTiers: []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", PriceConfigured: true, Enabled: batchBool(true), CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 3}}}}
	changes := BatchChannelModelChanges{DisplayName: batchText("新展示名"), Description: batchText(""), Enabled: batchBool(false), PricingEnabled: batchBool(true), Protocol: batchText("openai-response"), CapabilityTemplate: &BatchModelCapabilityTemplate{CapabilityConfig: config}, PricingTemplate: template}
	if n, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{batchRequest(t, svc, "a", changes)}); err != nil || n != 1 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	item, _ := svc.repo.ChannelModelByID("channel", "a")
	if item.Protocol != model.ChannelInterfaceOpenAIResponse || item.PriceCurrency != "USD" || item.Enabled || !item.PriceConfigured || !item.PriceTiers[0].Enabled || item.PriceTiers[0].UnitPriceMicrocredits != 0 || item.PriceTiers[0].CostPricing.UnitPriceMicrocredits != 3 {
		t.Fatalf("combined result: %+v", item)
	}
}

func TestBatchModelRejectsVersionsOwnershipAndEmptyChanges(t *testing.T) {
	for _, kind := range []string{"priceVersion", "capabilityVersion", "updatedAt", "empty", "duplicate", "private", "wrong group", "ordinary user", "missing"} {
		t.Run(kind, func(t *testing.T) {
			svc, db, admin := seedBatchUpdates(t)
			req := batchRequest(t, svc, "a", BatchChannelModelChanges{Description: batchText("不写")})
			requests := []BatchChannelModelUpdate{req}
			group := "channel"
			switch kind {
			case "priceVersion":
				requests[0].PriceVersion++
			case "capabilityVersion":
				requests[0].CapabilityVersion++
			case "updatedAt":
				requests[0].UpdatedAt = time.Now().Add(-time.Hour).Format(time.RFC3339Nano)
			case "empty":
				requests[0].Changes = BatchChannelModelChanges{}
			case "duplicate":
				requests = append(requests, req)
			case "private":
				db.Model(&model.ModelChannel{}).Where("id = ?", group).Update("scope", model.ChannelScopeUser)
			case "wrong group":
				group = "other"
			case "ordinary user":
				admin = &model.User{ID: "user", Role: model.UserRoleUser}
			case "missing":
				requests[0].ModelID = "missing"
			}
			if n, err := svc.BatchUpdateAdminChannelModels(admin, group, requests); err == nil || n != 0 {
				t.Fatalf("n=%d err=%v", n, err)
			}
			item, _ := svc.repo.ChannelModelByID("channel", "a")
			if item.Description != "" {
				t.Fatal("failed request wrote changes")
			}
		})
	}
}

func TestBatchModelRollsBackCompatibilityAndAuditFailure(t *testing.T) {
	for _, statement := range []string{
		"CREATE TRIGGER fail_sync BEFORE UPDATE OF models_json ON model_channels BEGIN SELECT RAISE(ABORT, 'sync failure'); END",
		"CREATE TRIGGER fail_audit BEFORE INSERT ON admin_audit_events BEGIN SELECT RAISE(ABORT, 'audit failure'); END",
	} {
		t.Run(statement[15:25], func(t *testing.T) {
			svc, db, admin := seedBatchUpdates(t)
			before, _ := svc.repo.ChannelModelByID("channel", "a")
			if err := db.Exec(statement).Error; err != nil {
				t.Fatal(err)
			}
			if _, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{batchRequest(t, svc, "a", BatchChannelModelChanges{Description: batchText("rollback"), PricingEnabled: batchBool(false)})}); err == nil {
				t.Fatal("injected failure accepted")
			}
			after, _ := svc.repo.ChannelModelByID("channel", "a")
			if !reflect.DeepEqual(before, after) {
				t.Fatal("transaction leaked partial updates")
			}
		})
	}
}

func TestBatchModelPricingJSONRequiresExplicitAmountsAndNoSKU(t *testing.T) {
	svc, _, admin := seedBatchUpdates(t)
	base := batchRequest(t, svc, "a", BatchChannelModelChanges{PricingTemplate: &BatchModelPricingTemplate{PriceCurrency: "credits", PriceTiers: []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", Enabled: batchBool(true), PriceConfigured: true}}}})
	encoded, _ := json.Marshal(base)
	var object map[string]any
	if err := json.Unmarshal(encoded, &object); err != nil {
		t.Fatal(err)
	}
	tier := object["changes"].(map[string]any)["pricingTemplate"].(map[string]any)["priceTiers"].([]any)[0].(map[string]any)
	delete(tier, "unitPriceMicrocredits")
	missing, _ := json.Marshal(object)
	for _, bad := range []string{string(missing), strings.Replace(string(encoded), `"providerModelKey":""`, `"providerModelKey":"different-sku"`, 1)} {
		var req BatchChannelModelUpdate
		// Nil slices emitted by an internal Go request are not the frontend wire format.
		bad = strings.ReplaceAll(bad, `"tokenPriceRules":null`, `"tokenPriceRules":[]`)
		bad = strings.ReplaceAll(bad, `"selector":null`, `"selector":{}`)
		if err := json.Unmarshal([]byte(bad), &req); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{req}); err == nil {
			t.Fatal("invalid price template accepted")
		}
	}
}

func TestBatchModelLegacyAvailability(t *testing.T) {
	for _, amount := range []int64{0, 27} {
		t.Run(fmt.Sprint(amount), func(t *testing.T) {
			svc, db, admin := seedBatchUpdates(t)
			if err := db.Where("channel_model_id = ?", "a").Delete(&model.ChannelModelPriceTier{}).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.ChannelModel{}).Where("id = ?", "a").Updates(map[string]any{"price_configured": false, "unit_price_microcredits": amount}).Error; err != nil {
				t.Fatal(err)
			}
			_, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{batchRequest(t, svc, "a", BatchChannelModelChanges{PricingEnabled: batchBool(true)})})
			if amount == 0 {
				if err == nil {
					t.Fatal("legacy missing zero became free")
				}
				var count int64
				db.Model(&model.ChannelModelPriceTier{}).Where("channel_model_id = ?", "a").Count(&count)
				if count != 0 {
					t.Fatal("legacy failed enable leaked default tier")
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				item, _ := svc.repo.ChannelModelByID("channel", "a")
				if len(item.PriceTiers) != 1 || !item.PriceTiers[0].Enabled || item.PriceTiers[0].UnitPriceMicrocredits != amount {
					t.Fatalf("legacy default: %+v", item)
				}
			}
		})
	}
}

func TestBatchModelAvailabilityPreservesAllTokenFields(t *testing.T) {
	svc, db, admin := seedBatchUpdates(t)
	item, _ := svc.repo.ChannelModelByID("channel", "a")
	tier := item.PriceTiers[0]
	tier.BillingMode = "token"
	tier.InputTokenPriceMicrocredits, tier.OutputTokenPriceMicrocredits, tier.CachedTokenPriceMicrocredits, tier.CacheWriteTokenPriceMicrocredits = 11, 22, 33, 44
	tier.ProviderModelKey = "independent-existing-sku"
	tier.TokenPriceRulesEnabled = true
	tier.TokenPriceRules = []model.TokenPriceRule{{Enabled: true, Weekdays: []int{1, 2}, Start: "00:00", End: "12:00", InputTokenPriceMicrocredits: 101, OutputTokenPriceMicrocredits: 202, CachedTokenPriceMicrocredits: 303, CacheWriteTokenPriceMicrocredits: 404}}
	tier.CostPricing = model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 1, InputTokenPriceMicrocredits: 2, OutputTokenPriceMicrocredits: 3, CachedTokenPriceMicrocredits: 4, CacheWriteTokenPriceMicrocredits: 5}
	if err := db.Save(&tier).Error; err != nil {
		t.Fatal(err)
	}
	before, _ := svc.repo.ChannelModelByID("channel", "a")
	for _, enable := range []bool{false, true} {
		if _, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{batchRequest(t, svc, "a", BatchChannelModelChanges{PricingEnabled: &enable})}); err != nil {
			t.Fatal(err)
		}
	}
	after, _ := svc.repo.ChannelModelByID("channel", "a")
	after.PriceTiers[0].PriceVersion = before.PriceTiers[0].PriceVersion
	after.PriceTiers[0].UpdatedAt = before.PriceTiers[0].UpdatedAt
	if !reflect.DeepEqual(before.PriceTiers, after.PriceTiers) {
		t.Fatal("availability roundtrip changed pricing or SKU")
	}
}

func TestBatchModelAcrossSystemChannels(t *testing.T) {
	svc, db, admin := seedBatchUpdates(t)
	if err := db.Create(&model.ModelChannel{ID: "second", Scope: model.ChannelScopeSystem, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "b").Update("channel_id", "second").Error; err != nil {
		t.Fatal(err)
	}
	requests := []BatchChannelModelUpdate{batchRequest(t, svc, "a", BatchChannelModelChanges{Description: batchText("跨组")}), batchRequest(t, svc, "b", BatchChannelModelChanges{Description: batchText("跨组")})}
	if n, err := svc.BatchUpdateAdminAllChannelModels(admin, requests); err != nil || n != 2 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	for channel, id := range map[string]string{"channel": "a", "second": "b"} {
		item, _ := svc.repo.ChannelModelByID(channel, id)
		if item.Description != "跨组" {
			t.Fatal("cross-group update missing")
		}
	}
}

func TestBatchModelJSONRejectsNullUnknownAndMissingVersion(t *testing.T) {
	valid := `{"modelId":"a","priceVersion":1,"capabilityVersion":0,"updatedAt":"2026-11-09T00:00:00Z","changes":{"enabled":false}}`
	for _, bad := range []string{strings.Replace(valid, `"enabled":false`, `"enabled":null`, 1), strings.Replace(valid, `"enabled":false`, `"apiKey":"bad"`, 1), strings.Replace(valid, `"capabilityVersion":0,`, "", 1), strings.Replace(valid, `"changes":{"enabled":false}`, `"changes":null`, 1)} {
		var req BatchChannelModelUpdate
		if err := json.Unmarshal([]byte(bad), &req); err == nil {
			t.Fatal("invalid JSON accepted")
		}
	}
	for _, config := range []string{`{"version":null}`, `{"version":1,"text":{"contextWindowTokens":null}}`} {
		var template BatchModelCapabilityTemplate
		if err := json.Unmarshal([]byte(`{"protocol":"chat-completion","capabilityConfig":`+config+`}`), &template); err == nil {
			t.Fatal("null capability scalar accepted")
		}
	}
}

func TestBatchModelRejectsTemplateConflictsAndOversizedSelection(t *testing.T) {
	svc, _, admin := seedBatchUpdates(t)
	base := batchRequest(t, svc, "a", BatchChannelModelChanges{Description: batchText("test")})
	if _, err := svc.BatchUpdateAdminAllChannelModels(admin, make([]BatchChannelModelUpdate, 101)); err == nil {
		t.Fatal("oversized selection accepted")
	}
	for _, changes := range []BatchChannelModelChanges{
		{CapabilityTemplate: &BatchModelCapabilityTemplate{CapabilityConfig: &ModelCapabilityConfig{Version: 1, Image: DefaultImageCapabilityConfig("openai-image", "a")}}},
		{PricingTemplate: &BatchModelPricingTemplate{PriceCurrency: "credits", PriceTiers: []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", Enabled: batchBool(true), PriceConfigured: true}, {BillingMode: "fixed_request", Enabled: batchBool(true), PriceConfigured: true}}}},
		{PricingTemplate: &BatchModelPricingTemplate{PriceCurrency: "credits", PriceTiers: []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", UnitPriceMicrocredits: -1, Enabled: batchBool(true), PriceConfigured: true}}}},
		{PricingTemplate: &BatchModelPricingTemplate{PriceCurrency: "credits", PriceTiers: []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", Selector: map[string]string{"operation": "video_to_video"}, Enabled: batchBool(true), PriceConfigured: true}}}},
	} {
		base.Changes = changes
		if _, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{base}); err == nil {
			t.Fatal("incompatible template accepted")
		}
	}
	// Equally specific selectors that can both match must not rely on row order.
	config := &ModelCapabilityConfig{Image: &ImageCapabilityConfig{References: ImageReferenceConfig{MaxImages: 1}, Resolution: ImageResolutionConfig{Supported: true, Values: []string{"1k"}}, Quality: ImageQualityConfig{Supported: true, Values: []string{"high"}}}}
	item := model.ChannelModel{Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, PriceTiers: []model.ChannelModelPriceTier{{BillingMode: "fixed_request", Resolution: "*", Selector: map[string]string{"quality": "high"}}, {BillingMode: "fixed_request", Resolution: "*", Selector: map[string]string{"imageResolution": "1k"}}}}
	if err := validateBatchFinalPrices(item, config); err == nil || !strings.Contains(err.Error(), "重叠") {
		t.Fatalf("overlap err=%v", err)
	}
}

func TestBatchModelWildcardKeepsDistinctPriorities(t *testing.T) {
	svc, _, admin := seedBatchUpdates(t)
	changes := BatchChannelModelChanges{PricingTemplate: &BatchModelPricingTemplate{PriceCurrency: "credits", PriceTiers: []ChannelModelPriceTierRequest{
		{Selector: map[string]string{"operation": "*"}, BillingMode: "fixed_request", PriceConfigured: true, Enabled: batchBool(true), UnitPriceMicrocredits: 10},
		{Selector: map[string]string{"operation": "text_generation"}, BillingMode: "fixed_request", PriceConfigured: true, Enabled: batchBool(true), UnitPriceMicrocredits: 20},
	}}}
	if n, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{batchRequest(t, svc, "a", changes)}); err != nil || n != 1 {
		t.Fatalf("default and specific tiers should coexist: n=%d err=%v", n, err)
	}
}
