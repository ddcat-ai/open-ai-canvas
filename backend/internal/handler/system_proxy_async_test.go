package handler

import (
	"net/http"
	"net/url"
	"path/filepath"
	"reflect"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestSystemProxyTaskIDCandidatesIncludesContentDownloadParent(t *testing.T) {
	got := systemProxyTaskIDCandidates("/v1/videos/video-42/content", url.Values{}, nil, "")
	want := []string{"video-42", "content"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("systemProxyTaskIDCandidates() = %#v, want %#v", got, want)
	}
}

func TestSystemProxyMalformedAsyncCreateRemainsUncertain(t *testing.T) {
	dir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "billing.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.BillingOrder{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dir)
	t.Cleanup(func() {
		svc.Close()
		sqlDB, _ := db.DB()
		_ = sqlDB.Close()
	})
	order := model.BillingOrder{
		ID: "async-order", UserID: "user-1", ChannelID: "channel-1", IdempotencyKey: "async-create-key",
		Model: "video-model", Capability: "video", BillingMode: "fixed_request", AmountMicrocredits: 10,
		ReservedAmountMicrocredits: 10, Quantity: 1, Status: model.BillingStatusRunning,
	}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CreditAccount{UserID: "user-1", AvailableMicrocredits: 90, ReservedMicrocredits: 10, Version: 1}).Error; err != nil {
		t.Fatal(err)
	}

	handleSystemProxyAsyncCreate(
		svc, order.ID, order.UserID, order.ChannelID,
		&model.ChannelModel{Protocol: "not-installed", Capability: "video", ModelKey: order.Model},
		systemProxyCallResult{Status: model.ApiCallStatusSucceeded, StatusCode: 200},
		http.StatusOK, nil, []byte("not json"),
	)

	var stored model.BillingOrder
	if err := db.First(&stored, "id = ?", order.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.BillingStatusUncertain {
		t.Fatalf("billing status = %q, want uncertain", stored.Status)
	}
	var entries []model.CreditLedgerEntry
	if err := db.Find(&entries).Error; err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("malformed async response settled billing: %#v", entries)
	}
}
