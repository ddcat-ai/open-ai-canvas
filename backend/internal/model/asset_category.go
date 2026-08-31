package model

import "strings"

// NormalizeAssetCategory keeps persisted and synced assets inside the current
// five-category contract while preserving the intended meaning of legacy data.
func NormalizeAssetCategory(value AssetCategory, kind string) AssetCategory {
	switch strings.ToLower(strings.TrimSpace(string(value))) {
	case string(AssetCategoryCharacter):
		return AssetCategoryCharacter
	case string(AssetCategoryEnvironment):
		return AssetCategoryEnvironment
	case string(AssetCategoryProp), "wardrobe", "weapon", "accessory":
		return AssetCategoryProp
	case string(AssetCategoryMaterial), "style":
		return AssetCategoryMaterial
	case string(AssetCategoryOther):
		return AssetCategoryOther
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
