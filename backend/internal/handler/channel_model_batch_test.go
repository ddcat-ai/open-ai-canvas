package handler

import (
	"bytes"
	"encoding/json"
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

func TestBatchModelUpdateHTTPContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
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
		if err := db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("batch-test"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	channel := model.ModelChannel{ID: "batch-channel", Scope: model.ChannelScopeSystem, Enabled: true, ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	admin, _ := repository.New(db).User("admin")
	item, err := svc.SaveAdminChannelModel(admin, channel.ID, "", service.ChannelModelRequest{ModelKey: "model", Capability: "text", Protocol: string(model.ChannelInterfaceChatCompletion), CapabilityConfig: service.DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "model"), PriceTiers: []service.ChannelModelPriceTierRequest{{BillingMode: "fixed_request", PriceConfigured: true, UnitPriceMicrocredits: 12}}})
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	RegisterFinanceRoutes(router.Group("/api"), svc)
	call := func(role, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if role != "" {
			r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: role + ".batch-test"})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	payload := func(changes any) string {
		latest, _ := repository.New(db).ChannelModelByID(channel.ID, item.ID)
		data, _ := json.Marshal(map[string]any{"models": []any{map[string]any{"modelId": latest.ID, "priceVersion": latest.PriceVersion, "capabilityVersion": latest.CapabilityVersion, "updatedAt": latest.UpdatedAt.Format(time.RFC3339Nano), "changes": changes}}})
		return string(data)
	}
	for _, path := range []string{"/api/admin/channels/" + channel.ID + "/models/batch-update", "/api/admin/channel-models/batch-update"} {
		for _, role := range []string{"", "user"} {
			w := call(role, path, payload(map[string]any{"enabled": false}))
			want := http.StatusForbidden
			if role == "" {
				want = http.StatusUnauthorized
			}
			if w.Code != want {
				t.Fatalf("role=%s status=%d body=%s", role, w.Code, w.Body.String())
			}
		}
		for _, bad := range []string{`{}`, `null`, `{"models":null}`, `{"models":[]}`, payload(map[string]any{}), payload(map[string]any{"enabled": nil}), payload(map[string]any{"apiKey": "secret"}), payload(map[string]any{"capabilityTemplate": map[string]any{"protocol": "chat-completion", "capabilityConfig": map[string]any{"version": 1, "unknown": true}}}), payload(map[string]any{"description": strings.Repeat("a", 2<<20)})} {
			w := call("admin", path, bad)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("invalid status=%d body=%s", w.Code, w.Body.String())
			}
		}
		body := payload(map[string]any{"description": "批量备注", "enabled": false, "pricingEnabled": false})
		w := call("admin", path, body)
		if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(`"updated":1`)) {
			t.Fatalf("save status=%d body=%s", w.Code, w.Body.String())
		}
		w = call("admin", path, body)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("stale request status=%d body=%s", w.Code, w.Body.String())
		}
		stored, _ := repository.New(db).ChannelModelByID(channel.ID, item.ID)
		if stored.Enabled || stored.PriceTiers[0].Enabled || !stored.PriceTiers[0].PriceConfigured || stored.PriceTiers[0].UnitPriceMicrocredits != 12 {
			t.Fatalf("stored=%+v", stored)
		}
		for _, legacy := range []string{"", "removed-plugin"} {
			config := service.DefaultModelCapabilityConfig("chat-completion")
			config.Text.References.MaxImages = 2
			config.Text.References.MaxImageBytes = 8 << 20
			template := map[string]any{"capabilityConfig": config}
			if legacy != "" {
				template["protocol"] = legacy
			}
			w = call("admin", path, payload(map[string]any{"capabilityTemplate": template}))
			if w.Code != http.StatusOK {
				t.Fatalf("template update failed: status=%d body=%s", w.Code, w.Body.String())
			}
			updated, _ := repository.New(db).ChannelModelByID(channel.ID, item.ID)
			if updated.Protocol != stored.Protocol || updated.PriceVersion != stored.PriceVersion || updated.PriceTiers[0].UnitPriceMicrocredits != 12 || !strings.Contains(updated.CapabilityConfigJSON, `"maxImages":2`) {
				t.Fatalf("template changed protocol/prices or lost capability: %+v", updated)
			}
		}
	}

	for i, path := range []string{"/api/admin/channels/" + channel.ID + "/models/batch-update", "/api/admin/channel-models/batch-update"} {
		fresh := model.ChannelModel{ID: "unconfigured-" + string(rune('a'+i)), ChannelID: channel.ID, ModelKey: "new-image-" + string(rune('a'+i)), DisplayName: "未分类", BillingMode: "fixed_request", PriceVersion: 1}
		if err := db.Create(&fresh).Error; err != nil {
			t.Fatal(err)
		}
		requestFor := func(id string, changes any) any {
			row, err := repository.New(db).ChannelModelByID(channel.ID, id)
			if err != nil {
				t.Fatal(err)
			}
			return map[string]any{"modelId": id, "priceVersion": row.PriceVersion, "capabilityVersion": row.CapabilityVersion, "updatedAt": row.UpdatedAt.Format(time.RFC3339Nano), "changes": changes}
		}
		snapshot := func() string {
			var rows []model.ChannelModel
			var tiers []model.ChannelModelPriceTier
			var channels []model.ModelChannel
			var selections []model.ChannelProtocolSelection
			var audits []model.AdminAuditEvent
			var sequences []model.IDSequence
			for _, target := range []any{&rows, &tiers, &channels, &selections, &audits} {
				if err := db.Order("id").Find(target).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := db.Order("name").Find(&sequences).Error; err != nil {
				t.Fatal(err)
			}
			value, err := json.Marshal([]any{rows, tiers, channels, selections, audits, sequences})
			if err != nil {
				t.Fatal(err)
			}
			return string(value)
		}
		for _, changes := range []any{
			map[string]any{"capability": nil, "protocol": "openai-image"},
			map[string]any{"capability": "image", "protocol": nil},
			map[string]any{"capability": "", "protocol": "openai-image"},
			map[string]any{"capability": "unknown", "protocol": "openai-image"},
			map[string]any{"capability": "image", "protocol": ""},
			map[string]any{"capability": "image", "protocol": "chat-completion"},
			map[string]any{"capability": "image", "protocol": "openai-image", "unexpected": true},
			map[string]any{"capability": "image", "capabilityTemplate": map[string]any{"protocol": "openai-image", "capabilityConfig": service.DefaultModelCapabilityConfig("openai-image")}},
		} {
			before := snapshot()
			body, err := json.Marshal(map[string]any{"models": []any{requestFor(item.ID, map[string]any{"description": "must roll back"}), requestFor(fresh.ID, changes)}})
			if err != nil {
				t.Fatal(err)
			}
			response := call("admin", path, string(body))
			if response.Code != http.StatusBadRequest {
				t.Fatalf("invalid unified request accepted: status=%d body=%s", response.Code, response.Body.String())
			}
			if after := snapshot(); before != after {
				t.Fatal("rejected new-model configuration changed persistent state")
			}
		}
		config := service.DefaultModelCapabilityConfig("openai-image")
		config.Image.References.MaxImageBytes = 10 << 20
		changes := map[string]any{
			"capability": "image", "protocol": "openai-image", "enabled": true, "pricingEnabled": true,
			"capabilityTemplate": map[string]any{"capabilityConfig": config},
			"pricingTemplate": map[string]any{"priceCurrency": "credits", "referenceVideoBilling": false, "priceTiers": []any{
				map[string]any{"billingMode": "fixed_request", "unitPriceMicrocredits": 23, "priceConfigured": true, "enabled": true},
			}},
		}
		body, err := json.Marshal(map[string]any{"models": []any{requestFor(item.ID, map[string]any{"protocol": "openai-response"}), requestFor(fresh.ID, changes)}})
		if err != nil {
			t.Fatal(err)
		}
		response := call("admin", path, string(body))
		if response.Code != http.StatusOK || !bytes.Contains(response.Body.Bytes(), []byte(`"updated":2`)) {
			t.Fatalf("unified setup failed: status=%d body=%s", response.Code, response.Body.String())
		}
		stored, _ := repository.New(db).ChannelModelByID(channel.ID, fresh.ID)
		if stored.Capability != "image" || stored.Protocol != model.ChannelInterfaceOpenAIImage || !stored.Enabled || !stored.PriceConfigured || stored.CapabilityVersion != 1 || stored.PriceTiers[0].UnitPriceMicrocredits != 23 {
			t.Fatalf("new model setup was not persisted: %+v", stored)
		}
		currentText, _ := repository.New(db).ChannelModelByID(channel.ID, item.ID)
		if currentText.Capability != "text" || currentText.Protocol != model.ChannelInterfaceOpenAIResponse || currentText.PriceTiers[0].UnitPriceMicrocredits != 12 || currentText.PriceTiers[0].Enabled {
			t.Fatal("mixed setup changed the existing type or prices")
		}
		before := snapshot()
		body, err = json.Marshal(map[string]any{"models": []any{requestFor(item.ID, map[string]any{"capability": "image", "protocol": "openai-image"})}})
		if err != nil {
			t.Fatal(err)
		}
		response = call("admin", path, string(body))
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "已有模型类型") || before != snapshot() {
			t.Fatalf("existing type changed: status=%d body=%s", response.Code, response.Body.String())
		}
	}

	video, err := svc.SaveAdminChannelModel(admin, channel.ID, "", service.ChannelModelRequest{ModelKey: "video-model", Capability: "video", Protocol: string(model.ChannelInterfaceNewAPIVideo), CapabilityConfig: service.DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceNewAPIVideo), "video-model"), PriceTiers: []service.ChannelModelPriceTierRequest{{BillingMode: "fixed_request", PriceConfigured: true, UnitPriceMicrocredits: 31}}})
	if err != nil {
		t.Fatal(err)
	}
	// Compare the whole affected persistence surface, including the ID sequence
	// allocated while normalizing templates, not just the response status.
	snapshot := func() []byte {
		t.Helper()
		models, err := repository.New(db).ChannelModelsByIDs([]string{item.ID, video.ID})
		if err != nil {
			t.Fatal(err)
		}
		var storedChannel model.ModelChannel
		var sequences []model.IDSequence
		var audits []model.AdminAuditEvent
		if err := db.First(&storedChannel, "id = ?", channel.ID).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Order("name").Find(&sequences).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Order("id").Find(&audits).Error; err != nil {
			t.Fatal(err)
		}
		result, err := json.Marshal([]any{models, storedChannel, sequences, audits})
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	for _, path := range []string{"/api/admin/channels/" + channel.ID + "/models/batch-update", "/api/admin/channel-models/batch-update"} {
		for _, scenario := range []struct {
			name      string
			selectors []map[string]string
		}{
			{"wildcard equivalent", []map[string]string{{}, {"operation": "*"}}},
			{"wildcard cross overlap", []map[string]string{{"operation": "*", "vquality": "720p"}, {"videoSeconds": "5"}}},
		} {
			t.Run(path+"/"+scenario.name, func(t *testing.T) {
				before := snapshot()
				tiers := make([]any, 0, len(scenario.selectors))
				for i, selector := range scenario.selectors {
					tiers = append(tiers, map[string]any{"selector": selector, "billingMode": "fixed_request", "unitPriceMicrocredits": 100 + i, "priceConfigured": true, "enabled": true})
				}
				requestFor := func(id string, changes any) any {
					row, err := repository.New(db).ChannelModelByID(channel.ID, id)
					if err != nil {
						t.Fatal(err)
					}
					return map[string]any{"modelId": id, "priceVersion": row.PriceVersion, "capabilityVersion": row.CapabilityVersion, "updatedAt": row.UpdatedAt.Format(time.RFC3339Nano), "changes": changes}
				}
				body, err := json.Marshal(map[string]any{"models": []any{
					requestFor(item.ID, map[string]any{"description": "must roll back"}),
					requestFor(video.ID, map[string]any{"pricingTemplate": map[string]any{"priceCurrency": "credits", "referenceVideoBilling": false, "priceTiers": tiers}}),
				}})
				if err != nil {
					t.Fatal(err)
				}
				response := call("admin", path, string(body))
				if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "重叠") {
					t.Fatalf("expected overlapping-tier rejection: status=%d body=%s", response.Code, response.Body.String())
				}
				if after := snapshot(); !bytes.Equal(before, after) {
					t.Fatal("rejected overlap changed models, tiers, channel, sequence or audit")
				}
			})
		}
	}
	for _, path := range []string{"/api/admin/channels/" + channel.ID + "/models/batch-update", "/api/admin/channel-models/batch-update"} {
		freeTemplate := map[string]any{"priceCurrency": "credits", "referenceVideoBilling": false, "priceTiers": []any{
			map[string]any{"billingMode": "fixed_request", "unitPriceMicrocredits": 0, "priceConfigured": true, "enabled": true},
		}}
		response := call("admin", path, payload(map[string]any{"pricingTemplate": freeTemplate}))
		if response.Code != http.StatusOK {
			t.Fatalf("save explicit free price: status=%d body=%s", response.Code, response.Body.String())
		}
		for _, enabled := range []bool{false, true} {
			response := call("admin", path, payload(map[string]any{"pricingEnabled": enabled}))
			if response.Code != http.StatusOK {
				t.Fatalf("free price availability=%t: status=%d body=%s", enabled, response.Code, response.Body.String())
			}
			stored, err := repository.New(db).ChannelModelByID(channel.ID, item.ID)
			if err != nil {
				t.Fatal(err)
			}
			if len(stored.PriceTiers) != 1 || !stored.PriceTiers[0].PriceConfigured || stored.PriceTiers[0].Enabled != enabled || stored.PriceTiers[0].UnitPriceMicrocredits != 0 || stored.PriceConfigured != enabled {
				t.Fatalf("free price or availability changed: %+v", stored)
			}
		}
	}
	frontendJSON, err := os.ReadFile("testdata/batch_template_availability.json")
	if err != nil {
		t.Fatal(err)
	}
	var frontendCases []struct {
		Name     string          `json:"name"`
		Apply    json.RawMessage `json:"apply"`
		Reenable json.RawMessage `json:"reenable"`
	}
	if err := json.Unmarshal(frontendJSON, &frontendCases); err != nil {
		t.Fatal(err)
	}
	// Only identity/version fields are rebound to the isolated model;
	// submitted changes remain the frontend builder's exact JSON payload.
	bindFrontendRequest := func(raw json.RawMessage) string {
		t.Helper()
		var body map[string][]map[string]any
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Fatal(err)
		}
		latest, err := repository.New(db).ChannelModelByID(channel.ID, item.ID)
		if err != nil || len(body["models"]) != 1 {
			t.Fatalf("load current model or fixture: %v", err)
		}
		request := body["models"][0]
		request["modelId"], request["priceVersion"] = latest.ID, latest.PriceVersion
		request["capabilityVersion"], request["updatedAt"] = latest.CapabilityVersion, latest.UpdatedAt.Format(time.RFC3339Nano)
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		return string(encoded)
	}
	for _, path := range []string{"/api/admin/channels/" + channel.ID + "/models/batch-update", "/api/admin/channel-models/batch-update"} {
		for _, scenario := range frontendCases {
			t.Run("frontend-template/"+scenario.Name+path, func(t *testing.T) {
				response := call("admin", path, bindFrontendRequest(scenario.Apply))
				if response.Code != http.StatusOK {
					t.Fatalf("frontend apply+disable: status=%d body=%s", response.Code, response.Body.String())
				}
				disabled, err := repository.New(db).ChannelModelByID(channel.ID, item.ID)
				if err != nil || len(disabled.PriceTiers) != 1 {
					t.Fatalf("read disabled model: %v", err)
				}
				tier := disabled.PriceTiers[0]
				if disabled.PriceConfigured || tier.Enabled || !tier.PriceConfigured || tier.UnitPriceMicrocredits != 0 || !tier.CostPricing.Configured || tier.CostPricing.UnitPriceMicrocredits != 250_000 {
					t.Fatalf("frontend template lost prices/configured marker: %+v", disabled)
				}
				if scenario.Name == "zero-token-cache" && (tier.BillingMode != "token" || tier.InputTokenPriceMicrocredits != 1_000_000 || tier.OutputTokenPriceMicrocredits != 2_000_000 || tier.CachedTokenPriceMicrocredits != 0 || tier.CacheWriteTokenPriceMicrocredits != 0) {
					t.Fatalf("frontend token template prices changed: %+v", tier)
				}
				response = call("admin", path, bindFrontendRequest(scenario.Reenable))
				if response.Code != http.StatusOK {
					t.Fatalf("frontend reenable: status=%d body=%s", response.Code, response.Body.String())
				}
				enabled, err := repository.New(db).ChannelModelByID(channel.ID, item.ID)
				if err != nil || !enabled.PriceConfigured || len(enabled.PriceTiers) != 1 || !enabled.PriceTiers[0].Enabled {
					t.Fatalf("read reenabled model: %+v err=%v", enabled, err)
				}
				actual := enabled.PriceTiers[0]
				actual.Enabled, actual.PriceVersion, actual.UpdatedAt = tier.Enabled, tier.PriceVersion, tier.UpdatedAt
				if !reflect.DeepEqual(actual, tier) {
					t.Fatal("frontend roundtrip changed prices, costs or SKU")
				}
			})
		}
	}
}
