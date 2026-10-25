package app

import "yingce/backend/internal/model"

type billingPricingRules struct {
	display map[string]displayGroupRate
}

func (s *Service) billingPricingRules(userID string) (billingPricingRules, error) {
	display, _, err := s.displayGroupPricing(userID)
	return billingPricingRules{display: display}, err
}

func (rules billingPricingRules) resolveModel(modelID, modelKey string, legacy int64) (int64, model.BillingGroupSnapshot, error) {
	// Grouped models use their configured sale price. Ungrouped models retain
	// the installation's existing credit policy until explicitly organized.
	if rate, ok := rules.display[modelID]; ok {
		return rate.multiplier, rate.snapshot, nil
	}
	if legacy <= 0 {
		legacy = 10000
	}
	return legacy, model.BillingGroupSnapshot{MultiplierSource: "global"}, nil
}

func (s *Service) applyBillingGroupPricing(order *model.BillingOrder, modelKey string, estimate tokenBillingEstimate) error {
	return s.applyModelGroupPricing(order, modelKey, order.ChannelModelID, estimate)
}

func (s *Service) applyModelGroupPricing(order *model.BillingOrder, modelKey, groupModelID string, estimate tokenBillingEstimate) error {
	rules, err := s.billingPricingRules(order.UserID)
	if err != nil {
		return err
	}
	multiplier, snapshot, err := rules.resolveModel(groupModelID, modelKey, order.MultiplierBasisPoints)
	if err != nil {
		return err
	}
	var amount int64
	if order.BillingMode == "token" {
		amount, err = tokenEstimateAmount(&model.ChannelModel{InputTokenPriceMicrocredits: order.InputTokenPriceMicrocredits, OutputTokenPriceMicrocredits: order.OutputTokenPriceMicrocredits, CachedTokenPriceMicrocredits: order.CachedTokenPriceMicrocredits}, estimate, multiplier)
	} else {
		amount, err = creditAmount(order.UnitPriceMicrocredits, order.Quantity, multiplier)
	}
	if err != nil {
		return err
	}
	order.MultiplierBasisPoints = multiplier
	order.BillingGroupSnapshot = snapshot
	order.AmountMicrocredits = amount
	order.ReservedAmountMicrocredits = amount
	return nil
}
