package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
	"yingce/backend/internal/storage"
)

func TestResourceProxyCancelsOriginOnClientDisconnect(t *testing.T) {
	for _, test := range []struct {
		name, phase, path, owner string
	}{
		{"processing headers", "headers", "/api/resources/image/file?purpose=ecommerce-export", "owner"},
		{"processing body", "body", "/api/resources/image/file?purpose=ecommerce-export", "owner"},
		{"transcode headers", "headers", "/api/resources/image/file?format=jpeg", "owner"},
		{"transcode body", "body", "/api/resources/image/file?format=jpeg", "owner"},
		{"team headers", "headers", "/api/teams/team/workspace/resources/image/file", model.TeamContentKey("team")},
		{"team body", "body", "/api/teams/team/workspace/resources/image/file", model.TeamContentKey("team")},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
			for _, name := range []string{"HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"} {
				t.Setenv(name, "")
			}
			started, stopped, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
			var reads atomic.Int32
			origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if reads.Add(1) != 1 {
					t.Error("canceled resource started another origin read")
					return
				}
				if test.phase == "body" {
					w.Header().Set("Content-Length", "6")
					w.WriteHeader(http.StatusOK)
					_, _ = w.Write([]byte("x"))
					w.(http.Flusher).Flush()
				}
				close(started)
				select {
				case <-r.Context().Done():
					close(stopped)
				case <-release:
				}
			}))
			defer origin.Close()
			dir := t.TempDir()
			db, err := database.Open(database.Config{Driver: "sqlite", DataDir: dir})
			if err != nil {
				t.Fatal(err)
			}
			sqlDB, _ := db.DB()
			defer sqlDB.Close()
			if err := db.AutoMigrate(database.Models()...); err != nil {
				t.Fatal(err)
			}
			setting := storage.Settings{Enabled: true, Provider: "s3", S3Preset: "custom", Endpoint: origin.URL, Region: "us-east-1", Bucket: "bucket", PathStyle: true, AccessKeyID: "test-id", AccessKeySecret: "test-secret"}
			encoded, err := json.Marshal(setting)
			if err != nil {
				t.Fatal(err)
			}
			for _, row := range []any{
				&model.User{ID: "owner", Username: "owner", Role: model.UserRoleUser, Status: model.UserStatusActive},
				&model.AuthSession{ID: "session", UserID: "owner", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
				&model.SystemSetting{Key: "oss", ValueJSON: string(encoded)},
				&model.SystemSetting{Key: "feature_availability", ValueJSON: `{"teamsEnabled":true}`},
				&model.Team{ID: "team", Name: "team", OwnerUserID: "owner", Status: model.TeamActive},
				&model.TeamMembership{ID: "membership", TeamID: "team", UserID: "owner", Role: model.TeamOwner, Status: model.TeamActive},
				&model.Resource{ID: "image", UserID: test.owner, Kind: "image", Status: model.ResourceStatusReady, Provider: "s3", Endpoint: origin.URL, Bucket: "bucket", ObjectKey: "image.png", MimeType: "image/png", Size: 6},
			} {
				if err := db.Create(row).Error; err != nil {
					t.Fatal(err)
				}
			}
			svc := service.New(repository.New(db), dir)
			defer svc.Close()
			gin.SetMode(gin.TestMode)
			router := gin.New()
			finished := make(chan struct{})
			router.Use(func(c *gin.Context) { c.Next(); close(finished) })
			RegisterUserDataRoutes(router.Group("/api"), svc)
			RegisterTeamWorkspaceRoutes(router.Group("/api"), svc)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			req := httptest.NewRequest(http.MethodGet, test.path, nil).WithContext(ctx)
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "session.test-token"})
			recorder := httptest.NewRecorder()
			go router.ServeHTTP(recorder, req)
			defer func() {
				cancel()
				close(release)
				select {
				case <-finished:
				case <-time.After(5 * time.Second):
					t.Error("resource handler did not stop during cleanup")
				}
			}()
			select {
			case <-started:
			case <-finished:
				t.Fatalf("origin was not read: status %d, body %s", recorder.Code, recorder.Body.String())
			case <-time.After(5 * time.Second):
				t.Fatal("origin request did not start")
			}
			cancel()
			select {
			case <-stopped:
			case <-time.After(2 * time.Second):
				t.Error("origin kept waiting after the client disconnected")
			}
			select {
			case <-finished:
			case <-time.After(2 * time.Second):
				t.Error("resource handler did not release its request")
			}
			if reads.Load() != 1 {
				t.Errorf("origin reads = %d, want 1", reads.Load())
			}
		})
	}
}
