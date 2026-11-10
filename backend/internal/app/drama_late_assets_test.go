package app

import (
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
)

func setupLateAssetDrama(t *testing.T, media string) (*Service, *fakeDramaBackend, *model.Project, *model.DramaEpisode, model.DramaCast) {
	t.Helper()
	svc, fake := newDramaTestService(t)
	settings := DramaSettings{ReviewMode: DramaReviewAuto, MediaMode: media, Concurrency: 16, Models: fakeDramaModels, EpisodeMode: DramaEpisodeModeChapter, ChaptersPerEpisode: 1}
	settings.EpisodeSeconds = 60
	settings.Storyboard.SegmentMode, settings.Storyboard.SegmentSeconds = production.SegmentFixed, 5
	summary, err := svc.CreateDrama("usr-drama", CreateDramaRequest{Name: "从1985修家电开始", Start: true, Settings: settings, Chapters: []DramaChapterInput{
		{Title: "第一章", Text: "周大明是四十出头的精瘦中年机修工，两颊凹陷，穿打补丁的工装。"},
		{Title: "第二章", Text: "张维民身材魁梧，国字脸，留平头，穿藏青色中山装，说话声闷而稳。他提着一只铜壳收音机走进县招待所大堂，大理石地面，墙上挂着领袖像。"},
	}})
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
	now := time.Now()
	hero := model.DramaCast{
		ID: newID(), ProjectID: summary.Project.ID, Kind: "character", Name: "周大明", AliasesJSON: "[]",
		Appearance: "四十出头的精瘦中年机修工，两颊凹陷，穿打补丁的工装", Description: "镇上的机修师傅",
		VoiceInstructions: "男，中年，嗓音干涩", Position: 0, CreatedAt: now, UpdatedAt: now,
	}
	if err := svc.repo.CreateDramaCasts([]model.DramaCast{hero}); err != nil {
		t.Fatal(err)
	}
	episodes, err := svc.repo.DramaEpisodes(summary.Project.ID)
	if err != nil || len(episodes) < 2 {
		t.Fatalf("need two chapter episodes: %+v %v", episodes, err)
	}
	return svc, fake, &summary.Project, &episodes[1], hero
}

func lateAssetRun(svc *Service, project *model.Project, productionRow *model.DramaProduction) *dramaRun {
	return &dramaRun{s: svc, project: project, production: productionRow, settings: parseDramaSettings(productionRow.SettingsJSON), active: map[string]bool{}}
}

func extractJob(jobs []model.DramaJob) *model.DramaJob {
	for i := range jobs {
		if jobs[i].Kind == model.DramaJobCastExtract {
			return &jobs[i]
		}
	}
	return nil
}

func imageJobFor(jobs []model.DramaJob, castID string) bool {
	for _, job := range jobs {
		if job.Kind == model.DramaJobCastImage && job.CastID == castID {
			return true
		}
	}
	return false
}

