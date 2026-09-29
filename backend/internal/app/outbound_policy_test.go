package app

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newOutboundPolicyTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	dsn := fmt.Sprintf("file:%s_%d?mode=memory&cache=shared", t.Name(), time.Now().UnixNano())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	return New(repository.New(db), t.TempDir()), db
}

func setAllowedModelOrigins(t *testing.T, svc *Service, origins ...string) {
	t.Helper()
	if _, err := svc.UpdateOutboundPolicy(&model.User{ID: "admin-1", Role: model.UserRoleAdmin}, OutboundPolicySetting{AllowedModelOrigins: origins}); err != nil {
		t.Fatal(err)
	}
}

func TestUpdateOutboundPolicyNormalizesPersistsAndAudits(t *testing.T) {
	svc, db := newOutboundPolicyTestService(t)
	initial, err := svc.OutboundPolicy()
	if err != nil || initial.AllowedModelOrigins == nil || len(initial.AllowedModelOrigins) != 0 {
		t.Fatalf("default policy = %#v, %v", initial, err)
	}
	if _, err := svc.UpdateOutboundPolicy(&model.User{ID: "user-1", Role: model.UserRoleUser}, OutboundPolicySetting{}); err == nil {
		t.Fatal("ordinary user updated the outbound policy")
	}
	if _, err := svc.UpdateOutboundPolicy(&model.User{ID: "admin-1", Role: model.UserRoleAdmin}, OutboundPolicySetting{AllowedModelOrigins: []string{"https://api.example.com/v1"}}); err == nil {
		t.Fatal("origin with a path was accepted")
	}
	setAllowedModelOrigins(t, svc, " https://API.example.com:443 ", "", "https://api.example.com", "http://gateway.internal:8080")
	saved, err := svc.OutboundPolicy()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(saved.AllowedModelOrigins, ",") != "https://api.example.com,http://gateway.internal:8080" {
		t.Fatalf("saved origins = %#v", saved.AllowedModelOrigins)
	}
	var audits int64
	if err := db.Model(&model.AdminAuditEvent{}).Where("action = ?", "outbound_policy.update").Count(&audits).Error; err != nil {
		t.Fatal(err)
	}
	if audits != 1 {
		t.Fatalf("outbound policy audits = %d, want 1", audits)
	}
}

func TestSystemChannelOutboundURLFollowsAllowedModelOrigins(t *testing.T) {
	svc, db := newOutboundPolicyTestService(t)
	if _, err := svc.ValidateChannelOutboundURL("https://8.8.8.8/v1/chat/completions"); err != nil {
		t.Fatalf("empty allow list should keep the original behavior: %v", err)
	}
	setAllowedModelOrigins(t, svc, "https://8.8.8.8")
	if _, err := svc.ValidateChannelOutboundURL("https://8.8.8.8:443/v1/chat/completions"); err != nil {
		t.Fatalf("allowed origin rejected: %v", err)
	}
	for _, rawURL := range []string{"https://1.1.1.1/v1", "http://8.8.8.8/v1", "https://8.8.8.8:8443/v1"} {
		if _, err := svc.ValidateChannelOutboundURL(rawURL); err == nil || !strings.Contains(err.Error(), "不在允许的模型服务地址中") {
			t.Fatalf("ValidateChannelOutboundURL(%q) error = %v", rawURL, err)
		}
	}
	// 配置损坏时拒绝，不按空白放行。
	if err := db.Save(&model.SystemSetting{Key: outboundPolicySettingKey, ValueJSON: "not-json"}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ValidateChannelOutboundURL("https://8.8.8.8/v1"); err == nil {
		t.Fatal("corrupted outbound policy was treated as an empty allow list")
	}
}

func TestBackgroundTaskSystemChannelRequiresAllowedModelOrigin(t *testing.T) {
	svc, db := newOutboundPolicyTestService(t)
	channel := model.ModelChannel{ID: "system-channel", Name: "系统渠道", Scope: model.ChannelScopeSystem, Enabled: true, BaseURL: "https://8.8.8.8/v1", APIKey: "system-key", ModelsJSON: `["model-a"]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	setAllowedModelOrigins(t, svc, "https://api.example.com")
	if _, err := svc.resolveProviderConfig(providerConfig{ChannelID: channel.ID, Model: "model-a"}); err == nil || !strings.Contains(err.Error(), "不在允许的模型服务地址中") {
		t.Fatalf("resolveProviderConfig() error = %v, want allow list rejection", err)
	}
	// 放行后进入原有的模型授权检查（这里没有授权记录，因此报未授权模型）。
	setAllowedModelOrigins(t, svc, "https://8.8.8.8")
	if _, err := svc.resolveProviderConfig(providerConfig{ChannelID: channel.ID, Model: "model-a"}); err == nil || strings.Contains(err.Error(), "不在允许的模型服务地址中") {
		t.Fatalf("resolveProviderConfig() after allowing origin error = %v", err)
	}
}

func TestAdminChannelModelTestRequiresAllowedModelOrigin(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var hits atomic.Int64
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer upstream.Close()
	svc, db := newOutboundPolicyTestService(t)
	channel := model.ModelChannel{ID: "system-channel", Name: "系统渠道", Scope: model.ChannelScopeSystem, Enabled: true, BaseURL: upstream.URL + "/v1", APIKey: "system-key", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	setAllowedModelOrigins(t, svc, "https://api.example.com")
	request := ChannelModelRequest{ModelKey: "model-a", Capability: "text", Protocol: string(model.ChannelInterfaceChatCompletion), CapabilityConfig: DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "model-a")}
	if _, err := svc.TestAdminChannelModel(context.Background(), &model.User{ID: "admin-1", Role: model.UserRoleAdmin}, channel.ID, request); err == nil || !strings.Contains(err.Error(), "不在允许的模型服务地址中") {
		t.Fatalf("TestAdminChannelModel() error = %v, want allow list rejection", err)
	}
	if hits.Load() != 0 {
		t.Fatalf("blocked model test reached upstream %d times", hits.Load())
	}
}

func TestSystemChannelModelDiscoveryRequiresAllowedModelOrigin(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var hits atomic.Int64
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"model-a"}]}`))
	}))
	defer upstream.Close()
	svc, db := newOutboundPolicyTestService(t)
	channel := model.ModelChannel{ID: "system-channel", Name: "系统渠道", Scope: model.ChannelScopeSystem, Enabled: true, BaseURL: upstream.URL + "/v1", APIKey: "system-key", APIFormat: "openai", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	setAllowedModelOrigins(t, svc, "https://api.example.com")
	if _, err := svc.FetchAdminChannelModels(context.Background(), admin, channel.ID); err == nil || !strings.Contains(err.Error(), "不在允许的模型服务地址中") {
		t.Fatalf("FetchAdminChannelModels() error = %v", err)
	}
	if _, err := svc.fetchAdminChannelModelCatalog(context.Background(), admin, channel.ID); err == nil || !strings.Contains(err.Error(), "不在允许的模型服务地址中") {
		t.Fatalf("fetchAdminChannelModelCatalog() error = %v", err)
	}
	if hits.Load() != 0 {
		t.Fatalf("blocked discovery reached upstream %d times", hits.Load())
	}
	setAllowedModelOrigins(t, svc, upstream.URL)
	models, err := svc.fetchAdminChannelModelCatalog(context.Background(), admin, channel.ID)
	if err != nil || len(models) != 1 || models[0] != "model-a" || hits.Load() != 1 {
		t.Fatalf("allowed discovery = %#v, %v, hits %d", models, err, hits.Load())
	}
}
