package app

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestVideoPollLogSchedulesNextCheckThirtySecondsLater(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:provider-poll-schedule?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}, &model.ApiCallLog{}, &model.ModelPricing{}); err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: "task-1", UserID: "user-1", Type: "canvas_video", Status: model.TaskStatusRunning}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	root := model.ApiCallLog{ID: "api-log-1", UserID: task.UserID, TaskID: task.ID, Capability: "video", RequestKind: "create", ProviderRequestID: "provider-task-1", CreatedAt: time.Now()}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	service := &Service{repo: repository.New(db)}
	startedAt := time.Now()
	if err := service.LogAPICall(model.ApiCallLog{
		ID: "poll-log-1", UserID: task.UserID, TaskID: task.ID, Capability: "video", RequestKind: "poll",
		ProviderRequestID: "provider-task-1", Status: model.ApiCallStatusSucceeded, StatusCode: 200, CreatedAt: startedAt,
	}); err != nil {
		t.Fatal(err)
	}
	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.NextPollAt == nil {
		t.Fatal("next poll time is nil")
	}
	delay := stored.NextPollAt.Sub(startedAt)
	if delay < 30*time.Second || delay > 31*time.Second {
		t.Fatalf("next poll delay = %s, want approximately 30s", delay)
	}
}

func TestEnsureFailedProviderAttemptLoggedFillsPreflightGapOnce(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:provider-preflight-log?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.SystemSetting{},
		&model.Asset{},
		&model.CanvasProject{},
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

func TestRecordProviderRequestKeepsUserVisibleSpeechAndNetworkErrors(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:provider-visible-error-log?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.Asset{}, &model.CanvasProject{}, &model.Task{}, &model.TaskLog{}, &model.Result{}, &model.ApiCallLog{}, &model.TaskTextDelta{}, &model.ModelPricing{}); err != nil {
		t.Fatal(err)
	}
	service := &Service{repo: repository.New(db)}
	speechBody := []byte(`{"code":0,"data":"AAAA"}{"header":{"code":45000030,"message":"[resource_id=volc.seedtts.default] requested resource not granted"}}`)
	recordLoggedProviderRequest(t, service, "task-speech", http.StatusOK, speechBody, nil)
	recordLoggedProviderRequest(t, service, "task-network", 0, nil, errors.New(`dial tcp 10.0.0.1:443: connect: connection refused`))
	recordLoggedProviderRequest(t, service, "task-gateway", http.StatusBadGateway, []byte(`<html>Bad Gateway</html>`), providerHTTPError{StatusCode: http.StatusBadGateway, Status: "502 Bad Gateway", Body: "<html>Bad Gateway</html>"})

	assertLoggedTaskError(t, db, "task-speech", "语音合成服务未开通")
	assertLoggedTaskError(t, db, "task-network", "网络异常。", "connection refused")
	assertLoggedTaskError(t, db, "task-gateway", "网络异常。", "502")
}

func assertLoggedTaskError(t *testing.T, db *gorm.DB, taskID string, parts ...string) {
	t.Helper()
	var log model.ApiCallLog
	if err := db.Where("task_id = ?", taskID).First(&log).Error; err != nil {
		t.Fatal(err)
	}
	if log.Status != model.ApiCallStatusFailed {
		t.Fatalf("%s status = %q, want failed; error %q", taskID, log.Status, log.Error)
	}
	for _, part := range parts {
		if !strings.Contains(log.Error, part) {
			t.Fatalf("%s error %q does not contain %q", taskID, log.Error, part)
		}
	}
}

func TestEnsureFailedProviderAttemptLoggedRecordsFailureHiddenBySuccessLog(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:provider-success-hides-failure?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.Asset{}, &model.CanvasProject{}, &model.Task{}, &model.TaskLog{}, &model.Result{}, &model.ApiCallLog{}, &model.TaskTextDelta{}, &model.ModelPricing{}); err != nil {
		t.Fatal(err)
	}
	success := model.ApiCallLog{ID: "api-log-success", TaskID: "task-1", Status: model.ApiCallStatusSucceeded, RequestKind: "create"}
	hidden := model.ApiCallLog{ID: "api-log-poll", TaskID: "task-1", Status: model.ApiCallStatusFailed, RequestKind: "poll", Error: "poll failed"}
	if err := db.Create(&success).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&hidden).Error; err != nil {
		t.Fatal(err)
	}
	service := &Service{repo: repository.New(db)}
	service.ensureFailedProviderAttemptLogged(model.Task{ID: "task-1", UserID: "user-1", Type: "canvas_audio", Model: "seed-tts-2.0"}, errors.New("流式音频合成失败（code 45000030）：[resource_id=volc.seedtts.default] requested resource not granted"))
	service.ensureFailedProviderAttemptLogged(model.Task{ID: "task-1", UserID: "user-1", Type: "canvas_audio", Model: "seed-tts-2.0"}, errors.New("流式音频合成失败（code 45000030）：[resource_id=volc.seedtts.default] requested resource not granted"))

	var logs []model.ApiCallLog
	if err := db.Where("request_kind <> ?", "poll").Order("created_at asc").Find(&logs).Error; err != nil {
		t.Fatal(err)
	}
	if len(logs) != 2 {
		t.Fatalf("visible log count = %d, want success plus one failure", len(logs))
	}
	if logs[1].Status != model.ApiCallStatusFailed || !strings.Contains(logs[1].Error, "语音合成服务未开通") {
		t.Fatalf("visible failure = status %q error %q", logs[1].Status, logs[1].Error)
	}
}

func recordLoggedProviderRequest(t *testing.T, service *Service, taskID string, statusCode int, body []byte, requestErr error) {
	t.Helper()
	request, err := http.NewRequest(http.MethodPost, "https://openspeech.bytedance.com/api/v3/tts/unidirectional", strings.NewReader(`{"text":"你好"}`))
	if err != nil {
		t.Fatal(err)
	}
	request = request.WithContext(context.WithValue(request.Context(), providerAnalyticsKey{}, providerAnalyticsContext{
		Service: service, UserID: "user-1", TaskID: taskID, ChannelID: "channel-1", Capability: "audio", Model: "seed-tts-2.0", RequestKind: "create",
	}))
	recordProviderRequest(request, time.Now(), statusCode, body, requestErr)
}
