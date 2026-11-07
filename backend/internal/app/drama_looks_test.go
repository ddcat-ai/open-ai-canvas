package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
)

// DefaultLook 按本集第一章在造型的默认章节范围里选：命中多套时取起始最晚、范围更窄的；没有命中回退角色本体。
func TestDefaultLookByChapter(t *testing.T) {
	looks := []production.LookRange{
		{ID: "散修", From: 1, To: 10},
		{ID: "外门", From: 11, To: 20},
		{ID: "内门", From: 21, To: 0},
		{ID: "伪装", From: 0, To: 0},
	}
	cases := []struct {
		chapters []int
		want     string
	}{
		{[]int{5, 6}, "散修"},
		{[]int{12}, "外门"},
		{[]int{30}, "内门"},
		{[]int{25, 21}, "内门"},
		{nil, ""},
	}
	for _, tc := range cases {
		if got := production.DefaultLook(looks, tc.chapters); got != tc.want {
			t.Fatalf("DefaultLook(%v) = %q, want %q", tc.chapters, got, tc.want)
		}
	}
	// 起点相同取范围更窄的那套。
	overlap := []production.LookRange{{ID: "宽", From: 1, To: 50}, {ID: "窄", From: 1, To: 5}}
	if got := production.DefaultLook(overlap, []int{3}); got != "窄" {
		t.Fatalf("overlapping looks should prefer the narrower range, got %q", got)
	}
}

// 角色造型的增删改走服务层：造型是角色子行，删除后镜头回退角色本体。
func TestDramaCastLookLifecycle(t *testing.T) {
	svc, fake := newDramaTestService(t)
	settings := DramaSettings{ReviewMode: DramaReviewAuto, MediaMode: DramaMediaManual, Concurrency: 16, Models: fakeDramaModels, EpisodeMode: DramaEpisodeModeChapter, ChaptersPerEpisode: 1}
	settings.EpisodeSeconds = 60
	settings.Storyboard.SegmentMode, settings.Storyboard.SegmentSeconds = production.SegmentFixed, 5
	summary, err := svc.CreateDrama("usr-drama", CreateDramaRequest{Name: "造型", Start: true, Settings: settings, Chapters: []DramaChapterInput{{Title: "第一章", Text: "萧炎……"}}})
	if err != nil {
		t.Fatal(err)
	}
	project := summary.Project.ID
	runDramaTicks(t, svc, project, 20)
	casts, err := svc.repo.DramaCasts(project)
	if err != nil {
		t.Fatal(err)
	}
	var hero model.DramaCast
	for _, cast := range casts {
		if cast.Kind == "character" && cast.ParentID == "" {
			hero = cast
			break
		}
	}
	if hero.ID == "" {
		t.Fatalf("no base character: %+v", casts)
	}
	if _, err := svc.AddDramaCastLook("someone", project, hero.ID, DramaCastLookRequest{LookName: "内门弟子", Appearance: "青色劲装"}); err == nil {
		t.Fatal("add look must check ownership")
	}
	if _, err := svc.AddDramaCastLook("usr-drama", project, hero.ID, DramaCastLookRequest{LookName: "基础造型", Appearance: "x"}); err == nil {
		t.Fatal("look name cannot be the base look")
	}
	result, err := svc.AddDramaCastLook("usr-drama", project, hero.ID, DramaCastLookRequest{LookName: "内门弟子", Appearance: "青色劲装，长发束起", FromChapter: intPtr(5), ToChapter: intPtr(2)})
	if err != nil {
		t.Fatal(err)
	}
	look := result["look"].(model.DramaCast)
	if look.ImageStatus != model.DramaMediaDraft {
		t.Fatalf("saving a look must leave it as a draft: %+v", look)
	}
	// 起止颠倒被交换。
	if look.ParentID != hero.ID || look.LookName != "内门弟子" || look.LookFromChapter != 2 || look.LookToChapter != 5 {
		t.Fatalf("look not stored right: %+v", look)
	}
	// 造型以角色本体参考图为底图生成（image_to_image），保持同一张脸。
	if _, err := svc.ReleaseDramaMedia("usr-drama", project, ReleaseDramaMediaRequest{Target: "assets"}); err != nil {
		t.Fatal(err)
	}
	runDramaTicks(t, svc, project, 8)
	saved, err := svc.repo.DramaCast(project, look.ID)
	if err != nil || saved.ImageStatus != model.DramaMediaDraft || saved.ImageResourceID != "" {
		t.Fatalf("release assets must not generate an unconfirmed look: %+v %v", saved, err)
	}
	prompt := "青色丝绸长袍，银色发簪，柔和侧光"
	if _, err := svc.UpdateDramaCastLook("usr-drama", project, look.ID, DramaCastLookRequest{ImagePrompt: &prompt}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RegenerateDramaCast("usr-drama", project, look.ID, false); err != nil {
		t.Fatal(err)
	}
	runDramaTicks(t, svc, project, 8)
	imageOps := map[string]int{}
	foundPrompt := false
	for _, req := range fake.requests {
		if req.Type == "canvas_image" {
			imageOps[req.Operation]++
			if req.Operation == "image_to_image" && strings.Contains(req.Prompt, prompt) {
				foundPrompt = true
			}
		}
	}
	if imageOps["image_to_image"] == 0 {
		t.Fatalf("look image must reference the base character: %v", imageOps)
	}
	if !foundPrompt {
		t.Fatal("look generation must use the saved custom prompt")
	}

	if _, err := svc.UpdateDramaCastLook("usr-drama", project, look.ID, DramaCastLookRequest{Appearance: "青色劲装加外袍"}); err != nil {
		t.Fatal(err)
	}
	updated, err := svc.repo.DramaCast(project, look.ID)
	if err != nil || updated.Appearance != "青色劲装加外袍" || updated.ImageStatus != model.DramaMediaReady {
		t.Fatalf("saving appearance must preserve the current image without requeuing: %+v %v", updated, err)
	}
	before := fake.byKind["image"]
	runDramaTicks(t, svc, project, 4)
	if fake.byKind["image"] != before {
		t.Fatal("editing a look must not submit image tasks")
	}
	custom := fake.resource("usr-drama", "image", "image/png")
	if _, err := svc.SetDramaCastImage("usr-drama", project, look.ID, SetDramaCastImageRequest{ResourceID: custom}); err != nil {
		t.Fatal(err)
	}
	adopted, err := svc.repo.DramaCast(project, look.ID)
	if err != nil || adopted.ImageResourceID != custom || !adopted.Locked {
		t.Fatalf("custom look image not adopted: %+v %v", adopted, err)
	}

	references := []string{look.ID}
	episodeID := summary.Episodes[0].ID
	if err := svc.UpdateDramaSegment("usr-drama", project, episodeID, 0, UpdateDramaSegmentRequest{ReferenceCastIDs: &references}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.DeleteDramaCastLook("usr-drama", project, look.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.repo.DramaCast(project, look.ID); err == nil {
		t.Fatal("look should be deleted")
	}
	detail, err := svc.DramaEpisodeDetail("usr-drama", project, episodeID)
	if err != nil || len(detail.Segments[0].Request.References) != 1 || detail.Segments[0].Request.References[0].CastID != hero.ID {
		t.Fatalf("deleting a look must restore its base character reference: %+v %v", detail, err)
	}
}
