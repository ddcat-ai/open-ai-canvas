package app

import (
	"math"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestTokenEstimateAmountUsesExactArithmetic(t *testing.T) {
	for _, test := range []struct {
		name       string
		prices     model.ChannelModel
		estimate   tokenBillingEstimate
		multiplier int64
		want       int64
	}{
		{
			name: "video maximum price with multiplier",
			prices: model.ChannelModel{
				InputTokenPriceMicrocredits: 1_000_000_000_000, OutputTokenPriceMicrocredits: 1_000_000_000_000,
			},
			estimate: tokenBillingEstimate{OutputTokens: 10_000_000}, multiplier: 12_500, want: 12_500_000_000_000,
		},
		{
			name: "text estimates input at full input price",
			prices: model.ChannelModel{
				InputTokenPriceMicrocredits: 2_000_000, OutputTokenPriceMicrocredits: 5_000_000, CachedTokenPriceMicrocredits: 1_000_000,
			},
			estimate: tokenBillingEstimate{InputTokens: 100, OutputTokens: 20}, multiplier: 10_000, want: 300,
		},
		{
			name: "round after combining input and output",
			prices: model.ChannelModel{
				InputTokenPriceMicrocredits: 400_000, OutputTokenPriceMicrocredits: 400_000,
			},
			estimate: tokenBillingEstimate{InputTokens: 1, OutputTokens: 1}, multiplier: 12_500, want: 1,
		},
		{
			name:     "maximum final amount",
			prices:   model.ChannelModel{OutputTokenPriceMicrocredits: 1_000_000},
			estimate: tokenBillingEstimate{OutputTokens: math.MaxInt64}, multiplier: 10_000, want: math.MaxInt64,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			amount, err := tokenEstimateAmount(&test.prices, test.estimate, test.multiplier)
			if err != nil || amount != test.want {
				t.Fatalf("tokenEstimateAmount() = %d, %v; want %d", amount, err, test.want)
			}
		})
	}
}

func TestTokenEstimateAmountRejectsInvalidArithmetic(t *testing.T) {
	for _, test := range []struct {
		name       string
		prices     model.ChannelModel
		estimate   tokenBillingEstimate
		multiplier int64
	}{
		{name: "negative input", estimate: tokenBillingEstimate{InputTokens: -1, OutputTokens: 1}, multiplier: 10_000},
		{name: "negative output", estimate: tokenBillingEstimate{OutputTokens: -1}, multiplier: 10_000},
		{name: "negative price", prices: model.ChannelModel{OutputTokenPriceMicrocredits: -1}, estimate: tokenBillingEstimate{OutputTokens: 1}, multiplier: 10_000},
		{name: "zero multiplier", estimate: tokenBillingEstimate{OutputTokens: 1}},
		{name: "final overflow", prices: model.ChannelModel{OutputTokenPriceMicrocredits: 1_000_000}, estimate: tokenBillingEstimate{OutputTokens: math.MaxInt64}, multiplier: 10_001},
	} {
		t.Run(test.name, func(t *testing.T) {
			if amount, err := tokenEstimateAmount(&test.prices, test.estimate, test.multiplier); amount != 0 || err == nil {
				t.Fatalf("invalid estimate billed %d, %v", amount, err)
			}
		})
	}
}


func TestCharacterBillingAmountRoundsByTenThousandCharacters(t *testing.T) {
	const unitPrice = int64(2_000_000)
	for _, test := range []struct {
		name       string
		characters int64
		want       int64
	}{
		{name: "one character", characters: 1, want: 2_600_000},
		{name: "one unit", characters: 10_000, want: 2_600_000},
		{name: "next unit rounds up", characters: 10_001, want: 5_200_000},
	} {
		t.Run(test.name, func(t *testing.T) {
			amount, err := characterBillingAmount(unitPrice, test.characters, 13_000)
			if err != nil || amount != test.want {
				t.Fatalf("characterBillingAmount() = %d, %v; want %d", amount, err, test.want)
			}
		})
	}
}

func TestAudioBillingEstimateCountsUnicodeCharactersWithoutRejectingEmptyPrompt(t *testing.T) {
	estimate := estimateTaskBillingTokens(map[string]any{"prompt": "你好，世界"}, "audio")
	if estimate.CharacterCount != 5 || estimate.CharacterCountErr != nil {
		t.Fatalf("audio character estimate = %#v; want five characters and no error", estimate)
	}
	empty := estimateTaskBillingTokens(map[string]any{}, "audio")
	if empty.CharacterCount != 0 || empty.CharacterCountErr != nil {
		t.Fatalf("empty audio character estimate = %#v; want zero characters and no error", empty)
	}
}

func TestAudioProxyBillingEstimateUsesInputOrPrompt(t *testing.T) {
	input := estimateProxyTokens([]byte(`{"input":"你好"}`), "audio")
	if input.CharacterCount != 2 || input.CharacterCountErr != nil {
		t.Fatalf("proxy input estimate = %#v; want two characters", input)
	}
	prompt := estimateProxyTokens([]byte(`{"prompt":"hello"}`), "audio")
	if prompt.CharacterCount != 5 || prompt.CharacterCountErr != nil {
		t.Fatalf("proxy prompt estimate = %#v; want five characters", prompt)
	}
}
