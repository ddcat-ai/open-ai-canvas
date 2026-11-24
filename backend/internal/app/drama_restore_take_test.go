package app

import (
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestRestoreDramaSegmentTakeSwitchesCurrentWithoutDuplicatingTakes(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	runDramaTicks(t, svc, project, 24)

	summary, err := svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatal(err)
	}
	episodeID := summary.Episodes[0].ID
	detail, err := svc.DramaEpisodeDetail("usr-drama", project, episodeID)
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Segments) < 2 || detail.Segments[0].VideoResourceID == "" || detail.Segments[0].VideoStatus != model.DramaMediaReady {
		t.Fatalf("need a ready first segment: %+v", detail.Segments)
	}
	if detail.Episode.FinalResourceID == "" {
		t.Fatal("need a compiled final so restore can mark it stale")
	}
	segment := detail.Segments[0]
	later := detail.Segments[1]
	currentResourceID := segment.VideoResourceID
	laterResourceID, laterRevision := later.VideoResourceID, later.Revision

	var beforeTakes int64
	if err := fake.db.Model(&model.DramaTake{}).Where("owner_id = ? AND kind = ?", segment.ID, "video").Count(&beforeTakes).Error; err != nil {
		t.Fatal(err)
	}
	if beforeTakes < 1 {
		t.Fatalf("expected an existing current take, got %d", beforeTakes)
	}

	listed, err := svc.DramaTakes("usr-drama", project, segment.ID, "video")
	if err != nil {
		t.Fatal(err)
	}
	takes, _ := listed["takes"].([]DramaTakeView)
	var currentTakeID string
	for _, take := range takes {
		if take.Current {
			currentTakeID = take.ID
			break
		}
	}
	if currentTakeID == "" {
		t.Fatal("current take not marked")
	}

	historyResourceID := fake.resource("usr-drama", "video", "video/mp4")
	if err := fake.db.Model(&model.Resource{}).Where("id = ?", historyResourceID).Update("duration_ms", int64(9000)).Error; err != nil {
		t.Fatal(err)
	}
	historyTask := &model.Task{
		ID: "tsk-history-h3", UserID: "usr-drama", ProjectID: project, Type: "canvas_video",
		Status: model.TaskStatusSucceeded, Model: "H3-768P", Prompt: "历史小力孩",
		ResultJSON: `{"mode":"video","video":{"resourceId":"` + historyResourceID + `"}}`,
	}
	if err := fake.db.Create(historyTask).Error; err != nil {
		t.Fatal(err)
	}
	historyTake := &model.DramaTake{
		ID: "take-history-v", ProjectID: project, OwnerID: segment.ID, Kind: "video",
		ResourceID: historyResourceID, TaskID: historyTask.ID, Prompt: "历史小力孩", DurationMs: 9000, CreatedAt: time.Now(),
	}
	if err := svc.repo.CreateDramaTake(historyTake); err != nil {
		t.Fatal(err)
	}

	listed, err = svc.DramaTakes("usr-drama", project, segment.ID, "video")
	if err != nil {
		t.Fatal(err)
	}
	takes, _ = listed["takes"].([]DramaTakeView)
	var historyView *DramaTakeView
	for i := range takes {
		if takes[i].ID == historyTake.ID {
			historyView = &takes[i]
			break
		}
	}
	if historyView == nil || historyView.Current || historyView.Model != "H3-768P" {
		t.Fatalf("history take should be listed, not current, with model: %+v", historyView)
	}
	if listed["currentResourceId"] != currentResourceID {
		t.Fatalf("current resource before restore: %v", listed["currentResourceId"])
	}

	// 错用户、错归属、已是当前：都不得改写入。
	if _, err := svc.RestoreDramaSegmentTake("other", project, episodeID, segment.Index, RestoreDramaSegmentTakeRequest{TakeID: historyTake.ID}); err == nil {
		t.Fatal("ownership")
	}
	foreign := &model.DramaTake{
		ID: "take-other-segment", ProjectID: project, OwnerID: later.ID, Kind: "video",
		ResourceID: historyResourceID, Prompt: "别段", DurationMs: 9000, CreatedAt: time.Now(),
	}
	if err := svc.repo.CreateDramaTake(foreign); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RestoreDramaSegmentTake("usr-drama", project, episodeID, segment.Index, RestoreDramaSegmentTakeRequest{TakeID: foreign.ID}); err == nil {
		t.Fatal("wrong owner take")
	}
	noop, err := svc.RestoreDramaSegmentTake("usr-drama", project, episodeID, segment.Index, RestoreDramaSegmentTakeRequest{TakeID: currentTakeID})
	if err != nil {
		t.Fatal(err)
	}
	if unchanged, _ := noop["unchanged"].(bool); !unchanged {
		t.Fatalf("already-current must be a no-op: %+v", noop)
	}

	afterNoop, err := svc.repo.DramaSegment(project, segment.ID)
	if err != nil {
		t.Fatal(err)
	}
	if afterNoop.VideoResourceID != currentResourceID || afterNoop.Revision != segment.Revision {
		t.Fatalf("no-op must not rewrite the segment: %+v", afterNoop)
	}

	result, err := svc.RestoreDramaSegmentTake("usr-drama", project, episodeID, segment.Index, RestoreDramaSegmentTakeRequest{TakeID: historyTake.ID, ExpectedRevision: &afterNoop.Revision})
	if err != nil {
		t.Fatal(err)
	}
	if restored, _ := result["restored"].(bool); !restored {
		t.Fatalf("restore should switch current: %+v", result)
	}
	if unchanged, _ := result["unchanged"].(bool); unchanged {
		t.Fatalf("historical take must not be treated as unchanged: %+v", result)
	}
	if seconds, _ := result["videoSeconds"].(int); seconds != 9 {
		t.Fatalf("duration should follow the historical take: %+v", result)
	}

	updated, err := svc.repo.DramaSegment(project, segment.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.VideoResourceID != historyResourceID || updated.VideoStatus != model.DramaMediaReady || updated.VideoSeconds != 9 {
		t.Fatalf("segment current video not updated: %+v", updated)
	}
	if updated.TailFrameResourceID == "" || updated.TailFrameResourceID == segment.TailFrameResourceID {
		t.Fatalf("tail frame should be re-extracted: before=%s after=%s", segment.TailFrameResourceID, updated.TailFrameResourceID)
	}

	episode, err := svc.repo.DramaEpisode(project, episodeID)
	if err != nil {
		t.Fatal(err)
	}
	if !episode.FinalStale {
		t.Fatal("compiled episode must be marked stale")
	}

	laterRow, err := svc.repo.DramaSegment(project, later.ID)
	if err != nil {
		t.Fatal(err)
	}
	if laterRow.VideoResourceID != laterResourceID || laterRow.Revision != laterRevision {
		t.Fatalf("restore must not cascade later segments: %+v", laterRow)
	}

	var afterTakes int64
	if err := fake.db.Model(&model.DramaTake{}).Where("owner_id = ? AND kind = ?", segment.ID, "video").Count(&afterTakes).Error; err != nil {
		t.Fatal(err)
	}
	// history take was added before restore; restore itself must not insert another row.
	if afterTakes != beforeTakes+1 {
		t.Fatalf("restore must not duplicate takes: before=%d after=%d", beforeTakes, afterTakes)
	}

	listed, err = svc.DramaTakes("usr-drama", project, segment.ID, "video")
	if err != nil {
		t.Fatal(err)
	}
	if listed["currentResourceId"] != historyResourceID {
		t.Fatalf("list current after restore: %v", listed["currentResourceId"])
	}
	takes, _ = listed["takes"].([]DramaTakeView)
	var currentCount int
	var stillHaveOriginal bool
	for _, take := range takes {
		if take.Current {
			currentCount++
			if take.ID != historyTake.ID || take.ResourceID != historyResourceID {
				t.Fatalf("current should be the restored history take: %+v", take)
			}
		}
		if take.ResourceID == currentResourceID {
			stillHaveOriginal = true
		}
	}
	if currentCount != 1 || !stillHaveOriginal {
		t.Fatalf("should keep original take and mark exactly one current: %+v", takes)
	}

	again, err := svc.RestoreDramaSegmentTake("usr-drama", project, episodeID, segment.Index, RestoreDramaSegmentTakeRequest{TakeID: historyTake.ID})
	if err != nil {
		t.Fatal(err)
	}
	if unchanged, _ := again["unchanged"].(bool); !unchanged {
		t.Fatalf("restoring the already-current take must be a no-op: %+v", again)
	}
	var finalTakes int64
	if err := fake.db.Model(&model.DramaTake{}).Where("owner_id = ? AND kind = ?", segment.ID, "video").Count(&finalTakes).Error; err != nil {
		t.Fatal(err)
	}
	if finalTakes != afterTakes {
		t.Fatalf("second restore duplicated takes: %d -> %d", afterTakes, finalTakes)
	}
}

