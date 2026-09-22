package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
	"infinite-canvas/backend/internal/repository"
)

func newMediaRecoveryTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db := newSQLiteTestDB(t)
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db), dataDir: t.TempDir(), activeCancels: make(map[string]context.CancelFunc)}, db
}

func mediaTestPNG(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, image.NewRGBA(image.Rect(0, 0, 2, 3))); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func seedMediaTask(t *testing.T, db *gorm.DB, config providerConfig) *model.Task {
	t.Helper()
	input, err := json.Marshal(canvasGenerationInput{Mode: "image", Config: config, Prompt: "test"})
	if err != nil {
		t.Fatal(err)
	}
	expires := time.Now().Add(time.Hour)
	task := &model.Task{ID: newID(), UserID: "media-user", Type: "canvas_image", Status: model.TaskStatusRunning, InputJSON: string(input), LeaseOwner: "worker-a", LeaseExpiresAt: &expires, RouteRun: 1, CreatedAt: time.Now()}
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	return task
}

func TestMediaRecoveryDownloadFailureResumesSameTaskAfterRestart(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	s, db := newMediaRecoveryTestService(t)
	picture := mediaTestPNG(t)
	var downloads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("recovery submitted generation: %s", r.Method)
		}
		if downloads.Add(1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(picture)
	}))
	defer server.Close()
	config := providerConfig{BaseURL: server.URL}
	task := seedMediaTask(t, db, config)
	ctx := context.WithValue(withProviderAnalytics(context.Background(), s, *task), mediaExecutionTaskKey{}, *task)
	_, handled, failure := recoverProtocolMedia(ctx, config, "image", []protocol.MediaReference{{URL: server.URL + "/result?token=private-test-token"}})
	if !handled || failure == nil {
		t.Fatalf("handled=%v failure=%v", handled, failure)
	}
	if err := s.handleMediaRecoveryFailure(task, failure); err != nil {
		t.Fatal(err)
	}
	saved, err := s.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Status != model.TaskStatusRunning || saved.NextPollAt == nil || saved.LeaseOwner != "" {
		t.Fatalf("not deferred: %+v", saved)
	}
	if saved.MediaRecoveryJSON == "" || strings.Contains(saved.MediaRecoveryJSON, "private-test-token") {
		t.Fatal("missing/encrypted checkpoint")
	}
	public, _ := json.Marshal(taskForOutput(*saved))
	if bytes.Contains(public, []byte("mediaRecovery")) || bytes.Contains(public, []byte("private-test-token")) {
		t.Fatal("checkpoint leaked")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Update("next_poll_at", time.Now().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	// A fresh service has no in-memory state or downloaded bytes from generation.
	restarted := &Service{repo: s.repo, dataDir: s.dataDir, activeCancels: make(map[string]context.CancelFunc)}
	claimed, err := restarted.repo.ClaimNextTask("worker-b", time.Minute)
	if err != nil || claimed == nil {
		t.Fatalf("claim: %v", err)
	}
	if err := restarted.taskWorker().processClaimedTask(claimed, nil); err != nil {
		t.Fatal(err)
	}
	completed, _ := s.repo.Task(task.ID)
	if completed.Status != model.TaskStatusSucceeded || completed.MediaStage != "completed" {
		t.Fatalf("not delivered: %s %s", completed.Status, completed.MediaStage)
	}
	if downloads.Load() != 2 {
		t.Fatalf("downloads=%d", downloads.Load())
	}
	var assets []model.Asset
	if err := db.Find(&assets, "user_id = ?", task.UserID).Error; err != nil {
		t.Fatal(err)
	}
	if len(assets) != 1 || !strings.HasPrefix(assets[0].ID, "generation_") {
		t.Fatalf("assets: %+v", assets)
	}
	if err := restarted.registerRecoveredMediaAssets(*completed); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&model.Asset{}).Where("user_id = ?", task.UserID).Count(&count)
	if count != 1 {
		t.Fatalf("duplicate assets: %d", count)
	}
	db.Model(&model.BillingOrder{}).Count(&count)
	if count != 0 {
		t.Fatal("recovery created a billing order")
	}
	files, err := os.ReadDir(filepath.Join(s.dataDir, "media-staging"))
	if err != nil || len(files) != 0 {
		t.Fatalf("staging not cleaned: %v %v", files, err)
	}
}

