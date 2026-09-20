package app

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestCanvasMediaGenerationCopyAndRevocableURL(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "https://127.0.0.1")
	svc, db, dir := newResourceDeletionTestService(t)
	t.Cleanup(func() { _ = svc.Close() })
	for _, id := range []string{"owner", "editor", "viewer"} {
		if err := db.Create(&model.User{ID: id, Username: id, Status: model.UserStatusActive, Role: model.UserRoleUser}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(dir, "resources"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "resources", "original.txt"), []byte("shared data"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, record := range []any{
		&model.Resource{ID: "media", UserID: "owner", Kind: "file", Provider: "local", ObjectKey: "original.txt", Size: 11, MimeType: "text/plain", Status: model.ResourceStatusReady},
		&model.CanvasProject{ID: "canvas", UserID: "owner", Revision: 1, CollaborationEnabled: true, PayloadJSON: `{"nodes":[]}`},
		&model.CanvasCollaborator{ID: "editor", CanvasID: "canvas", UserID: "editor", Role: "editor"},
		&model.CanvasCollaborator{ID: "viewer", CanvasID: "canvas", UserID: "viewer", Role: "viewer"},
		&model.CanvasMediaGrant{CanvasID: "canvas", Kind: model.CanvasMediaResource, ObjectID: "media", Current: true},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	media := providerMedia{StorageKey: "resource:media"}
	if err := svc.hydrateProviderMedia("editor", &media, providerMediaHydrationPolicy{requireURL: true}); err != nil {
		t.Fatal(err)
	}
	signed, err := url.Parse(media.URL)
	if err != nil {
		t.Fatal(err)
	}
	query := signed.Query()
	if query.Get("reader") != "editor" {
		t.Fatalf("provider received owner URL: %s", media.URL)
	}
	stream, err := svc.OpenReaderResourceRange("media", "editor", query.Get("expires"), query.Get("signature"), "")
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(stream.Body)
	_ = stream.Body.Close()
	if string(data) != "shared data" {
		t.Fatal(string(data))
	}
	copy, err := svc.CopyReadableResource("editor", "media")
	if err != nil {
		t.Fatal(err)
	}
	if copy.UserID != "editor" || copy.ID == "media" || copy.ObjectKey == "original.txt" {
		t.Fatalf("copy ownership: %#v", copy)
	}
	again, err := svc.CopyReadableResource("editor", "media")
	if err != nil || again.ID != copy.ID {
		t.Fatalf("copy retry: %#v %v", again, err)
	}
	if err := svc.ensureTaskProjectActive("editor", "canvas"); err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureTaskProjectActive("viewer", "canvas"); err == nil {
		t.Fatal("viewer can generate into shared canvas")
	}
	input := map[string]any{"mode": "image", "config": map[string]any{"channelId": "", "baseUrl": "https://images.example.com/v1", "apiKey": "test-key", "interfaceType": "openai-image", "model": "gpt-image-1"}, "referenceImages": []any{map[string]any{"storageKey": "resource:media"}}}
	if err := svc.validateTaskMediaReferences("editor", input); err != nil {
		t.Fatal(err)
	}
	task, err := svc.CreateTask("editor", CreateTaskRequest{ProjectID: "canvas", Type: "canvas_image", Operation: "image", Prompt: "test", Input: input})
	if err != nil {
		t.Fatal(err)
	}
	if task.UserID != "editor" || task.ProjectID != "canvas" {
		t.Fatalf("task borrowed owner identity: %#v", task)
	}
	if _, err := svc.CreateTask("viewer", CreateTaskRequest{ProjectID: "canvas", Type: "canvas_image", Operation: "image", Prompt: "test", Input: input}); err == nil {
		t.Fatal("viewer task admitted")
	}
	if err := db.Where("canvas_id = ? AND user_id = ?", "canvas", "editor").Delete(&model.CanvasCollaborator{}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.OpenReaderResourceRange("media", "editor", query.Get("expires"), query.Get("signature"), ""); err == nil {
		t.Fatal("revoked provider URL still works")
	}
	if err := svc.hydrateProviderMedia("editor", &providerMedia{StorageKey: "resource:media"}, providerMediaHydrationPolicy{requireURL: true}); err == nil {
		t.Fatal("revoked task reference still hydrates")
	}
	if _, err := svc.ReadResource("editor", copy.ID); err != nil {
		t.Fatalf("personal copy lost after revocation: %v", err)
	}
	if _, err := svc.Resource("editor", "media"); err == nil {
		t.Fatal("shared usage gave original resource management")
	}
}

func TestCanvasMediaUsesOwnerStorageAndProxy(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	ownerStorage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/users/owner/video" || r.Header.Get("Range") != "bytes=0-3" {
			t.Errorf("owner storage request: %s %s", r.URL.Path, r.Header.Get("Range"))
		}
		w.Header().Set("Content-Range", "bytes 0-3/8")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("data"))
	}))
	defer ownerStorage.Close()
	memberStorage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("used member's storage to open owner media")
		w.WriteHeader(500)
	}))
	defer memberStorage.Close()
	svc, db, _ := newResourceDeletionTestService(t)
	for id, endpoint := range map[string]string{"owner": ownerStorage.URL, "member": memberStorage.URL} {
		if _, err := svc.UpdateUserOSSSetting(&model.User{ID: id}, OSSSettingRequest{Enabled: true, Provider: aliyunOSSProvider, Endpoint: endpoint, CDNBaseURL: endpoint, Bucket: "private-bucket", AccessKeyID: id + "-test-key", AccessKeySecret: "test-secret"}); err != nil {
			t.Fatal(err)
		}
	}
	setting, _, err := svc.readUserOSSSetting("owner")
	if err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "shared-video", UserID: "owner", Kind: "video", Status: model.ResourceStatusReady, Provider: aliyunOSSProvider, Endpoint: ownerStorage.URL, Bucket: "private-bucket", StorageSettingID: setting.ID, ObjectKey: "users/owner/video", MimeType: "video/mp4"}
	for _, item := range []any{&resource, &model.CanvasProject{ID: "shared", UserID: "owner", PayloadJSON: `{}`}, &model.CanvasCollaborator{ID: "member", CanvasID: "shared", UserID: "member", Role: "viewer"}, &model.CanvasMediaGrant{CanvasID: "shared", Kind: model.CanvasMediaResource, ObjectID: resource.ID, Current: true}} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	delivery, err := svc.PrepareResourceDelivery("member", resource.ID, ResourceDeliveryOptions{ForceDirect: true})
	if err != nil || delivery.RedirectURL != "" {
		t.Fatalf("shared delivery = %#v, %v", delivery, err)
	}
	stream, err := svc.OpenResourceRange("member", resource.ID, "bytes=0-3")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	body, err := io.ReadAll(stream.Body)
	if err != nil || string(body) != "data" || stream.StatusCode != 206 {
		t.Fatalf("stream = %#v body=%s err=%v", stream, body, err)
	}
	metadata, err := svc.ReadResource("member", resource.ID)
	if err != nil || metadata.ObjectKey != "" || metadata.Endpoint != "" || metadata.Bucket != "" || metadata.PublicURL != "" {
		t.Fatalf("metadata = %#v, %v", metadata, err)
	}
	ownerDelivery, err := svc.PrepareResourceDelivery("owner", resource.ID, ResourceDeliveryOptions{})
	if err != nil || ownerDelivery.RedirectURL != ownerStorage.URL+"/users/owner/video" {
		t.Fatalf("owner delivery = %#v, %v", ownerDelivery, err)
	}
}

func TestCanvasMediaProtectsContributorAssetWithoutOwnedResource(t *testing.T) {
	svc, db, _ := newResourceDeletionTestService(t)
	asset := model.Asset{ID: "contributed-asset", UserID: "editor", PayloadJSON: `{"data":{"storageKey":"resource:owner-image"}}`}
	for _, item := range []any{&asset, &model.Resource{ID: "owner-image", UserID: "owner", Status: model.ResourceStatusReady}, &model.CanvasProject{ID: "shared", UserID: "owner", PayloadJSON: `{}`}, &model.CanvasMediaGrant{CanvasID: "shared", Kind: model.CanvasMediaAsset, ObjectID: asset.ID, Current: true}} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := svc.deleteUserAssetWithResources("editor", asset.ID); err == nil {
		t.Fatal("deleted contributor asset used by another owner's canvas")
	}
	if err := svc.repo.DeleteAssetAndResources("editor", asset.ID, nil, nil); !errors.Is(err, repository.ErrCanvasHistoryResourceReferenced) {
		t.Fatalf("transaction did not recheck reference: %v", err)
	}
	if _, err := svc.repo.AssetForUser("editor", asset.ID); err != nil {
		t.Fatal(err)
	}
}
