package app

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
)

func TestBrowserUploadReportsLocalStorageFallback(t *testing.T) {
	svc := newResourceTestService(t)
	result, err := svc.BeginBrowserResourceUpload("user-1", BrowserResourceUploadInput{FileName: "image.png", MimeType: "image/png", Size: 42})
	if err != nil {
		t.Fatal(err)
	}
	if result.FallbackReason != "local_storage" || result.Upload != nil || result.Resource != nil {
		t.Fatalf("result = %#v", result)
	}
}

func TestBrowserUploadRejectsCrossAccountCompletion(t *testing.T) {
	svc := newResourceTestService(t)
	if err := svc.repo.CreateResource(&model.Resource{ID: "upload-owned", UserID: "other-user", Status: model.ResourceStatusPending}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CompleteBrowserResourceUpload("user-1", "upload-owned"); err == nil {
		t.Fatal("foreign upload must not complete")
	}
}

func TestBrowserUploadPublishesOnlyVerifiedBytes(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var body bytes.Buffer
	if err := png.Encode(&body, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	data := body.Bytes()
	visible := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !visible {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("ETag", `"verified"`)
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		if r.Method != http.MethodHead {
			w.Header().Set("Content-Range", "bytes 0-"+strconv.Itoa(len(data)-1)+"/"+strconv.Itoa(len(data)))
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write(data)
		}
	}))
	defer server.Close()
	svc := newResourceTestService(t)
	setting, _ := json.Marshal(ossSettingValue{Enabled: true, Provider: s3Provider, Region: "auto", Endpoint: server.URL, Bucket: "media", AccessKeyID: "test-id", AccessKeySecret: "test-secret", PathStyle: true})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(setting)}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "direct-verification", UserID: "user-1", Provider: s3Provider, Endpoint: server.URL, Bucket: "media", ObjectKey: "test.png", Status: model.ResourceStatusPending, Kind: "image", MimeType: "image/png", Size: int64(len(data))}
	if err := svc.ReserveChunkUploadSession(resource.UserID, resource.ID, resource.Size, time.Now().Add(time.Minute), 32); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CompleteBrowserResourceUpload(resource.UserID, resource.ID); err == nil {
		t.Fatal("missing object must not be published")
	}
	stored, err := svc.repo.ResourceForUser(resource.UserID, resource.ID)
	if err != nil || stored.Status != model.ResourceStatusPending {
		t.Fatalf("premature status = %#v, %v", stored, err)
	}
	visible = true
	ready, err := svc.CompleteBrowserResourceUpload(resource.UserID, resource.ID)
	if err != nil || ready.Status != model.ResourceStatusReady || ready.ETag != "verified" {
		t.Fatalf("ready = %#v, %v", ready, err)
	}
	if _, err := svc.CompleteBrowserResourceUpload(resource.UserID, resource.ID); err != nil {
		t.Fatalf("completion must be idempotent: %v", err)
	}
}

func TestBrowserThumbnailReadsDifferFromOriginalAndProtectOwnership(t *testing.T) {
	svc := newResourceTestService(t)
	resource := model.Resource{ID: "thumbnail-local", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "original.png", MimeType: "image/png", Size: 8, Width: 2000, Height: 1000}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(svc.dataDir, "resources"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(svc.dataDir, "resources", resource.ObjectKey), []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 4, 2))); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveBrowserResourceThumbnail("other-user", resource.ID, encoded.Bytes()); err == nil {
		t.Fatal("foreign thumbnail write must fail")
	}
	if _, err := svc.SaveBrowserResourceThumbnail(resource.UserID, resource.ID, []byte("<html>not an image</html>")); err == nil {
		t.Fatal("HTML thumbnail must fail")
	}
	updated, err := svc.SaveBrowserResourceThumbnail(resource.UserID, resource.ID, encoded.Bytes())
	if err != nil || updated.ThumbnailStatus != "ready" {
		t.Fatalf("thumbnail = %#v, %v", updated, err)
	}
	delivery, err := svc.PrepareResourceDelivery(resource.UserID, resource.ID, ResourceAccessOptions{Purpose: assets.PurposeProcess, Variant: assets.VariantThumbnail}, "")
	if err != nil {
		t.Fatal(err)
	}
	defer delivery.Stream.Body.Close()
	thumbnail, err := io.ReadAll(delivery.Stream.Body)
	if err != nil || !bytes.Equal(thumbnail, encoded.Bytes()) {
		t.Fatalf("thumbnail bytes mismatch: %v", err)
	}
	original, err := os.ReadFile(filepath.Join(svc.dataDir, "resources", resource.ObjectKey))
	if err != nil || string(original) != "original" {
		t.Fatalf("original changed: %q %v", original, err)
	}
	usage, err := svc.repo.UserStoredFileBytes(resource.UserID)
	if err != nil || usage != resource.Size+int64(encoded.Len()) {
		t.Fatalf("thumbnail bytes not charged: %d %v", usage, err)
	}
	jobs := resourceDeletionJobs(resource.UserID, map[string]*model.Resource{"original": updated})
	if len(jobs) != 2 || jobs[1].ObjectKey != assets.ThumbnailObjectKey(resource.ObjectKey) {
		t.Fatalf("thumbnail cleanup not scheduled: %#v", jobs)
	}
}