func TestMediaRecoveryUploadFailureReusesStagedFileAndResource(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	s, db := newMediaRecoveryTestService(t)
	seedOSSEnabled(t, db, "media-user", "http://127.0.0.1:1")
	task := seedMediaTask(t, db, providerConfig{})
	temp, err := s.stageInlineMedia(mediaTestPNG(t))
	if err != nil {
		t.Fatal(err)
	}
	checkpoint := &mediaCheckpoint{Mode: "image", StartedAt: time.Now(), Items: []mediaCheckpointItem{{TempName: temp, MIMEType: "image/png"}}}
	if err := s.saveMediaCheckpoint(task, checkpoint, "upload"); err != nil {
		t.Fatal(err)
	}
	_, failure := s.materializeTaskMedia(context.Background(), task, providerConfig{}, checkpoint)
	var delivery *mediaRecoveryError
	if !errors.As(failure, &delivery) || delivery.stage != "upload" {
		t.Fatalf("expected OSS failure, got %v", failure)
	}
	resource, err := s.resourceForUploadKey(task.UserID, mediaUploadKey(task.ID, 0))
	if err != nil || resource == nil || resource.Status == model.ResourceStatusReady || resource.Provider == "local" {
		t.Fatalf("silently degraded upload: %+v %v", resource, err)
	}
	if _, err := os.Stat(s.mediaTempPath(temp)); err != nil {
		t.Fatal("upload failure discarded download", err)
	}
	// Simulate fixing storage configuration on the same existing object identity.
	resource.Provider, resource.ObjectKey = "local", "recovered/picture.png"
	if err := s.repo.SaveResource(resource); err != nil {
		t.Fatal(err)
	}
	output, err := s.resumeTaskMedia(context.Background(), task)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.finishTaskMediaRecovery(task, output, nil); err != nil {
		t.Fatal(err)
	}
	ready, _ := s.resourceForUploadKey(task.UserID, mediaUploadKey(task.ID, 0))
	if ready.ID != resource.ID || ready.Status != model.ResourceStatusReady {
		t.Fatal("resource identity changed")
	}
	var count int64
	db.Model(&model.Resource{}).Where("user_id = ?", task.UserID).Count(&count)
	if count != 1 {
		t.Fatalf("duplicate resource count=%d", count)
	}
}

func TestMediaRecoveryRegistrationRollbackAndRetryWithoutDownload(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	task := seedMediaTask(t, db, providerConfig{})
	temp, err := s.stageInlineMedia(mediaTestPNG(t))
	if err != nil {
		t.Fatal(err)
	}
	checkpoint := &mediaCheckpoint{Mode: "image", StartedAt: time.Now(), Items: []mediaCheckpointItem{{TempName: temp, MIMEType: "image/png"}}}
	if err := s.saveMediaCheckpoint(task, checkpoint, "local_save"); err != nil {
		t.Fatal(err)
	}
	output, err := s.materializeTaskMedia(context.Background(), task, providerConfig{}, checkpoint)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(output)
	if err := db.Exec(`CREATE TRIGGER reject_media_asset BEFORE INSERT ON assets BEGIN SELECT RAISE(ABORT, 'injected asset failure'); END`).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.saveTaskCompletionWithinStorageQuota(task, encoded, nil, false); err == nil {
		t.Fatal("registration failure was ignored")
	}
	saved, _ := s.repo.Task(task.ID)
	if saved.Status != model.TaskStatusRunning || saved.ResultJSON != "" {
		t.Fatal("false succeeded task escaped transaction")
	}
	if err := db.Exec(`DROP TRIGGER reject_media_asset`).Error; err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(s.mediaTempPath(temp)); err != nil {
		t.Fatal(err)
	}
	output, err = s.resumeTaskMedia(context.Background(), saved)
	if err != nil {
		t.Fatal("ready resource must not need staged file or URL", err)
	}
	if err := s.finishTaskMediaRecovery(saved, output, nil); err != nil {
		t.Fatal(err)
	}
}

