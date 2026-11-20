package ecommerceagent

import (
	"errors"
	"math"
)

// Charge uses integer microcredits so a partial page batch never gains or
// loses credit through floating-point rounding.
func Charge(unit int64, pages, success int) (reserved, actual, refund int64, err error) {
	if unit <= 0 || pages < 1 || pages > 15 || success < 0 || success > pages || unit > math.MaxInt64/int64(pages) {
		return 0, 0, 0, errors.New("invalid ecommerce charge snapshot")
	}
	reserved = unit * int64(pages)
	actual = unit * int64(success)
	refund = reserved - actual
	return reserved, actual, refund, nil
}
