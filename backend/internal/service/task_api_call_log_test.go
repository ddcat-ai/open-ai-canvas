package service

import (
	"errors"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestEnsureFailedProviderAttemptLoggedFillsPreflightGapOnce(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:provider-preflight-log?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.SystemSetting{},
		&model.Asset{},
		&model.CanvasProject{},
		&model.Session{},
		&model.Message{},
		&model.Task{},
		&model.TaskLog{},
		&model.Result{},
		&model.ApiCallLog{},
		&model.TaskTextDelta{},
		&model.ModelPricing{},
	); err != nil {
		t.Fatal(err)
	}
	task := model.Task{
		ID:        "task-1",
		UserID:    "user-1",
		Type:      "canvas_video",
		Status:    model.TaskStatusRunning,
		Operation: "video.generate",
		Model:     "logical-video",
		InputJSON: `{"mode":"video","config":{"channelId":"channel-1","channelModelKey":"agnes-video-2.5","apiKey":"secret-key"}}`,
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	service := &Service{repo: repository.New(db)}
	failure := errors.New("Agnes Video 2.5 size 必须是 720P、960P 或 2K")

	service.ensureFailedProviderAttemptLogged(task, failure)
	service.ensureFailedProviderAttemptLogged(task, failure)

	var logs []model.ApiCallLog
	if err := db.Find(&logs).Error; err != nil {
		t.Fatal(err)
	}
	if len(logs) != 1 {
		t.Fatalf("api call log count = %d, want 1", len(logs))
	}
	logged := logs[0]
	if logged.ErrorCode != "request_not_sent" || logged.Status != model.ApiCallStatusFailed || logged.StatusCode != 0 {
		t.Fatalf("unexpected preflight log state: %#v", logged)
	}
	if logged.ChannelID != "channel-1" || logged.Model != "agnes-video-2.5" || logged.Capability != "video" {
		t.Fatalf("unexpected provider metadata: %#v", logged)
	}
	if logged.Error != failure.Error() {
		t.Fatalf("preflight error = %q, want %q", logged.Error, failure.Error())
	}
	serialized := logged.RequestBody + logged.ResponseBody + logged.UpstreamURL + logged.Error
	if strings.Contains(serialized, "secret-key") || logged.RequestBody != "" || logged.ResponseBody != "" {
		t.Fatalf("preflight log leaked task input: %#v", logged)
	}
}

func TestEnsureFailedProviderAttemptLoggedDoesNotDuplicateHTTPLog(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:provider-http-log-dedup?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	existing := model.ApiCallLog{ID: "api-log-1", TaskID: "task-1", Status: model.ApiCallStatusFailed}
	if err := db.Create(&existing).Error; err != nil {
		t.Fatal(err)
	}
	service := &Service{repo: repository.New(db)}
	service.ensureFailedProviderAttemptLogged(model.Task{ID: "task-1"}, errors.New("provider rejected request"))

	var count int64
	if err := db.Model(&model.ApiCallLog{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("api call log count = %d, want 1", count)
	}
}
