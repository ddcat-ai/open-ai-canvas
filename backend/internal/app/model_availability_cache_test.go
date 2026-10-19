package app

import (
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPublicModelAvailabilityCacheFollowsRequestedCatalog(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	now := time.Now().UTC()
	for _, id := range []string{"channel-a", "channel-b", "channel-a"} {
		channels := []PublicChannelCatalog{{ID: id, Models: []PublicChannelModel{{ModelKey: "model"}}}}
		got, err := svc.publicModelAvailability(channels, now)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 1 || got[publicModelAvailabilityKey{channelID: id, modelKey: "model"}] == nil {
			t.Fatalf("cache returned another catalog: requested %s, got %#v", id, got)
		}
	}
}
