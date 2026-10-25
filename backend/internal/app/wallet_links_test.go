package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func TestWalletLinksPackagePurchaseAndRedeem(t *testing.T) {
	svc, db := newFeatureAvailabilityTestService(t)
	if err := db.AutoMigrate(&model.PluginPlatformState{}, &model.UserPluginState{}, &model.PaymentOrder{}, &model.User{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.RedeemBatch{}, &model.RedeemCode{}); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "shop-admin", Username: "shop-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	user := &model.User{ID: "shop-user", Username: "shop-user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	for _, actor := range []*model.User{admin, user} {
		if err := db.Create(actor).Error; err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "redeem-purchase-links.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.InstallPluginForAdmin(user, data, "redeem-purchase-links.yingce-plugin"); err == nil {
		t.Fatal("ordinary user installed plugin")
	}
	bundled, found := runtimePluginByID(svc.Plugins(), "redeem-purchase-links")
	if !found || bundled.Status == "enabled" {
		t.Fatalf("bundled plugin must be present and disabled: %#v", bundled)
	}
	// Simulate a host with the wallet-links API but without the bundled package.
	svc.pluginRuntime = &pluginRuntime{registryPath: filepath.Join(t.TempDir(), "plugins.json"), packageDir: t.TempDir(), plugins: make(map[string]pluginRecord)}
	installed, err := svc.InstallPluginForAdmin(admin, data, "redeem-purchase-links.yingce-plugin")
	if err != nil {
		t.Fatal(err)
	}
	// Uploaded packages follow the host's existing auto-enable policy.
	if _, err := svc.SetPluginPlatformAvailability(admin, installed.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	if links, err := svc.WalletLinks(user); err != nil || len(links) != 0 {
		t.Fatalf("disabled uploaded plugin: %#v %v", links, err)
	}
	if _, err := svc.UpdateAdminPluginConfiguration(admin, installed.Manifest.ID, map[string]string{"links": `[{"id":"shop","label":"100 积分","price":"10.00","url":"https://example.test/shop"}]`}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetPluginPlatformAvailability(admin, installed.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	links, err := svc.WalletLinks(user)
	if err != nil || len(links) != 1 || links[0].URL != "https://example.test/shop" {
		t.Fatalf("links: %#v, %v", links, err)
	}
	batch, err := svc.AdminCreateRedeemBatch(admin, CreateRedeemBatchRequest{AmountMicrocredits: CreditScale, Count: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RedeemCredits(user, batch.Codes[0], "203.0.113.8"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RedeemCredits(user, batch.Codes[0], "203.0.113.8"); err == nil {
		t.Fatal("code redeemed twice")
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", user.ID).Error; err != nil || account.AvailableMicrocredits != CreditScale {
		t.Fatalf("account: %#v, %v", account, err)
	}
	var orders int64
	if err := db.Model(&model.PaymentOrder{}).Count(&orders).Error; err != nil || orders != 0 {
		t.Fatalf("unexpected payment orders: %d, %v", orders, err)
	}
}

func TestWalletLinksConfigurationAndAvailability(t *testing.T) {
	svc, db := newFeatureAvailabilityTestService(t)
	if err := db.AutoMigrate(&model.PluginPlatformState{}, &model.UserPluginState{}, &model.PaymentOrder{}); err != nil {
		t.Fatal(err)
	}
	manifest := bundledPaymentPluginManifests()[0]
	manifest.Metadata.ID = "test-wallet-links"
	manifest.Contributes = protocol.ManifestContributions{WalletLinks: []protocol.ManifestWalletLink{{ID: "default", Label: "100积分", Description: "default description", URL: "https://example.test/shop"}, {ID: "default-2", Label: "200积分", Description: "must not leak", URL: "https://example.test/shop"}}}
	manifest.Configuration.Fields = []protocol.ManifestField{{Name: "links", Type: "json"}, {Name: "secret", Type: "password"}}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	svc.pluginRuntime = &pluginRuntime{plugins: map[string]pluginRecord{manifest.Metadata.ID: {Raw: raw, Metadata: manifest.Metadata, Source: PluginOriginUploaded, Status: "enabled"}}}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	user := &model.User{ID: "user", Role: model.UserRoleUser}
	if _, err := svc.WalletLinks(nil); err == nil {
		t.Fatal("anonymous request accepted")
	}
	if _, err := svc.AdminPluginConfiguration(user, manifest.Metadata.ID); err == nil {
		t.Fatal("ordinary user read admin config")
	}
	values := map[string]string{"links": `[{"id":"a","label":"500积分","price":"5.00","description":"测试介绍","url":"https://example.test/a"},{"id":"b","label":"100积分","price":"1.00","url":"https://example.test/b"}]`}
	if _, err := svc.UpdateAdminPluginConfiguration(user, manifest.Metadata.ID, values); err == nil {
		t.Fatal("ordinary user changed config")
	}
	if links, err := svc.WalletLinks(user); err != nil || len(links) != 2 {
		t.Fatalf("defaults: %v %v", links, err)
	}
	if _, err := svc.UpdateAdminPluginConfiguration(admin, manifest.Metadata.ID, values); err != nil {
		t.Fatal(err)
	}
	config, err := svc.AdminPluginConfiguration(admin, manifest.Metadata.ID)
	if err != nil || config.Values["links"] != values["links"] {
		t.Fatalf("saved config: %v %v", config, err)
	}
	links, err := svc.WalletLinks(user)
	if err != nil || len(links) != 2 || links[0].ID != "test-wallet-links:a" || links[0].Price != "5.00" || links[1].Label != "100积分" || links[1].Description != "" {
		t.Fatalf("configured links: %v %v", links, err)
	}
	for _, invalid := range []map[string]string{
		{"secret": "not-to-be-stored"},
		{"links": "{"},
		{"links": `[{"id":"a","label":"bad","url":"javascript:alert(1)"}]`},
		{"links": `[{"id":"a","label":"bad","url":"https://name:secret@example.test"}]`},
		{"links": `[{"id":"a","label":"a","url":"https://example.test"},{"id":"a","label":"b","url":"https://example.test"}]`},
	} {
		if _, err := svc.UpdateAdminPluginConfiguration(admin, manifest.Metadata.ID, invalid); err == nil {
			t.Fatalf("accepted invalid config: %v", invalid)
		}
	}
	if err := db.Create(&model.PluginPlatformState{PluginID: manifest.Metadata.ID, Available: false}).Error; err != nil {
		t.Fatal(err)
	}
	if links, err := svc.WalletLinks(user); err != nil || len(links) != 0 {
		t.Fatalf("disabled plugin exposed links: %v %v", links, err)
	}
	if err := db.Model(&model.PluginPlatformState{}).Where("plugin_id = ?", manifest.Metadata.ID).Update("available", true).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateAdminPluginConfiguration(admin, manifest.Metadata.ID, map[string]string{"links": "[]"}); err != nil {
		t.Fatal(err)
	}
	if links, err := svc.WalletLinks(user); err != nil || len(links) != 0 {
		t.Fatalf("cleared config: %v %v", links, err)
	}
	var count int64
	if err := db.Model(&model.PaymentOrder{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("unexpected payment orders: %d %v", count, err)
	}
}
