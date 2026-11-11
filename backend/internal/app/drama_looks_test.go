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

func TestDramaExplicitBaseLookOverridesChapterLook(t *testing.T) {
	character := model.DramaCast{ID: "hero"}
	looks := []model.DramaCast{{ID: "night", ParentID: "hero", LookName: "夜行", LookFromChapter: 1, LookToChapter: 10}}
	for _, name := range []string{"基础造型", "默认造型", "初始造型"} {
		if got := dramaResolveShotLook(character, looks, name, []int{2}); got != "" {
			t.Fatalf("explicit base look %q must use the character itself, got %q", name, got)
		}
	}
	if got := dramaResolveShotLook(character, looks, "", []int{2}); got != "night" {
		t.Fatalf("unspecified look should still follow the chapter: %q", got)
	}
}

func TestDramaScriptDoesNotCreateDuplicateBaseLook(t *testing.T) {
	svc, _ := newDramaTestService(t)
	summary := createTestDramaWithMedia(t, svc, DramaReviewAuto, DramaMediaManual)
	runDramaTicks(t, svc, summary.Project.ID, 20)
	summary, err := svc.DramaSummary("usr-drama", summary.Project.ID)
	if err != nil {
		t.Fatal(err)
	}
	casts, err := svc.repo.DramaCasts(summary.Project.ID)
	if err != nil {
		t.Fatal(err)
	}
	var hero model.DramaCast
	for _, cast := range casts {
		if cast.Name == "萧炎" && cast.ParentID == "" {
			hero = cast
		}
	}
	if hero.ID == "" {
		t.Fatal("missing fixture character")
	}
	episode, err := svc.repo.DramaEpisode(summary.Project.ID, summary.Episodes[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	run := &dramaRun{s: svc, project: &summary.Project, settings: summary.Production.Settings}
	var shots []production.ScriptShot
	var hints []production.ScriptCast
	for _, look := range []struct{ name, appearance string }{{"便装", hero.Appearance}, {"初始造型", "第一次登场形象"}, {"夜行", "黑衣蒙面"}, {"潜行", "黑衣，蒙面。"}} {
		shots = append(shots, production.ScriptShot{Characters: []string{hero.Name}, Looks: production.LookChoices{hero.Name: look.name}, Action: "走过院子"})
		hints = append(hints, production.ScriptCast{Kind: "look", Name: hero.Name, Look: look.name, Appearance: look.appearance})
	}
	if err := run.applyScriptShots(episode, shots, hints, production.ScriptEpisode{}, false); err != nil {
		t.Fatal(err)
	}
	updated, err := svc.repo.DramaCasts(summary.Project.ID)
	if err != nil {
		t.Fatal(err)
	}
	looks := dramaLooksForCharacter(updated, hero.ID)
	if len(looks) != 1 || looks[0].LookName != "夜行" {
		t.Fatalf("only the distinct outfit should create a look: %+v", looks)
	}
	saved, err := svc.repo.DramaShots(episode.ID)
	if err != nil || len(saved) != 4 {
		t.Fatalf("shots: %+v %v", saved, err)
	}
	if len(decodeStringList(saved[0].LookCastIDsJSON)) != 0 || len(decodeStringList(saved[1].LookCastIDsJSON)) != 0 || saved[2].LookCastIDsJSON != saved[3].LookCastIDsJSON {
		t.Fatalf("base shots should reuse the character and repeated outfits should reuse the same look: %+v", saved)
	}
}

// 造型在本体失败或删除时落为终态并只留一条失败作业；重试本体时联动失败造型。
func TestDramaLookFailsOnceWithBaseAndRequeuesOnBaseRetry(t *testing.T) {
	svc, fake := newDramaTestService(t)
	settings := DramaSettings{ReviewMode: DramaReviewAuto, MediaMode: DramaMediaManual, Concurrency: 16, Models: fakeDramaModels, EpisodeMode: DramaEpisodeModeChapter, ChaptersPerEpisode: 1}
	settings.EpisodeSeconds = 60
	settings.Storyboard.SegmentMode, settings.Storyboard.SegmentSeconds = production.SegmentFixed, 5
	summary, err := svc.CreateDrama("usr-drama", CreateDramaRequest{Name: "造型等本体", Start: true, Settings: settings, Chapters: []DramaChapterInput{{Title: "第一章", Text: "萧炎……"}}})
	if err != nil {
		t.Fatal(err)
	}
	project := summary.Project.ID
	runDramaTicks(t, svc, project, 20)
	casts, err := svc.repo.DramaCasts(project)
	if err != nil {
		t.Fatal(err)
	}
	var base *model.DramaCast
	for i := range casts {
		if casts[i].Kind == "character" && casts[i].ParentID == "" {
			base = &casts[i]
			break
		}
	}
	if base == nil {
		t.Fatalf("no base character: %+v", casts)
	}
	result, err := svc.AddDramaCastLook("usr-drama", project, base.ID, DramaCastLookRequest{LookName: "内门弟子", Appearance: "青色劲装"})
	if err != nil {
		t.Fatal(err)
	}
	lookValue := result["look"].(model.DramaCast)
	look := &lookValue
	if _, err := svc.ReleaseDramaMedia("usr-drama", project, ReleaseDramaMediaRequest{Target: "assets"}); err != nil {
		t.Fatal(err)
	}
	runDramaTicks(t, svc, project, 10)
	base, _ = svc.repo.DramaCast(project, base.ID)
	if base.ImageStatus != model.DramaMediaReady {
		t.Fatalf("base assets should be generated first: base=%s", base.ImageStatus)
	}
	// 造型保存后是 draft，需要用户单独请求生成。
	if _, err := svc.RegenerateDramaCast("usr-drama", project, look.ID, false); err != nil {
		t.Fatal(err)
	}
	runDramaTicks(t, svc, project, 8)
	base, _ = svc.repo.DramaCast(project, base.ID)
	look, _ = svc.repo.DramaCast(project, look.ID)
	if base.ImageStatus != model.DramaMediaReady || look.ImageStatus != model.DramaMediaReady {
		t.Fatalf("assets should be generated first: base=%s look=%s", base.ImageStatus, look.ImageStatus)
	}

	castJobs := func(status string) int64 {
		var count int64
		if err := fake.db.Model(&model.DramaJob{}).Where("project_id = ? AND cast_id = ? AND kind = ? AND status = ?", project, look.ID, model.DramaJobCastImage, status).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		return count
	}
	// 模拟线上：本体参考图失败，造型状态为空（既不是 ready 也不是 failed）。
	if err := fake.db.Model(&model.DramaCast{}).Where("id = ?", base.ID).Updates(map[string]any{"image_status": model.DramaMediaFailed, "image_resource_id": ""}).Error; err != nil {
		t.Fatal(err)
	}
	if err := fake.db.Model(&model.DramaCast{}).Where("id = ?", look.ID).Updates(map[string]any{"image_status": "", "image_resource_id": ""}).Error; err != nil {
		t.Fatal(err)
	}
	runDramaTicks(t, svc, project, 1)
	look, _ = svc.repo.DramaCast(project, look.ID)
	if look.ImageStatus != model.DramaMediaFailed {
		t.Fatalf("look must fail with its base, got %q", look.ImageStatus)
	}
	if got := castJobs(model.DramaJobFailed); got != 1 {
		t.Fatalf("failed base must leave exactly one failed look job, got %d", got)
	}
	var failedJob model.DramaJob
	if err := fake.db.Where("project_id = ? AND cast_id = ? AND kind = ? AND status = ?", project, look.ID, model.DramaJobCastImage, model.DramaJobFailed).First(&failedJob).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(failedJob.Error, "角色本体参考图生成失败") {
		t.Fatalf("failed job must explain the base failure: %q", failedJob.Error)
	}
	// 连续多轮巡检不能再落新作业（旧代码在这里无限重复入队）。
	runDramaTicks(t, svc, project, 5)
	if got := castJobs(model.DramaJobFailed); got != 1 {
		t.Fatalf("repeated ticks must not add failed jobs, got %d", got)
	}

	// 本体生成中时造型不排队。
	if err := fake.db.Model(&model.DramaCast{}).Where("id = ?", base.ID).Updates(map[string]any{"image_status": model.DramaMediaRunning}).Error; err != nil {
		t.Fatal(err)
	}
	if err := fake.db.Model(&model.DramaCast{}).Where("id = ?", look.ID).Updates(map[string]any{"image_status": model.DramaMediaQueued}).Error; err != nil {
		t.Fatal(err)
	}
	before := castJobs(model.DramaJobQueued) + castJobs(model.DramaJobRunning) + castJobs(model.DramaJobFailed) + castJobs(model.DramaJobCanceled)
	runDramaTicks(t, svc, project, 3)
	after := castJobs(model.DramaJobQueued) + castJobs(model.DramaJobRunning) + castJobs(model.DramaJobFailed) + castJobs(model.DramaJobCanceled)
	if after != before {
		t.Fatalf("look must wait while its base is running: jobs %d -> %d", before, after)
	}

	// 重试本体：本体与失败的造型一起回到 queued，本体就绪后造型再出图。
	if _, err := svc.RegenerateDramaCast("usr-drama", project, base.ID, false); err != nil {
		t.Fatal(err)
	}
	base, _ = svc.repo.DramaCast(project, base.ID)
	look, _ = svc.repo.DramaCast(project, look.ID)
	if base.ImageStatus != model.DramaMediaQueued || look.ImageStatus != model.DramaMediaQueued {
		t.Fatalf("base retry must requeue its failed looks: base=%s look=%s", base.ImageStatus, look.ImageStatus)
	}
	runDramaTicks(t, svc, project, 8)
	base, _ = svc.repo.DramaCast(project, base.ID)
	look, _ = svc.repo.DramaCast(project, look.ID)
	if base.ImageStatus != model.DramaMediaReady || look.ImageStatus != model.DramaMediaReady {
		t.Fatalf("look must generate after the base is ready: base=%s look=%s", base.ImageStatus, look.ImageStatus)
	}

	// 本体被删除时造型同样落失败，不再空转。
	if err := fake.db.Delete(&model.DramaCast{}, "id = ?", base.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := fake.db.Model(&model.DramaCast{}).Where("id = ?", look.ID).Updates(map[string]any{"image_status": "", "image_resource_id": ""}).Error; err != nil {
		t.Fatal(err)
	}
	beforeDelete := castJobs(model.DramaJobFailed)
	runDramaTicks(t, svc, project, 1)
	look, _ = svc.repo.DramaCast(project, look.ID)
	if look.ImageStatus != model.DramaMediaFailed {
		t.Fatalf("look must fail when its base is gone, got %q", look.ImageStatus)
	}
	if got := castJobs(model.DramaJobFailed); got != beforeDelete+1 {
		t.Fatalf("deleted base must leave one failed look job, jobs %d -> %d", beforeDelete, got)
	}
	var deletedJob model.DramaJob
	if err := fake.db.Where("project_id = ? AND cast_id = ? AND kind = ? AND status = ?", project, look.ID, model.DramaJobCastImage, model.DramaJobFailed).Order("created_at desc").First(&deletedJob).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(deletedJob.Error, "已被删除") {
		t.Fatalf("deleted base failure must explain itself: %q", deletedJob.Error)
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
	// 「生成全部参考图」也应把草稿造型排进队列；以角色本体参考图为底图生成，保持同一张脸。
	prompt := "青色丝绸长袍，银色发簪，柔和侧光"
	if _, err := svc.UpdateDramaCastLook("usr-drama", project, look.ID, DramaCastLookRequest{ImagePrompt: &prompt}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReleaseDramaMedia("usr-drama", project, ReleaseDramaMediaRequest{Target: "assets"}); err != nil {
		t.Fatal(err)
	}
	queued, err := svc.repo.DramaCast(project, look.ID)
	if err != nil || queued.ImageStatus != model.DramaMediaQueued {
		t.Fatalf("release assets must queue draft looks: %+v %v", queued, err)
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
	baseBefore, err := svc.repo.DramaCast(project, hero.ID)
	if err != nil {
		t.Fatal(err)
	}
	canvasImage := fake.resource("usr-drama", "image", "image/png")
	if _, err := svc.SetDramaCastImage("usr-drama", project, look.ID, SetDramaCastImageRequest{ResourceID: canvasImage, Source: "canvas"}); err != nil {
		t.Fatal(err)
	}
	canvasLook, err := svc.repo.DramaCast(project, look.ID)
	if err != nil || canvasLook.ImageResourceID != canvasImage || !canvasLook.Locked || canvasLook.ImageStatus != model.DramaMediaReady {
		t.Fatalf("canvas image must be adopted into the selected look: %+v %v", canvasLook, err)
	}
	baseAfter, err := svc.repo.DramaCast(project, hero.ID)
	if err != nil || baseAfter.ImageResourceID != baseBefore.ImageResourceID || baseAfter.ImageVersion != baseBefore.ImageVersion || baseAfter.Locked != baseBefore.Locked {
		t.Fatalf("adopting a look must preserve the base character image: %+v %v", baseAfter, err)
	}
	takes, err := svc.DramaTakes("usr-drama", project, look.ID, "cast")
	if err != nil {
		t.Fatal(err)
	}
	foundCanvasTake := false
	for _, take := range takes["takes"].([]DramaTakeView) {
		if take.ResourceID == canvasImage && take.Current && take.Source == "canvas" && take.OwnerID == look.ID {
			foundCanvasTake = true
		}
	}
	if !foundCanvasTake {
		t.Fatal("the selected look must record a current canvas take")
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

func TestDramaShotCastIDsIncludeLooks(t *testing.T) {
	shot := model.DramaShot{
		CastIDsJSON:     `["char-1"]`,
		LookCastIDsJSON: `["look-1"]`,
		PropIDsJSON:     `["prop-1"]`,
		SceneCastID:     "scene-1",
	}
	ids := dramaShotCastIDs(shot)
	for _, want := range []string{"char-1", "look-1", "prop-1", "scene-1"} {
		if !containsString(ids, want) {
			t.Fatalf("dramaShotCastIDs missing %s: %v", want, ids)
		}
	}
}

func TestDramaReferencesInProgressWaitsForDraftLooks(t *testing.T) {
	look := model.DramaCast{ID: "look-1", Name: "萧炎", LookName: "内门弟子", ParentID: "char-1", Appearance: "青色劲装", ImageStatus: model.DramaMediaDraft}
	shots := []model.DramaShot{{SegmentIndex: 0, LookCastIDsJSON: `["look-1"]`, CastIDsJSON: `["char-1"]`}}
	lookup := func(id string) (model.DramaCast, bool) {
		if id == look.ID {
			return look, true
		}
		return model.DramaCast{}, false
	}
	names := dramaReferencesInProgress(0, shots, lookup, true)
	if len(names) != 1 || names[0] != "萧炎·内门弟子" {
		t.Fatalf("expected draft look wait name, got %v", names)
	}
	if names := dramaReferencesInProgress(0, shots, lookup, false); len(names) != 0 {
		t.Fatalf("unrequested draft should not block when not queued: %v", names)
	}
}
