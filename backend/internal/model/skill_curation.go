package model

type SkillCurationSetting struct {
	ID       int   `gorm:"primaryKey;autoIncrement:false" json:"-"`
	Enabled  bool  `json:"enabled"`
	Revision int64 `json:"revision"`
}

type SkillCurationCategory struct {
	ID             string `gorm:"primaryKey;size:36" json:"id"`
	RootTag        string `gorm:"size:36;not null;uniqueIndex:idx_curation_category_name" json:"rootTag"`
	Name           string `gorm:"size:64;not null" json:"name"`
	NormalizedName string `gorm:"size:128;not null;uniqueIndex:idx_curation_category_name" json:"-"`
	SortOrder      int    `json:"sortOrder"`
	Enabled        bool   `json:"enabled"`
}

type SkillCurationAssignment struct {
	SkillID    string `gorm:"primaryKey;size:36" json:"skillId"`
	CategoryID string `gorm:"primaryKey;size:36;index" json:"categoryId"`
}