func TestMediaRecoveryFencesLeasesCancellationAndManualRetries(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	task := seedMediaTask(t, db, providerConfig{})
	checkpoint := &mediaCheckpoint{Mode: "image", StartedAt: time.Now(), Items: []mediaCheckpointItem{{Reference: protocol.MediaReference{URL: "https://example.test/result"}}}}
	if err := s.saveMediaCheckpoint(task, checkpoint, "download"); err != nil {
		t.Fatal(err)
	}
	stale := *task
	stale.LeaseOwner = "obsolete-worker"
	if err := s.saveMediaCheckpoint(&stale, checkpoint, "upload"); !errors.Is(err, repository.ErrTaskStateConflict) {
		t.Fatalf("stale write: %v", err)
	}
	if err := db.Model(task).Updates(map[string]any{"status": model.TaskStatusFailed, "lease_owner": "", "lease_expires_at": nil}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.RecoverTaskMedia("other-user", task.ID); err == nil {
		t.Fatal("cross-user recovery")
	}
	queued, err := s.RecoverTaskMedia(task.UserID, task.ID)
	if err != nil || queued.ID != task.ID {
		t.Fatalf("manual recovery: %v", err)
	}
	duplicate, err := s.RecoverTaskMedia(task.UserID, task.ID)
	if err != nil || duplicate.ID != task.ID {
		t.Fatalf("duplicate click: %v", err)
	}
	if err := db.Model(task).Update("status", model.TaskStatusCancelled).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.RecoverTaskMedia(task.UserID, task.ID); err == nil {
		t.Fatal("cancelled task revived")
	}
	if err := s.saveMediaCheckpoint(task, checkpoint, "register"); !errors.Is(err, repository.ErrTaskStateConflict) {
		t.Fatalf("cancelled write: %v", err)
	}
}

func TestMediaRecoveryDoesNotFailOverGenerationRoute(t *testing.T) {
	p := &taskRouteExecutionPortStub{nextAttempts: map[string]*model.RouteAttempt{"first": {RouteID: "second"}}, processResults: map[string]taskRouteExecutionStubResult{"first": {err: &mediaRecoveryError{stage: "download", retryable: true, cause: errors.New("connection reset")}}}}
	result, err := (&taskRouteExecutor{port: p}).execute(context.Background(), &model.Task{RouteID: "first"}, &model.RouteAttempt{RouteID: "first"})
	if err != nil || !result.providerSucceeded || len(p.processCalls) != 1 || p.finished[0] != "first:succeeded" {
		t.Fatalf("delivery entered model failover: %+v %v", result, err)
	}
}

func TestMediaRecoveryTerminalStagesLimitsAndPublicList(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	for _, tc := range []struct {
		name     string
		attempts int
		age      time.Duration
		failure  *mediaRecoveryError
	}{
		{"permanent", 0, 0, &mediaRecoveryError{stage: "upload", cause: providerHTTPError{StatusCode: 403}}},
		{"budget", 4, 0, &mediaRecoveryError{stage: "download", retryable: true, cause: errors.New("reset")}},
		{"expired", 0, time.Hour, &mediaRecoveryError{stage: "register", retryable: true, cause: errors.New("database unavailable")}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			task := seedMediaTask(t, db, providerConfig{})
			checkpoint := &mediaCheckpoint{Mode: "image", StartedAt: time.Now().Add(-tc.age), Attempts: tc.attempts, Items: []mediaCheckpointItem{{Reference: protocol.MediaReference{URL: "https://example.test/private"}}}}
			if err := s.saveMediaCheckpoint(task, checkpoint, "download"); err != nil {
				t.Fatal(err)
			}
			if err := s.handleMediaRecoveryFailure(task, tc.failure); err == nil {
				t.Fatal("terminal failure swallowed")
			}
			saved, err := s.repo.Task(task.ID)
			if err != nil || saved.Status != model.TaskStatusFailed || saved.MediaStage != tc.failure.stage {
				t.Fatalf("terminal stage: %+v %v", saved, err)
			}
			if !strings.Contains(saved.Error, "作品已生成") {
				t.Fatalf("wrong user message: %s", saved.Error)
			}
			listed, err := s.repo.Tasks(task.UserID, 100, "", false)
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, item := range taskSummariesForOutput(listed) {
				if item.ID == task.ID {
					found = item.CanRecoverMedia && item.MediaStage == tc.failure.stage
				}
			}
			if !found {
				t.Fatal("list lost recovery capability")
			}
		})
	}
}

