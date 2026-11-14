package imagebilling

import (
	"errors"
	"math"
	"math/big"

	"yingce/backend/internal/model"
)

const Mode = "image_usage"

func Validate(p *model.ImagePricing) error {
	if p == nil || p.InputPriceMicrocredits < 0 || p.InputPriceMicrocredits > 1_000_000_000_000 || p.FreeInputImages < 0 || p.FreeInputImages > 128 || len(p.OutputTiers) == 0 || len(p.OutputTiers) > 16 {
		return errors.New("图片用量价格必须包含有效的输入价、免费张数和输出档位")
	}
	var previous int64
	for i, tier := range p.OutputTiers {
		if tier.UnitPriceMicrocredits < 0 || tier.UnitPriceMicrocredits > 1_000_000_000_000 || tier.MaxPixels < 0 || tier.MaxPixels > 100_000_000 || (tier.MaxPixels == 0 && i != len(p.OutputTiers)-1) || (tier.MaxPixels > 0 && tier.MaxPixels <= previous) {
			return errors.New("输出像素上限必须递增，0 只能用于最后一个不限像素档位；价格必须有效")
		}
		previous = tier.MaxPixels
	}
	return nil
}

func ValidateUsage(usage *model.ImageBillingUsage) error {
	if usage == nil || usage.InputImages < 0 || usage.InputImages > 128 || len(usage.Outputs) == 0 || len(usage.Outputs) > 128 {
		return errors.New("图片实际用量不可用")
	}
	seen := map[int]bool{}
	for _, output := range usage.Outputs {
		if seen[output.Index] || output.Index < 0 || output.Width < 0 || output.Height < 0 || output.Width > 100_000 || output.Height > 100_000 {
			return errors.New("图片实际尺寸或输出序号无效")
		}
		seen[output.Index] = true
	}
	return nil
}

func outputPrice(p *model.ImagePricing, output model.ImageOutputUsage) (int64, error) {
	if len(p.OutputTiers) == 1 && p.OutputTiers[0].MaxPixels == 0 {
		return p.OutputTiers[0].UnitPriceMicrocredits, nil
	}
	if output.Width <= 0 || output.Height <= 0 || output.Width > math.MaxInt64/output.Height {
		return 0, errors.New("图片实际尺寸不可用，无法按像素结算")
	}
	pixels := output.Width * output.Height
	for _, tier := range p.OutputTiers {
		if tier.MaxPixels == 0 || pixels <= tier.MaxPixels {
			return tier.UnitPriceMicrocredits, nil
		}
	}
	return 0, errors.New("图片实际像素超出价格档范围")
}

func scaledAmount(base *big.Int, multiplier int64) (int64, error) {
	if multiplier <= 0 {
		return 0, errors.New("图片计费倍率无效")
	}
	amount := new(big.Int).Mul(base, big.NewInt(multiplier))
	amount.Add(amount, big.NewInt(9999)).Quo(amount, big.NewInt(10000))
	if !amount.IsInt64() {
		return 0, errors.New("图片计费金额超出范围")
	}
	return amount.Int64(), nil
}

func Amount(p *model.ImagePricing, usage *model.ImageBillingUsage, multiplier int64) (int64, error) {
	if err := Validate(p); err != nil {
		return 0, err
	}
	if err := ValidateUsage(usage); err != nil {
		return 0, err
	}
	base := new(big.Int).Mul(big.NewInt(max(0, usage.InputImages-p.FreeInputImages)), big.NewInt(p.InputPriceMicrocredits))
	for _, output := range usage.Outputs {
		price, err := outputPrice(p, output)
		if err != nil {
			return 0, err
		}
		base.Add(base, big.NewInt(price))
	}
	return scaledAmount(base, multiplier)
}

// Reserve covers all configured output tiers, including non-monotonic prices.
func Reserve(p *model.ImagePricing, inputs, maxOutputs, multiplier int64) (int64, error) {
	if err := Validate(p); err != nil {
		return 0, err
	}
	if inputs < 0 || inputs > 128 || maxOutputs <= 0 || maxOutputs > 128 {
		return 0, errors.New("图片预留张数无效")
	}
	var highest int64
	for _, tier := range p.OutputTiers {
		highest = max(highest, tier.UnitPriceMicrocredits)
	}
	base := new(big.Int).Mul(big.NewInt(max(0, inputs-p.FreeInputImages)), big.NewInt(p.InputPriceMicrocredits))
	base.Add(base, new(big.Int).Mul(big.NewInt(maxOutputs), big.NewInt(highest)))
	return scaledAmount(base, multiplier)
}

func MapPrices(p *model.ImagePricing, convert func(int64) (int64, error)) (*model.ImagePricing, error) {
	if err := Validate(p); err != nil {
		return nil, err
	}
	result := *p
	var err error
	result.InputPriceMicrocredits, err = convert(p.InputPriceMicrocredits)
	if err != nil {
		return nil, err
	}
	result.OutputTiers = append([]model.ImagePriceTier(nil), p.OutputTiers...)
	for i := range result.OutputTiers {
		result.OutputTiers[i].UnitPriceMicrocredits, err = convert(p.OutputTiers[i].UnitPriceMicrocredits)
		if err != nil {
			return nil, err
		}
	}
	return &result, nil
}
