package app

import (
	"os"
	"testing"
	"yingce/backend/internal/model"
	"yingce/backend/internal/providercatalog"
)

func TestMetasoCatalogBuild(t *testing.T) {
	body, err := os.ReadFile("../../../scripts/provider-catalog/catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	catalog, warnings, err := providercatalog.Parse(body, providercatalog.DefaultLogoBase)
	if err != nil || len(warnings) > 0 || len(catalog.Providers) != 1 {
		t.Fatalf("parse: %v, %v", err, warnings)
	}
	svc, _ := newChannelModelTestService(t)
	entry := catalog.Providers[0].Models[0]
	item, tiers, err := svc.buildCatalogChannelModel(&model.ModelChannel{ID: "test"}, entry, 3000, 0)
	if err != nil {
		t.Fatal(err)
	}
	if item.ChannelLabel != "MiniMax-H3" || len(item.Tags) != 2 || item.Icon != "minimax" {
		t.Fatalf("metadata: %#v", item)
	}
	if len(tiers) != 3 {
		t.Fatalf("tiers: %d", len(tiers))
	}
	for i, cost := range []int64{75000, 90000, 180000} {
		if tiers[i].CostPricing.UnitPriceMicrocredits != cost || tiers[i].BillingMode != "per_second" {
			t.Fatalf("tier: %#v", tiers[i])
		}
	}
}

func TestMetasoSeedanceCatalogBuild(t *testing.T) {
	body, err := os.ReadFile("../../../scripts/provider-catalog/catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	catalog, warnings, err := providercatalog.Parse(body, providercatalog.DefaultLogoBase)
	if err != nil || len(warnings) > 0 || len(catalog.Providers) != 1 {
		t.Fatalf("parse: %v %v", err, warnings)
	}
	if len(catalog.Providers[0].Models) != 3 {
		t.Fatalf("models = %d, want 3", len(catalog.Providers[0].Models))
	}
	svc, _ := newChannelModelTestService(t)
	for _, entry := range catalog.Providers[0].Models[1:] {
		item, tiers, err := svc.buildCatalogChannelModel(&model.ModelChannel{ID: "test"}, entry, 3000, 0)
		if err != nil {
			t.Fatal(err)
		}
		want := []int64{140000, 310000}
		refs := []int64{90000, 190000}
		if entry.ModelKey == "seedance-2.0" {
			want = []int64{450000, 960000, 2390000, 4870000}
			refs = []int64{270000, 580000, 1460000, 3000000}
		}
		if !item.ReferenceVideoBilling || item.DisplayName != "Seedance" || len(tiers) != len(want) {
			t.Fatalf("model = %#v, tiers %d", item, len(tiers))
		}
		for i, tier := range tiers {
			if tier.CostPricing.UnitPriceMicrocredits != want[i] || tier.CostPricing.ReferenceVideoUnitPriceMicrocredits != refs[i] || tier.ReferenceVideoUnitPriceMicrocredits != providercatalog.ApplyMarkup(refs[i], 3000) {
				t.Fatalf("tier %d = %#v", i, tier)
			}
		}
	}
}
