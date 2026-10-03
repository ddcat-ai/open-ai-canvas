package app

import (
	"archive/zip"
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func imageArchiveFixture(t *testing.T) *Service {
	t.Helper()
	s := newResourceTestService(t)
	for _, resource := range []model.Resource{
		{ID: "image-1", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "first.png", MimeType: "image/png", Size: 5},
		{ID: "image-2", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "second.webp", MimeType: "image/webp", Size: 6},
	} {
		if err := s.repo.CreateResource(&resource); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(s.dataDir, "resources"), 0700); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(s.dataDir, "resources", "first.png"), []byte("first"), 0600)
	os.WriteFile(filepath.Join(s.dataDir, "resources", "second.webp"), []byte("second"), 0600)
	return s
}

func TestImageResourceArchiveKeepsRequestedOrderNamesAndOriginalBytes(t *testing.T) {
	s := imageArchiveFixture(t)
	file, err := s.CreateImageResourceArchive(context.Background(), "user-1", []ImageResourceArchiveItem{{ResourceID: "image-2", Name: "02_细节"}, {ResourceID: "image-1", Name: "03_场景"}})
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(file.Name())
	defer file.Close()
	stat, _ := file.Stat()
	archive, err := zip.NewReader(file, stat.Size())
	if err != nil || len(archive.File) != 2 {
		t.Fatalf("invalid archive: %+v %v", archive, err)
	}
	for i, expected := range []struct{ name, content string }{{"02_细节.webp", "second"}, {"03_场景.png", "first"}} {
		entry := archive.File[i]
		reader, _ := entry.Open()
		content, _ := io.ReadAll(reader)
		reader.Close()
		if entry.Name != expected.name || string(content) != expected.content {
			t.Fatalf("entry %d: %s %q", i, entry.Name, content)
		}
	}
}

func TestImageResourceArchiveRejectsForeignUnsafeMissingAndIncompleteInputs(t *testing.T) {
	s := imageArchiveFixture(t)
	for _, request := range []struct {
		user  string
		items []ImageResourceArchiveItem
	}{
		{"other-user", []ImageResourceArchiveItem{{ResourceID: "image-1", Name: "01_场景"}}},
		{"user-1", nil},
		{"user-1", make([]ImageResourceArchiveItem, 101)},
		{"user-1", []ImageResourceArchiveItem{{ResourceID: "image-1", Name: "../../outside"}}},
		{"user-1", []ImageResourceArchiveItem{{ResourceID: "image-1", Name: "same"}, {ResourceID: "image-1", Name: "same"}}},
		{"user-1", []ImageResourceArchiveItem{{ResourceID: "image-1", Name: "01_场景"}, {ResourceID: "missing", Name: "02_场景"}}},
	} {
		if file, err := s.CreateImageResourceArchive(context.Background(), request.user, request.items); err == nil || file != nil {
			t.Fatalf("invalid archive request accepted: %+v", request)
		}
	}
	resource, _ := s.repo.ResourceForUser("user-1", "image-2")
	resource.Size = 7
	s.repo.SaveResource(resource)
	if file, err := s.CreateImageResourceArchive(context.Background(), "user-1", []ImageResourceArchiveItem{{ResourceID: "image-2", Name: "02_细节"}}); err == nil || file != nil {
		t.Fatal("truncated original was archived")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if file, err := s.CreateImageResourceArchive(ctx, "user-1", []ImageResourceArchiveItem{{ResourceID: "image-1", Name: "01_场景"}}); err == nil || file != nil {
		t.Fatal("cancelled archive continued")
	}
}
