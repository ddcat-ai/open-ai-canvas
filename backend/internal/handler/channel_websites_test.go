package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

func TestChannelWebsiteHTTPAdminAndTwoKeys(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.ModelChannel{}, &model.ChannelModel{}, &model.ChannelModelPriceTier{}, &model.ChannelWebsite{}, &model.ChannelProtocolSelection{}, &model.ChannelCatalogSnapshot{}, &model.IDSequence{}, &model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"admin", "user"} {
		role := model.UserRoleUser
		if id == "admin" {
			role = model.UserRoleAdmin
		}
		db.Create(&model.User{ID: id, Username: id, Email: id + "@example.invalid", Role: role, Status: model.UserStatusActive})
		db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("fixture-session"), ExpiresAt: time.Now().Add(time.Hour)})
	}
	dataDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dataDir, ".settings-key"), []byte("0123456789abcdef0123456789abcdef"), 0o600); err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dataDir)
	previousRuntime := runtimeService
	runtimeService = svc
	t.Cleanup(func() { runtimeService = previousRuntime })
	router := gin.New()
	group := router.Group("/api")
	registerAdminChannelRoutes(group, svc)
	RegisterFinanceRoutes(group, svc)
	call := func(actor, method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api"+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if actor != "" {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: actor + ".fixture-session"})
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		return res
	}
	for _, spec := range []struct {
		actor string
		want  int
	}{{"", 401}, {"user", 403}} {
		if res := call(spec.actor, "GET", "/admin/channel-websites", ""); res.Code != spec.want {
			t.Fatalf("authorization %s: %d", spec.actor, res.Code)
		}
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := "model-a"
		if r.Header.Get("Authorization") == "Bearer fixture-b" {
			name = "model-b"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{{"id": name}}})
	}))
	defer upstream.Close()
	createSite, _ := json.Marshal(map[string]any{"name": "Website", "baseUrl": upstream.URL + "/v1", "apiFormat": "openai"})
	res := call("admin", "POST", "/admin/channel-websites", string(createSite))
	if res.Code != 200 {
		t.Fatal(res.Body.String())
	}
	var siteBody struct {
		Data struct {
			Website model.ChannelWebsite `json:"website"`
		} `json:"data"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &siteBody); err != nil {
		t.Fatal(err)
	}
	if siteBody.Data.Website.ID == "" {
		t.Fatal("site missing")
	}
	for _, key := range []string{"a", "b"} {
		body, _ := json.Marshal(map[string]any{"name": "Key " + key, "websiteId": siteBody.Data.Website.ID, "apiKey": "fixture-" + key})
		res = call("admin", "POST", "/admin/channels", string(body))
		if res.Code != 200 {
			t.Fatal(res.Body.String())
		}
		var created struct {
			Data struct {
				Channel struct {
					ID        string `json:"id"`
					WebsiteID string `json:"websiteId"`
				} `json:"channel"`
			} `json:"data"`
		}
		if err := json.Unmarshal(res.Body.Bytes(), &created); err != nil {
			t.Fatal(err)
		}
		if created.Data.Channel.WebsiteID != siteBody.Data.Website.ID {
			t.Fatal("group detached")
		}
		res = call("admin", "POST", "/admin/channels/"+created.Data.Channel.ID+"/models/fetch", "")
		if res.Code != 200 || !strings.Contains(res.Body.String(), "model-"+key) {
			t.Fatalf("wrong key catalog: %d %s", res.Code, res.Body.String())
		}
		if strings.Contains(res.Body.String(), "fixture-") {
			t.Fatal("catalog leaked key")
		}
	}
}
