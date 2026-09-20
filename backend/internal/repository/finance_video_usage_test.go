package repository

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestVideoTokenUsageAmountIgnoresTextCharges(t *testing.T) {
	order := model.BillingOrder{
		Capability: "video", InputTokenPriceMicrocredits: 30_000_000,
		OutputTokenPriceMicrocredits: 16_000_000, CachedTokenPriceMicrocredits: 20_000_000,
		MultiplierBasisPoints: 10_000,
	}
	usage := &BillingUsage{InputTokens: 1000, OutputTokens: 108900, CachedTokens: 200}
	amount, err := tokenUsageAmount(order, usage)
	if err != nil || amount != 1_742_400 {
		t.Fatalf("video settlement = %d, %v, want 1742400", amount, err)
	}
	if usage.InputTokens != 1000 || usage.CachedTokens != 200 {
		t.Fatalf("settlement mutated observed usage: %#v", usage)
	}
}

func TestVideoTokenUsageAmountRejectsInvalidUsage(t *testing.T) {
	order := model.BillingOrder{Capability: "video", OutputTokenPriceMicrocredits: 16_000_000, MultiplierBasisPoints: 10_000}
	for _, test := range []struct {
		name  string
		usage *BillingUsage
	}{
		{name: "missing"},
		{name: "zero output", usage: &BillingUsage{}},
		{name: "negative output", usage: &BillingUsage{OutputTokens: -1}},
		{name: "negative input", usage: &BillingUsage{InputTokens: -1, OutputTokens: 108900}},
		{name: "negative cached", usage: &BillingUsage{CachedTokens: -1, OutputTokens: 108900}},
		{name: "overflow", usage: &BillingUsage{OutputTokens: 1<<63 - 1}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if amount, err := tokenUsageAmount(order, test.usage); err == nil {
				t.Fatalf("invalid usage settled to %d", amount)
			}
		})
	}
}

func TestTextTokenUsageAmountPreservesInputOutputAndCachePrices(t *testing.T) {
	amount, err := tokenUsageAmount(model.BillingOrder{
		Capability: "text", InputTokenPriceMicrocredits: 2_000_000,
		OutputTokenPriceMicrocredits: 5_000_000, CachedTokenPriceMicrocredits: 1_000_000,
		MultiplierBasisPoints: 10_000,
	}, &BillingUsage{InputTokens: 100, OutputTokens: 20, CachedTokens: 40})
	if err != nil || amount != 260 {
		t.Fatalf("text settlement = %d, %v, want 260", amount, err)
	}
}
