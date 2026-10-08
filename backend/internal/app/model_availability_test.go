package app

import (
	"math"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPublicModelAvailabilityUsesCreateAttemptsAndFixedSevenDayTrend(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	logs := make([]model.ApiCallLog, 0, 20)
	for index := 0; index < 12; index++ {
		status := model.ApiCallStatusSucceeded
		if index >= 9 {
			status = model.ApiCallStatusFailed
		}
		logs = append(logs, model.ApiCallLog{
			ID:          "ready-" + string(rune('a'+index)),
			UserID:      "user-1",
			ChannelID:   "channel-1",
			Model:       "model-a",
			RequestKind: "create",
			Status:      status,
			CreatedAt:   now.Add(-time.Duration(index+1) * time.Hour),
		})
	}
	logs = append(logs,
		model.ApiCallLog{ID: "insufficient-1", UserID: "user-1", ChannelID: "channel-1", Model: "model-b", RequestKind: "create", Status: model.ApiCallStatusSucceeded, CreatedAt: now.Add(-2 * time.Hour)},
		model.ApiCallLog{ID: "insufficient-2", UserID: "user-1", ChannelID: "channel-1", Model: "model-b", RequestKind: "create", Status: model.ApiCallStatusFailed, CreatedAt: now.Add(-3 * time.Hour)},
		model.ApiCallLog{ID: "poll-only", UserID: "user-1", ChannelID: "channel-1", Model: "model-a", RequestKind: "poll", Status: model.ApiCallStatusFailed, CreatedAt: now.Add(-30 * time.Minute)},
		model.ApiCallLog{ID: "download-only", UserID: "user-1", ChannelID: "channel-1", Model: "model-a", RequestKind: "download", Status: model.ApiCallStatusFailed, CreatedAt: now.Add(-20 * time.Minute)},
	)
	if err := db.Create(&logs).Error; err != nil {
		t.Fatal(err)
	}

	channels := []PublicChannelCatalog{{ID: "channel-1", Models: []PublicChannelModel{
		{ModelKey: "model-a"},
		{ModelKey: "model-b"},
		{ModelKey: "model-c"},
	}}}
	availability, err := svc.publicModelAvailability(channels, now)
	if err != nil {
		t.Fatal(err)
	}

	ready := availability[publicModelAvailabilityKey{channelID: "channel-1", modelKey: "model-a"}]
	if ready == nil || ready.DataState != PublicModelAvailabilityReady || ready.SampleCount != 12 || ready.Rate24h == nil {
		t.Fatalf("ready availability = %#v", ready)
	}
	if math.Abs(*ready.Rate24h-0.75) > 0.0001 {
		t.Fatalf("ready rate = %v, want 0.75", *ready.Rate24h)
	}
	if len(ready.Trend7d) != 7 {
		t.Fatalf("trend length = %d, want 7", len(ready.Trend7d))
	}

	insufficient := availability[publicModelAvailabilityKey{channelID: "channel-1", modelKey: "model-b"}]
	if insufficient == nil || insufficient.DataState != PublicModelAvailabilityInsufficient || insufficient.SampleCount != 2 || insufficient.Rate24h != nil {
		t.Fatalf("insufficient availability = %#v", insufficient)
	}

	noData := availability[publicModelAvailabilityKey{channelID: "channel-1", modelKey: "model-c"}]
	if noData == nil || noData.DataState != PublicModelAvailabilityNoData || noData.SampleCount != 0 || noData.Rate24h != nil {
		t.Fatalf("no-data availability = %#v", noData)
	}
}
