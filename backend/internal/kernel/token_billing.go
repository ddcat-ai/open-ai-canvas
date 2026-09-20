package kernel

import (
	"errors"
	"math/big"
)

var (
	ErrInvalidTokenBilling  = errors.New("invalid token billing parameters")
	ErrTokenBillingOverflow = errors.New("token billing amount overflows int64")
)

type TokenBillingTerm struct {
	Tokens            int64
	PriceMicrocredits int64
}

// TokenBillingAmount 按每百万 Token 单价及万分比倍率汇总费用，只对最终微积分金额上取整。
func TokenBillingAmount(multiplierBPS int64, terms ...TokenBillingTerm) (int64, error) {
	if multiplierBPS <= 0 {
		return 0, ErrInvalidTokenBilling
	}
	var total, product big.Int
	for _, term := range terms {
		if term.Tokens < 0 || term.PriceMicrocredits < 0 {
			return 0, ErrInvalidTokenBilling
		}
		product.Mul(big.NewInt(term.Tokens), big.NewInt(term.PriceMicrocredits))
		total.Add(&total, &product)
	}
	total.Mul(&total, big.NewInt(multiplierBPS))
	var remainder big.Int
	total.QuoRem(&total, big.NewInt(10_000_000_000), &remainder)
	if remainder.Sign() != 0 {
		total.Add(&total, big.NewInt(1))
	}
	if !total.IsInt64() {
		return 0, ErrTokenBillingOverflow
	}
	return total.Int64(), nil
}
