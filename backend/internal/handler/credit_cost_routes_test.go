package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/auth"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestChannelCostHTTPAuthorizationAndPublicProjection(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.ModelChannel{}, &model.ChannelModel{}, &model.ChannelModelPriceTier{}, &model.IDSequence{}, &model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	for _, role := range []model.UserRole{model.UserRoleAdmin, model.UserRoleUser} {
		id := string(role)
		if err := db.Create(&model.User{ID: id, Username: id, Email: id + "@example.invalid", Role: role, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	channel := model.ModelChannel{ID: "channel", Name: "渠道", Scope: model.ChannelScopeSystem, Enabled: true, ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	router := gin.New()
	RegisterFinanceRoutes(router.Group("/api"), svc)
	RegisterModelCatalogRoutes(router.Group("/api"), svc)
	request := service.ChannelModelRequest{ModelKey: "text-model", DisplayName: "文本模型", ChannelLabel: "优惠渠道", Capability: "text", Protocol: string(model.ChannelInterfaceChatCompletion), CapabilityConfig: service.DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-model"), PriceTiers: []service.ChannelModelPriceTierRequest{{BillingMode: "fixed_request", UnitPriceMicrocredits: 900_000, PriceConfigured: true, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 123_456}}}}
	body, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	call := func(role, method, path string, payload []byte) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, bytes.NewReader(payload))
		r.Header.Set("Content-Type", "application/json")
		if role != "" {
			r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: role + ".test-token"})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		for _, role := range []string{"", "user"} {
			w := call(role, method, "/api/admin/channels/channel/models", body)
			want := http.StatusForbidden
			if role == "" {
				want = http.StatusUnauthorized
			}
			if w.Code != want {
				t.Fatalf("%s %s: %d %s", role, method, w.Code, w.Body.String())
			}
		}
	}
	for _, method := range []string{http.MethodPost, http.MethodGet} {
		w := call("admin", method, "/api/admin/channels/channel/models", body)
		if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"costPricing":`) || !strings.Contains(w.Body.String(), "123456") {
			t.Fatalf("admin cost missing: %d %s", w.Code, w.Body.String())
		}
	}
	for _, path := range []string{"/api/model-catalog", "/api/model-catalog/available", "/api/model-catalog/quote"} {
		method := http.MethodPost
		payload := []byte(`{"capability":"text"}`)
		if path == "/api/model-catalog" {
			method = http.MethodGet
			payload = nil
		}
		if strings.HasSuffix(path, "/quote") {
			payload = []byte(`{"channelId":"channel","modelKey":"text-model","intent":{"capability":"text","operation":"text_generation","inputs":{"text":1}}}`)
		}
		w := call("user", method, path, payload)
		if w.Code != http.StatusOK {
			t.Fatalf("public %s: %d %s", path, w.Code, w.Body.String())
		}
		if strings.Contains(w.Body.String(), "costPricing") || strings.Contains(w.Body.String(), "123456") {
			t.Fatalf("public cost leaked: %s", w.Body.String())
		}
	}
}
