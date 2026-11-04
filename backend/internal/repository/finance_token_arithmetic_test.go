package repository

import (
	"math"
	"testing"

	"yingce/backend/internal/model"
)

func TestTokenUsageAmountUsesExactArithmetic(t *testing.T) {
	for _, test := range []struct {
		name  string
		order model.BillingOrder
		usage BillingUsage
		want  int64
	}{
		{
			name: "video maximum price with multiplier ignores text charges",
			order: model.BillingOrder{
				Capability: "video", MultiplierBasisPoints: 12_500,
				InputTokenPriceMicrocredits: 1_000_000_000_000, OutputTokenPriceMicrocredits: 1_000_000_000_000,
				CachedTokenPriceMicrocredits: 1_000_000_000_000,
			},
			usage: BillingUsage{InputTokens: math.MaxInt64, OutputTokens: 10_000_000, CachedTokens: math.MaxInt64},
			want:  12_500_000_000_000,
		},
		{
			name: "text subtracts cache and preserves distinct prices",
			order: model.BillingOrder{
				Capability: "text", MultiplierBasisPoints: 12_500,
				InputTokenPriceMicrocredits: 500_000_000_000, OutputTokenPriceMicrocredits: 1_000_000_000_000,
				CachedTokenPriceMicrocredits: 100_000_000_000,
			},
			usage: BillingUsage{InputTokens: 20_000_000, OutputTokens: 10_000_000, CachedTokens: 5_000_000},
			want:  22_500_000_000_000,
		},
		{
			// InputTokens 含缓存命中和缓存写入，两者都从普通输入中扣出后按各自单价计费。
			name: "text bills cache writes at their own price",
			order: model.BillingOrder{
				Capability: "text", MultiplierBasisPoints: 10_000,
				InputTokenPriceMicrocredits: 1_000_000, OutputTokenPriceMicrocredits: 2_000_000,
				CachedTokenPriceMicrocredits: 100_000, CacheWriteTokenPriceMicrocredits: 1_250_000,
			},
			usage: BillingUsage{InputTokens: 3_000_000, OutputTokens: 1_000_000, CachedTokens: 1_000_000, CacheWriteTokens: 1_000_000},
			want:  4_350_000,
		},
		{
			name: "default zero cache write price leaves writes uncharged",
			order: model.BillingOrder{
				Capability: "text", MultiplierBasisPoints: 10_000,
				InputTokenPriceMicrocredits: 1_000_000, OutputTokenPriceMicrocredits: 2_000_000, CachedTokenPriceMicrocredits: 100_000,
			},
			usage: BillingUsage{InputTokens: 3_000_000, OutputTokens: 1_000_000, CachedTokens: 1_000_000, CacheWriteTokens: 1_000_000},
			want:  3_100_000,
		},
		{
			name: "round once after all text charges",
			order: model.BillingOrder{
				Capability: "text", MultiplierBasisPoints: 10_000,
				InputTokenPriceMicrocredits: 400_000, OutputTokenPriceMicrocredits: 400_000, CachedTokenPriceMicrocredits: 100_000,
			},
			usage: BillingUsage{InputTokens: 2, OutputTokens: 1, CachedTokens: 1},
			want:  1,
		},
		{
			name:  "maximum final amount",
			order: model.BillingOrder{Capability: "video", MultiplierBasisPoints: 10_000, OutputTokenPriceMicrocredits: 1_000_000},
			usage: BillingUsage{OutputTokens: math.MaxInt64}, want: math.MaxInt64,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			amount, err := tokenUsageAmount(test.order, &test.usage)
			if err != nil || amount != test.want {
				t.Fatalf("tokenUsageAmount() = %d, %v; want %d", amount, err, test.want)
			}
		})
	}
}

func TestTokenUsageAmountRejectsInvalidArithmetic(t *testing.T) {
	for _, test := range []struct {
		name  string
		order model.BillingOrder
		usage BillingUsage
	}{
		{
			name:  "negative output price",
			order: model.BillingOrder{Capability: "video", MultiplierBasisPoints: 10_000, OutputTokenPriceMicrocredits: -1},
			usage: BillingUsage{OutputTokens: 1},
		},
		{
			name:  "negative unused text cache price",
			order: model.BillingOrder{Capability: "text", MultiplierBasisPoints: 10_000, CachedTokenPriceMicrocredits: -1},
			usage: BillingUsage{OutputTokens: 1},
		},
		{
			name:  "negative cache write usage",
			order: model.BillingOrder{Capability: "text", MultiplierBasisPoints: 10_000, CacheWriteTokenPriceMicrocredits: 1},
			usage: BillingUsage{OutputTokens: 1, CacheWriteTokens: -1},
		},
		{
			name:  "zero multiplier",
			order: model.BillingOrder{Capability: "video", OutputTokenPriceMicrocredits: 1},
			usage: BillingUsage{OutputTokens: 1},
		},
		{
			name:  "final overflow",
			order: model.BillingOrder{Capability: "video", MultiplierBasisPoints: 10_001, OutputTokenPriceMicrocredits: 1_000_000},
			usage: BillingUsage{OutputTokens: math.MaxInt64},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			if amount, err := tokenUsageAmount(test.order, &test.usage); amount != 0 || err == nil {
				t.Fatalf("invalid usage billed %d, %v", amount, err)
			}
		})
	}
}
