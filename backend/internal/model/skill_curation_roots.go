package model

type SkillCurationRoot struct {
	ID             string `gorm:"primaryKey;size:36" json:"id"`
	Name           string `gorm:"size:64;not null" json:"name"`
	NormalizedName string `gorm:"size:128;not null;uniqueIndex" json:"-"`
	IconKey        string `gorm:"size:32" json:"iconKey"`
	SortOrder      int    `json:"sortOrder"`
	Enabled        bool   `json:"enabled"`
}

type SkillCurationRootAssignment struct {
	SkillID string `gorm:"primaryKey;size:36" json:"skillId"`
	RootID  string `gorm:"size:36;not null;index" json:"rootId"`
}

// These neutral defaults match the original catalog. No skill content or
// skill-to-category mapping is shipped by the migration.
func DefaultSkillCurationRoots() []SkillCurationRoot {
	return []SkillCurationRoot{
		{ID: "drama", Name: "短剧影视", NormalizedName: "短剧影视", IconKey: "film", SortOrder: 10, Enabled: true},
		{ID: "ecommerce", Name: "电商营销", NormalizedName: "电商营销", IconKey: "shopping-bag", SortOrder: 20, Enabled: true},
		{ID: "creative", Name: "创意设计", NormalizedName: "创意设计", IconKey: "palette", SortOrder: 30, Enabled: true},
		{ID: "social", Name: "社媒内容", NormalizedName: "社媒内容", IconKey: "users", SortOrder: 40, Enabled: true},
		{ID: "others", Name: "其他", NormalizedName: "其他", IconKey: "shapes", SortOrder: 50, Enabled: true},
	}
}
