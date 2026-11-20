package app

import (
	"testing"

	"yingce/backend/internal/model"
)

// 草稿保存创建页表单，回到创建页可整体替换原文、选章与设置；开工后不能再按草稿修改。
func TestDramaDraftReplaceThenStart(t *testing.T) {
	svc, _ := newDramaTestService(t)
	settings := DramaSettings{ReviewMode: DramaReviewAuto, MediaMode: DramaMediaManual, Concurrency: 4, Models: fakeDramaModels, EpisodeMode: DramaEpisodeModeChapter, ChaptersPerEpisode: 1}
	settings.AspectRatio = "9:16"
	created, err := svc.CreateDrama("usr-drama", CreateDramaRequest{
		Name: "草稿", Settings: settings, Chapters: []DramaChapterInput{{Title: "第一章", Text: "甲"}, {Title: "第二章", Text: "乙"}},
		SelectedChapters: []int{0}, Draft: &DramaDraftForm{SourceText: "第一章\n甲\n第二章\n乙", StyleID: "guoman"},
	})
	if err != nil {
		t.Fatal(err)
	}
	project := created.Project.ID
	if created.Production.Status != model.DramaStatusDraft || !created.Production.HasDraftForm {
		t.Fatalf("status = %s", created.Production.Status)
	}
	draft, err := svc.DramaDraft("usr-drama", project)
	if err != nil || draft.Form.StyleID != "guoman" || draft.Form.SourceText == "" || len(draft.SelectedChapters) != 1 || draft.ChapterCount != 2 {
		t.Fatalf("draft = %+v %v", draft, err)
	}
	if _, err := svc.DramaDraft("usr-other", project); err == nil {
		t.Fatal("other user must not read the draft")
	}

	settings.AspectRatio = "16:9"
	saved, err := svc.SaveDramaDraft("usr-drama", project, CreateDramaRequest{
		Name: "草稿改名", Settings: settings, Chapters: []DramaChapterInput{{Title: "第一集", Text: "丙"}, {Title: "第二集", Text: "丁"}, {Title: "第三集", Text: "戊"}},
		BudgetMicrocredits: 5_000_000, Draft: &DramaDraftForm{SourceText: "丙丁戊", StyleID: "real"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Project.Name != "草稿改名" || saved.Project.AspectRatio != "16:9" || saved.Production.ChapterCount != 3 || len(saved.Episodes) != 3 || saved.Production.BudgetMicrocredits != 5_000_000 || saved.Production.Status != model.DramaStatusDraft {
		t.Fatalf("replaced draft = %+v %+v", saved.Project, saved.Production)
	}
	outline, err := svc.DramaChapterOutline("usr-drama", project)
	if err != nil || len(outline) != 3 || outline[0].Title != "第一集" {
		t.Fatalf("chapters must be replaced: %+v %v", outline, err)
	}

	started, err := svc.SaveDramaDraft("usr-drama", project, CreateDramaRequest{Name: "草稿改名", Start: true, Settings: settings, Chapters: []DramaChapterInput{{Title: "第一集", Text: "丙"}}, Draft: &DramaDraftForm{SourceText: "丙"}})
	if err != nil || started.Production.Status != model.DramaStatusRunning || started.Production.HasDraftForm {
		t.Fatalf("start from draft = %+v %v", started.Production, err)
	}
	row, err := svc.repo.DramaProduction(project)
	if err != nil || row.DraftJSON != "" {
		t.Fatalf("starting must drop the draft form: %q %v", row.DraftJSON, err)
	}
	if _, err := svc.SaveDramaDraft("usr-drama", project, CreateDramaRequest{Name: "再改", Settings: settings, Chapters: []DramaChapterInput{{Title: "第一集", Text: "丙"}}}); err == nil {
		t.Fatal("started drama must not be replaced as a draft")
	}
	if _, err := svc.DramaDraft("usr-drama", project); err == nil {
		t.Fatal("started drama has no draft")
	}
}
