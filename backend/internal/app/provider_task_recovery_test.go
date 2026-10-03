package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestProviderTaskRecoveryContextSurvivesClientCancellation(t *testing.T) {
	type contextKey string
	parent, cancelParent := context.WithCancel(context.WithValue(context.Background(), contextKey("trace"), "trace-1"))
	cancelParent()

	recovery, cancelRecovery := providerTaskRecoveryContext(parent)
	defer cancelRecovery()
	if recovery.Err() != nil {
		t.Fatalf("recovery context inherited cancellation: %v", recovery.Err())
	}
	if recovery.Value(contextKey("trace")) != "trace-1" {
		t.Fatal("recovery context did not preserve request values")
	}
	if _, ok := recovery.Deadline(); !ok {
		t.Fatal("recovery context has no bounded deadline")
	}
}

func TestSettleRecoveredBillingIsIdempotent(t *testing.T) {
	tests := []struct {
		name        string
		status      model.BillingStatus
		wantSettle  int
		wantRestore int
	}{
		{name: "settled", status: model.BillingStatusSettled},
		{name: "running", status: model.BillingStatusRunning, wantSettle: 1},
		{name: "refunded", status: model.BillingStatusRefunded, wantRestore: 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &taskBillingRepositoryStub{order: &model.BillingOrder{Status: tt.status}}
			svc := &Service{taskBillingCoordinator: newTaskBillingCoordinator(repo)}
			if err := svc.settleRecoveredBilling(&model.Task{BillingOrderID: "order-1"}, "provider-1"); err != nil {
				t.Fatalf("settleRecoveredBilling() error = %v", err)
			}
			if got := len(repo.settleCalls); got != tt.wantSettle {
				t.Fatalf("settle calls = %d, want %d", got, tt.wantSettle)
			}
			if got := len(repo.restoreCalls); got != tt.wantRestore {
				t.Fatalf("restore calls = %d, want %d", got, tt.wantRestore)
			}
		})
	}
}

func TestDownloadRemoteResourceEnforcesVideoImportBounds(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	t.Setenv("HTTP_PROXY", "")
	t.Setenv("HTTPS_PROXY", "")
	t.Setenv("ALL_PROXY", "")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/large" {
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("12345"))
			return
		}
		w.Header().Set("Content-Type", "video/mp4; charset=binary")
		_, _ = w.Write([]byte("video"))
	}))
	defer server.Close()

	payload, err := downloadRemoteResource(server.URL+"/video.mp4", 16)
	if err != nil {
		t.Fatalf("downloadRemoteResource() error = %v", err)
	}
	if payload.mimeType != "video/mp4" || string(payload.data) != "video" {
		t.Fatalf("payload = %#v, want video/mp4 body", payload)
	}
	if _, err := downloadRemoteResource(server.URL+"/large", 5); err == nil || !strings.Contains(err.Error(), "远程资源必须小于") {
		t.Fatalf("oversized download error = %v", err)
	}
	if _, err := downloadRemoteResource("file:///tmp/video.mp4", 16); err == nil {
		t.Fatal("downloadRemoteResource() accepted a non-http URL")
	}
}

func TestAdminVideoRecoveryRequiresAdmin(t *testing.T) {
	service := &Service{}
	methods := map[string]func(*model.User) error{
		"query": func(actor *model.User) error {
			_, err := service.AdminQueryFailedVideoTask(context.Background(), actor, "log-1", "provider-1")
			return err
		},
		"url": func(actor *model.User) error {
			_, err := service.AdminRecoverVideoByURL(context.Background(), actor, "log-1", "https://example.com/video.mp4", "provider-1")
			return err
		},
		"batch": func(actor *model.User) error {
			_, err := service.AdminBatchQueryFailedVideoTasks(context.Background(), actor, []string{"log-1"})
			return err
		},
	}
	actors := map[string]*model.User{
		"anonymous":     nil,
		"ordinary user": {Role: model.UserRoleUser},
	}
	for actorName, actor := range actors {
		for methodName, invoke := range methods {
			t.Run(actorName+"/"+methodName, func(t *testing.T) {
				if err := invoke(actor); err == nil {
					t.Fatalf("recovery method %q accepted %s actor", methodName, actorName)
				}
			})
		}
	}
}

func TestRetryableProtocolMediaDownload(t *testing.T) {
	for _, err := range []error{
		errors.New("net/http: TLS handshake timeout"),
		errors.New("read: connection reset by peer"),
		errors.New("unexpected EOF"),
	} {
		if !retryableProtocolMediaDownload(err) {
			t.Fatalf("retryableProtocolMediaDownload(%v) = false", err)
		}
	}
	for _, err := range []error{context.Canceled, context.DeadlineExceeded, errors.New("HTTP 404")} {
		if retryableProtocolMediaDownload(err) {
			t.Fatalf("retryableProtocolMediaDownload(%v) = true", err)
		}
	}
}

func TestTaskNeedsProviderMediaRepair(t *testing.T) {
	for _, test := range []struct {
		name   string
		task   *model.Task
		needed bool
	}{
		{name: "missing result", task: &model.Task{Type: "canvas_video", Status: model.TaskStatusSucceeded}, needed: true},
		{name: "external result", task: &model.Task{Type: "canvas_video", Status: model.TaskStatusSucceeded, ResultJSON: `{"video":{"url":"https://cdn.example/video.mp4"}}`}, needed: true},
		{name: "stored result", task: &model.Task{Type: "canvas_video", Status: model.TaskStatusSucceeded, ResultJSON: `{"video":{"url":"/api/resources/resource-1/file"}}`}, needed: false},
		{name: "non-video task", task: &model.Task{Type: "canvas_image", Status: model.TaskStatusSucceeded}, needed: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := taskNeedsProviderMediaRepair(test.task); got != test.needed {
				t.Fatalf("taskNeedsProviderMediaRepair() = %v, want %v", got, test.needed)
			}
		})
	}
}

func TestAdminQuerySucceededVideoWithoutStoredMediaReportsRecoveryFailure(t *testing.T) {
	service, db, _, _ := creationTestService(t)
	actor := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	if err := db.Create(&model.Task{ID: "video-task", UserID: "user", Type: "canvas_video", Status: model.TaskStatusSucceeded, ResultJSON: `{"video":{"url":"https://example.invalid/video.mp4"}}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ApiCallLog{ID: "video-log", UserID: "user", TaskID: "video-task", Capability: "video"}).Error; err != nil {
		t.Fatal(err)
	}
	result, err := service.AdminQueryFailedVideoTask(context.Background(), actor, "video-log", "")
	if err == nil || !strings.Contains(err.Error(), "没有可恢复的上游任务 ID") || result != nil {
		t.Fatalf("admin recovery result = %#v, err = %v; missing provider ID must be reported", result, err)
	}
}
