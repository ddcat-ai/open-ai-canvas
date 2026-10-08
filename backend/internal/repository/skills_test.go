package repository

import (
	"testing"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestPublicSkillCategoryCounts(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	if err := db.AutoMigrate(&model.Skill{}); err != nil {
		t.Fatal(err)
	}

	skills := []model.Skill{
		{ID: "drama-1", Status: 1, Tag: "drama"},
		{ID: "drama-2", Status: 1, Tag: "drama"},
		{ID: "private-drama", Status: 1, IsPrivate: true, Tag: "drama"},
		{ID: "disabled-ecommerce", Status: 0, Tag: "ecommerce"},
		{ID: "ecommerce-1", Status: 1, Tag: "ecommerce"},
	}
	if err := db.Create(&skills).Error; err != nil {
		t.Fatal(err)
	}

	counts, err := New(db).PublicSkillCategoryCounts()
	if err != nil {
		t.Fatal(err)
	}
	if counts["drama"] != 2 || counts["ecommerce"] != 1 {
		t.Fatalf("public skill category counts = %#v, want drama=2 and ecommerce=1", counts)
	}
}
