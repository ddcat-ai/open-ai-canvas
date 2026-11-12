package repository

import (
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestOfficialRecommendationRetainsCharacterMedia(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&model.OfficialAssetRecommendation{}, &model.OfficialAsset{}); err != nil {
		t.Fatal(err)
	}
	snapshot := `{"images":[{"resourceId":"image-1"},{"resourceId":"image-2"}],"voice":{"profile":{"sampleResourceId":"audio-1"}}}`
	if err = db.Create(&model.OfficialAssetRecommendation{ID: "rec-1", Status: model.OfficialAssetRecommendationPending, SnapshotJSON: snapshot}).Error; err != nil {
		t.Fatal(err)
	}
	ids, err := New(db).OfficialRecommendationResourceIDs()
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"image-1", "image-2", "audio-1"} {
		if _, ok := ids[id]; !ok {
			t.Errorf("missing retained resource %s", id)
		}
	}
	if err = db.Model(&model.OfficialAssetRecommendation{}).Where("id = ?", "rec-1").Update("status", model.OfficialAssetRecommendationRejected).Error; err != nil {
		t.Fatal(err)
	}
	ids, err = New(db).OfficialRecommendationResourceIDs()
	if err != nil || len(ids) != 0 {
		t.Fatalf("rejected recommendation retained resources: %v, %v", ids, err)
	}
}
