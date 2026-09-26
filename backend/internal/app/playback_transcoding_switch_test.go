package app

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/platform"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func minimalMP4WithFourcc(fourcc string) []byte {
	stsd := stsdBoxWithFourcc(fourcc)
	moov := make([]byte, 8+len(stsd))
	binary.BigEndian.PutUint32(moov[0:4], uint32(len(moov)))
	copy(moov[4:8], "moov")
	copy(moov[8:], stsd)
	ftyp := make([]byte, 16)
	binary.BigEndian.PutUint32(ftyp[0:4], 16)
	copy(ftyp[4:8], "ftyp")
	copy(ftyp[8:12], "isom")
	return append(ftyp, moov...)
}

func newPlaybackSwitchTestService(t *testing.T, enabled bool) (*Service, *gorm.DB) {
	t.Helper()
	dsn := fmt.Sprintf("file:%s_%d?mode=memory&cache=shared", t.Name(), time.Now().UnixNano())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	value := platform.DefaultFeatureAvailability()
	value.PlaybackTranscodingEnabled = enabled
	if _, err := svc.UpdateFeatureAvailability(&model.User{ID: "admin-playback", Role: model.UserRoleAdmin}, value); err != nil {
		t.Fatal(err)
	}
	return svc, db
}

func TestPlaybackTranscodingDefaultsEnabled(t *testing.T) {
	svc, db := newFeatureAvailabilityTestService(t)
	if !svc.playbackTranscodingEnabled() {
		t.Fatal("playback transcoding should be enabled by default")
	}
	legacy := &model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"pluginCenterEnabled":true}`}
	if err := db.Create(legacy).Error; err != nil {
		t.Fatal(err)
	}
	if !svc.playbackTranscodingEnabled() {
		t.Fatal("legacy setting without playbackTranscodingEnabled should keep transcoding enabled")
	}
}

func TestPlaybackTranscodingSwitchRejectsTranscodeOnlyUploads(t *testing.T) {
	svc, db := newPlaybackSwitchTestService(t, false)
	var served []byte
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "video/mp4")
		_, _ = w.Write(served)
	}))
	defer remote.Close()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, fourcc := range []string{"hvc1", "hev1", "mp4v"} {
		data := minimalMP4WithFourcc(fourcc)
		served = data
		uploads := map[string]func() error{
			"multipart": func() error {
				_, err := svc.UploadResource("user-1", multipartFileHeader(t, "clip-"+fourcc+".mp4", "video/mp4", data), "video", 0, 0, 0)
				return err
			},
			"chunked": func() error {
				_, err := svc.UploadResourceFile("user-1", "clip-"+fourcc+".mp4", int64(len(data)), "video", 0, 0, 0, bytes.NewReader(data))
				return err
			},
			"url": func() error {
				_, err := svc.ImportResourceURL("user-1", remote.URL+"/clip-"+fourcc+".mp4", "video", 0, 0, 0)
				return err
			},
		}
		for name, upload := range uploads {
			if err := upload(); err == nil || !strings.Contains(err.Error(), "播放转码已关闭") {
				t.Fatalf("%s %s upload error = %v, want playback transcoding rejection", name, fourcc, err)
			}
		}
	}
	var count int64
	if err := db.Model(&model.Resource{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("rejected uploads created %d resources", count)
	}

	// 浏览器可直接播放的视频照常接收，且不会被排入转码。
	data := minimalMP4WithFourcc("avc1")
	resource, err := svc.UploadResourceFile("user-1", "clip.mp4", int64(len(data)), "video", 0, 0, 0, bytes.NewReader(data))
	if err != nil {
		t.Fatalf("H.264 upload error = %v", err)
	}
	if resource.Kind != "video" || resource.PlaybackStatus != model.PlaybackStatusNone {
		t.Fatalf("H.264 upload = kind %q playback %q", resource.Kind, resource.PlaybackStatus)
	}
	// 非视频内容不受开关影响。
	if err := svc.requireBrowserPlayableVideo("image", "image/png", bytes.NewReader([]byte("png"))); err != nil {
		t.Fatalf("image upload rejected: %v", err)
	}
}

func TestPlaybackTranscodingSwitchAllowsTranscodeOnlyUploadsWhenEnabled(t *testing.T) {
	svc, _ := newPlaybackSwitchTestService(t, true)
	for _, fourcc := range []string{"hvc1", "mp4v"} {
		if err := svc.requireBrowserPlayableVideo("video", "video/mp4", bytes.NewReader(minimalMP4WithFourcc(fourcc))); err != nil {
			t.Fatalf("%s rejected while transcoding is enabled: %v", fourcc, err)
		}
	}
}

func TestPlaybackTranscodingSwitchStopsNewTranscodesAndKeepsReadyCopies(t *testing.T) {
	svc, db := newPlaybackSwitchTestService(t, false)
	source := filepath.Join(svc.dataDir, "resources", "clips", "hevc.mp4")
	if err := os.MkdirAll(filepath.Dir(source), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, minimalMP4WithFourcc("hvc1"), 0o644); err != nil {
		t.Fatal(err)
	}
	pending := model.Resource{ID: "hevc", UserID: "user-1", Kind: "video", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "clips/hevc.mp4"}
	if err := db.Create(&pending).Error; err != nil {
		t.Fatal(err)
	}
	svc.maybeStartPlaybackTranscode(&pending)
	var stored model.Resource
	if err := db.First(&stored, "id = ?", pending.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.PlaybackStatus != model.PlaybackStatusNone {
		t.Fatalf("playback status = %q, want none while transcoding is disabled", stored.PlaybackStatus)
	}

	copyPath := filepath.Join(svc.dataDir, playbackDirName, "ready.mp4")
	if err := os.MkdirAll(filepath.Dir(copyPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(copyPath, []byte("playback-copy"), 0o644); err != nil {
		t.Fatal(err)
	}
	ready := model.Resource{ID: "ready", UserID: "user-1", Kind: "video", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "clips/ready.mp4", PlaybackStatus: model.PlaybackStatusReady, PlaybackObjectKey: "ready.mp4"}
	if err := db.Create(&ready).Error; err != nil {
		t.Fatal(err)
	}
	stream, err := svc.OpenResourcePlaybackRange("user-1", "ready")
	if err != nil {
		t.Fatalf("existing playback copy unavailable: %v", err)
	}
	defer stream.Body.Close()
	if body, _ := io.ReadAll(stream.Body); string(body) != "playback-copy" {
		t.Fatalf("playback copy body = %q", body)
	}
}
