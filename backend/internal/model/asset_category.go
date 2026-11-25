package model

import "strings"

// NormalizeAssetCategory keeps persisted and synced assets inside the current
// category contract while preserving the intended meaning of legacy data.
func NormalizeAssetCategory(value AssetCategory, kind string) AssetCategory {
	switch strings.ToLower(strings.TrimSpace(string(value))) {
	case string(AssetCategoryCharacter):
		return AssetCategoryCharacter
	case string(AssetCategoryEnvironment):
		return AssetCategoryEnvironment
	case string(AssetCategoryProp), "weapon":
		return AssetCategoryProp
	case string(AssetCategoryClothing), "wardrobe":
		return AssetCategoryClothing
	case string(AssetCategoryExpression):
		return AssetCategoryExpression
	case string(AssetCategoryPose):
		return AssetCategoryPose
	case string(AssetCategoryAccessory):
		return AssetCategoryAccessory
	case string(AssetCategoryHairstyle):
		return AssetCategoryHairstyle
	case string(AssetCategoryFacialFeatures):
		return AssetCategoryFacialFeatures
	case string(AssetCategoryMaterial), "style":
		return AssetCategoryMaterial
	case string(AssetCategoryOther):
		return AssetCategoryOther
	case string(AssetCategoryArk):
		return AssetCategoryArk
	}
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "entity":
		return AssetCategoryCharacter
	case "image", "video", "audio", "model":
		return AssetCategoryMaterial
	default:
		return AssetCategoryOther
	}
}

// IsValidAssetCategory 统一业务写入和筛选合同，避免不同入口丢失梳妆分类。
func IsValidAssetCategory(value AssetCategory) bool {
	switch value {
	case AssetCategoryCharacter, AssetCategoryEnvironment, AssetCategoryProp, AssetCategoryMaterial,
		AssetCategoryOther, AssetCategoryArk, AssetCategoryClothing, AssetCategoryExpression,
		AssetCategoryPose, AssetCategoryAccessory, AssetCategoryHairstyle, AssetCategoryFacialFeatures:
		return true
	}
	return false
}
