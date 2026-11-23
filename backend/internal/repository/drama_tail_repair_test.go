package repository

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestDramaTailRepairQueueAndFinishPostgres(t *testing.T) {
	db := newBillingTerminalDB(t, "postgres")
	if err := db.AutoMigrate(&model.Project{}, &model.DramaProduction{}, &model.DramaSegment{}, &model.DramaJob{}, &model.Resource{}); err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	project := model.Project{ID: "drama", UserID: "owner", Name: "drama", Status: model.ProjectStatusActive}
	task := model.Task{ID: "task", UserID: project.UserID, ProjectID: project.ID, Status: model.TaskStatusSucceeded}
	video := model.Resource{ID: "original", UserID: project.UserID, Provider: "volcengine", MimeType: "video/mp4", Status: model.ResourceStatusReady}
	segment := model.DramaSegment{ID: "segment", ProjectID: project.ID, EpisodeID: "episode", Revision: 1, VideoStatus: model.DramaMediaFailed,
		VideoResourceID: video.ID, VideoError: "context deadline exceeded (Client.Timeout while reading body)"}
	job := model.DramaJob{ID: "job", ProjectID: project.ID, EpisodeID: segment.EpisodeID, ShotID: segment.ID, Kind: model.DramaJobSegmentVideo,
		TaskID: task.ID, Status: model.DramaJobFailed, PayloadJSON: `{"revision":1}`}
	for _, row := range []any{&project, &task, &video, &segment, &job, &model.DramaProduction{ProjectID: project.ID, UserID: project.UserID, Status: model.DramaStatusPaused}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	jobs, err := repo.DramaTailRepairJobs(t.Context())
	if err != nil || len(jobs) != 1 || jobs[0].ID != job.ID {
		t.Fatalf("historical candidates: %+v, %v", jobs, err)
	}
	const pending = `{"revision":1,"tailRepair":"pending"}`
	const finished = `{"revision":1,"tailRepair":"finished"}`
	for i := 0; i < 2; i++ {
		if queued, err := repo.QueueDramaTailRepair(job, segment, pending); err != nil || !queued {
			t.Fatalf("queue %d: %v, %v", i, queued, err)
		}
	}
	// A newly started worker reads the committed queue marker and preserves the original job.
	restarted := New(db)
	jobs, err = restarted.DramaTailRepairJobs(t.Context())
	if err != nil || len(jobs) != 1 || jobs[0].PayloadJSON != pending {
		t.Fatalf("pending jobs after restart: %+v, %v", jobs, err)
	}
	stale := segment
	stale.Revision--
	if ok, err := restarted.FinishDramaTailRepair(jobs[0], stale, finished, "stale-tail", ""); err != nil || ok {
		t.Fatalf("stale repair was committed: %v, %v", ok, err)
	}
	if ok, err := restarted.FinishDramaTailRepair(jobs[0], segment, finished, "tail", ""); err != nil || !ok {
		t.Fatalf("current repair was rolled back: %v, %v", ok, err)
	}
	current, err := repo.DramaSegment(project.ID, segment.ID)
	if err != nil || current.TailFrameResourceID != "tail" || current.VideoResourceID != video.ID || current.VideoStatus != model.DramaMediaReady {
		t.Fatalf("unexpected segment after repair: %+v, %v", current, err)
	}
	if jobs, err := restarted.DramaTailRepairJobs(t.Context()); err != nil || len(jobs) != 0 {
		t.Fatalf("finished job reappeared: %+v, %v", jobs, err)
	}
}