func TestBrowserVerificationDoesNotBlockOtherUploadsOrCancellation(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var data bytes.Buffer
	if err := png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	var deletes atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			deletes.Add(1)
			return
		}
		if r.Method == http.MethodGet {
			close(entered)
			<-release
		}
		w.Header().Set("Content-Length", strconv.Itoa(data.Len()))
		if r.Method != http.MethodHead {
			w.Header().Set("Content-Range", "bytes 0-"+strconv.Itoa(data.Len()-1)+"/"+strconv.Itoa(data.Len()))
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write(data.Bytes())
		}
	}))
	defer server.Close()
	svc := newResourceTestService(t)
	setting, _ := json.Marshal(ossSettingValue{Enabled: true, Provider: s3Provider, Region: "auto", Endpoint: server.URL, Bucket: "media", AccessKeyID: "id", AccessKeySecret: "secret", PathStyle: true})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(setting)}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "serialized-upload", UserID: "owner", Provider: s3Provider, Endpoint: server.URL, Bucket: "media", ObjectKey: "one.png", Status: model.ResourceStatusPending, Kind: "image", MimeType: "image/png", Size: int64(data.Len())}
	if err := svc.ReserveChunkUploadSession(resource.UserID, resource.ID, resource.Size, time.Now().Add(time.Minute), 32); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	completed, canceled := make(chan error, 1), make(chan error, 1)
	go func() { _, err := svc.CompleteBrowserResourceUpload(resource.UserID, resource.ID); completed <- err }()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("completion did not reach object verification")
	}
	go func() { canceled <- svc.CancelBrowserResourceUpload(resource.UserID, resource.ID) }()
	select {
	case err := <-canceled:
		if err != nil {
			close(release)
			t.Fatal(err)
		}
	case <-time.After(500 * time.Millisecond):
		close(release)
		<-completed
		<-canceled
		t.Fatal("object verification blocked cancellation behind the global storage lock")
	}
	close(release)
	if err := <-completed; err == nil {
		t.Fatal("late verification published a cancelled object")
	}
	stored, err := svc.repo.ResourceForUser(resource.UserID, resource.ID)
	if err != nil || stored.Status != model.ResourceStatusFailed || deletes.Load() != 1 {
		t.Fatalf("cancelled resource = %+v, deletes=%d, err=%v", stored, deletes.Load(), err)
	}
}

func TestBrowserCancelBeforeCompleteNeverPublishesDeletedObject(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var deletes, reads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			deletes.Add(1)
			return
		}
		reads.Add(1)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()
	svc, db, _ := newResourceDeletionTestService(t)
	setting, _ := json.Marshal(ossSettingValue{Enabled: true, Provider: s3Provider, Region: "auto", Endpoint: server.URL, Bucket: "media", AccessKeyID: "id", AccessKeySecret: "secret", PathStyle: true})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(setting)}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "canceled-upload", UserID: "owner", Provider: s3Provider, Endpoint: server.URL, Bucket: "media", ObjectKey: "canceled.png", Status: model.ResourceStatusPending, Kind: "image", MimeType: "image/png", Size: 8}
	if err := svc.ReserveChunkUploadSession(resource.UserID, resource.ID, resource.Size, time.Now().Add(time.Minute), 32); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	if err := svc.CancelBrowserResourceUpload(resource.UserID, resource.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CompleteBrowserResourceUpload(resource.UserID, resource.ID); err == nil {
		t.Fatal("canceled resource was published")
	}
	if err := db.First(&resource, "id = ?", resource.ID).Error; err != nil {
		t.Fatal(err)
	}
	if resource.Status != model.ResourceStatusFailed || deletes.Load() != 1 || reads.Load() != 0 {
		t.Fatalf("canceled resource = %#v deletes=%d reads=%d", resource, deletes.Load(), reads.Load())
	}
}
