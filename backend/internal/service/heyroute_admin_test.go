package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestHeyrouteAdminProbeUsesModelDuration(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, tc := range []struct {
		name    string
		seconds int
	}{{"seedance-2.0", 15}, {"seedance-2.0-fast", 15}, {"grok-video", 6}} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				var payload map[string]any
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Error(err)
				}
				if r.URL.Path != "/v1/videos" || payload["seconds"] != strconv.Itoa(tc.seconds) {
					t.Errorf("wrong probe: path=%s seconds=%v", r.URL.Path, payload["seconds"])
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":{"message":"fixture: request captured; no generation"}}`))
			}))
			defer upstream.Close()
			dataDir := t.TempDir()
			db, err := database.Open(database.Config{Driver: "sqlite", DataDir: dataDir})
			if err != nil {
				t.Fatal(err)
			}
			if err := database.MigrateSchema(db); err != nil {
				t.Fatal(err)
			}
			svc := NewWithRuntimeCapabilities(repository.New(db), dataDir, RuntimeCapabilities{desktopLocalChannels: true})
			defer svc.Close()
			actor := &model.User{ID: "fixture-admin", Role: model.UserRoleAdmin}
			channel := model.ModelChannel{ID: "fixture-channel", UserID: actor.ID, Scope: model.ChannelScopeSystem, BaseURL: upstream.URL, APIKey: "test-placeholder", APIFormat: "openai", Enabled: true, AllowLocalChannel: true}
			if err := db.Create(&channel).Error; err != nil {
				t.Fatal(err)
			}
			_, err = svc.TestAdminChannelModel(context.Background(), actor, channel.ID, ChannelModelRequest{ModelKey: tc.name, Capability: "video", Protocol: "heyroute-video", CapabilityConfig: DefaultModelCapabilityConfigForModel("heyroute-video", tc.name)})
			if err == nil {
				t.Fatal("expected fixture upstream rejection")
			}
			if calls.Load() != 1 {
				t.Fatalf("expected one valid probe request, got %d: %v", calls.Load(), err)
			}
		})
	}
}
