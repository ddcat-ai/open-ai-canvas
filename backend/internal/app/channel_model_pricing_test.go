package app

import (
	"errors"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

func seedRepricingModels(t *testing.T) (*Service, *gorm.DB, *model.User) {
	t.Helper()
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	if err := db.Create(&model.ModelChannel{ID: "channel", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"a", "b"} {
		item := model.ChannelModel{ID: id, ChannelID: "channel", ModelKey: id, DisplayName: id, Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, BillingMode: "fixed_request", Enabled: true, PriceConfigured: true, PriceVersion: 1, UnitPriceMicrocredits: 9}
		tier := model.ChannelModelPriceTier{ID: "tier-" + id, ChannelModelID: id, SelectorKey: "{}", SelectorJSON: "{}", Resolution: "*", BillingMode: "fixed_request", Enabled: true, PriceConfigured: true, PriceVersion: 1, UnitPriceMicrocredits: 9, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 1_000_000}}
		if err := db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&tier).Error; err != nil {
			t.Fatal(err)
		}
	}
	return svc, db, admin
}

func repricingRequest(id string, price int64) ChannelModelRepriceRequest {
	return ChannelModelRepriceRequest{ModelID: id, PriceVersion: 1, PriceTiers: []ChannelModelTierRepriceRequest{{ID: "tier-" + id, PriceVersion: 1, Prices: map[string]*int64{"unitPriceMicrocredits": &price}}}}
}

func TestRepriceAdminChannelModelsPreservesFinalManualPrices(t *testing.T) {
	svc, db, admin := seedRepricingModels(t)
	disabled := model.ChannelModelPriceTier{ID: "disabled", ChannelModelID: "a", SelectorKey: `{"quality":"high"}`, Enabled: false, UnitPriceMicrocredits: 99, PriceVersion: 7}
	if err := db.Create(&disabled).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "b").Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	requests := []ChannelModelRepriceRequest{repricingRequest("a", 1_250_000), repricingRequest("b", 1_370_000)}
	updated, err := svc.RepriceAdminChannelModels(admin, "channel", requests)
	if err != nil || updated != 2 {
		t.Fatalf("updated=%d err=%v", updated, err)
	}
	for _, request := range requests {
		item, err := svc.repo.ChannelModelByID("channel", request.ModelID)
		if err != nil {
			t.Fatal(err)
		}
		want := *request.PriceTiers[0].Prices["unitPriceMicrocredits"]
		if item.UnitPriceMicrocredits != want || item.PriceVersion != 2 || item.Enabled != (item.ID == "a") {
			t.Fatalf("model=%+v", item)
		}
		for _, tier := range item.PriceTiers {
			if tier.ID == "disabled" {
				if tier.UnitPriceMicrocredits != 99 || tier.PriceVersion != 7 || tier.Enabled {
					t.Fatalf("disabled=%+v", tier)
				}
			} else if tier.UnitPriceMicrocredits != want || tier.PriceVersion != 2 || tier.CostPricing.UnitPriceMicrocredits != 1_000_000 {
				t.Fatalf("tier=%+v", tier)
			}
		}
	}
	if _, err := svc.RepriceAdminChannelModels(admin, "channel", requests); err == nil {
		t.Fatal("stale preview accepted")
	}
}

