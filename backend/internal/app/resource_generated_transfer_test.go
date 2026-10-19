package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func TestGeneratedURLIsUsableBeforeAnyDownload(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	s, db := newMediaRecoveryTestService(t)
	var downloads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		downloads.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()
	task := seedMediaTask(t, db, providerConfig{BaseURL: server.URL})
	ctx := context.WithValue(withProviderAnalytics(context.Background(), s, *task), mediaExecutionTaskKey{}, *task)
	result, handled, err := recoverProtocolMedia(ctx, providerConfig{}, "image", []protocol.MediaReference{{URL: server.URL + "/result?token=private-token", MIMEType: "image/png"}})
	if !handled || err != nil {
		t.Fatalf("URL result must be usable without download: handled=%v err=%v", handled, err)
	}
	if downloads.Load() != 0 {
		t.Fatal("URL result was synchronously downloaded")
	}
	var resources []model.Resource
	if err := db.Find(&resources).Error; err != nil || len(resources) != 1 {
		t.Fatalf("resources: %v %v", resources, err)
	}
	resource := resources[0]
	task, err = s.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !resource.TransferPending || resource.BrowserDirect || resource.Status != model.ResourceStatusReady {
		t.Fatalf("temporary source: %+v", resource)
	}
	if strings.Contains(resource.PublicURL, "private-token") || strings.Contains(task.MediaRecoveryJSON, "private-token") {
		t.Fatal("upstream credentials stored in plain text")
	}
	access, err := s.resolveResourceAccess(&resource, ResourceAccessOptions{Purpose: assets.PurposeDisplay})
	if err != nil || access.URL != server.URL+"/result?token=private-token" || access.Delivery != "upstream" {
		t.Fatalf("access=%+v err=%v", access, err)
	}
	providerURL, err := s.providerResourceURL(&resource, time.Time{})
	if err != nil || providerURL != access.URL {
		t.Fatalf("next generation cannot use upstream URL: %q %v", providerURL, err)
	}
	if accesses, err := s.ResourceAccessBatch("other-user", []ResourceAccessRequest{{ResourceID: resource.ID}}); err != nil || len(accesses) != 1 || accesses[0].Access != nil || accesses[0].Error == nil {
		t.Fatalf("cross-account access: %+v %v", accesses, err)
	}
	if err := s.finishTaskMediaRecovery(task, result, nil); err != nil {
		t.Fatal(err)
	}
	completed, _ := s.repo.Task(task.ID)
	if completed.Status != model.TaskStatusSucceeded || strings.Contains(completed.ResultJSON, "private-token") {
		t.Fatalf("completion: %+v", completed)
	}
	assets, err := s.repo.Assets(task.UserID)
	if err != nil || len(assets) != 1 {
		t.Fatalf("assets before saving=%d err=%v", len(assets), err)
	}
}

