package providercatalog

import (
	"errors"
	"math"
	"math/big"
)

// TierPrice 是一个规格档换算后的成本与售价（microcredits）。
type TierPrice struct {
	CostUnit, CostInput, CostOutput, CostCached int64
	SaleUnit, SaleInput, SaleOutput, SaleCached int64
	CostReferenceVideo, SaleReferenceVideo      int64
}

// YuanToMicrocredits 按 1 元 = 1 积分换算，四舍五入到 microcredit。
func YuanToMicrocredits(yuan float64) int64 {
	return int64(math.Round(yuan * MicrocreditsPerYuan))
}

// MarkupBasisPoints 校验加价率（0–1000%，最多两位小数）并转为万分比。
func MarkupBasisPoints(percent float64) (int64, error) {
	if math.IsNaN(percent) || math.IsInf(percent, 0) || percent < 0 || percent > MaxMarkupPercent {
		return 0, errors.New("加价率必须在 0% 到 1000% 之间")
	}
	bp := math.Round(percent * 100)
	if math.Abs(percent*100-bp) > 1e-6 {
		return 0, errors.New("加价率最多保留两位小数")
	}
	return int64(bp), nil
}

// ApplyMarkup 计算 售价 = 成本 × (1 + 加价率)，向上取整到 microcredit，保证不低于目标加价。
func ApplyMarkup(cost int64, basisPoints int64) int64 {
	if cost <= 0 {
		return 0
	}
	numerator := new(big.Int).Mul(big.NewInt(cost), big.NewInt(10_000+basisPoints))
	denominator := big.NewInt(10_000)
	quotient, remainder := new(big.Int).QuoRem(numerator, denominator, new(big.Int))
	if remainder.Sign() > 0 {
		quotient.Add(quotient, big.NewInt(1))
	}
	return quotient.Int64()
}

// PriceTier 把目录规格档换算为成本与售价。视频 token 只按输出计费，输入与缓存强制为 0。
func PriceFor(capability string, tier PriceTier, basisPoints int64) TierPrice {
	price := TierPrice{}
	if tier.BillingMode == "token" {
		price.CostOutput = YuanToMicrocredits(tier.OutputPerMillion)
		if capability != "video" {
			price.CostInput = YuanToMicrocredits(tier.InputPerMillion)
			price.CostCached = YuanToMicrocredits(tier.CachedPerMillion)
		}
	} else {
		price.CostUnit = YuanToMicrocredits(tier.Cost)
		if capability == "video" && tier.BillingMode == "per_second" {
			price.CostReferenceVideo = YuanToMicrocredits(tier.ReferenceVideoCost)
		}
	}
	price.SaleReferenceVideo = ApplyMarkup(price.CostReferenceVideo, basisPoints)
	price.SaleUnit = ApplyMarkup(price.CostUnit, basisPoints)
	price.SaleInput = ApplyMarkup(price.CostInput, basisPoints)
	price.SaleOutput = ApplyMarkup(price.CostOutput, basisPoints)
	price.SaleCached = ApplyMarkup(price.CostCached, basisPoints)
	return price
}
