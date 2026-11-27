package app

import (
	"reflect"
	"testing"
)

func TestBatchUpdateChannelLabelKeepsPricesAndSupportsClear(t *testing.T) {
	svc, _, admin := seedBatchUpdates(t)
	before, err := svc.repo.ChannelModelByID("channel", "a")
	if err != nil {
		t.Fatal(err)
	}
	req := batchRequest(t, svc, "a", BatchChannelModelChanges{ChannelLabel: batchText("  精简渠道  ")})
	if n, err := svc.BatchUpdateAdminChannelModels(admin, "channel", []BatchChannelModelUpdate{req}); err != nil || n != 1 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	after, err := svc.repo.ChannelModelByID("channel", "a")
	if err != nil {
		t.Fatal(err)
	}
	if after.ChannelLabel != "精简渠道" || after.ModelKey != before.ModelKey || after.PriceVersion != before.PriceVersion || !reflect.DeepEqual(after.PriceTiers, before.PriceTiers) {
		t.Fatalf("label update changed other fields: %+v", after)
	}
	req = batchRequest(t, svc, "a", BatchChannelModelChanges{ChannelLabel: batchText(before.ProviderModelKey)})
	if _, err := svc.BatchUpdateAdminChannelModels(admin, "channel", []BatchChannelModelUpdate{req}); err != nil {
		t.Fatal(err)
	}
	after, _ = svc.repo.ChannelModelByID("channel", "a")
	if after.ChannelLabel != "" {
		t.Fatalf("provider key label should clear, got %q", after.ChannelLabel)
	}
}

func TestAdminChannelModelCostsProjectsCostPricing(t *testing.T) {
	svc, _, admin := seedBatchUpdates(t)
	models, err := svc.AdminChannelModelCosts(admin)
	if err != nil {
		t.Fatal(err)
	}
	var found *AdminChannelModelCost
	for i := range models {
		if models[i].ID == "a" {
			found = &models[i]
		}
	}
	if found == nil || len(found.PriceTiers) != 1 {
		t.Fatalf("unexpected models: %+v", models)
	}
	tier := found.PriceTiers[0]
	if !tier.CostPricing.Configured || tier.CostPricing.UnitPriceMicrocredits != 1_000_000 {
		t.Fatalf("cost pricing not projected: %+v", tier.CostPricing)
	}
	if tier.UnitPriceMicrocredits != 9 {
		t.Fatalf("sale price not projected: %+v", tier)
	}
}

func TestUpdateAdminChannelModelLabelKeepsPricesAndVersions(t *testing.T) {
	svc, _, admin := seedBatchUpdates(t)
	before, err := svc.repo.ChannelModelByID("channel", "a")
	if err != nil {
		t.Fatal(err)
	}
	after, err := svc.UpdateAdminChannelModelLabel(admin, "channel", "a", AdminChannelModelLabelRequest{ChannelLabel: "  新渠道  ", DisplayName: batchText("新展示名")})
	if err != nil {
		t.Fatal(err)
	}
	if after.ChannelLabel != "新渠道" || after.DisplayName != "新展示名" {
		t.Fatalf("label not updated: %+v", after)
	}
	if after.PriceVersion != before.PriceVersion || after.CapabilityVersion != before.CapabilityVersion || !reflect.DeepEqual(after.PriceTiers, before.PriceTiers) {
		t.Fatalf("label update changed pricing or capability: %+v", after)
	}
	op, err := assistantOperation("UpdateAdminChannelModelLabel")
	if err != nil || !op.Write || op.HighRisk {
		t.Fatalf("label operation must be a non-high-risk write: %+v %v", op, err)
	}
}