func TestRepriceAdminChannelModelsMultipleSpecifications(t *testing.T) {
	svc, db, admin := seedRepricingModels(t)
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "a").Updates(map[string]any{
		"capability": "image", "protocol": model.ChannelInterfaceOpenAIImage,
	}).Error; err != nil {
		t.Fatal(err)
	}
	request := repricingRequest("a", 4_000)
	for _, spec := range []struct {
		id    string
		price int64
	}{{"2K", 5_500}, {"4K", 6_000}} {
		tier := model.ChannelModelPriceTier{ID: spec.id, ChannelModelID: "a", SelectorKey: `{"vquality":"` + spec.id + `"}`,
			SelectorJSON: `{"vquality":"` + spec.id + `"}`, Resolution: spec.id, BillingMode: "fixed_request",
			Enabled: true, PriceConfigured: true, PriceVersion: 1, UnitPriceMicrocredits: 9,
			CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 3_000}}
		if err := db.Create(&tier).Error; err != nil {
			t.Fatal(err)
		}
		request.PriceTiers = append(request.PriceTiers, ChannelModelTierRepriceRequest{ID: spec.id, PriceVersion: 1,
			Prices: map[string]*int64{"unitPriceMicrocredits": &spec.price}})
	}
	if updated, err := svc.RepriceAdminChannelModels(admin, "channel", []ChannelModelRepriceRequest{request}); err != nil || updated != 1 {
		t.Fatalf("updated=%d err=%v", updated, err)
	}
	for _, input := range request.PriceTiers {
		var tier model.ChannelModelPriceTier
		if err := db.First(&tier, "id = ?", input.ID).Error; err != nil {
			t.Fatal(err)
		}
		if tier.UnitPriceMicrocredits != *input.Prices["unitPriceMicrocredits"] || tier.PriceVersion != 2 {
			t.Fatalf("specification price was not saved independently: %+v", tier)
		}
	}
}

func TestRepriceAdminChannelModelsRejectsWholeBatch(t *testing.T) {
	for _, tt := range []struct {
		name     string
		edit     func([]ChannelModelRepriceRequest) []ChannelModelRepriceRequest
		mutate   func(*gorm.DB) error
		nonAdmin bool
	}{
		{name: "empty", edit: func(_ []ChannelModelRepriceRequest) []ChannelModelRepriceRequest { return nil }},
		{name: "too many", edit: func(_ []ChannelModelRepriceRequest) []ChannelModelRepriceRequest {
			return make([]ChannelModelRepriceRequest, 101)
		}},
		{name: "duplicate model", edit: func(r []ChannelModelRepriceRequest) []ChannelModelRepriceRequest { return append(r, r[0]) }},
		{name: "empty ID", edit: func(r []ChannelModelRepriceRequest) []ChannelModelRepriceRequest { r[1].ModelID = ""; return r }},
		{name: "stale model", edit: func(r []ChannelModelRepriceRequest) []ChannelModelRepriceRequest { r[1].PriceVersion = 2; return r }},
		{name: "stale tier", edit: func(r []ChannelModelRepriceRequest) []ChannelModelRepriceRequest {
			r[1].PriceTiers[0].PriceVersion = 2
			return r
		}},
		{name: "missing tier", edit: func(r []ChannelModelRepriceRequest) []ChannelModelRepriceRequest { r[1].PriceTiers = nil; return r }},
		{name: "wrong tier owner", edit: func(r []ChannelModelRepriceRequest) []ChannelModelRepriceRequest {
			r[1].PriceTiers[0].ID = "tier-a"
			return r
		}},
		{name: "duplicate tier", edit: func(r []ChannelModelRepriceRequest) []ChannelModelRepriceRequest {
			r[1].PriceTiers = append(r[1].PriceTiers, r[1].PriceTiers[0])
			return r
		}},
		{name: "negative price", edit: func(r []ChannelModelRepriceRequest) []ChannelModelRepriceRequest {
			r[1] = repricingRequest("b", -1)
			return r
		}},
		{name: "missing price", edit: func(r []ChannelModelRepriceRequest) []ChannelModelRepriceRequest {
			r[1].PriceTiers[0].Prices = nil
			return r
		}},
		{name: "null price", edit: func(r []ChannelModelRepriceRequest) []ChannelModelRepriceRequest {
			r[1].PriceTiers[0].Prices["unitPriceMicrocredits"] = nil
			return r
		}},
		{name: "unknown field", edit: func(r []ChannelModelRepriceRequest) []ChannelModelRepriceRequest {
			r[1].PriceTiers[0].Prices["enabled"] = nil
			return r
		}},
		{name: "unsafe price", edit: func(r []ChannelModelRepriceRequest) []ChannelModelRepriceRequest {
			r[1] = repricingRequest("b", 9_007_199_254_740_992)
			return r
		}},
		{name: "missing cost", mutate: func(db *gorm.DB) error {
			return db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", "tier-b").Update("cost_configured", false).Error
		}},
		{name: "disabled tier", mutate: func(db *gorm.DB) error {
			return db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", "tier-b").Update("enabled", false).Error
		}},
		{name: "cross channel", mutate: func(db *gorm.DB) error {
			return db.Model(&model.ChannelModel{}).Where("id = ?", "b").Update("channel_id", "other").Error
		}},
		{name: "deleted", mutate: func(db *gorm.DB) error { return db.Delete(&model.ChannelModel{}, "id = ?", "b").Error }},
		{name: "not admin", nonAdmin: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			svc, db, actor := seedRepricingModels(t)
			requests := []ChannelModelRepriceRequest{repricingRequest("a", 1_250_000), repricingRequest("b", 1_370_000)}
			if tt.edit != nil {
				requests = tt.edit(requests)
			}
			if tt.mutate != nil {
				if err := tt.mutate(db); err != nil {
					t.Fatal(err)
				}
			}
			if tt.nonAdmin {
				actor = &model.User{ID: "user"}
			}
			if count, err := svc.RepriceAdminChannelModels(actor, "channel", requests); err == nil || count != 0 {
				t.Fatalf("count=%d err=%v", count, err)
			}
			item, err := svc.repo.ChannelModelByID("channel", "a")
			if err != nil {
				t.Fatal(err)
			}
			if item.PriceVersion != 1 || item.PriceTiers[0].UnitPriceMicrocredits != 9 {
				t.Fatal("partial save")
			}
		})
	}
}

