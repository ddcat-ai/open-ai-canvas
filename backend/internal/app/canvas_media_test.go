package app

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

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
