package app

import "testing"

func TestCreateExternalDramaIdempotency(t *testing.T) {
	svc, _ := newDramaTestService(t)
	settings := DramaSettings{ReviewMode: DramaReviewAuto, MediaMode: DramaMediaManual, Concurrency: 4, Models: fakeDramaModels, EpisodeMode: DramaEpisodeModeChapter, ChaptersPerEpisode: 1}
	settings.AspectRatio = "9:16"
	req := CreateDramaRequest{Name: "外部作品", Settings: settings, Chapters: []DramaChapterInput{{Title: "第一章", Text: "甲"}}}
	first, err := svc.CreateExternalDrama("usr-drama", "external-creation-1", req)
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.CreateExternalDrama("usr-drama", "external-creation-1", req)
	if err != nil || second.Project.ID != first.Project.ID {
		t.Fatalf("same request duplicated: %v %s %s", err, first.Project.ID, second.Project.ID)
	}
	req.Name = "另一作品"
	if _, err := svc.CreateExternalDrama("usr-drama", "external-creation-1", req); err == nil {
		t.Fatal("changed request reused idempotency key")
	}
}
