package model

import "time"

// DefaultUserGroupCode 是未分配分组用户的归属；该分组不能删除。
const DefaultUserGroupCode = "default"

// 计价货币：credits 表示价格直接以积分配置；USD/CNY 表示价格以货币配置，
// 下单时按用户分组的「1 单位货币 = N 积分」换算。
const (
	PriceCurrencyCredits = "credits"
	PriceCurrencyUSD     = "USD"
	PriceCurrencyCNY     = "CNY"
)

// 用户端分组徽章外观；none 表示不展示徽章。
const (
	UserGroupBadgeNone = "none"
	UserGroupBadgeVIP  = "vip"
	UserGroupBadgeSVIP = "svip"
)

// UserGroup 是用户分组：统一折扣倍率、货币兑换积分比例和可见渠道范围。
// RatioBasisPoints 10000 = 1.0（不打折），8000 = 8 折。
// PointsPerUSD/PointsPerCNY 以微积分（1 积分 = 1_000_000）表示 1 单位货币可兑换的积分。
type UserGroup struct {
	ID                 string    `json:"id" gorm:"primaryKey;size:36"`
	Code               string    `json:"code" gorm:"size:40;uniqueIndex"`
	Name               string    `json:"name" gorm:"size:80"`
	Description        string    `json:"description" gorm:"size:500;not null;default:''"`
	BadgeLabel         string    `json:"badgeLabel" gorm:"size:16;not null;default:''"`
	BadgeStyle         string    `json:"badgeStyle" gorm:"size:16;not null;default:none"`
	SortOrder          int       `json:"sortOrder" gorm:"not null;default:0"`
	RatioBasisPoints   int64     `json:"ratioBasisPoints" gorm:"not null;default:10000"`
	PointsPerUSD       int64     `json:"pointsPerUsdMicrocredits" gorm:"column:points_per_usd;not null;default:0"`
	PointsPerCNY       int64     `json:"pointsPerCnyMicrocredits" gorm:"column:points_per_cny;not null;default:0"`
	AllChannels        bool      `json:"allChannels" gorm:"not null;default:false"`
	ModelOverridesJSON string    `json:"-" gorm:"type:text;not null;default:'[]'"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

// UserGroupChannel 绑定分组可使用的系统渠道；AllChannels 为 true 时不读取本表。
type UserGroupChannel struct {
	GroupID   string    `json:"groupId" gorm:"primaryKey;size:36"`
	ChannelID string    `json:"channelId" gorm:"primaryKey;size:36;index"`
	CreatedAt time.Time `json:"createdAt"`
}

// UserGroupModelOverride 是分组内单个模型的倍率与兑换比例；0 表示沿用分组默认值。
// ModelKey 匹配渠道模型标识或前台模型编码。
type UserGroupModelOverride struct {
	ModelKey         string `json:"modelKey"`
	RatioBasisPoints int64  `json:"ratioBasisPoints"`
	PointsPerUSD     int64  `json:"pointsPerUsdMicrocredits"`
	PointsPerCNY     int64  `json:"pointsPerCnyMicrocredits"`
}
