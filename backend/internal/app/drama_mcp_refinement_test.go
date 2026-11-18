package app

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestDramaMCPSegmentPromptEditAndGenerationRevision(t *testing.T) {
	svc, fake := newDramaTestService(t)
	projectID := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	runDramaTicks(t, svc, projectID, 24)
	summary, err := svc.DramaSummary("usr-drama", projectID)
	if err != nil {
		t.Fatal(err)
	}
	episodeID := summary.Episodes[0].ID
	detail, err := svc.DramaEpisodeDetail("usr-drama", projectID, episodeID)
	if err != nil || len(detail.Segments) == 0 {
		t.Fatalf("need segment: %v", err)
	}
	segment := detail.Segments[0]
	oldVideos := len(dramaVideoRequests(fake))
	if _, err := svc.EditDramaSegmentPrompt("other", projectID, episodeID, segment.Index, EditDramaSegmentPromptRequest{Prompt: "越权"}); err == nil {
		t.Fatal("foreign user edited prompt")
	}
	if _, err := svc.EditDramaSegmentPrompt("usr-drama", projectID, episodeID, 999, EditDramaSegmentPromptRequest{Prompt: "无效段"}); err == nil {
		t.Fatal("missing segment accepted")
	}
	if _, err := svc.EditDramaSegmentPrompt("usr-drama", projectID, episodeID, segment.Index, EditDramaSegmentPromptRequest{Prompt: "  "}); err == nil {
		t.Fatal("empty prompt accepted")
	}
	stale := segment.Revision - 1
	if _, err := svc.EditDramaSegmentPrompt("usr-drama", projectID, episodeID, segment.Index, EditDramaSegmentPromptRequest{Prompt: "旧版本", ExpectedRevision: &stale}); err == nil {
		t.Fatal("stale edit accepted")
	}
	prompt := "一个演员站在画面中央，前景无叠影。"
	edit, err := svc.EditDramaSegmentPrompt("usr-drama", projectID, episodeID, segment.Index, EditDramaSegmentPromptRequest{Prompt: prompt, ExpectedRevision: &segment.Revision})
	if err != nil {
		t.Fatal(err)
	}
	if edit.Revision != segment.Revision+1 || !edit.Custom || edit.PromptStatus == "" {
		t.Fatalf("edit result: %+v", edit)
	}
	if len(dramaVideoRequests(fake)) != oldVideos {
		t.Fatal("prompt edit triggered video generation")
	}
	read, err := svc.DramaSegmentDetail("usr-drama", projectID, episodeID, segment.Index)
	if err != nil {
		t.Fatal(err)
	}
	if read.Segment.VideoPrompt != prompt || read.Segment.Generated != segment.Generated || len(read.Shots) == 0 || len(read.PromptHistory) != 1 || read.PromptHistory[0].Prompt != prompt {
		t.Fatalf("segment read: %+v", read)
	}
	if len(read.VideoVersions) == 0 || read.Segment.Request.Operation == "" {
		t.Fatalf("missing versions or request preview: %+v", read)
	}
	if _, err := svc.GenerateDramaSegments("usr-drama", projectID, episodeID, GenerateDramaSegmentsRequest{Segments: []int{segment.Index}, ExpectedPromptRevision: &segment.Revision}); err == nil {
		t.Fatal("stale generation accepted")
	}
	queued, err := svc.GenerateDramaSegments("usr-drama", projectID, episodeID, GenerateDramaSegmentsRequest{Segments: []int{segment.Index}, ExpectedPromptRevision: &edit.Revision})
	if err != nil {
		t.Fatal(err)
	}
	items, ok := queued["segments"].([]map[string]any)
	if !ok || len(items) != 1 || items[0]["segmentIndex"] != segment.Index || items[0]["segmentId"] != segment.ID {
		t.Fatalf("missing segment mapping: %+v", queued)
	}
	if len(dramaVideoRequests(fake)) != oldVideos {
		t.Fatal("enqueue synchronously submitted video task")
	}
}

func TestDramaMCPSegmentVersionOwnershipAndFrame(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg unavailable")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe unavailable")
	}
	svc, fake := newDramaTestService(t)
	projectID := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	runDramaTicks(t, svc, projectID, 24)
	summary, err := svc.DramaSummary("usr-drama", projectID)
	if err != nil {
		t.Fatal(err)
	}
	episodeID := summary.Episodes[0].ID
	detail, err := svc.DramaEpisodeDetail("usr-drama", projectID, episodeID)
	if err != nil || len(detail.Segments) == 0 {
		t.Fatalf("need segment: %v", err)
	}
	segment := detail.Segments[0]
	versions, err := svc.DramaSegmentVideoVersions("usr-drama", projectID, episodeID, segment.Index)
	if err != nil || len(versions.Versions) == 0 || versions.CurrentResourceID != segment.VideoResourceID {
		t.Fatalf("versions: %+v, %v", versions, err)
	}
	if _, err := svc.DramaSegmentVideoVersions("other", projectID, episodeID, segment.Index); err == nil {
		t.Fatal("foreign user read versions")
	}
	if _, err := svc.DramaSegmentPreviewFrame(context.Background(), "usr-drama", projectID, episodeID, 999, "", 0); err == nil {
		t.Fatal("invalid segment preview accepted")
	}
	if len(detail.Segments) > 1 {
		otherVersions, err := svc.DramaSegmentVideoVersions("usr-drama", projectID, episodeID, detail.Segments[1].Index)
		if err != nil || len(otherVersions.Versions) == 0 {
			t.Fatalf("other versions: %v", err)
		}
		if _, err := svc.DramaSegmentPreviewFrame(context.Background(), "usr-drama", projectID, episodeID, segment.Index, otherVersions.Versions[0].ID, 0); err == nil {
			t.Fatal("foreign segment take accepted")
		}
	}
	root := t.TempDir()
	svc.dataDir = root
	if err := os.MkdirAll(filepath.Join(root, "resources"), 0700); err != nil {
		t.Fatal(err)
	}
	videoPath := filepath.Join(root, "resources", "segment-preview.mp4")
	output, err := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=1", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "2", "-c:v", "mpeg4", "-c:a", "aac", "-y", videoPath).CombinedOutput()
	if err != nil {
		t.Fatalf("fixture ffmpeg: %v %s", err, output)
	}
	stat, err := os.Stat(videoPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := fake.db.Model(&model.Resource{}).Where("id = ?", segment.VideoResourceID).Updates(map[string]any{"provider": "local", "object_key": "segment-preview.mp4", "size": stat.Size()}).Error; err != nil {
		t.Fatal(err)
	}
	frame, err := svc.DramaSegmentPreviewFrame(context.Background(), "usr-drama", projectID, episodeID, segment.Index, "", 1)
	if err != nil {
		t.Fatal(err)
	}
	if frame.ResourceID != segment.VideoResourceID || frame.Width != 320 || frame.Height != 180 || !frame.HasAudio || frame.DurationMs < 1900 || len(frame.JPEG) < 100 || !strings.HasPrefix(string(frame.JPEG), "\xff\xd8") {
		t.Fatalf("frame metadata: %+v", frame)
	}
}
