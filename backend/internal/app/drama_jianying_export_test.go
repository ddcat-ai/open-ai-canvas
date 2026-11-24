package app

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/jianying"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func jianyingExportFixture(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := db.DB()
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })
	if err := db.AutoMigrate(&model.Project{}, &model.DramaProduction{}, &model.DramaEpisode{}, &model.DramaSegment{}, &model.DramaShot{}, &model.Resource{}); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	for _, record := range []any{
		&model.Project{ID: "project", UserID: "owner", Name: strings.Repeat("长作品名", 30)},
		&model.DramaProduction{ProjectID: "project", UserID: "owner", SettingsJSON: `{"aspectRatio":"9:16"}`},
		&model.DramaEpisode{ID: "episode", ProjectID: "project", Number: 1},
		&model.DramaEpisode{ID: "foreign-episode", ProjectID: "other", Number: 1},
		&model.DramaSegment{ID: "s0", ProjectID: "project", EpisodeID: "episode", SegmentIndex: 0, VideoStatus: model.DramaMediaReady, VideoResourceID: "r0", VideoSeconds: 3},
		&model.DramaSegment{ID: "s1", ProjectID: "project", EpisodeID: "episode", SegmentIndex: 1, VideoStatus: model.DramaMediaFailed},
		&model.DramaSegment{ID: "s2", ProjectID: "project", EpisodeID: "episode", SegmentIndex: 2, VideoStatus: model.DramaMediaStale, VideoResourceID: "r2", VideoSeconds: 3},
		&model.DramaSegment{ID: "s3", ProjectID: "project", EpisodeID: "episode", SegmentIndex: 3, VideoStatus: model.DramaMediaReady, VideoResourceID: "r3", VideoSeconds: 4},
		&model.DramaShot{ID: "h0b", ProjectID: "project", EpisodeID: "episode", Position: 20, SegmentIndex: 0, DurationMs: 1000, Dialogue: "后一句"},
		&model.DramaShot{ID: "h0a", ProjectID: "project", EpisodeID: "episode", Position: 10, SegmentIndex: 0, DurationMs: 3000, Dialogue: "先一句"},
		&model.DramaShot{ID: "h1", ProjectID: "project", EpisodeID: "episode", Position: 30, SegmentIndex: 1, DurationMs: 3000, Dialogue: "未生成不导出"},
		&model.DramaShot{ID: "h2", ProjectID: "project", EpisodeID: "episode", Position: 40, SegmentIndex: 2, DurationMs: 3000, Dialogue: "旧版本台词"},
		&model.DramaShot{ID: "h3", ProjectID: "project", EpisodeID: "episode", Position: 50, SegmentIndex: 3, DurationMs: 0, Dialogue: "估算"},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, record := range []model.Resource{
		{ID: "r0", UserID: "owner", Kind: "video", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "r0.mp4", MimeType: "video/mp4", Size: 7, DurationMs: 2500, Width: 1080, Height: 1920},
		{ID: "r2", UserID: "owner", Kind: "video", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "r2.mp4", MimeType: "video/mp4", Size: 7, DurationMs: 6000},
		{ID: "r3", UserID: "owner", Kind: "video", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "r3.mp4", MimeType: "video/mp4", Size: 7},
	} {
		if err := db.Create(&record).Error; err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Join(svc.dataDir, "resources"), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(svc.dataDir, "resources", record.ObjectKey), []byte("content"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return svc, db
}

func TestDramaJianyingPreviewAndStreamMatchReviewedMedia(t *testing.T) {
	svc, _ := jianyingExportFixture(t)
	req := DramaJianyingDraftRequest{DraftRoot: `C:/Users/导演/Drafts`, Captions: true}
	preview, err := svc.PreviewDramaJianyingDraft("owner", "project", "episode", req)
	if err != nil {
		t.Fatal(err)
	}
	if preview.TotalSegments != 4 || preview.AvailableSegments != 3 || preview.MissingSegments != 1 || preview.StaleSegments != 1 || preview.DurationMs != 12500 || preview.MediaBytes != 21 || preview.CaptionCount != 4 {
		t.Fatalf("preview: %+v", preview)
	}
	if preview.DraftRoot != `C:\Users\导演\Drafts` || !preview.Segments[3].DurationEstimated || len(preview.Warnings) != 4 {
		t.Fatalf("preview missing warnings: %+v", preview)
	}
	req.Revision = preview.Revision
	if _, err := svc.PrepareDramaJianyingDraft("owner", "project", "episode", req); err == nil {
		t.Fatal("partial export silently accepted")
	}
	req.AllowIncomplete = true
	if _, err := svc.PrepareDramaJianyingDraft("owner", "project", "episode", req); err == nil {
		t.Fatal("stale export silently accepted")
	}
	req.AllowStale = true
	archive, err := svc.PrepareDramaJianyingDraft("owner", "project", "episode", req)
	if err != nil {
		t.Fatal(err)
	}
	again, err := svc.PrepareDramaJianyingDraft("owner", "project", "episode", req)
	if err != nil || archive.FileName == again.FileName {
		t.Fatal("repeat export names collide")
	}
	var buffer bytes.Buffer
	if err := svc.WriteDramaArchive(context.Background(), "owner", archive, &buffer); err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(buffer.Bytes()), int64(buffer.Len()))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{}
	for _, file := range reader.File {
		body, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		files[file.Name], err = io.ReadAll(body)
		_ = body.Close()
		if err != nil {
			t.Fatal(err)
		}
	}
	folder := strings.TrimSuffix(archive.FileName, ".zip")
	if !bytes.Equal(files[folder+"/draft_content.json"], files[folder+"/draft_info.json"]) {
		t.Fatal("platform draft copies differ")
	}
	var content struct {
		ID        string `json:"id"`
		Duration  int64  `json:"duration"`
		Materials struct {
			Videos []struct {
				Path     string `json:"path"`
				Duration int64  `json:"duration"`
			} `json:"videos"`
		} `json:"materials"`
	}
	if err := json.Unmarshal(files[folder+"/draft_content.json"], &content); err != nil {
		t.Fatal(err)
	}
	if content.Duration != 12_500_000 || len(content.Materials.Videos) != 3 {
		t.Fatal("duration or clip count mismatch")
	}
	for index, material := range content.Materials.Videos {
		if !strings.HasPrefix(material.Path, preview.DraftRoot+`\`+folder+`\materials\`) {
			t.Fatal("material path not under reviewed target")
		}
		filename := material.Path[strings.LastIndex(material.Path, `\`)+1:]
		if string(files[folder+"/materials/"+filename]) != "content" {
			t.Fatalf("missing material: %s", filename)
		}
		if material.Duration != []int64{2500000, 6000000, 4000000}[index] {
			t.Fatal("clips not ordered using actual media duration")
		}
	}
	srt := string(files[folder+"/台词字幕.srt"])
	for _, want := range []string{"00:00:00,000 --> 00:00:01,875\n先一句", "00:00:01,875 --> 00:00:02,500\n后一句", "00:00:02,500 --> 00:00:08,500\n旧版本台词", "00:00:08,500 --> 00:00:12,500\n估算"} {
		if !strings.Contains(srt, want) {
			t.Fatalf("SRT range mismatch: %s", srt)
		}
	}
	if strings.Contains(srt, "未生成") || !strings.Contains(string(files[folder+"/导入说明.txt"]), "第 2 段") {
		t.Fatal("omission not disclosed")
	}
}

func TestDramaJianyingRevisionPermissionsAndUnavailableMedia(t *testing.T) {
	svc, db := jianyingExportFixture(t)
	req := DramaJianyingDraftRequest{DraftRoot: "/Users/editor/Drafts", Captions: true, AllowIncomplete: true, AllowStale: true}
	for _, target := range [][3]string{{"other", "project", "episode"}, {"owner", "project", "foreign-episode"}} {
		_, err := svc.PreviewDramaJianyingDraft(target[0], target[1], target[2], req)
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Status != 404 {
			t.Fatalf("ownership not enforced: %v", err)
		}
	}
	preview, err := svc.PreviewDramaJianyingDraft("owner", "project", "episode", req)
	if err != nil {
		t.Fatal(err)
	}
	req.Revision = preview.Revision
	if err := db.Model(&model.DramaShot{}).Where("id = ?", "h0a").Update("dialogue", "已修改台词").Error; err != nil {
		t.Fatal(err)
	}
	_, err = svc.PrepareDramaJianyingDraft("owner", "project", "episode", req)
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Status != 409 {
		t.Fatalf("changed export not rejected: %v", err)
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", "r0").Update("user_id", "other").Error; err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(svc.dataDir, "resources/r2.mp4"), []byte("short"), 0o600); err != nil {
		t.Fatal(err)
	}
	preview, err = svc.PreviewDramaJianyingDraft("owner", "project", "episode", req)
	if err != nil {
		t.Fatal(err)
	}
	if preview.AvailableSegments != 1 || preview.MissingSegments != 3 {
		t.Fatalf("unreadable/foreign media not marked missing: %+v", preview)
	}
	req.Revision = preview.Revision
	archive, err := svc.PrepareDramaJianyingDraft("owner", "project", "episode", req)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(svc.dataDir, "resources/r3.mp4"), []byte("changed-size"), 0o600); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := svc.WriteDramaArchive(context.Background(), "owner", archive, &output); err == nil {
		t.Fatal("changed physical bytes incorrectly reported as complete ZIP")
	}
	if _, err := zip.NewReader(bytes.NewReader(output.Bytes()), int64(output.Len())); err == nil {
		t.Fatal("partial archive incorrectly finalized")
	}
}

func TestDramaSegmentCaptionsStayInsideAvailableClip(t *testing.T) {
	captions := dramaSegmentCaptions([]model.DramaShot{{Dialogue: "一"}, {Dialogue: ""}, {Dialogue: "三"}}, 2500, 10000)
	if len(captions) != 2 || captions[0].StartUs != 2500 || captions[1].StartUs+captions[1].DurationUs != 12500 {
		t.Fatalf("bad equal allocation: %+v", captions)
	}
	if jianying.SRT(captions) == "" {
		t.Fatal("captions not serializable")
	}
}
