package service

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestExportDiagnosticBundleRedactsSensitiveValues(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:diagnostics-test?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}, &model.TaskLog{}, &model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := db.Create(&model.Task{
		ID: "task-1", UserID: "user-1", TraceID: "trace-1", RequestID: "req-1", ProjectID: "project-1", Type: "video_generate",
		Status: model.TaskStatusFailed, Error: "authorization: task-secret", Prompt: "secret prompt", CreatedAt: now.Add(-time.Minute), UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.TaskLog{ID: "task-log-1", UserID: "user-1", TaskID: "task-1", TraceID: "trace-1", Message: "任务失败", Payload: "apiKey=log-secret", CreatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ApiCallLog{ID: "api-log-1", UserID: "user-1", TraceID: "trace-1", RequestID: "req-1", TaskID: "task-1", Path: "/v1/generations", RequestBody: "apiKey=body-secret", ResponseBody: "response-secret", UpstreamURL: "https://provider.example/result?signature=secret", Error: "token=api-secret", CreatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}

	svc := &Service{repo: repository.New(db)}
	bundle, err := svc.ExportDiagnosticBundle("user-1", DiagnosticExportRequest{
		From: now.Add(-2 * time.Minute).Format(time.RFC3339Nano), To: now.Add(time.Minute).Format(time.RFC3339Nano), TaskID: "task-1",
		Description: "页面报错", ClientEvents: []DiagnosticClientEvent{{ID: "event-1", Message: "cookie=client-secret", TraceID: "trace-1"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	files := readDiagnosticTestZIP(t, bundle.Data)
	manifest := files["manifest.json"]
	if !strings.Contains(manifest, `"bundleId": "`+bundle.BundleID+`"`) {
		t.Fatalf("manifest = %s", manifest)
	}
	all := strings.Join([]string{manifest, files["client/events.jsonl"], files["backend/tasks.jsonl"], files["backend/task-logs.jsonl"], files["backend/upstream-calls.jsonl"]}, "\n")
	for _, secret := range []string{"task-secret", "secret prompt", "log-secret", "body-secret", "response-secret", "api-secret", "signature=secret", "client-secret"} {
		if strings.Contains(all, secret) {
			t.Fatalf("diagnostic bundle leaked %q: %s", secret, all)
		}
	}
	if strings.Contains(files["backend/upstream-calls.jsonl"], "requestBody") || strings.Contains(files["backend/upstream-calls.jsonl"], "result?signature") {
		t.Fatalf("upstream call contains excluded payload or query: %s", files["backend/upstream-calls.jsonl"])
	}
}

func TestExportDiagnosticBundleRejectsForeignTask(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:diagnostics-ownership-test?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Task{ID: "foreign-task", UserID: "user-2", CreatedAt: time.Now(), UpdatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	_, err = (&Service{repo: repository.New(db)}).ExportDiagnosticBundle("user-1", DiagnosticExportRequest{TaskID: "foreign-task"})
	if err == nil || !strings.Contains(err.Error(), "任务不存在或无权访问") {
		t.Fatalf("foreign task error = %v", err)
	}
}

func readDiagnosticTestZIP(t *testing.T, data []byte) map[string]string {
	t.Helper()
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	files := make(map[string]string, len(archive.File))
	for _, file := range archive.File {
		reader, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		content, readErr := io.ReadAll(reader)
		closeErr := reader.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		if closeErr != nil {
			t.Fatal(closeErr)
		}
		files[file.Name] = string(content)
	}
	return files
}
