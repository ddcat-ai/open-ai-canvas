package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func TestMediaAccountSchedulerFairnessAndBorrowing(t *testing.T) {
	var q mediaTransferScheduler
	slots := make(chan struct{}, 4)
	var releases []func()
	for range 4 {
		release, ok := q.acquire("busy-account", slots, 2, 4)
		if !ok {
			t.Fatal("idle slots could not be borrowed")
		}
		releases = append(releases, release)
	}
	if _, ok := q.acquire("other-account", slots, 2, 4); ok {
		t.Fatal("global limit exceeded")
	}
	releases[0]()
	if _, ok := q.acquire("busy-account", slots, 2, 4); ok {
		t.Fatal("borrower stole a waiting account's slot")
	}
	release, ok := q.acquire("other-account", slots, 2, 4)
	if !ok {
		t.Fatal("waiting account did not get a slot")
	}
	release()
	release() // release must be idempotent
	for _, release := range releases {
		release()
	}
	if len(slots) != 0 || len(q.active) != 0 {
		t.Fatal("slot leaked")
	}
}

func TestMediaAccountSchedulerCancelledWaiterExpires(t *testing.T) {
	q := mediaTransferScheduler{active: map[string]int{}, waiting: map[string]time.Time{"cancelled": time.Now().Add(-time.Minute)}, order: []string{"cancelled"}}
	release, ok := q.acquire("live", make(chan struct{}, 1), 1, 1)
	if !ok {
		t.Fatal("stale waiter blocked live account")
	}
	release()
}

func TestMediaStagingAccountsAreIsolatedAndDoNotExpire(t *testing.T) {
	t.Setenv("CANVAS_MEDIA_STAGING_USER_MB", "1")
	t.Setenv("CANVAS_MEDIA_STAGING_TOTAL_MB", "3")
	s := &Service{dataDir: t.TempDir()}
	first, err := s.newMediaTemp("account-a", 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	first.Close()
	old := time.Now().Add(-72 * time.Hour)
	if err := os.Chtimes(first.Name(), old, old); err != nil {
		t.Fatal(err)
	}
	if _, err := s.newMediaTemp("account-a", 1); !errors.Is(err, errMediaStagingBusy) {
		t.Fatalf("account quota not enforced: %v", err)
	}
	second, err := s.newMediaTemp("account-b", 1<<20)
	if err != nil {
		t.Fatalf("another account was blocked: %v", err)
	}
	second.Close()
	if filepath.Dir(first.Name()) == filepath.Dir(second.Name()) {
		t.Fatal("accounts share a staging directory")
	}
	if _, err := os.Stat(first.Name()); err != nil {
		t.Fatal("old failed result was automatically deleted")
	}
	if _, err := s.newMediaTemp("", 1); err == nil {
		t.Fatal("empty account accepted")
	}
}

func TestMediaStagingGlobalBudgetIncludesLegacyFiles(t *testing.T) {
	t.Setenv("CANVAS_MEDIA_STAGING_TOTAL_MB", "1")
	s := &Service{dataDir: t.TempDir()}
	root := filepath.Join(s.dataDir, "media-staging")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	legacy, err := os.Create(filepath.Join(root, "result-legacy"))
	if err != nil {
		t.Fatal(err)
	}
	if err := legacy.Truncate(1 << 20); err != nil {
		t.Fatal(err)
	}
	legacy.Close()
	if _, err := s.newMediaTemp("new-account", 1); !errors.Is(err, errMediaStagingGlobalBusy) {
		t.Fatalf("global quota bypassed: %v", err)
	}
	if s.mediaTempPath("result-legacy") == "" {
		t.Fatal("old checkpoint lost access to its file")
	}
	for _, name := range []string{"../result-file", strings.Repeat("a", 64) + "/../result-file", strings.Repeat("a", 64) + "/result-file/extra"} {
		if s.mediaTempPath(name) != "" {
			t.Fatal("unsafe path accepted")
		}
	}
}

func TestMediaRecoveryUsesStagedPreviewAfterUpstreamExpires(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	task := seedMediaTask(t, db, providerConfig{})
	name, err := s.stageInlineMedia(task.UserID, mediaTestPNG(t))
	if err != nil {
		t.Fatal(err)
	}
	checkpoint := &mediaCheckpoint{Mode: "image", StartedAt: time.Now(), Items: []mediaCheckpointItem{{TempName: name, MIMEType: "image/png", Reference: protocol.MediaReference{URL: "https://expired.example/result"}}}}
	if err := s.saveMediaCheckpoint(task, checkpoint, "upload"); err != nil {
		t.Fatal(err)
	}
	source, err := s.TaskSourceImage(task.UserID, task.ID)
	if err != nil || source.LocalPath != s.mediaTempPath(name) || source.URL != "" {
		t.Fatalf("preview ignored staged bytes: %+v %v", source, err)
	}
}

func TestMediaRecoveryCapacityDoesNotConsumeAttempt(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	task := seedMediaTask(t, db, providerConfig{})
	name, err := s.stageInlineMedia(task.UserID, mediaTestPNG(t))
	if err != nil {
		t.Fatal(err)
	}
	checkpoint := &mediaCheckpoint{Mode: "image", StartedAt: time.Now(), ManualAttempts: 3, Items: []mediaCheckpointItem{{TempName: name, MIMEType: "image/png"}}}
	if err := s.saveMediaCheckpoint(task, checkpoint, "upload"); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(task).Updates(map[string]any{"status": model.TaskStatusFailed, "lease_owner": "", "lease_expires_at": nil}).Error; err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: newID(), UserID: task.UserID, Status: model.ResourceStatusReady, Size: 20 << 30, Provider: "local", ObjectKey: "full"}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.RecoverTaskMedia(task.UserID, task.ID); err == nil {
		t.Fatal("full account requeued")
	}
	saved, _ := s.repo.Task(task.ID)
	unchanged, err := s.decodeMediaCheckpoint(saved)
	if err != nil || unchanged.ManualAttempts != 3 || saved.Status != model.TaskStatusFailed {
		t.Fatal("quota check consumed recovery attempt")
	}
	if err := db.Delete(&resource).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.RecoverTaskMedia(task.UserID, task.ID); err != nil {
		t.Fatalf("repaired old task remained locked: %v", err)
	}
}

func TestMediaRecoveryExpiredURLHasActionableError(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	s, _ := newMediaRecoveryTestService(t)
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()
	_, _, err := s.downloadTaskMedia(context.Background(), "account", providerConfig{}, server.URL, "image")
	message := (&mediaRecoveryError{stage: "download", cause: err}).Error()
	if !strings.Contains(message, "地址已失效") || strings.Contains(message, server.URL) {
		t.Fatalf("unsafe or opaque error: %s", message)
	}
}
