package app

import (
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestDramaInboxSegmentListLimit(t *testing.T) {
	cases := []struct{ existing, limit, want int }{
		{0, 99, 99},
		{10, 99, 89},
		{99, 99, 0},
		{120, 99, 0},
		{0, 0, 0},
	}
	for _, tc := range cases {
		if got := dramaInboxSegmentListLimit(tc.existing, tc.limit); got != tc.want {
			t.Fatalf("dramaInboxSegmentListLimit(%d, %d) = %d, want %d", tc.existing, tc.limit, got, tc.want)
		}
	}
}

func TestDramaInboxCapsFailedSegmentsAndReportsTotal(t *testing.T) {
	svc, fake := newDramaTestService(t)
	settings := DramaSettings{ReviewMode: DramaReviewAuto, MediaMode: DramaMediaManual, Concurrency: 16, Models: fakeDramaModels, EpisodeMode: DramaEpisodeModeChapter, ChaptersPerEpisode: 1}
	settings.EpisodeSeconds = 60
	summary, err := svc.CreateDrama("usr-drama", CreateDramaRequest{Name: "待处理列表", Start: true, Settings: settings, Chapters: []DramaChapterInput{{Title: "第一章", Text: "周大明在修收音机。"}}})
	if err != nil {
		t.Fatal(err)
	}
	productionRow, err := svc.repo.DramaProduction(summary.Project.ID)
	if err != nil {
		t.Fatal(err)
	}
	productionRow.Stage = model.DramaStageProduce
	if err := svc.repo.SaveDramaProductionProgress(productionRow, productionRow.Status, false); err != nil {
		t.Fatal(err)
	}
	episodes, err := svc.repo.DramaEpisodes(summary.Project.ID)
	if err != nil || len(episodes) == 0 {
		t.Fatalf("need an episode: %+v %v", episodes, err)
	}
	now := time.Now()
	if err := svc.repo.CreateDramaCasts([]model.DramaCast{{
		ID: newID(), ProjectID: summary.Project.ID, Kind: "character", Name: "张维民", AliasesJSON: "[]",
		ImageStatus: model.DramaMediaFailed, CreatedAt: now, UpdatedAt: now,
	}}); err != nil {
		t.Fatal(err)
	}
	segments := make([]model.DramaSegment, 0, 120)
	for i := 0; i < 120; i++ {
		segments = append(segments, model.DramaSegment{
			ID: newID(), ProjectID: summary.Project.ID, EpisodeID: episodes[0].ID, SegmentIndex: i,
			VideoStatus: model.DramaMediaFailed, VideoError: "上游失败", CreatedAt: now, UpdatedAt: now,
		})
	}
	if err := fake.db.Create(&segments).Error; err != nil {
		t.Fatal(err)
	}
	view, err := svc.DramaSummary("usr-drama", summary.Project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if view.InboxCount != 121 || view.InboxFailureCount != 121 {
		t.Fatalf("true totals must include every failed item: count=%d failures=%d", view.InboxCount, view.InboxFailureCount)
	}
	if len(view.Inbox) != 99 {
		t.Fatalf("inbox list must cap at 99, got %d", len(view.Inbox))
	}
	casts, segmentsListed := 0, 0
	for _, item := range view.Inbox {
		switch item.Kind {
		case "cast_failed":
			casts++
		case "segment_failed":
			segmentsListed++
		}
	}
	if casts != 1 || segmentsListed != 98 {
		t.Fatalf("keep non-segment items and fill the rest with failed segments: casts=%d segments=%d inbox=%+v", casts, segmentsListed, view.Inbox[:3])
	}
}
