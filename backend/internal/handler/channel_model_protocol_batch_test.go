package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestGroupedProtocolHTTPContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, path := range []string{"/api/admin/channels/channel/models/batch-protocol", "/api/admin/channel-models/batch-protocol"} {
		t.Run(path, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			sqlDB, err := db.DB()
			if err != nil {
				t.Fatal(err)
			}
			sqlDB.SetMaxOpenConns(1)
			t.Cleanup(func() { _ = sqlDB.Close() })
			if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.UserGroup{}, &model.UserGroupChannel{}, &model.ChannelWebsite{}, &model.ChannelProtocolSelection{}, &model.ModelChannel{}, &model.ChannelModel{}, &model.ChannelModelPriceTier{}, &model.IDSequence{}, &model.SystemSetting{}, &model.AdminAuditEvent{}); err != nil {
				t.Fatal(err)
			}
			for _, role := range []model.UserRole{model.UserRoleAdmin, model.UserRoleUser} {
				id := string(role)
				if err := db.Create(&model.User{ID: id, Username: id, Email: id + "@example.invalid", Role: role, Status: model.UserStatusActive}).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("protocol-test"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := db.Create(&model.ChannelWebsite{ID: "website", Scope: model.ChannelScopeSystem, Name: "test", BaseURL: "https://example.invalid"}).Error; err != nil {
				t.Fatal(err)
			}
			for _, channel := range []model.ModelChannel{
				{ID: "channel", WebsiteID: "website", Scope: model.ChannelScopeSystem, Enabled: true},
				{ID: "other", WebsiteID: "website", Scope: model.ChannelScopeSystem, Enabled: true},
				{ID: "personal", Scope: model.ChannelScopeUser, Enabled: true},
			} {
				if err := db.Create(&channel).Error; err != nil {
					t.Fatal(err)
				}
			}
			repo := repository.New(db)
			svc := service.New(repo, t.TempDir())
			admin, err := repo.User("admin")
			if err != nil {
				t.Fatal(err)
			}
			imageJSON, err := os.ReadFile("testdata/grouped_protocol_image_capability.json")
			if err != nil {
				t.Fatal(err)
			}
			var imageConfig service.ModelCapabilityConfig
			if err := json.Unmarshal(imageJSON, &imageConfig); err != nil {
				t.Fatal(err)
			}
			ids := make([]string, 0, 2)
			for _, spec := range []struct {
				capability, protocol string
				config               *service.ModelCapabilityConfig
			}{
				{"text", "chat-completion", service.DefaultModelCapabilityConfigForModel("chat-completion", "text-provider")},
				{"image", "openai-image", &imageConfig},
			} {
				row, err := svc.SaveAdminChannelModel(admin, "channel", "", service.ChannelModelRequest{
					ModelKey: spec.capability + "-model", ProviderModelKey: spec.capability + "-provider", DisplayName: "保留名称", Description: "保留备注",
					Capability: spec.capability, Protocol: spec.protocol, CapabilityConfig: spec.config,
					PriceTiers: []service.ChannelModelPriceTierRequest{{BillingMode: "fixed_request", PriceConfigured: true, UnitPriceMicrocredits: 12, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 5}}},
				})
				if err != nil {
					t.Fatal(err)
				}
				ids = append(ids, row.ID)
			}
			router := gin.New()
			RegisterFinanceRoutes(router.Group("/api"), svc)
			call := func(role, body string) *httptest.ResponseRecorder {
				r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
				r.Header.Set("Content-Type", "application/json")
				if role != "" {
					r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: role + ".protocol-test"})
				}
				w := httptest.NewRecorder()
				router.ServeHTTP(w, r)
				return w
			}
			encode := func(value any) string {
				data, err := json.Marshal(value)
				if err != nil {
					t.Fatal(err)
				}
				return string(data)
			}
			group := func(modelIDs []string, protocol string) any {
				return map[string]any{"modelIds": modelIDs, "protocol": protocol}
			}
			payload := func(groups ...any) string { return encode(map[string]any{"groups": groups}) }
			valid := payload(group(ids[:1], "openai-response"), group(ids[1:], "gemini-image"))
			snapshot := func() []any {
				rows, err := repo.ChannelModelsByIDs(ids)
				if err != nil {
					t.Fatal(err)
				}
				var memories []model.ChannelProtocolSelection
				var audits []model.AdminAuditEvent
				if err := db.Order("id").Find(&memories).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Order("id").Find(&audits).Error; err != nil {
					t.Fatal(err)
				}
				return []any{rows, memories, audits}
			}
			for _, role := range []string{"", "user"} {
				before := snapshot()
				response := call(role, valid)
				want := http.StatusForbidden
				if role == "" {
					want = http.StatusUnauthorized
				}
				if response.Code != want || !reflect.DeepEqual(before, snapshot()) {
					t.Fatalf("role=%q status=%d body=%s", role, response.Code, response.Body.String())
				}
			}
			many := make([]string, 101)
			for i := range many {
				many[i] = fmt.Sprintf("model-%d", i)
			}
			for _, bad := range []struct{ name, body string }{
				{"empty object", `{}`}, {"null object", `null`}, {"null groups", `{"groups":null}`}, {"empty groups", `{"groups":[]}`}, {"null group", `{"groups":[null]}`},
				{"unknown top", encode(map[string]any{"groups": []any{group(ids[:1], "openai-response")}, "extra": true})}, {"unknown group", payload(map[string]any{"modelIds": ids[:1], "protocol": "openai-response", "extra": true})},
				{"null ids", payload(map[string]any{"modelIds": nil, "protocol": "openai-response"})}, {"null id", `{"groups":[{"modelIds":[null],"protocol":"openai-response"}]}`},
				{"null protocol", payload(map[string]any{"modelIds": ids[:1], "protocol": nil})}, {"missing protocol", payload(map[string]any{"modelIds": ids[:1]})},
				{"empty ids", payload(group([]string{}, "openai-response"))}, {"blank id", payload(group([]string{" "}, "openai-response"))}, {"blank protocol", payload(group(ids[:1], " "))},
				{"mixed formats", encode(map[string]any{"groups": []any{group(ids[:1], "openai-response")}, "modelIds": ids, "protocol": "openai-response"})},
				{"mixed formats case alias", encode(map[string]any{"groups": []any{group(ids[:1], "openai-response")}, "Protocol": "openai-response"})},
				{"group case alias", payload(map[string]any{"modelIds": ids[:1], "protocol": "openai-response", "Protocol": "chat-completion"})},
				{"within group duplicate", payload(group([]string{ids[0], " " + ids[0] + " "}, "openai-response"))},
				{"across group duplicate", payload(group(ids[:1], "openai-response"), group(ids[:1], "openai-response"))},
				{"unknown second protocol", payload(group(ids[:1], "openai-response"), group(ids[1:], "missing-plugin"))},
				{"wrong second capability", payload(group(ids[:1], "openai-response"), group(ids[1:], "openai-response"))},
				{"missing model", payload(group(ids[:1], "openai-response"), group([]string{"missing"}, "gemini-image"))},
				{"five groups", payload(group(many[:1], "a"), group(many[1:2], "b"), group(many[2:3], "c"), group(many[3:4], "d"), group(many[4:5], "e"))},
				{"total limit", payload(group(many[:50], "openai-response"), group(many[50:], "gemini-image"))},
				{"trailing JSON", valid + ` {}`}, {"body limit", payload(group(ids[:1], strings.Repeat("x", 33<<10)))},
			} {
				t.Run(bad.name, func(t *testing.T) {
					before := snapshot()
					response := call("admin", bad.body)
					if response.Code != http.StatusBadRequest {
						t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
					}
					if !reflect.DeepEqual(before, snapshot()) {
						t.Fatal("rejected request changed models, prices, protocol memory or audit")
					}
				})
			}
			for _, channelID := range []string{"other", "personal"} {
				if err := db.Model(&model.ChannelModel{}).Where("id = ?", ids[1]).Update("channel_id", channelID).Error; err != nil {
					t.Fatal(err)
				}
				if path == "/api/admin/channel-models/batch-protocol" && channelID == "other" {
					continue
				}
				before := snapshot()
				response := call("admin", valid)
				if response.Code != http.StatusBadRequest || !reflect.DeepEqual(before, snapshot()) {
					t.Fatalf("channel=%s status=%d body=%s", channelID, response.Code, response.Body.String())
				}
			}
			channelID := "channel"
			if path == "/api/admin/channel-models/batch-protocol" {
				channelID = "other"
			}
			if err := db.Model(&model.ChannelModel{}).Where("id = ?", ids[1]).Update("channel_id", channelID).Error; err != nil {
				t.Fatal(err)
			}
			before, err := repo.ChannelModelsByIDs(ids)
			if err != nil {
				t.Fatal(err)
			}
			response := call("admin", valid)
			if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"updated":2`) {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			after, err := repo.ChannelModelsByIDs(ids)
			if err != nil {
				t.Fatal(err)
			}
			for i := range before {
				want := "openai-response"
				if after[i].Capability == "image" {
					want = "gemini-image"
				}
				if string(after[i].Protocol) != want {
					t.Fatalf("incorrect protocol=%s", after[i].Protocol)
				}
				after[i].Protocol = before[i].Protocol
				after[i].CapabilityConfigJSON = before[i].CapabilityConfigJSON
				after[i].CapabilityVersion = before[i].CapabilityVersion
				after[i].UpdatedAt = before[i].UpdatedAt
				if !reflect.DeepEqual(before[i], after[i]) {
					t.Fatal("successful request changed model metadata, price or cost")
				}
			}
			legacy := encode(map[string]any{"modelIds": []string{ids[0], ids[0]}, "protocol": "chat-completion"})
			response = call("admin", legacy)
			if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"updated":1`) {
				t.Fatalf("legacy duplicate compatibility status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}