func TestRestoreDramaSegmentTakeRejectsInaccessibleResource(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	runDramaTicks(t, svc, project, 24)
	summary, err := svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatal(err)
	}
	episodeID := summary.Episodes[0].ID
	detail, err := svc.DramaEpisodeDetail("usr-drama", project, episodeID)
	if err != nil {
		t.Fatal(err)
	}
	segment := detail.Segments[0]
	if err := fake.db.Create(&model.User{ID: "usr-other", Email: "other@example.com", Username: "other"}).Error; err != nil {
		t.Fatal(err)
	}
	foreignResource := fake.resource("usr-other", "video", "video/mp4")
	take := &model.DramaTake{
		ID: "take-foreign-res", ProjectID: project, OwnerID: segment.ID, Kind: "video",
		ResourceID: foreignResource, Prompt: "无权视频", DurationMs: 8000, CreatedAt: time.Now(),
	}
	if err := svc.repo.CreateDramaTake(take); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RestoreDramaSegmentTake("usr-drama", project, episodeID, segment.Index, RestoreDramaSegmentTakeRequest{TakeID: take.ID}); err == nil {
		t.Fatal("must reject a resource the user cannot access")
	}
	row, err := svc.repo.DramaSegment(project, segment.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.VideoResourceID != segment.VideoResourceID {
		t.Fatalf("failed restore must not change current video: %+v", row)
	}
}
