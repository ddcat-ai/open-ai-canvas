package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

// 导入长篇时只选部分章节：未选中的章节原文保存为预留章节，不进入资产提取与分集；之后可在制作台加入。
func TestDramaSelectedChaptersReserveTheRest(t *testing.T) {
	svc, fake := newDramaTestService(t)
	settings := DramaSettings{ReviewMode: DramaReviewAuto, MediaMode: DramaMediaManual, Concurrency: 16, Models: fakeDramaModels, EpisodeMode: DramaEpisodeModeChapter, ChaptersPerEpisode: 2}
	chapters := []DramaChapterInput{{Title: "第一章", Text: "甲甲"}, {Title: "第二章", Text: "乙乙"}, {Title: "第三章", Text: "预留丙"}, {Title: "第四章", Text: "丁丁"}, {Title: "第五章", Text: "预留戊"}}
	summary, err := svc.CreateDrama("usr-drama", CreateDramaRequest{Name: "选章", Start: true, Settings: settings, Chapters: chapters, SelectedChapters: []int{0, 1, 3}})
	if err != nil {
		t.Fatal(err)
	}
	project := summary.Project.ID
	// 第一、二章相邻合成一集；第四章与第二章之间隔着预留章节，单独成集。
	if len(summary.Episodes) != 2 || summary.Production.ChapterCount != 3 || summary.Production.ReservedChapterCount != 2 || summary.Production.PlanCursor != 3 {
		t.Fatalf("selected chapters must produce 2 episodes and reserve 2 chapters: %+v %+v", summary.Episodes, summary.Production)
	}
	second, err := svc.repo.DramaEpisode(project, summary.Episodes[1].ID)
	if err != nil || len(decodeStringList(second.ChapterIDsJSON)) != 1 {
		t.Fatalf("chapters across a gap must not share an episode: %+v %v", second, err)
	}
	runDramaTicks(t, svc, project, 2)
	bible := ""
	for _, req := range fake.requests {
		if strings.Contains(req.Prompt, "小说原文抽样") {
			bible = req.Prompt
		}
	}
	if bible == "" || !strings.Contains(bible, "丁丁") || strings.Contains(bible, "预留") {
		t.Fatalf("asset extraction must only read selected chapters: %q", bible)
	}

	outline, err := svc.DramaChapterOutline("usr-drama", project)
	if err != nil || len(outline) != 5 {
		t.Fatalf("outline must list every chapter: %+v %v", outline, err)
	}
	if outline[0].Reserved || outline[0].EpisodeNumber != 1 || outline[3].EpisodeNumber != 2 || !outline[2].Reserved || !outline[4].Reserved || outline[2].EpisodeNumber != 0 {
		t.Fatalf("outline flags: %+v", outline)
	}
	if _, err := svc.DramaChapterOutline("someone", project); err == nil {
		t.Fatal("outline must check ownership")
	}
	if _, err := svc.ProduceDramaChapters("usr-drama", project, ProduceDramaChaptersRequest{ChapterIDs: []string{outline[0].ID}}); err == nil {
		t.Fatal("chapters already in production cannot be added again")
	}
	if _, err := svc.ProduceDramaChapters("someone", project, ProduceDramaChaptersRequest{ChapterIDs: []string{outline[2].ID}}); err == nil {
		t.Fatal("produce must check ownership")
	}

	result, err := svc.ProduceDramaChapters("usr-drama", project, ProduceDramaChaptersRequest{ChapterIDs: []string{outline[4].ID, outline[2].ID}})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.EpisodeIDs) != 2 {
		t.Fatalf("non-adjacent reserved chapters become separate episodes: %+v", result)
	}
	after, err := svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatal(err)
	}
	if after.Production.ReservedChapterCount != 0 || after.Production.ChapterCount != 5 || after.Production.PlanCursor != 5 || !after.Production.PlanDone || len(after.Episodes) != 4 {
		t.Fatalf("produced chapters must join the plan: %+v", after.Production)
	}
	third, err := svc.repo.DramaEpisode(project, result.EpisodeIDs[0])
	if err != nil || third.Number != 3 || third.Stage != model.DramaEpisodeQueued || decodeStringList(third.ChapterIDsJSON)[0] != outline[2].ID {
		t.Fatalf("new episodes follow chapter order after existing ones: %+v %v", third, err)
	}
}

func TestDramaSelectedChaptersValidation(t *testing.T) {
	svc, _ := newDramaTestService(t)
	settings := DramaSettings{ReviewMode: DramaReviewAuto, MediaMode: DramaMediaManual, Models: fakeDramaModels, EpisodeMode: DramaEpisodeModeChapter, ChaptersPerEpisode: 1}
	chapters := []DramaChapterInput{{Title: "第一章", Text: "甲"}, {Title: "第二章", Text: strings.Repeat("长", 13000)}}
	if _, err := svc.CreateDrama("usr-drama", CreateDramaRequest{Name: "越界", Settings: settings, Chapters: chapters, SelectedChapters: []int{2}}); err == nil {
		t.Fatal("out-of-range selection must be rejected")
	}
	// 超长章节没选中时只保存原文；加入制作时才按单章上限拦下。
	summary, err := svc.CreateDrama("usr-drama", CreateDramaRequest{Name: "预留超长", Settings: settings, Chapters: chapters, SelectedChapters: []int{0}})
	if err != nil {
		t.Fatal(err)
	}
	outline, err := svc.DramaChapterOutline("usr-drama", summary.Project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ProduceDramaChapters("usr-drama", summary.Project.ID, ProduceDramaChaptersRequest{ChapterIDs: []string{outline[1].ID}}); err == nil || !strings.Contains(err.Error(), "单章不超过") {
		t.Fatalf("oversized reserved chapter must be rejected when produced: %v", err)
	}
}