func TestRepriceTierFieldValidation(t *testing.T) {
	for _, capability := range []string{"text", "video"} {
		output, input, zero := int64(1_370_000), int64(500_000), int64(0)
		tier := model.ChannelModelPriceTier{ID: "t", BillingMode: "token", PriceConfigured: true, CostPricing: model.CreditCostPricing{Configured: true}}
		prices := map[string]*int64{"outputTokenPriceMicrocredits": &output}
		protocol := model.ChannelInterfaceVolcengineArkVideo
		if capability == "text" {
			protocol = model.ChannelInterfaceChatCompletion
			prices["inputTokenPriceMicrocredits"] = &input
			prices["cachedTokenPriceMicrocredits"] = &zero
		}
		if err := applyChannelModelTierPrices(&tier, capability, protocol, prices); err != nil {
			t.Fatal(err)
		}
		if tier.OutputTokenPriceMicrocredits != output || tier.CachedTokenPriceMicrocredits != 0 {
			t.Fatalf("tier=%+v", tier)
		}
		output = 1_000_000_000_001
		if err := applyChannelModelTierPrices(&tier, capability, protocol, prices); err == nil {
			t.Fatal("token price limit missing")
		}
	}
}

func TestBatchRepricingRollsBackOnConcurrentChange(t *testing.T) {
	for _, target := range []string{"model", "tier"} {
		t.Run(target, func(t *testing.T) {
			svc, db, _ := seedRepricingModels(t)
			items := make([]model.ChannelModel, 0, 2)
			for _, id := range []string{"a", "b"} {
				item, err := svc.repo.ChannelModelByID("channel", id)
				if err != nil {
					t.Fatal(err)
				}
				item.UnitPriceMicrocredits = 123
				item.PriceTiers[0].UnitPriceMicrocredits = 123
				items = append(items, *item)
			}
			var err error
			if target == "model" {
				err = db.Model(&model.ChannelModel{}).Where("id = ?", "b").Update("price_version", 2).Error
			} else {
				err = db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", "tier-b").Update("price_version", 2).Error
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := svc.repo.UpdateChannelModelSalePrices("channel", items); !errors.Is(err, repository.ErrChannelModelPriceConflict) {
				t.Fatalf("error=%v", err)
			}
			item, err := svc.repo.ChannelModelByID("channel", "a")
			if err != nil {
				t.Fatal(err)
			}
			if item.UnitPriceMicrocredits != 9 || item.PriceVersion != 1 || item.PriceTiers[0].UnitPriceMicrocredits != 9 || item.PriceTiers[0].PriceVersion != 1 {
				t.Fatal("transaction not rolled back")
			}
		})
	}
}
