package handler

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestTeamAssetHTTPPublicationMediaRangeAndMemberRevocation(t *testing.T) {
	dir := t.TempDir()
	db, err := database.Open(database.Config{Driver: "sqlite", DataDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"owner", "contributor", "stranger"} {
		if err := db.Create(&model.User{ID: id, Username: id, Status: model.UserStatusActive, Role: model.UserRoleUser}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("team-media-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.Team{ID: "team", Name: "创作团队", OwnerUserID: "owner", Status: model.TeamActive}).Error; err != nil {
		t.Fatal(err)
	}
	for _, row := range []model.TeamMembership{
		{ID: "owner", TeamID: "team", UserID: "owner", Role: model.TeamOwner, Status: model.TeamActive},
		{ID: "contributor", TeamID: "team", UserID: "contributor", Role: model.TeamMember, Status: model.TeamActive},
	} {
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	var picture bytes.Buffer
	if err := png.Encode(&picture, image.NewRGBA(image.Rect(0, 0, 2, 3))); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "resources"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "resources", "personal.png"), picture.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Resource{ID: "personal-media", UserID: "contributor", Kind: "image", Provider: "local", ObjectKey: "personal.png", MimeType: "image/png", Size: int64(picture.Len()), Width: 2, Height: 3, Status: model.ResourceStatusReady}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Asset{ID: "personal-asset", UserID: "contributor", Title: "参考图", Kind: "image", PayloadJSON: `{"data":{"storageKey":"resource:personal-media"}}`}).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dir)
	t.Cleanup(func() {
		if err := svc.Close(); err != nil {
			t.Errorf("close team test service: %v", err)
		}
	})
	gin.SetMode(gin.TestMode)
	router := gin.New()
	if err := db.Create(&model.SystemSetting{Key: "feature_availability", ValueJSON: `{"teamsEnabled":true}`}).Error; err != nil {
		t.Fatal(err)
	}
	RegisterTeamWorkspaceRoutes(router.Group("/api"), svc)
	rec := profileRequest(router, http.MethodPost, "/api/teams/team/asset-publications", `{"assetIds":["personal-asset"],"idempotencyKey":"publish-media"}`, "contributor.team-media-token")
	if rec.Code != http.StatusOK {
		t.Fatalf("publish status %d: %s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Data struct {
			Results []struct {
				Asset struct{ ID string } `json:"asset"`
			} `json:"results"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if len(envelope.Data.Results) != 1 || envelope.Data.Results[0].Asset.ID == "" {
		t.Fatalf("missing published resource: %s", rec.Body.String())
	}
	rec = profileRequest(router, "GET", "/api/teams/team/workspace/assets/"+envelope.Data.Results[0].Asset.ID, "", "owner.team-media-token")
	var asset struct {
		Data struct {
			Asset struct{ Data struct{ DataURL string } }
		}
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &asset); err != nil {
		t.Fatal(err)
	}
	url := asset.Data.Asset.Data.DataURL
	get := func(user, method, byteRange string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, url, nil)
		if user != "" {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: user + ".team-media-token"})
		}
		if byteRange != "" {
			req.Header.Set("Range", byteRange)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}
	rec = get("owner", http.MethodGet, "bytes=2-8")
	if rec.Code != http.StatusPartialContent || !bytes.Equal(rec.Body.Bytes(), picture.Bytes()[2:9]) {
		t.Fatalf("range result %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Cache-Control") != "private, no-store" || !strings.Contains(rec.Header().Get("Content-Range"), "bytes 2-8/") {
		t.Fatalf("unsafe media headers: %#v", rec.Header())
	}
	if rec := get("owner", http.MethodHead, ""); rec.Code != http.StatusOK || rec.Body.Len() != 0 {
		t.Fatalf("HEAD failed: %d %s", rec.Code, rec.Body.String())
	}
	if rec := get("", http.MethodGet, ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous access: %d", rec.Code)
	}
	if rec := get("stranger", http.MethodGet, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("stranger access: %d", rec.Code)
	}
	if err := db.Model(&model.TeamMembership{}).Where("id = ?", "contributor").Update("status", model.TeamLeft).Error; err != nil {
		t.Fatal(err)
	}
	if rec := get("contributor", http.MethodGet, "bytes=0-4"); rec.Code != http.StatusForbidden {
		t.Fatalf("departed contributor reused old URL: %d", rec.Code)
	}
	if rec := get("owner", http.MethodGet, ""); rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), picture.Bytes()) {
		t.Fatalf("team lost contributed media: %d", rec.Code)
	}
}