func TestLateAssetsExtractFromCurrentEpisodeScript(t *testing.T) {
	svc, _, project, episode, hero := setupLateAssetDrama(t, DramaMediaAuto)
	productionRow, err := svc.repo.DramaProduction(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	run := lateAssetRun(svc, project, productionRow)
	shots := []production.ScriptShot{
		{Scene: "县招待所大堂", Characters: []string{"周大明", "张维民"}, Props: []string{"铜壳收音机"}, Speaker: "张维民", Dialogue: "这台机器还能修。", Action: "张维民提着收音机走进大堂", SourceQuote: "张维民身材魁梧，国字脸"},
	}
	if err := run.applyScriptShots(episode, shots, nil, production.ScriptEpisode{}, false); err != nil {
		t.Fatal(err)
	}
	casts, err := svc.repo.DramaCasts(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	var zhang, radio, lobby, zhou model.DramaCast
	for _, cast := range casts {
		switch {
		case cast.Kind == "character" && cast.Name == "张维民":
			zhang = cast
		case cast.Kind == "prop" && cast.Name == "铜壳收音机":
			radio = cast
		case cast.Kind == "scene" && cast.Name == "县招待所大堂":
			lobby = cast
		case cast.ID == hero.ID:
			zhou = cast
		}
	}
	if zhang.ID == "" || radio.ID == "" || lobby.ID == "" {
		t.Fatalf("late stubs must be created: %+v", casts)
	}
	if zhang.Appearance != "" || radio.Appearance != "" || lobby.Appearance != "" {
		t.Fatalf("late stubs must start without a look: 张维民=%q 收音机=%q 大堂=%q", zhang.Appearance, radio.Appearance, lobby.Appearance)
	}
	if zhou.Appearance != hero.Appearance {
		t.Fatalf("existing appearance must stay intact: %q", zhou.Appearance)
	}
	job := extractJob(run.newJobs)
	if job == nil {
		t.Fatal("empty late stubs must enqueue a cast_extract job")
	}
	if imageJobFor(run.newJobs, zhang.ID) || imageJobFor(run.newJobs, radio.ID) || imageJobFor(run.newJobs, lobby.ID) {
		t.Fatal("empty stubs must not enqueue reference images")
	}

	extract := &model.DramaJob{ID: job.ID, ProjectID: project.ID, EpisodeID: episode.ID, Kind: model.DramaJobCastExtract, PayloadJSON: job.PayloadJSON}
	task := &model.Task{ResultJSON: `{"text":"{\"characters\":[{\"name\":\"张维民\",\"role\":\"配角\",\"gender\":\"男\",\"age\":\"中年\",\"description\":\"县里来的干部\",\"appearance\":\"身材魁梧，国字脸，留平头，穿藏青色中山装\",\"voice\":\"声闷而稳\"},{\"name\":\"周大明\",\"appearance\":\"把原有外貌改成完全不同的形象\"}],\"props\":[{\"name\":\"铜壳收音机\",\"description\":\"待修的旧收音机\",\"appearance\":\"黄铜外壳，旋钮磨损发亮\"}],\"scenes\":[{\"name\":\"县招待所大堂\",\"description\":\"待客大厅\",\"appearance\":\"大理石地面，墙上挂着领袖像的县招待所大堂\"}]}"}`}
	if err := run.applyCastExtract(extract, task); err != nil {
		t.Fatal(err)
	}
	updated, err := svc.repo.DramaCasts(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	zhang, radio, lobby, zhou = model.DramaCast{}, model.DramaCast{}, model.DramaCast{}, model.DramaCast{}
	for _, cast := range updated {
		switch {
		case cast.Kind == "character" && cast.Name == "张维民":
			zhang = cast
		case cast.Kind == "prop" && cast.Name == "铜壳收音机":
			radio = cast
		case cast.Kind == "scene" && cast.Name == "县招待所大堂":
			lobby = cast
		case cast.ID == hero.ID:
			zhou = cast
		}
	}
	if !strings.Contains(zhang.Appearance, "藏青色中山装") || zhang.Description != "县里来的干部" || !strings.Contains(zhang.VoiceInstructions, "声闷而稳") {
		t.Fatalf("late character must be filled from the episode extract: %+v", zhang)
	}
	if radio.Appearance != "黄铜外壳，旋钮磨损发亮" || radio.Description != "待修的旧收音机" {
		t.Fatalf("late prop must be filled: %+v", radio)
	}
	if lobby.Appearance != "大理石地面，墙上挂着领袖像的县招待所大堂" || lobby.Description != "待客大厅" {
		t.Fatalf("late scene must be filled: %+v", lobby)
	}
	if zhou.Appearance != hero.Appearance || zhou.Description != hero.Description || zhou.VoiceInstructions != hero.VoiceInstructions {
		t.Fatalf("existing named asset must not be overwritten: %+v", zhou)
	}
}

func TestLateAssetEmptyExtractDoesNotQueueImage(t *testing.T) {
	svc, _, project, episode, hero := setupLateAssetDrama(t, DramaMediaAuto)
	productionRow, err := svc.repo.DramaProduction(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	run := lateAssetRun(svc, project, productionRow)
	shots := []production.ScriptShot{
		{Scene: "后院", Characters: []string{"路过的路人"}, Action: "有人从门口走过"},
	}
	if err := run.applyScriptShots(episode, shots, nil, production.ScriptEpisode{}, false); err != nil {
		t.Fatal(err)
	}
	job := extractJob(run.newJobs)
	if job == nil {
		t.Fatal("missing extract job")
	}
	if err := run.applyCastExtract(job, &model.Task{ResultJSON: `{"text":"{\"characters\":[{\"name\":\"路过的路人\",\"appearance\":\"\"}],\"props\":[],\"scenes\":[{\"name\":\"后院\",\"appearance\":\"\"}]}"}`}); err != nil {
		t.Fatal(err)
	}
	casts, err := svc.repo.DramaCasts(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	run.casts = casts
	var passerby, yard, zhou model.DramaCast
	for _, cast := range casts {
		switch {
		case cast.Kind == "character" && cast.Name == "路过的路人":
			passerby = cast
		case cast.Kind == "scene" && cast.Name == "后院":
			yard = cast
		case cast.ID == hero.ID:
			zhou = cast
		}
	}
	if passerby.ID == "" || yard.ID == "" {
		t.Fatalf("named assets must still be created: %+v", casts)
	}
	if passerby.Appearance != "" || yard.Appearance != "" {
		t.Fatalf("empty extract must leave appearance blank: %+v %+v", passerby, yard)
	}
	run.newJobs = nil
	run.active = map[string]bool{}
	if err := run.plan(); err != nil {
		t.Fatal(err)
	}
	if imageJobFor(run.newJobs, passerby.ID) || imageJobFor(run.newJobs, yard.ID) {
		t.Fatalf("empty appearance must not auto-queue a reference image: %+v", run.newJobs)
	}
	if !imageJobFor(run.newJobs, zhou.ID) {
		t.Fatalf("existing described assets must still auto-queue a reference image: %+v", run.newJobs)
	}
	if _, skip, err := run.submitCastImage(&model.DramaJob{CastID: passerby.ID, ProjectID: project.ID}); err != nil || !skip {
		t.Fatalf("submitCastImage must skip empty appearance: skip=%v err=%v", skip, err)
	}
}

func TestLateAssetHintsSkipExtractAndKeepExisting(t *testing.T) {
	svc, _, project, episode, hero := setupLateAssetDrama(t, DramaMediaAuto)
	productionRow, err := svc.repo.DramaProduction(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	run := lateAssetRun(svc, project, productionRow)
	shots := []production.ScriptShot{
		{Scene: "周家小院", Characters: []string{"周大明", "张维民"}, Action: "两人站在院子里"},
	}
	hints := []production.ScriptCast{
		{Kind: "character", Name: "张维民", Appearance: "身材魁梧的中年干部，藏青色中山装", Voice: "声闷而稳"},
		{Kind: "scene", Name: "周家小院", Appearance: "堆满零件的小院"},
		{Kind: "character", Name: "周大明", Appearance: "试图改写已有外貌"},
	}
	if err := run.applyScriptShots(episode, shots, hints, production.ScriptEpisode{}, false); err != nil {
		t.Fatal(err)
	}
	if extractJob(run.newJobs) != nil {
		t.Fatalf("complete hints should not enqueue extract: %+v", run.newJobs)
	}
	casts, err := svc.repo.DramaCasts(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	var zhang, yard, zhou model.DramaCast
	for _, cast := range casts {
		switch {
		case cast.Kind == "character" && cast.Name == "张维民":
			zhang = cast
		case cast.Kind == "scene" && cast.Name == "周家小院":
			yard = cast
		case cast.ID == hero.ID:
			zhou = cast
		}
	}
	if zhang.Appearance != "身材魁梧的中年干部，藏青色中山装" || zhang.VoiceInstructions != "声闷而稳" {
		t.Fatalf("hinted late character must be stored: %+v", zhang)
	}
	if yard.Appearance != "堆满零件的小院" {
		t.Fatalf("hinted late scene must be stored: %+v", yard)
	}
	if zhou.Appearance != hero.Appearance {
		t.Fatalf("existing character must not be overwritten by a script hint: %q", zhou.Appearance)
	}
}

func TestDramaReferencesInProgressSkipsEmptyBrief(t *testing.T) {
	cast := model.DramaCast{ID: "new-1", Name: "张维民", Kind: "character"}
	shots := []model.DramaShot{{SegmentIndex: 0, CastIDsJSON: `["new-1"]`}}
	lookup := func(id string) (model.DramaCast, bool) {
		if id == cast.ID {
			return cast, true
		}
		return model.DramaCast{}, false
	}
	if names := dramaReferencesInProgress(0, shots, lookup, true); len(names) != 0 {
		t.Fatalf("empty appearance must not block video: %v", names)
	}
	cast.ImageStatus = model.DramaMediaQueued
	if names := dramaReferencesInProgress(0, shots, lookup, true); len(names) != 0 {
		t.Fatalf("queued empty appearance must not block video: %v", names)
	}
	cast.ImageStatus = ""
	cast.Appearance = "身材魁梧，穿藏青色中山装"
	if names := dramaReferencesInProgress(0, shots, lookup, true); len(names) != 1 || names[0] != "张维民" {
		t.Fatalf("described asset should wait for its reference image: %v", names)
	}
}
