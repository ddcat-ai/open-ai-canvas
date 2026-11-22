package app

import (
	"encoding/json"
	"errors"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
	"yingce/backend/internal/repository"
)

func TestDramaTailRepairUsesStagedVideoAndKeepsPausedProject(t *testing.T) {
	ffmpeg, err := renderFfmpegBinary()
	if err != nil {
		t.Skip(err)
	}
	videoPath := filepath.Join(t.TempDir(), "clip.mp4")
	if output, err := exec.Command(ffmpeg, "-v", "error",
		"-f", "lavfi", "-i", "color=red:s=32x32:d=0.5:r=10",
		"-f", "lavfi", "-i", "color=blue:s=32x32:d=0.5:r=10",
		"-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0", "-c:v", "mpeg4", videoPath).CombinedOutput(); err != nil {
		t.Fatalf("video fixture: %s %v", output, err)
	}
	src, err := os.ReadFile(videoPath)
	if err != nil {
		t.Fatal(err)
	}
	s, db := newMediaRecoveryTestService(t)
	if err := os.WriteFile(filepath.Join(s.dataDir, ".settings-key"), make([]byte, 32), 0600); err != nil {
		t.Fatal(err)
	}
	s.coordinator, err = platform.NewCoordinator("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	const userID = "repair-user"
	project := model.Project{ID: "repair-project", UserID: userID, Name: "saved drama", Status: model.ProjectStatusActive}
	production := model.DramaProduction{ProjectID: project.ID, UserID: userID, Status: model.DramaStatusPaused}
	episode := model.DramaEpisode{ID: "repair-episode", ProjectID: project.ID, Number: 1}
	task := seedMediaTask(t, db, providerConfig{})
	task.UserID, task.ProjectID, task.Type = userID, project.ID, "canvas_video"
	resource := model.Resource{
		ID: "repair-original", UserID: userID, Kind: "video", MimeType: "video/mp4", Size: int64(len(src)),
		Provider: volcengineTOSProvider, Status: model.ResourceStatusReady, UploadKey: mediaUploadKey(task.ID, 0), Width: 32, Height: 32,
	}
	segment := model.DramaSegment{
		ID: "repair-segment", ProjectID: project.ID, EpisodeID: episode.ID, Revision: 5,
		VideoStatus: model.DramaMediaFailed, VideoResourceID: resource.ID, VideoError: "context deadline exceeded (Client.Timeout while reading body)",
	}
	job := model.DramaJob{
		ID: "repair-job", ProjectID: project.ID, EpisodeID: episode.ID, ShotID: segment.ID,
		TaskID: task.ID, Kind: model.DramaJobSegmentVideo, Status: model.DramaJobFailed,
		PayloadJSON: encodeDramaRevision(segment.Revision), CostMicrocredits: 70000,
	}
	recordDramaAttempt(&job, task.ID, string(model.TaskStatusSucceeded), "", 70000)
	order := model.BillingOrder{
		ID: "repair-order", TaskID: task.ID, UserID: userID, Status: model.BillingStatusSettled, ActualAmountMicrocredits: 70000,
	}
	for _, row := range []any{&model.User{ID: userID, Username: userID, Email: "repair@example.test"}, &project, &production, &episode, &resource, &segment, &job, &order} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Save(task).Error; err != nil {
		t.Fatal(err)
	}
	name, err := s.stageInlineMedia(src)
	if err != nil {
		t.Fatal(err)
	}
	checkpoint := mediaCheckpoint{Mode: "video", Items: []mediaCheckpointItem{{TempName: name, MIMEType: "video/mp4"}}}
	result, err := s.materializeTaskMedia(t.Context(), task, providerConfig{}, &checkpoint)
	if err != nil {
		t.Fatal(err)
	}
	out, _ := json.Marshal(result)
	task.Status, task.ResultJSON = model.TaskStatusSucceeded, string(out)
	if err := db.Save(task).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.dramaTailStagePath(resource.ID)); err != nil {
		t.Fatal(err)
	}
	otherVideos := make([]string, dramaTailConcurrency)
	for i := range otherVideos {
		otherVideos[i] = newID()
		if !s.dramaTails.claim(otherVideos[i]) {
			t.Fatal("could not claim tail capacity in fixture")
		}
	}
	if processed, err := s.repairSavedDramaTails(t.Context()); err != nil || processed {
		t.Fatalf("repair ran while existing tail slots were occupied: %v", err)
	}
	s.dramaTails.finish(otherVideos[0], nil)
	// Automatic recovery can read the clip only from staging. Its remote address is deliberately unavailable.
	if processed, err := s.repairSavedDramaTails(t.Context()); err != nil || !processed {
		t.Fatalf("saved video's tail was not processed: %v", err)
	}
	if processed, err := s.repairSavedDramaTails(t.Context()); err != nil || processed {
		t.Fatalf("finished job returned to the queue: %v", err)
	}
	if _, err := os.Stat(s.dramaTailStagePath(resource.ID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("retained file after repair = %v", err)
	}
	updated, err := s.repo.DramaSegment(project.ID, segment.ID)
	if err != nil || updated.VideoStatus != model.DramaMediaReady || updated.VideoResourceID != resource.ID || updated.TailFrameResourceID == "" {
		t.Fatalf("segment after repair = %+v, %v", updated, err)
	}
	_, tail, err := s.OpenResource(userID, updated.TailFrameResourceID)
	if err != nil {
		t.Fatal(err)
	}
	picture, err := png.Decode(tail)
	_ = tail.Close()
	if err != nil {
		t.Fatal(err)
	}
	red, _, blue, _ := picture.At(12, 12).RGBA()
	if red > 4096 || blue < 60_000 {
		t.Fatalf("expected blue final frame, red=%d blue=%d", red, blue)
	}
	reloaded, err := s.repo.DramaProduction(project.ID)
	if err != nil || reloaded.Status != model.DramaStatusPaused {
		t.Fatalf("repair changed production state: %+v, %v", reloaded, err)
	}
	var savedOrder model.BillingOrder
	if err := db.First(&savedOrder, "id = ?", order.ID).Error; err != nil || savedOrder.Status != order.Status || savedOrder.ActualAmountMicrocredits != 70000 {
		t.Fatalf("order changed: %+v, %v", savedOrder, err)
	}
	for table, want := range map[string]int64{"tasks": 1, "billing_orders": 1, "api_call_logs": 0} {
		var count int64
		if err := db.Table(table).Count(&count).Error; err != nil || count != want {
			t.Fatalf("%s count = %d, %v", table, count, err)
		}
	}
}

func TestDramaTailRepairRejectsVideoReplacedDuringExtraction(t *testing.T) {
	s, fake := newDramaTestService(t)
	s.dramaTailRepairWake = make(chan struct{}, 1)
	const previousVideo = "old-video"
	const newVideo = "replacement-video"
	const user = "usr-drama"
	project := model.Project{ID: "repair-project", UserID: user, Name: "paused", Status: model.ProjectStatusActive}
	production := model.DramaProduction{ProjectID: project.ID, UserID: user, Status: model.DramaStatusPaused}
	episode := model.DramaEpisode{ID: "repair-episode", ProjectID: project.ID, Number: 1}
	segment := model.DramaSegment{ID: "repair-segment", ProjectID: project.ID, EpisodeID: episode.ID, Revision: 7, VideoResourceID: previousVideo, VideoStatus: model.DramaMediaFailed}
	task := model.Task{ID: "existing-video-task", UserID: user, ProjectID: project.ID, Type: "canvas_video", Status: model.TaskStatusSucceeded, ResultJSON: `{"mode":"video","video":{"resourceId":"old-video"}}`}
	job := model.DramaJob{ID: "tail-job", ProjectID: project.ID, ShotID: segment.ID, EpisodeID: episode.ID, Kind: model.DramaJobSegmentVideo, TaskID: task.ID, PayloadJSON: encodeDramaRevision(7), Status: model.DramaJobFailed}
	recordDramaAttempt(&job, task.ID, string(task.Status), "", 70000)
	for _, row := range []any{&project, &production, &episode, &segment, &task, &job} {
		if err := fake.db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	for attempt := 0; attempt < 2; attempt++ {
		if _, err := s.ReprocessDramaSegmentVideo(user, project.ID, episode.ID, segment.SegmentIndex); err != nil {
			t.Fatal(err)
		}
	}
	select {
	case <-s.dramaTailRepairWake:
	default:
		t.Fatal("manual repair did not wake the idle worker")
	}
	var pending model.DramaJob
	if err := fake.db.First(&pending, "id = ?", job.ID).Error; err != nil {
		t.Fatal(err)
	}
	s.dramaTailFrameHook = func(string, string) (string, error) {
		if err := fake.db.Model(&segment).Updates(map[string]any{"revision": 8, "video_resource_id": newVideo}).Error; err != nil {
			t.Fatal(err)
		}
		return "late-tail", nil
	}
	if _, err := s.repairSavedDramaTail(t.Context(), pending); err != nil {
		t.Fatal(err)
	}
	row, err := s.repo.DramaSegment(project.ID, segment.ID)
	if err != nil || row.Revision != 8 || row.VideoResourceID != newVideo || row.TailFrameResourceID != "" {
		t.Fatalf("new video overwritten: %+v, %v", row, err)
	}
	var payload dramaRevisionPayload
	if err := fake.db.First(&pending, "id = ?", job.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(pending.PayloadJSON), &payload); err != nil || payload.TailRepair != repository.DramaTailRepairFinished {
		t.Fatalf("stale repair was left queued: %+v, %v", payload, err)
	}
	if len(fake.requests) != 0 {
		t.Fatal("repair submitted a new generation")
	}
}

func TestDramaTailStagingEvictsAvailableCopiesBeforePaidResult(t *testing.T) {
	s, _ := newMediaRecoveryTestService(t)
	stageDir := filepath.Join(s.dataDir, "media-staging")
	if err := os.MkdirAll(stageDir, 0700); err != nil {
		t.Fatal(err)
	}
	input := []byte("saved clip")
	old := s.dramaTailStagePath("old")
	if err := os.WriteFile(old, input, 0600); err != nil {
		t.Fatal(err)
	}
	file, err := s.newMediaTemp(mediaStagingBudget)
	if err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	_ = os.Remove(file.Name())
	if _, err := os.Stat(old); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("disposable copy was retained: %v", err)
	}
}
