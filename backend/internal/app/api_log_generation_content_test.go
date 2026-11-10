package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

func generationLogService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db := newSQLiteTestDB(t)
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	return New(repository.New(db), t.TempDir()), db
}

func generationLogResource(t *testing.T, s *Service, db *gorm.DB, id, owner, kind string) model.Resource {
	t.Helper()
	r := model.Resource{ID: id, UserID: owner, Kind: kind, MimeType: kind + "/test", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: id, Size: 10, CreatedAt: time.Now().Add(-48 * time.Hour), UpdatedAt: time.Now().Add(-48 * time.Hour)}
	if err := os.MkdirAll(filepath.Join(s.dataDir, "resources"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.dataDir, "resources", id), []byte("0123456789"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&r).Error; err != nil {
		t.Fatal(err)
	}
	return r
}

func TestGenerationSnapshotKeepsRequestOrderAndSanitizesWhitelist(t *testing.T) {
	s, db := generationLogService(t)
	generationLogResource(t, s, db, "image-b", "owner", "image")
	generationLogResource(t, s, db, "image-a", "owner", "image")
	generationLogResource(t, s, db, "video-a", "owner", "video")
	generationLogResource(t, s, db, "audio-a", "owner", "audio")
	input := canvasGenerationInput{Mode: "video", Prompt: "@图片1 对照 @图片2 @视频1 @音频1 @图片4 https://signed.invalid/media?token=url-secret Bearer bearer-secret private-credential header-secret",
		Config:          providerConfig{APIKey: "private-credential", Headers: []OutboundHeader{{Name: "Authorization", Value: "header-secret"}, {Name: "X-Count", Value: "1"}}},
		ReferenceImages: []providerMedia{{ID: "node-a", StorageKey: "resource:image-b", Name: "原图 private-credential", Role: "first_frame", SlotKey: "subject"}, {ID: "node-b", StorageKey: "resource:image-a", Name: "第二图"}, {URL: "https://external.invalid/file", DataURL: "data:image/png;base64,private", Name: "外链"}},
		ReferenceVideos: []providerMedia{{StorageKey: "resource:video-a", Name: "视频"}}, ReferenceAudios: []providerMedia{{StorageKey: "resource:audio-a", Name: "音频"}}}
	snapshot := s.generationSnapshot("owner", "attempt", input)
	if len(snapshot.References) != 6 {
		t.Fatalf("references=%#v", snapshot.References)
	}
	for i, want := range []string{"图片1", "图片2", "图片3", "视频1", "音频1", "图片4"} {
		if snapshot.References[i].Label != want {
			t.Fatalf("reference %d=%#v", i, snapshot.References[i])
		}
	}
	if snapshot.References[0].ResourceID != "image-b" || snapshot.References[1].ResourceID != "image-a" || snapshot.References[0].Role != "first_frame" || snapshot.References[0].SlotKey != "subject" || snapshot.References[2].ResourceID != "" || !snapshot.Incomplete {
		t.Fatalf("snapshot=%#v", snapshot)
	}
	encoded := encodeGenerationSnapshot(snapshot)
	for _, forbidden := range []string{"https://", "data:", "private-credential", "header-secret", "bearer-secret", "url-secret", "dataUrl", "apiKey", "config", "headers"} {
		if strings.Contains(encoded, forbidden) {
			t.Fatalf("snapshot leaked %q: %s", forbidden, encoded)
		}
	}
	if !strings.Contains(snapshot.Prompt, "@图片1") {
		t.Fatalf("numbering lost: %q", snapshot.Prompt)
	}
	large := snapshot
	large.Prompt = strings.Repeat("镜", 100000)
	if raw := encodeGenerationSnapshot(large); raw == "" || len(raw) > maxGenerationSnapshotBytes || !strings.Contains(raw, `"incomplete":true`) {
		t.Fatalf("bounded snapshot length=%d", len(raw))
	}
}

func TestGenerationSnapshotVerifiesArkOriginalBinding(t *testing.T) {
	s, db := generationLogService(t)
	generationLogResource(t, s, db, "original", "owner", "image")
	if err := db.Create(&model.ArkPrivateAssetBinding{ID: "binding", UserID: "owner", ResourceID: "original", ProjectName: "project", ArkAssetID: "ark-a", Status: "active"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ owner, asset, source, want string }{{"owner", "ark-a", "original", "original"}, {"owner", "ark-b", "original", ""}, {"other", "ark-a", "original", ""}, {"owner", "ark-a", "", ""}} {
		input := canvasGenerationInput{ReferenceImages: []providerMedia{{URL: "asset://" + tc.asset, SourceResourceID: tc.source}}}
		got := s.generationSnapshot(tc.owner, "attempt", input).References[0].ResourceID
		if got != tc.want {
			t.Fatalf("%+v: original=%q", tc, got)
		}
	}
	if got := s.generationOriginalResourceID("owner", providerMedia{URL: "https://external.invalid/file", SourceResourceID: "original"}); got != "" {
		t.Fatalf("unverified source accepted: %q", got)
	}
}

func TestGenerationSnapshotSurvivesPollCompactionAndRetry(t *testing.T) {
	s, db := generationLogService(t)
	generationLogResource(t, s, db, "original", "owner", "image")
	input := canvasGenerationInput{Mode: "video", Prompt: "@图片1 原请求", ReferenceImages: []providerMedia{{StorageKey: "resource:original", Name: "原请求图"}}}
	raw, _ := json.Marshal(input)
	task := model.Task{ID: "task", UserID: "owner", Type: "canvas_video", Status: model.TaskStatusRunning, InputJSON: string(raw), Prompt: input.Prompt, Attempts: 1, RouteRun: 1}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	ctx := s.withGenerationSnapshot(withProviderAnalytics(context.Background(), s, task), task.UserID, input)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://upstream.invalid/videos", strings.NewReader(`{"prompt":"transport changed"}`))
	if err != nil {
		t.Fatal(err)
	}
	recordProviderRequest(req, time.Now(), 200, []byte(`{"id":"upstream-1"}`), nil)
	var root model.ApiCallLog
	if err := db.Where("task_id = ? AND request_kind = ?", task.ID, "create").First(&root).Error; err != nil {
		t.Fatal(err)
	}
	if root.GenerationContentJSON == "" {
		t.Fatal("HTTP create did not retain snapshot")
	}
	before := root.GenerationContentJSON
	if err := db.Model(&task).Updates(map[string]any{"input_json": publicTaskInputJSON(task.InputJSON), "prompt": "重试后的提示词", "attempts": 2, "route_run": 2}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.LogAPICall(model.ApiCallLog{UserID: "owner", TaskID: task.ID, Capability: "video", RequestKind: "poll", ProviderRequestID: "upstream-1", Status: model.ApiCallStatusSucceeded, StatusCode: 200, ResponseBody: `{"status":"completed"}`}); err != nil {
		t.Fatal(err)
	}
	detail, err := s.AdminAPICallLog(&model.User{Role: model.UserRoleAdmin}, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.GenerationContentJSON != before || detail.PollCount != 1 || detail.GenerationContent.Prompt != input.Prompt || detail.GenerationContent.Source != "snapshot" || !detail.GenerationContent.References[0].Available {
		t.Fatalf("detail=%#v content=%#v", detail, detail.GenerationContent)
	}
	for _, actor := range []*model.User{nil, {Role: model.UserRoleUser}} {
		if _, err := s.PrepareAdminAPICallLogReferenceDelivery(actor, root.ID, detail.GenerationContent.References[0].ID, ""); err == nil {
			t.Fatal("non-admin media allowed")
		}
	}
	delivery, err := s.PrepareAdminAPICallLogReferenceDelivery(&model.User{Role: model.UserRoleAdmin}, root.ID, detail.GenerationContent.References[0].ID, "")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(delivery.Stream.Body)
	_ = delivery.Stream.Body.Close()
	if string(body) != "0123456789" || delivery.Access.URL != "" {
		t.Fatalf("delivery=%#v body=%s", delivery.Access, body)
	}
	if _, err := s.PrepareAdminAPICallLogReferenceDelivery(&model.User{Role: model.UserRoleAdmin}, root.ID, "original", ""); err == nil {
		t.Fatal("resource ID accepted as reference ID")
	}
	if err := db.Model(&task).Update("user_id", "foreign").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.PrepareAdminAPICallLogReferenceDelivery(&model.User{Role: model.UserRoleAdmin}, root.ID, detail.GenerationContent.References[0].ID, ""); err == nil {
		t.Fatal("foreign task chain allowed")
	}
}

func TestGenerationLegacyFallbackNeverUsesRetriedTaskOrRemoteURL(t *testing.T) {
	s, db := generationLogService(t)
	generationLogResource(t, s, db, "original", "owner", "image")
	task := model.Task{ID: "task", UserID: "owner", Prompt: "current unrelated prompt", Attempts: 2, RouteRun: 2, InputJSON: `{"prompt":"current unrelated prompt","referenceImages":[{"storageKey":"resource:original"}]}`}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	log := model.ApiCallLog{ID: "legacy", UserID: "owner", TaskID: task.ID, Capability: "video", RequestKind: "create", RequestBody: `{"content":[{"type":"text","text":"历史 @图片1 @视频1"},{"type":"image_url","image_url":{"url":"https://private.invalid/image?token=hidden"}},{"type":"video_url","video_url":{"url":"https://private.invalid/video"}}]}`, CreatedAt: time.Now()}
	if err := s.decorateAPILogGeneration(&log); err != nil {
		t.Fatal(err)
	}
	content := log.GenerationContent
	if content.Source != "request" || !content.Incomplete || content.Prompt != "历史 @图片1 @视频1" || len(content.References) != 2 {
		t.Fatalf("fallback=%#v", content)
	}
	for _, ref := range content.References {
		if ref.Available || ref.MediaURL != "" || ref.UnavailableReason == "" {
			t.Fatalf("remote reference=%#v", ref)
		}
	}
	if err := db.Model(&task).Updates(map[string]any{"attempts": 1, "route_run": 1}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.decorateAPILogGeneration(&log); err != nil {
		t.Fatal(err)
	}
	if log.GenerationContent.Source != "task" || !log.GenerationContent.Incomplete || log.GenerationContent.References[0].Name != "图片1" {
		t.Fatalf("first-attempt evidence lost: %#v", log.GenerationContent)
	}
}

func TestGenerationFailedAttemptCapturesUncompressedInputAndNewAttempt(t *testing.T) {
	s, db := generationLogService(t)
	generationLogResource(t, s, db, "original", "owner", "image")
	task := model.Task{ID: "failed", UserID: "owner", Type: "canvas_video", Prompt: "fallback", InputJSON: `{"mode":"video","prompt":"@图片1 首次","referenceImages":[{"storageKey":"resource:original","name":"原图"}],"config":{"apiKey":"secret-value"}}`}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	s.ensureFailedProviderAttemptLogged(task, errors.New("preflight failure"))
	var first model.ApiCallLog
	if err := db.Where("task_id = ?", task.ID).First(&first).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(first.GenerationContentJSON, "原图") || strings.Contains(first.GenerationContentJSON, "secret-value") {
		t.Fatalf("failed snapshot=%q", first.GenerationContentJSON)
	}
	started := time.Now().Add(time.Millisecond)
	task.StartedAt = &started
	task.InputJSON = strings.ReplaceAll(task.InputJSON, "首次", "第二次")
	s.ensureFailedProviderAttemptLogged(task, errors.New("second preflight failure"))
	var logs []model.ApiCallLog
	if err := db.Where("task_id = ?", task.ID).Find(&logs).Error; err != nil {
		t.Fatal(err)
	}
	if len(logs) != 2 || !strings.Contains(logs[1].GenerationContentJSON, "第二次") {
		t.Fatalf("retry logs=%#v", logs)
	}
}

func TestGenerationSnapshotProtectsResourcesUntilLogDeletionAndCountsQuota(t *testing.T) {
	s, db := generationLogService(t)
	r := generationLogResource(t, s, db, "original", "owner", "image")
	snapshot := encodeGenerationSnapshot(s.generationSnapshot("owner", "attempt", canvasGenerationInput{Prompt: "@图片1", ReferenceImages: []providerMedia{{StorageKey: "resource:original"}}}))
	log := model.ApiCallLog{ID: "log", UserID: "owner", Capability: "video", RequestKind: "create", GenerationContentJSON: snapshot}
	before, err := s.repo.UserStorageUsage("owner")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.LogAPICall(log); err != nil {
		t.Fatal(err)
	}
	after, err := s.repo.UserStorageUsage("owner")
	if err != nil {
		t.Fatal(err)
	}
	if after.TaskBytes-before.TaskBytes != int64(len(snapshot)) {
		t.Fatalf("quota delta=%d, snapshot=%d", after.TaskBytes-before.TaskBytes, len(snapshot))
	}
	page, err := s.AdminAPICallLogs(&model.User{Role: model.UserRoleAdmin}, APICallLogQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Logs) != 1 || page.Logs[0].GenerationContentJSON != "" || page.Logs[0].GenerationContent != nil {
		t.Fatalf("list leaked snapshot: %#v", page)
	}
	export, err := s.repo.ExportAPICallLogs(repository.APICallLogFilter{AnalyticsFilter: repository.AnalyticsFilter{From: time.Now().Add(-time.Hour), To: time.Now().Add(time.Hour)}}, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(export) != 1 || export[0].GenerationContentJSON != "" {
		t.Fatalf("CSV selection retained snapshot: %#v", export)
	}
	refs, err := s.repo.APICallLogResourceReferences("owner", []string{r.ID})
	if err != nil || len(refs) != 1 {
		t.Fatalf("refs=%#v err=%v", refs, err)
	}
	if err := s.repo.DeleteDetachedResources([]model.Resource{r}, nil); !errors.Is(err, repository.ErrResourceCleanupStillReferenced) {
		t.Fatalf("repo cleanup=%v", err)
	}
	if err := s.cleanupDetachedUserResources("owner", []model.Resource{r}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.repo.Resource(r.ID); err != nil {
		t.Fatal("snapshot original was cleaned", err)
	}
	asset := model.Asset{ID: "asset", UserID: "owner", Title: "original", PayloadJSON: `{"storageKey":"resource:original"}`}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.deleteUserAssetWithResources("owner", asset.ID, false); err == nil || !strings.Contains(err.Error(), repository.APICallLogResourceReferenceKind) {
		t.Fatalf("protected delete=%v", err)
	}
	if err := s.deleteUserAssetWithResources("owner", asset.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := s.repo.Resource(r.ID); err != nil {
		t.Fatal("forced asset deletion removed snapshot original", err)
	}
	if err := db.Delete(&model.ApiCallLog{}, "id = ?", log.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.cleanupDetachedUserResources("owner", []model.Resource{r}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.repo.Resource(r.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("log retention did not release reference: %v", err)
	}
}
