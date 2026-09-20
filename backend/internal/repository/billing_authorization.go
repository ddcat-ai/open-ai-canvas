package repository

import "infinite-canvas/backend/internal/model"

func billingChargeLimitApplies(order model.BillingOrder) bool {
	return order.ChargeLimitSet || order.ChargeLimitMicrocredits > 0
}

func validateBillingChargeLimit(order model.BillingOrder, amount int64) error {
	if amount < 0 || (billingChargeLimitApplies(order) && (order.ChargeLimitMicrocredits < 0 || amount > order.ChargeLimitMicrocredits)) {
		return ErrBillingChargeLimit
	}
	return nil
}
