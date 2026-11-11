package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestDramaRegeneratedVideoAfterEarlierShotDeletion(t *testing.T) {
	for _, tc := range []struct {
		name, mode, change string
		adopt              bool
	}{
		{"parallel delete before regeneration", DramaContinuityParallel, "delete-before", true},
		{"parallel delete during generation", DramaContinuityParallel, "delete-during", true},
		{"parallel regenerate earlier segment", DramaContinuityParallel, "regenerate-earlier", true},
		{"parallel edit own segment", DramaContinuityParallel, "edit-own", false},
		{"tail frame delete before regeneration", DramaContinuityTailFrame, "delete-before", true},
		{"tail frame delete during generation", DramaContinuityTailFrame, "delete-during", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, fake := newDramaTestService(t)
			summary := createTestDrama(t, svc, DramaReviewAuto)
			project := summary.Project.ID
			settings := summary.Production.Settings
			settings.VideoContinuity = tc.mode
			settingsJSON, err := json.Marshal(settings)
			if err != nil {
				t.Fatal(err)
			}
			if err := svc.repo.UpdateDramaProduction(project, map[string]any{"settings_json": string(settingsJSON)}); err != nil {
				t.Fatal(err)
			}
			episode := model.DramaEpisode{ID: "episode", ProjectID: project, Number: 1, Stage: model.DramaEpisodeVideo, Revision: 1}
			if err := fake.db.Create(&episode).Error; err != nil {
				t.Fatal(err)
			}
			shots := []model.DramaShot{
				{ID: "delete-me", ProjectID: project, EpisodeID: episode.ID, Position: 0, SegmentIndex: 0, DurationMs: 1000},
				{ID: "keep-earlier", ProjectID: project, EpisodeID: episode.ID, Position: 1, SegmentIndex: 0, DurationMs: 1000},
				{ID: "target-shot", ProjectID: project, EpisodeID: episode.ID, Position: 2, SegmentIndex: 1, DurationMs: 5000},
			}
			if err := fake.db.Create(&shots).Error; err != nil {
				t.Fatal(err)
			}
			segments := []model.DramaSegment{
				{ID: "earlier", ProjectID: project, EpisodeID: episode.ID, SegmentIndex: 0, Revision: 1, PromptStatus: model.DramaMediaReady, VideoStatus: model.DramaMediaReady, VideoResourceID: "old-earlier", VideoPrompt: "earlier prompt"},
				{ID: "target", ProjectID: project, EpisodeID: episode.ID, SegmentIndex: 1, Revision: 1, PromptStatus: model.DramaMediaReady, VideoStatus: model.DramaMediaReady, VideoResourceID: "old-target", VideoPrompt: "target prompt"},
			}
			if err := fake.db.Create(&segments).Error; err != nil {
				t.Fatal(err)
			}
			if tc.change == "delete-before" {
				if err := svc.DeleteDramaShot("usr-drama", project, shots[0].ID); err != nil {
					t.Fatal(err)
				}
			}
			if err := svc.repo.RequestDramaSegmentVideos(project, episode.ID, []int{1}, nil); err != nil {
				t.Fatal(err)
			}
			target, err := svc.repo.DramaSegment(project, "target")
			if err != nil {
				t.Fatal(err)
			}
			payload, err := json.Marshal(dramaRevisionPayload{Revision: target.Revision, Seconds: 5})
			if err != nil {
				t.Fatal(err)
			}
			if err := svc.repo.UpdateDramaSegmentFields(target.ID, map[string]any{"video_status": model.DramaMediaRunning}); err != nil {
				t.Fatal(err)
			}
			queued := []model.DramaJob{
				{ID: "target-queued", ProjectID: project, EpisodeID: episode.ID, ShotID: target.ID, Kind: model.DramaJobSegmentPrompt, Status: model.DramaJobQueued},
				{ID: "earlier-queued", ProjectID: project, EpisodeID: episode.ID, ShotID: "earlier", Kind: model.DramaJobSegmentPrompt, Status: model.DramaJobQueued},
				{ID: "render-queued", ProjectID: project, EpisodeID: episode.ID, Kind: model.DramaJobRender, Status: model.DramaJobQueued},
			}
			if err := fake.db.Create(&queued).Error; err != nil {
				t.Fatal(err)
			}
			switch tc.change {
			case "delete-during":
				if err := svc.DeleteDramaShot("usr-drama", project, shots[0].ID); err != nil {
					t.Fatal(err)
				}
			case "regenerate-earlier":
				if err := svc.repo.RequestDramaSegmentVideos(project, episode.ID, []int{0}, nil); err != nil {
					t.Fatal(err)
				}
			case "edit-own":
				action := "new action after submission"
				if _, err := svc.UpdateDramaShot("usr-drama", project, shots[2].ID, UpdateDramaShotRequest{Action: &action}); err != nil {
					t.Fatal(err)
				}
			}
			current, err := svc.repo.DramaSegment(project, target.ID)
			if err != nil {
				t.Fatal(err)
			}
			if (current.Revision == target.Revision) != tc.adopt {
				t.Fatalf("target revision=%d submitted=%d, adopt=%v", current.Revision, target.Revision, tc.adopt)
			}
			if tc.change == "delete-before" || tc.change == "delete-during" {
				shot, err := svc.repo.DramaShot(project, shots[2].ID)
				if err != nil || shot.Position != 1 || shot.SegmentIndex != 1 {
					t.Fatalf("renumbered shot lost segment identity: %+v %v", shot, err)
				}
			}
			if tc.change == "delete-during" || tc.change == "regenerate-earlier" {
				for _, queuedJob := range queued {
					job, err := svc.repo.DramaJob(project, queuedJob.ID)
					if err != nil {
						t.Fatal(err)
					}
					want := model.DramaJobCanceled
					if tc.mode == DramaContinuityParallel && queuedJob.ID == "target-queued" {
						want = model.DramaJobQueued
					}
					if job.Status != want {
						t.Fatalf("job %s status=%s want=%s", job.ID, job.Status, want)
					}
				}
			}
			resource := fake.resource("usr-drama", "video", "video/mp4")
			task := &model.Task{ID: "regenerated-video", Prompt: "new target video", ResultJSON: `{"mode":"video","video":{"resourceId":"` + resource + `"}}`}
			run := &dramaRun{s: svc, project: &summary.Project}
			if err := run.applySegmentVideo(&model.DramaJob{ShotID: target.ID, PayloadJSON: string(payload)}, task); err != nil {
				t.Fatal(err)
			}
			current, err = svc.repo.DramaSegment(project, target.ID)
			if err != nil {
				t.Fatal(err)
			}
			if tc.adopt {
				if current.VideoResourceID != resource || current.VideoStatus != model.DramaMediaReady || current.TailFrameResourceID == "" || current.VideoSeconds != 5 {
					t.Fatalf("new video not attached: %+v", current)
				}
			} else if current.VideoResourceID != "old-target" {
				t.Fatal("stale result overwrote newer intent")
			}
			takes, err := svc.repo.DramaTakes(project, target.ID, "video", 10)
			if err != nil || len(takes) != 1 || takes[0].ResourceID != resource {
				t.Fatalf("paid result not preserved: %+v %v", takes, err)
			}
		})
	}
}
