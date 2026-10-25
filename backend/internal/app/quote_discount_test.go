package app

import (
	"testing"
	"yingce/backend/internal/model"
)

func TestQuoteOriginalPriceUsesSameUsageWithoutReverseRounding(t *testing.T) {
	for _, tc := range []struct {
		mode                     string
		unit, quantity, original int64
	}{
		{"fixed_request", 1, 1, 1},
		{"fixed_request", 10000000, 4, 40000000},
		{"per_second", 300000, 5, 1500000},
	} {
		amount, err := creditAmount(tc.unit, tc.quantity, 8000)
		if err != nil {
			t.Fatal(err)
		}
		order := &model.BillingOrder{BillingMode: tc.mode, UnitPriceMicrocredits: tc.unit, Quantity: tc.quantity, MultiplierBasisPoints: 8000, AmountMicrocredits: amount}
		order.MultiplierSource = "user"
		order.OfficialPricing = model.OfficialPricing{Configured: true, UnitPriceMicrocredits: tc.unit}
		quote := quoteFromOrder("", order, tokenBillingEstimate{})
		if quote.OriginalAmountMicrocredits == nil || *quote.OriginalAmountMicrocredits != tc.original || quote.AmountMicrocredits != amount || quote.MultiplierSource != "user" {
			t.Fatalf("unexpected quote: %+v", quote)
		}
		if order.AmountMicrocredits != amount || order.MultiplierBasisPoints != 8000 {
			t.Fatal("quote changed billing order")
		}
	}
}

func TestQuoteOriginalTokenPriceKeepsEstimate(t *testing.T) {
	order := &model.BillingOrder{BillingMode: "token", InputTokenPriceMicrocredits: 1000000, OutputTokenPriceMicrocredits: 2000000, MultiplierBasisPoints: 5000, AmountMicrocredits: 250000}
	order.OfficialPricing = model.OfficialPricing{Configured: true, InputTokenPriceMicrocredits: 1000000, OutputTokenPriceMicrocredits: 2000000}
	quote := quoteFromOrder("", order, tokenBillingEstimate{InputTokens: 100000, OutputTokens: 200000})
	if !quote.Estimated || quote.OriginalAmountMicrocredits == nil || *quote.OriginalAmountMicrocredits != 500000 || quote.AmountMicrocredits != 250000 {
		t.Fatalf("unexpected token quote: %+v", quote)
	}
}
