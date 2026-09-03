package service

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newPaymentLifecycleService(t *testing.T, status model.PaymentOrderStatus) (*Service, protocol.Manifest) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.PaymentOrder{}); err != nil {
		t.Fatal(err)
	}
	manifest := bundledPaymentPluginManifests()[0]
	manifest.Metadata.ID = "uploaded-payment"
	manifest.Metadata.Version = "1.0.0"
	manifest.Metadata.Enabled = true
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	center := &pluginRuntime{plugins: map[string]pluginRecord{
		manifest.Metadata.ID: {Raw: raw, Metadata: manifest.Metadata, Source: PluginOriginUploaded},
	}}
	order := model.PaymentOrder{ID: "active-order", UserID: "user", IdempotencyKey: "key", MerchantOrderNo: "merchant", ProviderID: manifest.Contributes.PaymentProviders[0].ID, PluginID: manifest.Metadata.ID, PluginVersion: manifest.Metadata.Version, Status: status}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db), pluginRuntime: center}, manifest
}

func TestPaymentPluginUpgradeBlockedByActiveOrders(t *testing.T) {
	svc, next := newPaymentLifecycleService(t, model.PaymentOrderPending)
	next.Metadata.Version = "2.0.0"
	if err := svc.ensurePaymentPluginLifecycle(next); err == nil || !strings.Contains(err.Error(), "未完成订单") {
		t.Fatalf("upgrade guard error = %v", err)
	}
}

func TestPaymentPluginRemovalAllowedAfterOrdersFinish(t *testing.T) {
	svc, manifest := newPaymentLifecycleService(t, model.PaymentOrderCredited)
	if err := svc.ensurePaymentPluginCanBeRemoved(manifest.Metadata.ID); err != nil {
		t.Fatalf("removal guard rejected completed order: %v", err)
	}
}