func TestGeneratedURLFallbackSavesSameResourceAfterDelivery(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	s, db := newMediaRecoveryTestService(t)
	picture := mediaTestPNG(t)
	var downloads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Errorf("unexpected regeneration: %s", r.Method)
		}
		downloads.Add(1)
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(picture)
	}))
	defer server.Close()
	task := seedMediaTask(t, db, providerConfig{BaseURL: server.URL})
	result, err := s.prepareGeneratedImageResult(context.Background(), task, map[string]any{"mode": "image", "images": []map[string]string{{"dataUrl": server.URL + "/image"}}})
	if err != nil {
		t.Fatal(err)
	}
	task, _ = s.repo.Task(task.ID)
	if err := s.finishTaskMediaRecovery(task, result, nil); err != nil {
		t.Fatal(err)
	}
	var resource model.Resource
	if err := db.First(&resource).Error; err != nil {
		t.Fatal(err)
	}
	signature := cloudAgentResourceSignature(&resource)
	if err := s.RequestGeneratedResourceFallback("other-user", resource.ID, ""); err == nil {
		t.Fatal("foreign fallback accepted")
	}
	if err := s.RequestGeneratedResourceFallback(task.UserID, resource.ID, ""); err != nil {
		t.Fatal(err)
	}
	claimed, err := s.repo.ClaimResourceTransfer(task.UserID, resource.ID, "server:test", time.Now().Add(time.Minute), "")
	if err != nil || !claimed {
		t.Fatalf("claim: %v %v", claimed, err)
	}
	if err := s.saveGeneratedResourceFallback(context.Background(), task.UserID, resource.ID, "server:test"); err != nil {
		t.Fatal(err)
	}
	stored, err := s.repo.ResourceForUser(task.UserID, resource.ID)
	if err != nil || stored.TransferPending || stored.BrowserDirect || stored.Size != int64(len(picture)) || stored.Width != 2 || stored.Height != 3 {
		t.Fatalf("stored: %+v %v", stored, err)
	}
	if signature != cloudAgentResourceSignature(stored) {
		t.Fatal("background transport update invalidated approved image content")
	}
	data, err := os.ReadFile(filepath.Join(s.dataDir, "resources", filepath.FromSlash(stored.ObjectKey)))
	if err != nil || string(data) != string(picture) {
		t.Fatalf("saved original: %v", err)
	}
	if downloads.Load() != 1 {
		t.Fatalf("downloads=%d", downloads.Load())
	}
	var count int64
	db.Model(&model.Resource{}).Count(&count)
	if count != 1 {
		t.Fatalf("duplicate resource: %d", count)
	}
	db.Model(&model.ResourceTransfer{}).Count(&count)
	if count != 0 {
		t.Fatal("saved transfer was not removed")
	}
	db.Model(&model.ResourceDeletionJob{}).Count(&count)
	if count != 0 {
		t.Fatal("published original still scheduled for deletion")
	}
	assets, _ := s.repo.Assets(task.UserID)
	if len(assets) != 1 {
		t.Fatalf("assets=%d", len(assets))
	}
}

func TestGeneratedURLBrowserCompletionVerifiesThenMarksDirect(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	s, db := newMediaRecoveryTestService(t)
	picture := mediaTestPNG(t)
	visible := false
	var sourceDownloads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/upstream" {
			sourceDownloads.Add(1)
			w.WriteHeader(503)
			return
		}
		if !visible {
			w.WriteHeader(404)
			return
		}
		w.Header().Set("ETag", `"direct-verified"`)
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Content-Range", "bytes 0-"+strconv.Itoa(len(picture)-1)+"/"+strconv.Itoa(len(picture)))
		w.Header().Set("Content-Length", strconv.Itoa(len(picture)))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(picture)
	}))
	defer server.Close()
	setting, _ := json.Marshal(ossSettingValue{Enabled: true, Provider: s3Provider, Region: "auto", Endpoint: server.URL, Bucket: "media", AccessKeyID: "test", AccessKeySecret: "test", PathStyle: true})
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(setting)}); err != nil {
		t.Fatal(err)
	}
	task := seedMediaTask(t, db, providerConfig{BaseURL: server.URL})
	resource, err := s.registerGeneratedURL(task, 0, protocol.MediaReference{URL: server.URL + "/upstream"})
	if err != nil {
		t.Fatal(err)
	}
	input := generatedBrowserUpload{UploadID: "direct-test", BrowserResourceUploadInput: BrowserResourceUploadInput{Size: int64(len(picture)), MimeType: "image/png", Width: 2, Height: 3}}
	payload, _ := json.Marshal(input)
	if claimed, err := s.repo.ClaimResourceTransfer(task.UserID, resource.ID, "browser:direct-test", time.Now().Add(time.Minute), string(payload)); err != nil || !claimed {
		t.Fatal(err)
	}
	if err := s.ReserveChunkUploadSession(task.UserID, input.UploadID, input.Size, time.Now().Add(time.Minute), 32); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteGeneratedResourceUpload("other-user", resource.ID, input.UploadID); err == nil {
		t.Fatal("foreign completion accepted")
	}
	if _, err := s.CompleteGeneratedResourceUpload(task.UserID, resource.ID, input.UploadID); err == nil {
		t.Fatal("missing object accepted")
	}
	before, _ := s.repo.ResourceForUser(task.UserID, resource.ID)
	if before.BrowserDirect || !before.TransferPending {
		t.Fatal("marked direct before successful verification")
	}
	visible = true
	ready, err := s.CompleteGeneratedResourceUpload(task.UserID, resource.ID, input.UploadID)
	if err != nil || !ready.BrowserDirect || ready.TransferPending || ready.ID != resource.ID || ready.ETag != "direct-verified" {
		t.Fatalf("ready: %+v %v", ready, err)
	}
	if again, err := s.CompleteGeneratedResourceUpload(task.UserID, resource.ID, input.UploadID); err != nil || again.ID != ready.ID {
		t.Fatalf("replayed completion: %+v %v", again, err)
	}
	if sourceDownloads.Load() != 0 {
		t.Fatal("browser completed but server still downloaded source")
	}
	if claimed, _ := s.repo.ClaimResourceTransfer(task.UserID, resource.ID, "server:late", time.Now().Add(time.Minute), ""); claimed {
		t.Fatal("server reclaimed completed transfer")
	}
	var count int64
	db.Model(&model.Resource{}).Count(&count)
	if count != 1 {
		t.Fatal("direct completion created duplicate resource")
	}
}

