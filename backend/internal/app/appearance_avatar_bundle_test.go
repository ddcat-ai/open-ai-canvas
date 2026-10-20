package app

import (
	"archive/zip"
	"bytes"
	"reflect"
	"testing"

	"yingce/backend/internal/model"
)

func agentAvatarBundleTestZIP(t *testing.T, manifest string, files map[string][]byte) []byte {
	t.Helper()
	var data bytes.Buffer
	w := zip.NewWriter(&data)
	if manifest != "" {
		file, err := w.Create("avatar.json")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write([]byte(manifest)); err != nil {
			t.Fatal(err)
		}
	}
	for name, content := range files {
		file, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func agentAvatarTestMP4() []byte {
	return []byte{0, 0, 0, 16, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 0, 0, 0, 0}
}

func TestAgentAvatarBundleArchiveValidation(t *testing.T) {
	validManifest := `{"version":1,"width":480,"height":432,"clips":{"idle":"idle.mp4","wave":"wave.mp4"}}`
	validFiles := map[string][]byte{"idle.mp4": agentAvatarTestMP4(), "wave.mp4": agentAvatarTestMP4()}
	data := agentAvatarBundleTestZIP(t, validManifest, validFiles)
	manifest, err := validateAgentAvatarBundleArchive(bytes.NewReader(data), int64(len(data)))
	if err != nil || manifest.Width != 480 || manifest.Height != 432 || len(manifest.Clips) != 2 {
		t.Fatalf("valid bundle rejected: manifest=%+v err=%v", manifest, err)
	}

	tests := []struct {
		name     string
		manifest string
		files    map[string][]byte
	}{
		{"missing manifest", "", validFiles},
		{"unsupported version", `{"version":2,"width":480,"height":432,"clips":{"idle":"idle.mp4"}}`, map[string][]byte{"idle.mp4": agentAvatarTestMP4()}},
		{"path traversal", `{"version":1,"width":480,"height":432,"clips":{"idle":"../idle.mp4"}}`, map[string][]byte{"../idle.mp4": agentAvatarTestMP4()}},
		{"missing clip", `{"version":1,"width":480,"height":432,"clips":{"idle":"idle.mp4"}}`, nil},
		{"invalid mp4", `{"version":1,"width":480,"height":432,"clips":{"idle":"idle.mp4"}}`, map[string][]byte{"idle.mp4": []byte("not an mp4 file")}},
		{"unreferenced file", `{"version":1,"width":480,"height":432,"clips":{"idle":"idle.mp4"}}`, map[string][]byte{"idle.mp4": agentAvatarTestMP4(), "extra.mp4": agentAvatarTestMP4()}},
		{"unsupported file", `{"version":1,"width":480,"height":432,"clips":{"idle":"idle.mp4"}}`, map[string][]byte{"idle.mp4": agentAvatarTestMP4(), "readme.txt": []byte("not allowed")}},
		{"invalid dimensions", `{"version":1,"width":0,"height":432,"clips":{"idle":"idle.mp4"}}`, map[string][]byte{"idle.mp4": agentAvatarTestMP4()}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			data := agentAvatarBundleTestZIP(t, test.manifest, test.files)
			if _, err := validateAgentAvatarBundleArchive(bytes.NewReader(data), int64(len(data))); err == nil {
				t.Fatal("invalid bundle accepted")
			}
		})
	}
}

func TestDefaultCanvasAppearanceUsesBuiltInAvatarBundle(t *testing.T) {
	value := defaultCanvasAppearance()
	if value.AvatarType != "bundle" || value.AvatarBundleResourceID != "" {
		t.Fatalf("default canvas appearance = %+v, want built-in avatar bundle", value)
	}
	wantStates := map[string]string{
		"idle": "idle", "queued": "sleep_loop", "running": "working_loop", "waiting_approval": "think",
		"completed": "wave", "failed": "wipe_sweat", "cancelled": "lie_down", "rejected": "think",
	}
	if !reflect.DeepEqual(value.AvatarClipStates, wantStates) {
		t.Fatalf("default clip mapping = %#v", value.AvatarClipStates)
	}
	if _, err := normalizeCanvasAppearance(value); err != nil {
		t.Fatalf("default bundle rejected: %v", err)
	}
	invalid := value
	invalid.AvatarClipStates = map[string]string{"unrecognized": "idle"}
	if _, err := normalizeCanvasAppearance(invalid); err == nil {
		t.Fatal("unknown state accepted")
	}
}

func TestAgentAvatarBundleUploadEnableAndReferenceProtection(t *testing.T) {
	svc, _, _, admin := newAppearanceTestService(t)
	data := agentAvatarBundleTestZIP(t, `{"version":1,"width":480,"height":432,"clips":{"idle":"idle.mp4","wave":"wave.mp4"}}`, map[string][]byte{
		"idle.mp4": agentAvatarTestMP4(),
		"wave.mp4": agentAvatarTestMP4(),
	})
	imported, err := svc.UploadAgentAvatarBundle(admin, multipartFileHeader(t, "avatar.zip", "application/zip", data))
	if err != nil {
		t.Fatal(err)
	}
	resource, err := svc.repo.Resource(imported.ResourceID)
	if err != nil || resource.Kind != agentAvatarBundleResourceKind || resource.Provider != "local" {
		t.Fatalf("resource=%+v err=%v", resource, err)
	}
	if _, _, err := svc.AgentAvatarBundleAsset(nil, imported.ResourceID, "avatar.json"); err == nil {
		t.Fatal("unpublished bundle is publicly accessible")
	}

	appearance, err := svc.AdminAppearance(admin)
	if err != nil {
		t.Fatal(err)
	}
	appearance.Canvas.AvatarType = "bundle"
	appearance.Canvas.AvatarBundleResourceID = imported.ResourceID
	appearance.Canvas.AvatarClipStates = map[string]string{
		"idle": "idle", "running": "idle", "waiting_approval": "idle", "completed": "wave", "failed": "idle",
	}
	other := &model.User{ID: "other-avatar-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if _, err := svc.UpdateAppearance(other, appearance.AppearanceSetting); err == nil {
		t.Fatal("another administrator enabled an unowned bundle")
	}
	invalid := appearance.AppearanceSetting
	invalid.Canvas.AvatarClipStates = map[string]string{"running": "missing"}
	if _, err := svc.UpdateAppearance(admin, invalid); err == nil {
		t.Fatal("missing clip mapping was saved")
	}
	if _, err := svc.UpdateAppearance(admin, appearance.AppearanceSetting); err != nil {
		t.Fatal(err)
	}
	video, mimeType, err := svc.AgentAvatarBundleAsset(nil, imported.ResourceID, "idle.mp4")
	if err != nil || mimeType != "video/mp4" || !bytes.Equal(video, agentAvatarTestMP4()) {
		t.Fatalf("public clip response mime=%q bytes=%d err=%v", mimeType, len(video), err)
	}
	if _, _, err := svc.AgentAvatarBundleAsset(nil, imported.ResourceID, "../avatar.json"); err == nil {
		t.Fatal("traversal file request accepted")
	}
	if len(svc.appearanceResourceReferences([]string{imported.ResourceID})[imported.ResourceID]) == 0 {
		t.Fatal("active avatar bundle lost deletion protection")
	}

	appearance.Canvas.AvatarBundleResourceID = ""
	if _, err := svc.UpdateAppearance(admin, appearance.AppearanceSetting); err != nil {
		t.Fatal(err)
	}
	if len(svc.appearanceResourceReferences([]string{imported.ResourceID})[imported.ResourceID]) != 0 {
		t.Fatal("detached avatar bundle remains referenced")
	}
	if _, _, err := svc.AgentAvatarBundleAsset(nil, imported.ResourceID, "idle.mp4"); err == nil {
		t.Fatal("detached bundle remains publicly accessible")
	}
}
