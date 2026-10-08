package platform

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPublicRuntimeLimitsStoredFileGB(t *testing.T) {
	for _, configured := range []bool{false, true} {
		db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = sqlDB.Close() })
		if err := db.AutoMigrate(&model.SystemSetting{}); err != nil {
			t.Fatal(err)
		}
		policy := DefaultRuntimePolicy()
		if configured {
			policy.Resource.StoredFileGB = 37
			data, err := json.Marshal(policy)
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&model.SystemSetting{Key: runtimePolicySettingKey, ValueJSON: string(data)}).Error; err != nil {
				t.Fatal(err)
			}
		}
		limits, err := New(repository.New(db), nil, nil).PublicRuntimeLimits()
		if err != nil {
			t.Fatal(err)
		}
		data, err := json.Marshal(limits)
		if err != nil {
			t.Fatal(err)
		}
		var fields map[string]any
		if err := json.Unmarshal(data, &fields); err != nil {
			t.Fatal(err)
		}
		if got := fields["storedFileGB"]; got != float64(policy.Resource.StoredFileGB) {
			t.Errorf("configured=%v: storedFileGB = %v, want %d; JSON=%s", configured, got, policy.Resource.StoredFileGB, data)
		}
	}
}