func TestGeneratedBase64StillSavesOnBackend(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	task := seedMediaTask(t, db, providerConfig{})
	ctx := context.WithValue(withProviderAnalytics(context.Background(), s, *task), mediaExecutionTaskKey{}, *task)
	result, _, err := recoverProtocolMedia(ctx, providerConfig{}, "image", []protocol.MediaReference{{DataURL: dataURL("image/png", mediaTestPNG(t))}})
	if err != nil {
		t.Fatal(err)
	}
	task, _ = s.repo.Task(task.ID)
	if err := s.finishTaskMediaRecovery(task, result, nil); err != nil {
		t.Fatal(err)
	}
	var resource model.Resource
	if err := db.First(&resource).Error; err != nil || resource.TransferPending || resource.BrowserDirect || resource.Size == 0 {
		t.Fatalf("base64: %+v %v", resource, err)
	}
	var count int64
	db.Model(&model.ResourceTransfer{}).Count(&count)
	if count != 0 {
		t.Fatal("base64 was sent to browser persistence")
	}
}

func TestGeneratedURLBrowserBeginScopesSignatureAndReleasesFailedReservation(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	setting, _ := json.Marshal(ossSettingValue{Enabled: true, Provider: s3Provider, S3Preset: "r2", Region: "auto", Endpoint: "https://1.1.1.1", Bucket: "media", AccessKeyID: "test", AccessKeySecret: "test", PathStyle: true})
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(setting)}); err != nil {
		t.Fatal(err)
	}
	task := seedMediaTask(t, db, providerConfig{BaseURL: "https://1.1.1.1"})
	resource, err := s.registerGeneratedURL(task, 0, protocol.MediaReference{URL: "https://1.1.1.1/upstream.png"})
	if err != nil {
		t.Fatal(err)
	}
	input := BrowserResourceUploadInput{MimeType: "image/png", Size: 80, Width: 2, Height: 3}
	if _, err := s.BeginGeneratedResourceUpload("other-user", resource.ID, input); err == nil {
		t.Fatal("foreign upload accepted")
	}
	prepared, err := s.BeginGeneratedResourceUpload(task.UserID, resource.ID, input)
	if err != nil || prepared.Upload == nil {
		t.Fatalf("prepared=%+v err=%v", prepared, err)
	}
	upload := prepared.Upload
	parsed, _ := url.Parse(upload.URL)
	if upload.Headers["If-None-Match"] != "*" || !strings.HasSuffix(parsed.Path, ".browser-"+upload.ID) {
		t.Fatalf("unscoped upload: %+v", upload)
	}
	if other, err := s.BeginGeneratedResourceUpload(task.UserID, resource.ID, input); err != nil || other.Upload != nil || other.FallbackReason != "resource_transfer_in_progress" {
		t.Fatalf("duplicate lease: %+v %v", other, err)
	}
	if err := s.RequestGeneratedResourceFallback(task.UserID, resource.ID, upload.ID); err != nil {
		t.Fatal(err)
	}
	var reservations int64
	db.Model(&model.UploadReservation{}).Count(&reservations)
	if reservations != 0 {
		t.Fatal("failed browser upload kept its quota reservation")
	}
	if _, err := s.CompleteGeneratedResourceUpload(task.UserID, resource.ID, upload.ID); err == nil {
		t.Fatal("late browser completion published after releasing lease")
	}
	ready, _ := s.repo.ResourceForUser(task.UserID, resource.ID)
	if ready.BrowserDirect || !ready.TransferPending {
		t.Fatal("failed browser upload incorrectly marked direct")
	}
}
