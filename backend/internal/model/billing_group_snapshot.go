package model

// BillingGroupSnapshot freezes the discount source when an order is reserved.
type BillingGroupSnapshot struct {
	BillingGroupID       string `json:"billingGroupId,omitempty" gorm:"size:80"`
	BillingGroupName     string `json:"billingGroupName,omitempty" gorm:"size:160"`
	BillingGroupVersion  int64  `json:"billingGroupVersion"`
	BillingMemberVersion int64  `json:"billingMemberVersion"`
	MultiplierSource     string `json:"multiplierSource" gorm:"size:32"`
}
