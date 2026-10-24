package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestHandwrittenImageURLCanPreviewAndReuseWhileSaving(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	s, db := newMediaRecoveryTestService(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()
	config := providerConfig{BaseURL: server.URL}
	task := seedMediaTask(t, db, config)
	ctx := context.WithValue(withProviderAnalytics(context.Background(), s, *task), mediaExecutionTaskKey{}, *task)
	sourceURL := server.URL + "/generated.png?token=secret"
	_, err := recoverImageTaskResult(ctx, config, map[string]interface{}{
		"mode": "image", "images": []map[string]string{{"dataUrl": sourceURL}},
	})
	if err == nil {
		t.Fatal("expected the first download to fail after checkpointing")
	}
	saved, err := s.repo.Task(task.ID)
	if err != nil || saved.MediaRecoveryJSON == "" {
		t.Fatalf("checkpoint missing: %v", err)
	}
	if strings.Contains(saved.MediaRecoveryJSON, "secret") {
		t.Fatal("upstream URL leaked into persisted checkpoint")
	}
	public := taskForOutput(*saved)
	if public.PreviewURL != taskSourceImageURL(task.ID) || strings.Contains(public.PreviewURL, "secret") {
		t.Fatalf("unexpected preview URL: %s", public.PreviewURL)
	}
	source, err := s.TaskSourceImage(task.UserID, task.ID)
	if err != nil || source.URL != sourceURL {
		t.Fatalf("source image unavailable: %+v %v", source, err)
	}
	if _, err := s.TaskSourceImage("another-user", task.ID); err == nil {
		t.Fatal("cross-user source image access allowed")
	}
	media := &providerMedia{StorageKey: taskSourceImagePrefix + task.ID}
	if err := s.hydrateProviderMedia(task.UserID, media, providerMediaHydrationPolicy{preferURL: true}); err != nil {
		t.Fatal(err)
	}
	if media.URL != sourceURL {
		t.Fatalf("next generation received %q, want upstream URL", media.URL)
	}
	if saved.Status != model.TaskStatusRunning {
		t.Fatalf("unexpected task status: %s", saved.Status)
	}
}
