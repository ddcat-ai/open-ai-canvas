package kernel

import (
	"errors"
	"math"
	"testing"
)

func TestTokenBillingAmount(t *testing.T) {
	for _, test := range []struct {
		name       string
		multiplier int64
		terms      []TokenBillingTerm
		want       int64
	}{
		{
			name: "maximum configured price", multiplier: 10_000,
			terms: []TokenBillingTerm{{Tokens: 10_000_000, PriceMicrocredits: 1_000_000_000_000}},
			want:  10_000_000_000_000,
		},
		{
			name: "maximum configured price with multiplier", multiplier: 12_500,
			terms: []TokenBillingTerm{{Tokens: 10_000_000, PriceMicrocredits: 1_000_000_000_000}},
			want:  12_500_000_000_000,
		},
		{
			name: "round once after combining terms", multiplier: 10_000,
			terms: []TokenBillingTerm{{Tokens: 1, PriceMicrocredits: 400_000}, {Tokens: 1, PriceMicrocredits: 400_000}, {Tokens: 1, PriceMicrocredits: 100_000}},
			want:  1,
		},
		{
			name: "apply multiplier before rounding", multiplier: 12_500,
			terms: []TokenBillingTerm{{Tokens: 1, PriceMicrocredits: 400_000}, {Tokens: 1, PriceMicrocredits: 400_000}},
			want:  1,
		},
		{
			name: "fractional microcredit rounds up", multiplier: 1,
			terms: []TokenBillingTerm{{Tokens: 1, PriceMicrocredits: 1}},
			want:  1,
		},
		{
			name: "maximum int64 result after overflowing intermediate sum", multiplier: 10_000,
			terms: []TokenBillingTerm{{Tokens: math.MaxInt64, PriceMicrocredits: 500_000}, {Tokens: math.MaxInt64, PriceMicrocredits: 500_000}},
			want:  math.MaxInt64,
		},
		{
			name: "free usage", multiplier: math.MaxInt64,
			terms: []TokenBillingTerm{{Tokens: math.MaxInt64, PriceMicrocredits: 0}},
			want:  0,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			amount, err := TokenBillingAmount(test.multiplier, test.terms...)
			if err != nil || amount != test.want {
				t.Fatalf("TokenBillingAmount() = %d, %v; want %d", amount, err, test.want)
			}
		})
	}
}

func TestTokenBillingAmountRejectsInvalidParametersAndFinalOverflow(t *testing.T) {
	for _, test := range []struct {
		name       string
		multiplier int64
		terms      []TokenBillingTerm
		wantErr    error
	}{
		{name: "zero multiplier", terms: []TokenBillingTerm{{Tokens: 1, PriceMicrocredits: 1}}, wantErr: ErrInvalidTokenBilling},
		{name: "negative multiplier", multiplier: -1, wantErr: ErrInvalidTokenBilling},
		{name: "negative tokens", multiplier: 10_000, terms: []TokenBillingTerm{{Tokens: -1}}, wantErr: ErrInvalidTokenBilling},
		{name: "negative price even with zero tokens", multiplier: 10_000, terms: []TokenBillingTerm{{PriceMicrocredits: -1}}, wantErr: ErrInvalidTokenBilling},
		{
			name: "final amount overflow", multiplier: 10_001,
			terms:   []TokenBillingTerm{{Tokens: math.MaxInt64, PriceMicrocredits: 1_000_000}},
			wantErr: ErrTokenBillingOverflow,
		},
		{
			name: "rounding causes final overflow", multiplier: 10_000,
			terms:   []TokenBillingTerm{{Tokens: math.MaxInt64, PriceMicrocredits: 1_000_000}, {Tokens: 1, PriceMicrocredits: 1}},
			wantErr: ErrTokenBillingOverflow,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			amount, err := TokenBillingAmount(test.multiplier, test.terms...)
			if amount != 0 || !errors.Is(err, test.wantErr) {
				t.Fatalf("TokenBillingAmount() = %d, %v; want 0, %v", amount, err, test.wantErr)
			}
		})
	}
}