func TestMediaRecoveryManualGuardsDoNotChangeBilling(t *testing.T) {
	for _, name := range []string{"refunded", "wrong-owner", "limit", "cooldown", "deleted-project"} {
		t.Run(name, func(t *testing.T) {
			s, db := newMediaRecoveryTestService(t)
			task := seedMediaTask(t, db, providerConfig{})
			checkpoint := &mediaCheckpoint{Mode: "image", StartedAt: time.Now(), Items: []mediaCheckpointItem{{Reference: protocol.MediaReference{URL: "https://example.test/result"}}}}
			order := model.BillingOrder{ID: newID(), TaskID: task.ID, UserID: task.UserID, IdempotencyKey: newID(), Status: model.BillingStatusUncertain, ReservedAmountMicrocredits: 100}
			switch name {
			case "refunded":
				order.Status = model.BillingStatusRefunded
			case "wrong-owner":
				order.UserID = "another-user"
			case "limit":
				checkpoint.ManualAttempts = 3
			case "cooldown":
				checkpoint.LastManualAt = time.Now()
			case "deleted-project":
				task.ProjectID = "deleted-project"
			}
			if err := db.Create(&order).Error; err != nil {
				t.Fatal(err)
			}
			if err := s.saveMediaCheckpoint(task, checkpoint, "upload"); err != nil {
				t.Fatal(err)
			}
			if err := db.Model(task).Updates(map[string]any{"status": model.TaskStatusFailed, "lease_owner": "", "lease_expires_at": nil, "billing_order_id": order.ID, "project_id": task.ProjectID}).Error; err != nil {
				t.Fatal(err)
			}
			if _, err := s.RecoverTaskMedia(task.UserID, task.ID); err == nil {
				t.Fatal("guard bypassed")
			}
			saved, _ := s.repo.Task(task.ID)
			if saved.Status != model.TaskStatusFailed {
				t.Fatal("guard changed task")
			}
			unchanged, err := s.repo.BillingOrder(order.ID)
			if err != nil || unchanged.Status != order.Status || unchanged.ReservedAmountMicrocredits != 100 {
				t.Fatalf("billing changed: %+v %v", unchanged, err)
			}
		})
	}
}

func TestMediaRecoveryVideoDownloadDoesNotRewriteGenerationLog(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	task := seedMediaTask(t, db, providerConfig{})
	for _, item := range []model.ApiCallLog{
		{ID: "media-create", UserID: task.UserID, TaskID: task.ID, Capability: "video", RequestKind: "create", Method: "POST", Billable: true, Status: model.ApiCallStatusSucceeded, StatusCode: 200},
		{ID: "media-download", UserID: task.UserID, TaskID: task.ID, Capability: "video", RequestKind: "download", Method: "GET", Status: model.ApiCallStatusFailed, StatusCode: 503},
	} {
		if err := s.LogAPICall(item); err != nil {
			t.Fatal(err)
		}
	}
	var logs []model.ApiCallLog
	if err := db.Where("task_id = ?", task.ID).Order("id").Find(&logs).Error; err != nil {
		t.Fatal(err)
	}
	if len(logs) != 2 || logs[0].Status != model.ApiCallStatusSucceeded || logs[1].Status != model.ApiCallStatusFailed || logs[1].Billable {
		t.Fatalf("merged delivery into generation: %+v", logs)
	}
}

func TestMediaRecoveryExpiredLeaseAndStagingLimits(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	task := seedMediaTask(t, db, providerConfig{})
	checkpoint := &mediaCheckpoint{Mode: "image", StartedAt: time.Now(), Items: []mediaCheckpointItem{{}}}
	if err := db.Model(task).Update("lease_expires_at", time.Now().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.saveMediaCheckpoint(task, checkpoint, "download"); !errors.Is(err, repository.ErrTaskStateConflict) {
		t.Fatalf("expired lease wrote: %v", err)
	}
	for _, name := range []string{"../result-secret", "other", "", "result-dir/file"} {
		if s.mediaTempPath(name) != "" {
			t.Fatalf("unsafe staging name %s", name)
		}
	}
	if _, err := s.newMediaTemp(mediaStagingBudget + 1); err == nil {
		t.Fatal("oversized reservation accepted")
	}
	file, err := s.newMediaTemp(mediaStagingBudget)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if _, err := s.newMediaTemp(1); err == nil {
		t.Fatal("staging budget exceeded")
	}
}
