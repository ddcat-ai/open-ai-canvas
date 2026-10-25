package model

// OfficialPricing is a public reference price, never an upstream cost or charge.
type OfficialPricing struct {
	Configured                   bool  `json:"configured" gorm:"not null;default:false"`
	UnitPriceMicrocredits        int64 `json:"unitPriceMicrocredits" gorm:"not null;default:0"`
	InputTokenPriceMicrocredits  int64 `json:"inputTokenPriceMicrocredits" gorm:"not null;default:0"`
	OutputTokenPriceMicrocredits int64 `json:"outputTokenPriceMicrocredits" gorm:"not null;default:0"`
	CachedTokenPriceMicrocredits int64 `json:"cachedTokenPriceMicrocredits" gorm:"not null;default:0"`
}
