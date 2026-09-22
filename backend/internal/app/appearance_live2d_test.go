package app

import (
	"archive/zip"
	"bytes"
	"image"
	"image/png"
	"os"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func live2DTestFiles(t *testing.T) map[string][]byte {
	t.Helper()
	var texture bytes.Buffer
	if err := png.Encode(&texture, image.NewNRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	return map[string][]byte{
		"avatar/avatar.model3.json": []byte(`{"Version":3,"FileReferences":{"Moc":"avatar.moc3","Textures":["texture.png"]}}`),
		"avatar/avatar.moc3":        []byte("MOC3-test-validation-only"),
		"avatar/texture.png":        texture.Bytes(),
	}
}

func live2DTestZIP(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var data bytes.Buffer
	w := zip.NewWriter(&data)
	for name, content := range files {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func TestLive2DArchiveAccepts50MiB(t *testing.T) {
	files := live2DTestFiles(t)
	// Structural fixture only, not a playable model. Store preserves the ZIP size.
	moc := make([]byte, 50<<20)
	copy(moc, "MOC3")
	files["avatar/avatar.moc3"] = moc
	var data bytes.Buffer
	w := zip.NewWriter(&data)
	for name, content := range files {
		f, err := w.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if data.Len() <= 50<<20 {
		t.Fatal("fixture must exercise a ZIP larger than 50 MiB")
	}
	if _, err := validateLive2DArchive(bytes.NewReader(data.Bytes()), int64(data.Len())); err != nil {
		t.Fatal(err)
	}
}

func TestLive2DArchiveValidation(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(map[string][]byte)
		valid  bool
	}{
		{"valid nested model", func(map[string][]byte) {}, true},
		{"traversal", func(f map[string][]byte) { f["../escape.json"] = []byte(`{}`) }, false},
		{"script", func(f map[string][]byte) { f["run.js"] = []byte(`alert(1)`) }, false},
		{"case collision", func(f map[string][]byte) { f["avatar/TEXTURE.png"] = f["avatar/texture.png"] }, false},
		{"missing moc", func(f map[string][]byte) { delete(f, "avatar/avatar.moc3") }, false},
		{"fake moc", func(f map[string][]byte) { f["avatar/avatar.moc3"] = []byte("fake") }, false},
		{"invalid png", func(f map[string][]byte) { f["avatar/texture.png"] = []byte("not png") }, false},
		{"external texture", func(f map[string][]byte) {
			f["avatar/avatar.model3.json"] = []byte(`{"Version":3,"FileReferences":{"Moc":"avatar.moc3","Textures":["https://example.com/texture.png"]}}`)
		}, false},
		{"audio reference", func(f map[string][]byte) {
			f["avatar/avatar.model3.json"] = []byte(`{"Version":3,"FileReferences":{"Moc":"avatar.moc3","Textures":["texture.png"],"Motions":{"Idle":[{"File":"idle.motion3.json","Sound":"voice.wav"}]}}}`)
		}, false},
		{"multiple entries", func(f map[string][]byte) { f["other.model3.json"] = f["avatar/avatar.model3.json"] }, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			files := live2DTestFiles(t)
			tt.mutate(files)
			data := live2DTestZIP(t, files)
			entry, err := validateLive2DArchive(bytes.NewReader(data), int64(len(data)))
			if (err == nil) != tt.valid {
				t.Fatalf("entry=%q err=%v", entry, err)
			}
			if tt.valid && entry != "avatar/avatar.model3.json" {
				t.Fatal(entry)
			}
		})
	}
	if _, err := validateLive2DArchive(bytes.NewReader(nil), Live2DMaxBytes+1); err == nil {
		t.Fatal("oversized ZIP accepted")
	}
	for _, name := range []string{"", "../a", "a/../b", "/a", "a\\b", "a%2fb", "https://host/a", "a?b"} {
		if live2DFileName(name) {
			t.Fatalf("unsafe filename accepted: %q", name)
		}
	}
}

func TestLive2DArchiveRejectsSymlinksAndEntryFlood(t *testing.T) {
	var data bytes.Buffer
	w := zip.NewWriter(&data)
	header := &zip.FileHeader{Name: "link.json", Method: zip.Store}
	header.SetMode(os.ModeSymlink | 0o777)
	f, err := w.CreateHeader(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte("outside")); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := validateLive2DArchive(bytes.NewReader(data.Bytes()), int64(data.Len())); err == nil {
		t.Fatal("symlink accepted")
	}
	data.Reset()
	w = zip.NewWriter(&data)
	for i := 0; i < 257; i++ {
		if _, err := w.Create("duplicate.json"); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := validateLive2DArchive(bytes.NewReader(data.Bytes()), int64(data.Len())); err == nil {
		t.Fatal("entry flood accepted")
	}
}

func TestLive2DAppearanceImportPublishAndDetach(t *testing.T) {
	svc, _, _, admin := newAppearanceTestService(t)
	if _, err := svc.UploadLive2D(nil, nil); err == nil {
		t.Fatal("anonymous upload accepted")
	}
	data := live2DTestZIP(t, live2DTestFiles(t))
	ordinary, err := svc.UploadResource(admin.ID, multipartFileHeader(t, "ordinary.zip", "application/zip", data), "live2d", 0, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if ordinary.Kind == "live2d" {
		t.Fatal("ordinary upload claimed the reserved model kind")
	}
	imported, err := svc.UploadLive2D(admin, multipartFileHeader(t, "avatar.zip", "application/zip", data))
	if err != nil {
		t.Fatal(err)
	}
	resource, err := svc.repo.Resource(imported.ResourceID)
	if err != nil || resource.Kind != "live2d" || resource.Provider != "local" {
		t.Fatalf("resource=%+v err=%v", resource, err)
	}
	if _, _, err := svc.Live2DAsset(nil, imported.ResourceID, imported.Entry); err == nil {
		t.Fatal("draft is publicly accessible")
	}
	if body, mime, err := svc.Live2DAsset(admin, imported.ResourceID, imported.Entry); err != nil || mime != "application/json" || len(body) == 0 {
		t.Fatalf("preview failed: %s %v", mime, err)
	}
	other := &model.User{ID: "other-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if _, _, err := svc.Live2DAsset(other, imported.ResourceID, imported.Entry); err == nil {
		t.Fatal("other admin previewed draft")
	}
	value := defaultAppearanceSetting()
	value.Canvas.AgentName = "小鱼"
	value.Canvas.AvatarType = "live2d"
	value.Canvas.Live2DResourceID = imported.ResourceID
	value.Canvas.Live2DEntry = "client-cannot-choose.json"
	if _, err := svc.UpdateAppearance(other, value); err == nil {
		t.Fatal("other admin enabled draft")
	}
	saved, err := svc.UpdateAppearance(admin, value)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Public.Canvas.AgentName != "小鱼" || saved.Public.BrandName != "影策" || saved.Public.Canvas.Live2DEntry != imported.Entry {
		t.Fatalf("bad public setting: %+v", saved.Public)
	}
	if _, _, err := svc.Live2DAsset(nil, imported.ResourceID, "avatar/texture.png"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.Live2DAsset(nil, imported.ResourceID, "../avatar/texture.png"); err == nil {
		t.Fatal("traversal accepted")
	}
	refs := svc.appearanceResourceReferences([]string{imported.ResourceID})
	if len(refs[imported.ResourceID]) != 1 {
		t.Fatalf("missing deletion protection: %+v", refs)
	}
	if _, err := svc.AdminResourcePage(admin, AdminResourceQuery{Kind: "live2d", Page: 1, Limit: 20}); err != nil {
		t.Fatal(err)
	}
	blocked, err := svc.DeleteAdminResources(admin, AdminResourceDeleteRequest{ResourceIDs: []string{imported.ResourceID}})
	if err != nil || len(blocked.Blocked) != 1 || len(blocked.Deleted) != 0 {
		t.Fatalf("referenced model deletion: %+v %v", blocked, err)
	}
	value.Canvas.AvatarType = "orb"
	if _, err := svc.UpdateAppearance(admin, value); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.Live2DAsset(nil, imported.ResourceID, imported.Entry); err == nil {
		t.Fatal("disabled model still public")
	}
	if len(svc.appearanceResourceReferences([]string{imported.ResourceID})[imported.ResourceID]) != 1 {
		t.Fatal("orb selection lost resource reference")
	}
	value.Canvas.Live2DResourceID = ""
	if _, err := svc.UpdateAppearance(admin, value); err != nil {
		t.Fatal(err)
	}
	if len(svc.appearanceResourceReferences([]string{imported.ResourceID})[imported.ResourceID]) != 0 {
		t.Fatal("detached model still referenced")
	}
	deleted, err := svc.DeleteAdminResources(admin, AdminResourceDeleteRequest{ResourceIDs: []string{imported.ResourceID}})
	if err != nil || len(deleted.Deleted) != 1 {
		t.Fatalf("detached model deletion: %+v %v", deleted, err)
	}
}

func TestCanvasAppearanceValidation(t *testing.T) {
	for _, mutate := range []func(*CanvasAppearance){
		func(v *CanvasAppearance) { v.AgentName = "\n" },
		func(v *CanvasAppearance) { v.AgentName = "小\x00鱼" },
		func(v *CanvasAppearance) { v.AvatarHeight = 1000 },
		func(v *CanvasAppearance) { v.AvatarType = "invalid" },
		func(v *CanvasAppearance) { v.AvatarType = "live2d" },
	} {
		value := defaultCanvasAppearance()
		mutate(&value)
		if _, err := normalizeCanvasAppearance(value); err == nil {
			t.Fatalf("invalid value accepted: %+v", value)
		}
	}
}
