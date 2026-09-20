package model

// CreditCostPricing 仅供管理员配置和内部核算。持有者必须使用 json:"-"，
// 管理端通过专用响应投影公开，禁止随用户目录、报价或账单序列化。
type CreditCostPricing struct {
	Configured                   bool  `json:"configured" gorm:"not null;default:false"`
	UnitPriceMicrocredits        int64 `json:"unitPriceMicrocredits" gorm:"not null;default:0"`
	InputTokenPriceMicrocredits  int64 `json:"inputTokenPriceMicrocredits" gorm:"not null;default:0"`
	OutputTokenPriceMicrocredits int64 `json:"outputTokenPriceMicrocredits" gorm:"not null;default:0"`
	CachedTokenPriceMicrocredits int64 `json:"cachedTokenPriceMicrocredits" gorm:"not null;default:0"`
}

// BillingCostSnapshot 独立于销售价格，切换供应线路时始终更新为实际执行线路的成本。
type BillingCostSnapshot struct {
	CostPricing            CreditCostPricing `json:"-" gorm:"embedded;embeddedPrefix:cost_"`
	CostBillingMode        string            `json:"-" gorm:"size:32;not null;default:''"`
	CostQuantity           int64             `json:"-" gorm:"not null;default:0"`
	CostVideoFormulaTokens int64             `json:"-" gorm:"not null;default:0"`
}
