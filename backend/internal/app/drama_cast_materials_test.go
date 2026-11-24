package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
	"yingce/backend/internal/production"
)

func newDramaMaterialProject(t *testing.T, svc *Service, name string) string {
	t.Helper()
	settings := DramaSettings{Models: fakeDramaModels, MediaMode: DramaMediaManual}
	settings.Assets.Mode = production.AssetModeFourView
	settings.StylePrompt = "玄幻仙侠风格"
	summary, err := svc.CreateDrama("usr-drama", CreateDramaRequest{Name: name, Settings: settings, Chapters: []DramaChapterInput{{Title: "第一章", Text: "正文"}}})
	if err != nil {
		t.Fatal(err)
	}
	return summary.Project.ID
}

func createDramaMaterial(t *testing.T, svc *Service, project, kind, name string) model.DramaCast {
	t.Helper()
	cast, err := svc.CreateDramaCast("usr-drama", project, CreateDramaCastRequest{Kind: kind, Name: name, Appearance: "当前外观"})
	if err != nil {
		t.Fatal(err)
	}
	return cast
}

func TestDramaManualCastDraftValidation(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := newDramaMaterialProject(t, svc, "手动设定")
	for _, kind := range []string{"character", "scene", "prop"} {
		cast := createDramaMaterial(t, svc, project, kind, kind)
		if cast.ImageStatus != model.DramaMediaDraft || cast.ImageResourceID != "" || cast.ParentID != "" {
			t.Fatalf("expected independent draft: %+v", cast)
		}
	}
	valid := CreateDramaCastRequest{Kind: "character", Name: "林逸", Appearance: "白衬衫"}
	if _, err := svc.CreateDramaCast("someone", project, valid); err == nil {
		t.Fatal("ownership required")
	}
	for _, req := range []CreateDramaCastRequest{
		{Kind: "look", Name: "x", Appearance: "x"}, {Kind: "character", Name: " ", Appearance: "x"},
		{Kind: "scene", Name: "x", Appearance: " "}, {Kind: "prop", Name: strings.Repeat("中", 61), Appearance: "x"},
		{Kind: "prop", Name: "x", Appearance: strings.Repeat("中", 1001)}, {Kind: "prop", Name: "x", Appearance: "x", ImageStylePrompt: strings.Repeat("中", 4001)},
		{Kind: "character", Name: "x", Appearance: "x", ImagePrompt: strings.Repeat("中", 12001)},
	} {
		if _, err := svc.CreateDramaCast("usr-drama", project, req); err == nil {
			t.Fatalf("invalid request accepted: %+v", req)
		}
	}
	if len(fake.requests) != 0 {
		t.Fatal("saving drafts must not call models")
	}
	jobs, err := svc.repo.RecentDramaJobs(project, 100)
	if err != nil || len(jobs) != 0 {
		t.Fatalf("saving drafts must not queue jobs: %+v %v", jobs, err)
	}
}

func TestDramaCastImagePromptPreviewAndStyles(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := newDramaMaterialProject(t, svc, "造型画风")
	base := createDramaMaterial(t, svc, project, "character", "林逸")
	style := "现代都市写实，9:16 竖屏构图"
	styleID, styleName := "urban", "都市"
	lookResult, err := svc.AddDramaCastLook("usr-drama", project, base.ID, DramaCastLookRequest{LookName: "童年", Appearance: "六岁儿童，校服，校园背景", ImageStyleID: &styleID, ImageStyleName: &styleName, ImageStylePrompt: &style})
	if err != nil {
		t.Fatal(err)
	}
	look := lookResult["look"].(model.DramaCast)
	row, _ := svc.repo.DramaProduction(project)
	row.BibleJSON = `{"visualRules":"仙气环绕，古装长袍"}`
	if err := fake.db.Save(row).Error; err != nil {
		t.Fatal(err)
	}
	preview, err := svc.PreviewDramaCastImagePrompt("usr-drama", project, look.ID, DramaCastImagePromptRequest{})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"四格", "正面全身", "侧面全身", "背面全身", "允许幼年", "现代都市写实", "六岁儿童", "16:9"} {
		if !strings.Contains(preview, want) {
			t.Fatalf("preview missing %q: %s", want, preview)
		}
	}
	for _, reject := range []string{"玄幻", "仙气", "体态与参考图1完全一致", "9:16"} {
		if strings.Contains(preview, reject) {
			t.Fatalf("old style or body leaked: %s", preview)
		}
	}
	custom := "自定义无缝棚拍，蓝色毛衣"
	if _, err := svc.UpdateDramaCast("usr-drama", project, base.ID, UpdateDramaCastRequest{ImagePrompt: &custom, ImageStylePrompt: &style}); err != nil {
		t.Fatal(err)
	}
	baseRow, _ := svc.repo.DramaCast(project, base.ID)
	if actual := buildDramaCastImagePrompt(parseDramaSettings(row.SettingsJSON), parseDramaBibleMeta(row.BibleJSON), *baseRow); !strings.Contains(actual, custom) || strings.Contains(actual, "玄幻") || strings.Contains(actual, "仙气") {
		t.Fatalf("custom base prompt ignored or polluted: %s", actual)
	}
	if _, err := svc.UpdateDramaCastLook("usr-drama", project, look.ID, DramaCastLookRequest{ImagePrompt: &preview}); err != nil {
		t.Fatal(err)
	}
	saved, _ := svc.repo.DramaCast(project, look.ID)
	if actual := buildDramaCastImagePrompt(parseDramaSettings(row.SettingsJSON), parseDramaBibleMeta(row.BibleJSON), *saved); actual != preview {
		t.Fatalf("saving preview must preserve exact submission prompt:\n%s\n%s", preview, actual)
	}
	newAppearance := "十二岁，运动装"
	second, err := svc.PreviewDramaCastImagePrompt("usr-drama", project, look.ID, DramaCastImagePromptRequest{Appearance: &newAppearance})
	if err != nil || !strings.Contains(second, newAppearance) || strings.Contains(second, "六岁儿童") || strings.Count(second, "角色四格资产参考图") != 1 {
		t.Fatalf("preview must recompose without old custom prompt: %s %v", second, err)
	}
	persisted, _ := svc.repo.DramaCast(project, look.ID)
	if persisted.Appearance != look.Appearance || persisted.ImagePrompt != preview || persisted.Revision != saved.Revision {
		t.Fatal("preview wrote to database")
	}
	if len(fake.requests) != 0 {
		t.Fatal("preview must not call paid models")
	}
	empty := ""
	cleared, err := svc.UpdateDramaCast("usr-drama", project, base.ID, UpdateDramaCastRequest{ImagePrompt: &empty, ImageStylePrompt: &empty})
	if err != nil || cleared.ImagePrompt != "" || cleared.ImageStylePrompt != "" {
		t.Fatalf("pointer fields must clear: %+v %v", cleared, err)
	}
	inherited := buildDramaCastImagePrompt(parseDramaSettings(row.SettingsJSON), parseDramaBibleMeta(row.BibleJSON), cleared)
	if !strings.Contains(inherited, "玄幻") || !strings.Contains(inherited, "仙气") {
		t.Fatal("cleared style must inherit work")
	}
	if _, err := svc.PreviewDramaCastImagePrompt("someone", project, look.ID, DramaCastImagePromptRequest{}); err == nil {
		t.Fatal("preview ownership required")
	}
}

func TestDramaCastImagePromptSubmissionUsesPreview(t *testing.T) {
	svc, fake := newDramaTestService(t)
	projectID := newDramaMaterialProject(t, svc, "真实提示词提交")
	base := createDramaMaterial(t, svc, projectID, "character", "林逸")
	base.ImageResourceID, base.ImageStatus = fake.resource("usr-drama", "image", "image/png"), model.DramaMediaReady
	if err := fake.db.Save(&base).Error; err != nil {
		t.Fatal(err)
	}
	style := "现代都市写实"
	result, err := svc.AddDramaCastLook("usr-drama", projectID, base.ID, DramaCastLookRequest{LookName: "童年", Appearance: "六岁体态，现代运动服", ImageStylePrompt: &style})
	if err != nil {
		t.Fatal(err)
	}
	look := result["look"].(model.DramaCast)
	preview, err := svc.PreviewDramaCastImagePrompt("usr-drama", projectID, look.ID, DramaCastImagePromptRequest{})
	if err != nil {
		t.Fatal(err)
	}
	look.ImageStatus = model.DramaMediaQueued
	if err := fake.db.Save(&look).Error; err != nil {
		t.Fatal(err)
	}
	project, row, err := svc.dramaForUser("usr-drama", projectID)
	if err != nil {
		t.Fatal(err)
	}
	run := dramaRun{s: svc, project: project, production: row, settings: parseDramaSettings(row.SettingsJSON), meta: parseDramaBibleMeta(row.BibleJSON)}
	if _, skip, err := run.submitCastImage(&model.DramaJob{ID: newID(), ProjectID: projectID, Kind: model.DramaJobCastImage, CastID: look.ID}); err != nil || skip {
		t.Fatalf("look submission failed: skip=%v %v", skip, err)
	}
	if len(fake.requests) != 1 {
		t.Fatalf("expected one request: %+v", fake.requests)
	}
	request := fake.requests[0]
	if request.Prompt != preview || request.Operation != "image_to_image" {
		t.Fatalf("actual generation differs from preview: %+v", request)
	}
	refs, ok := request.Input["referenceImages"].([]any)
	if !ok || len(refs) != 1 {
		t.Fatalf("missing base identity reference: %+v", request.Input)
	}
	custom := "定制灯光，蓝色衬衫"
	base.ImagePrompt, base.ImageStatus, base.ImageStylePrompt = custom, model.DramaMediaQueued, style
	if err := fake.db.Save(&base).Error; err != nil {
		t.Fatal(err)
	}
	if _, skip, err := run.submitCastImage(&model.DramaJob{ID: newID(), ProjectID: projectID, Kind: model.DramaJobCastImage, CastID: base.ID}); err != nil || skip {
		t.Fatalf("base submission failed: skip=%v %v", skip, err)
	}
	if len(fake.requests) != 2 || !strings.Contains(fake.requests[1].Prompt, custom) || strings.Contains(fake.requests[1].Prompt, "玄幻") {
		t.Fatal("actual base generation ignored the independent custom prompt")
	}
}

func TestDramaCastImportCopiesGraphAndIsolatesEdits(t *testing.T) {
	svc, fake := newDramaTestService(t)
	svc.coordinator = platform.NewCoordinatorWithRedis(nil, t.Name())
	source, target := newDramaMaterialProject(t, svc, "第一季"), newDramaMaterialProject(t, svc, "第二季")
	base := createDramaMaterial(t, svc, source, "character", "林逸")
	base.ImageResourceID, base.ImageStatus = fake.resource("usr-drama", "image", "image/png"), model.DramaMediaReady
	base.ImageStyleID, base.ImageStyleName, base.ImageStylePrompt = "urban", "都市", "都市写实"
	base.VoiceSampleResourceID = fake.resource("usr-drama", "audio", "audio/wav")
	base.VoiceInstructions = "低沉平静"
	if err := fake.db.Save(&base).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetDramaCastVoice("usr-drama", source, base.ID, SetDramaCastVoiceRequest{SampleResourceID: base.VoiceSampleResourceID}, false); err != nil {
		t.Fatal(err)
	}
	lookResult, err := svc.AddDramaCastLook("usr-drama", source, base.ID, DramaCastLookRequest{LookName: "夜行", Appearance: "深色外套", FromChapter: intPtr(3), ToChapter: intPtr(7)})
	if err != nil {
		t.Fatal(err)
	}
	look := lookResult["look"].(model.DramaCast)
	look.ImageResourceID, look.ImageStatus = fake.resource("usr-drama", "image", "image/png"), model.DramaMediaReady
	if err := fake.db.Save(&look).Error; err != nil {
		t.Fatal(err)
	}
	prop := createDramaMaterial(t, svc, source, "prop", "怀表")
	prop.ImageStatus = model.DramaMediaRunning
	if err := fake.db.Save(&prop).Error; err != nil {
		t.Fatal(err)
	}
	req := ImportDramaCastRequest{SourceProjectID: source, CastIDs: []string{base.ID, prop.ID}}
	got, err := svc.ImportDramaCast("usr-drama", target, req)
	if err != nil || got.Imported != 3 || got.Skipped != 0 {
		t.Fatalf("import graph: %+v %v", got, err)
	}
	bySource := map[string]model.DramaCast{}
	for _, cast := range got.Cast {
		bySource[cast.SourceCastID] = cast
		if cast.ProjectID != target || cast.SourceProjectID != source || cast.ID == cast.SourceCastID {
			t.Fatalf("bad lineage: %+v", cast)
		}
	}
	copied := bySource[base.ID]
	if copied.ImageResourceID != base.ImageResourceID || copied.ImageStylePrompt != base.ImageStylePrompt || copied.VoiceSampleResourceID != base.VoiceSampleResourceID || copied.VoiceProfileID == "" || !copied.Locked {
		t.Fatalf("base lost metadata: %+v", copied)
	}
	copiedLook := bySource[look.ID]
	if copiedLook.ParentID != copied.ID || copiedLook.LookFromChapter != 0 || copiedLook.LookToChapter != 0 || copiedLook.ImageResourceID != look.ImageResourceID {
		t.Fatalf("bad remapped look: %+v", copiedLook)
	}
	if bySource[prop.ID].ImageStatus != model.DramaMediaDraft {
		t.Fatal("source running state must not be copied")
	}
	for _, cast := range []model.DramaCast{copied, copiedLook} {
		takes, err := svc.repo.DramaTakes(target, cast.ID, "cast", 100)
		if err != nil || len(takes) != 1 || takes[0].ResourceID != cast.ImageResourceID || takes[0].TaskID != "" {
			t.Fatalf("import needs independent take: %+v %v", takes, err)
		}
	}
	name := "本季林逸"
	if _, err := svc.UpdateDramaCast("usr-drama", target, copied.ID, UpdateDramaCastRequest{Name: &name}); err != nil {
		t.Fatal(err)
	}
	second, err := svc.ImportDramaCast("usr-drama", target, req)
	if err != nil || second.Imported != 0 || second.Skipped != 3 {
		t.Fatalf("repeat import must be idempotent: %+v %v", second, err)
	}
	savedSource, _ := svc.repo.DramaCast(source, base.ID)
	savedTarget, _ := svc.repo.DramaCast(target, copied.ID)
	if savedSource.Name != "林逸" || savedTarget.Name != name {
		t.Fatal("edits or repeat import leaked across seasons")
	}
	jobs, _ := svc.repo.RecentDramaJobs(target, 100)
	if len(fake.requests) != 0 || len(jobs) != 0 {
		t.Fatal("import must not generate or reuse jobs")
	}
	refs, err := svc.repo.DramaResourceReferences("usr-drama", []string{base.ImageResourceID, look.ImageResourceID, base.VoiceSampleResourceID})
	if err != nil || len(refs) < 3 {
		t.Fatalf("shared media must stay referenced: %+v %v", refs, err)
	}
	if err := svc.DeleteDrama("usr-drama", source); err != nil {
		t.Fatal(err)
	}
	refs, err = svc.repo.DramaResourceReferences("usr-drama", []string{base.ImageResourceID, look.ImageResourceID, base.VoiceSampleResourceID})
	if err != nil {
		t.Fatal(err)
	}
	for _, resourceID := range []string{base.ImageResourceID, look.ImageResourceID, base.VoiceSampleResourceID} {
		found := false
		for _, ref := range refs {
			if ref.ResourceID == resourceID {
				found = true
			}
		}
		if !found {
			t.Fatalf("deleting source lost target media protection for %s", resourceID)
		}
		if _, err := svc.repo.ResourceForUser("usr-drama", resourceID); err != nil {
			t.Fatalf("deleting source removed shared media: %v", err)
		}
	}
}

func TestDramaCastImportReplacementAndAtomicConflicts(t *testing.T) {
	svc, fake := newDramaTestService(t)
	svc.coordinator = platform.NewCoordinatorWithRedis(nil, t.Name())
	source, target := newDramaMaterialProject(t, svc, "来源"), newDramaMaterialProject(t, svc, "目标")
	src := createDramaMaterial(t, svc, source, "scene", "办公室")
	src.ImageResourceID, src.ImageStatus = fake.resource("usr-drama", "image", "image/png"), model.DramaMediaReady
	if err := fake.db.Save(&src).Error; err != nil {
		t.Fatal(err)
	}
	dst := createDramaMaterial(t, svc, target, "scene", "办公室")
	dst.ImageResourceID, dst.ImageStatus = fake.resource("usr-drama", "image", "image/png"), model.DramaMediaReady
	if err := fake.db.Save(&dst).Error; err != nil {
		t.Fatal(err)
	}
	req := ImportDramaCastRequest{SourceProjectID: source, CastIDs: []string{src.ID}, MatchByName: true}
	got, err := svc.ImportDramaCast("usr-drama", target, req)
	if err != nil || got.Skipped != 1 || got.Cast[0].ImageResourceID != dst.ImageResourceID {
		t.Fatalf("default must keep image: %+v %v", got, err)
	}
	episode := model.DramaEpisode{ID: newID(), ProjectID: target, Number: 1, Stage: model.DramaEpisodeDone}
	if err := fake.db.Create(&episode).Error; err != nil {
		t.Fatal(err)
	}
	segment := model.DramaSegment{ID: newID(), ProjectID: target, EpisodeID: episode.ID, SegmentIndex: 0, PromptStatus: model.DramaMediaReady, VideoStatus: model.DramaMediaReady, VideoResourceID: "old-video", ReferenceCastIDsJSON: encodeStringList([]string{dst.ID})}
	if err := fake.db.Create(&segment).Error; err != nil {
		t.Fatal(err)
	}
	if err := fake.db.Create(&model.DramaShot{ID: newID(), ProjectID: target, EpisodeID: episode.ID, SegmentIndex: 0}).Error; err != nil {
		t.Fatal(err)
	}
	req.ReplaceExisting = true
	got, err = svc.ImportDramaCast("usr-drama", target, req)
	if err != nil || got.Imported != 1 || got.Cast[0].ID != dst.ID || got.Cast[0].ImageResourceID != src.ImageResourceID {
		t.Fatalf("explicit replacement: %+v %v", got, err)
	}
	takes, _ := svc.repo.DramaTakes(target, dst.ID, "cast", 100)
	if len(takes) != 2 || takes[0].ResourceID != src.ImageResourceID || takes[1].ResourceID != dst.ImageResourceID {
		t.Fatalf("old image lost: %+v", takes)
	}
	refs, err := svc.repo.DramaResourceReferences("usr-drama", []string{dst.ImageResourceID})
	if err != nil || len(refs) == 0 {
		t.Fatalf("old take no longer protects its resource: %+v %v", refs, err)
	}
	segments, _ := svc.repo.DramaSegments(episode.ID)
	if segments[0].VideoStatus != model.DramaMediaStale || segments[0].PromptStatus != model.DramaMediaStale {
		t.Fatalf("manual references must be invalidated: %+v", segments)
	}
	bad := createDramaMaterial(t, svc, source, "prop", "坏道具")
	bad.ImageResourceID, bad.ImageStatus = fake.resource("someone", "image", "image/png"), model.DramaMediaReady
	if err := fake.db.Save(&bad).Error; err != nil {
		t.Fatal(err)
	}
	fresh := createDramaMaterial(t, svc, source, "prop", "新道具")
	before, _ := svc.repo.DramaCasts(target)
	if _, err := svc.ImportDramaCast("usr-drama", target, ImportDramaCastRequest{SourceProjectID: source, CastIDs: []string{fresh.ID, bad.ID}}); err == nil {
		t.Fatal("foreign image accepted")
	}
	after, _ := svc.repo.DramaCasts(target)
	if len(before) != len(after) {
		t.Fatal("invalid batch left partial writes")
	}
	// 冲突发生在批内已有写入之后，整个事务也必须回滚。
	if err := fake.db.Model(&model.DramaCast{}).Where("id = ?", dst.ID).Update("image_status", model.DramaMediaRunning).Error; err != nil {
		t.Fatal(err)
	}
	_, err = svc.ImportDramaCast("usr-drama", target, ImportDramaCastRequest{SourceProjectID: source, CastIDs: []string{fresh.ID, src.ID}, ReplaceExisting: true})
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Status != 409 {
		t.Fatalf("busy target must conflict: %v", err)
	}
	after, _ = svc.repo.DramaCasts(target)
	if len(before) != len(after) {
		t.Fatal("conflict left partial writes")
	}
	if _, err := svc.ImportDramaCast("someone", target, req); err == nil {
		t.Fatal("target owner check missing")
	}
	if _, err := svc.ImportDramaCast("usr-drama", source, req); err == nil {
		t.Fatal("self-import accepted")
	}
}

func TestDramaCastImportBibleMergePreservesManualDrafts(t *testing.T) {
	svc, fake := newDramaTestService(t)
	svc.coordinator = platform.NewCoordinatorWithRedis(nil, t.Name())
	source, target := newDramaMaterialProject(t, svc, "旧季"), newDramaMaterialProject(t, svc, "新季")
	base := createDramaMaterial(t, svc, source, "character", "林逸")
	base.ImageResourceID, base.ImageStatus = fake.resource("usr-drama", "image", "image/png"), model.DramaMediaReady
	if err := fake.db.Save(&base).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AddDramaCastLook("usr-drama", source, base.ID, DramaCastLookRequest{LookName: "夜行", Appearance: "保留旧季外套"}); err != nil {
		t.Fatal(err)
	}
	imported, err := svc.ImportDramaCast("usr-drama", target, ImportDramaCastRequest{SourceProjectID: source, CastIDs: []string{base.ID}})
	if err != nil {
		t.Fatal(err)
	}
	manual := createDramaMaterial(t, svc, target, "character", "手动角色")
	project, row, err := svc.dramaForUser("usr-drama", target)
	if err != nil {
		t.Fatal(err)
	}
	run := &dramaRun{s: svc, project: project, production: row, settings: parseDramaSettings(row.SettingsJSON), active: map[string]bool{}}
	text := `{"characters":[{"name":"林逸","appearance":"不得覆盖导入外观","looks":[{"name":"夜行","appearance":"不得覆盖导入造型"},{"name":"本季正装","appearance":"灰色西服"}]},{"name":"手动角色","appearance":"不得覆盖手动外观"},{"name":"本季新角色","appearance":"短发","looks":[{"name":"工作服","appearance":"蓝色制服"}]}],"props":[{"name":"本季道具","appearance":"铜钥匙"}],"scenes":[{"name":"本季地点","appearance":"车站"}]}`
	body, _ := json.Marshal(map[string]string{"text": text})
	for i := 0; i < 2; i++ {
		if err := run.applyBible(&model.Task{ResultJSON: string(body)}); err != nil {
			t.Fatal(err)
		}
	}
	casts, _ := svc.repo.DramaCasts(target)
	if len(casts) != 8 {
		t.Fatalf("Bible must merge missing casts and looks exactly once: %+v", casts)
	}
	for _, cast := range casts {
		if strings.Contains(cast.Appearance, "不得覆盖") {
			t.Fatalf("Bible overwrote existing material: %+v", cast)
		}
	}
	for _, old := range imported.Cast {
		now, err := svc.repo.DramaCast(target, old.ID)
		if err != nil || now.Appearance != old.Appearance || now.ImageResourceID != old.ImageResourceID || now.SourceCastID != old.SourceCastID || now.ParentID != old.ParentID {
			t.Fatalf("imported graph changed: %+v %v", now, err)
		}
	}
	episode := model.DramaEpisode{ID: newID(), ProjectID: target, Number: 1, Stage: model.DramaEpisodeScript, Revision: 1}
	if err := fake.db.Create(&episode).Error; err != nil {
		t.Fatal(err)
	}
	shots := []production.ScriptShot{{Characters: []string{"林逸", "手动角色"}, Looks: production.LookChoices{"林逸": "本季正装"}, Scene: "本季地点", Props: []string{"本季道具"}, Action: "走进车站"}}
	if err := run.applyScriptShots(&episode, shots, nil, production.ScriptEpisode{}, false); err != nil {
		t.Fatal(err)
	}
	saved, _ := svc.repo.DramaShots(episode.ID)
	if len(saved) != 1 || !strings.Contains(saved[0].CastIDsJSON, manual.ID) || !strings.Contains(saved[0].CastIDsJSON, imported.Cast[0].ID) || saved[0].LookCastIDsJSON == "[]" {
		t.Fatalf("script must resolve imported and manual identities: %+v", saved)
	}
	manualNow, _ := svc.repo.DramaCast(target, manual.ID)
	if manualNow.ImageStatus != model.DramaMediaDraft || manualNow.Appearance != manual.Appearance {
		t.Fatal("script altered manual draft")
	}
	run.production.AssetsReleased = true
	if err := run.loadCasts(); err != nil {
		t.Fatal(err)
	}
	if err := run.plan(); err != nil {
		t.Fatal(err)
	}
	for _, job := range run.newJobs {
		if job.CastID == manual.ID || job.CastID == imported.Cast[0].ID {
			t.Fatalf("automatic scheduling requested manual/imported image: %+v", job)
		}
	}
}

func TestDramaCastImportLookLimitRollsBack(t *testing.T) {
	svc, _ := newDramaTestService(t)
	svc.coordinator = platform.NewCoordinatorWithRedis(nil, t.Name())
	source, target := newDramaMaterialProject(t, svc, "造型来源"), newDramaMaterialProject(t, svc, "满额角色")
	src, dst := createDramaMaterial(t, svc, source, "character", "林逸"), createDramaMaterial(t, svc, target, "character", "林逸")
	if _, err := svc.AddDramaCastLook("usr-drama", source, src.ID, DramaCastLookRequest{LookName: "额外造型", Appearance: "西装"}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < production.MaxCharacterLooks; i++ {
		if _, err := svc.AddDramaCastLook("usr-drama", target, dst.ID, DramaCastLookRequest{LookName: fmt.Sprintf("本季造型%d", i), Appearance: "白衣"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.ImportDramaCast("usr-drama", target, ImportDramaCastRequest{SourceProjectID: source, CastIDs: []string{src.ID}, MatchByName: true}); err == nil {
		t.Fatal("import exceeded per-character look limit")
	}
	after, _ := svc.repo.DramaCast(target, dst.ID)
	if after.SourceCastID != "" || after.Revision != dst.Revision {
		t.Fatal("look limit failure did not roll back base association")
	}
}

func TestDramaCastImportAmbiguousNamesAndVoiceValidation(t *testing.T) {
	svc, fake := newDramaTestService(t)
	svc.coordinator = platform.NewCoordinatorWithRedis(nil, t.Name())
	source, target := newDramaMaterialProject(t, svc, "来源声音"), newDramaMaterialProject(t, svc, "目标声音")
	src := createDramaMaterial(t, svc, source, "character", "同名")
	createDramaMaterial(t, svc, target, "character", "同名")
	createDramaMaterial(t, svc, target, "character", "同名")
	req := ImportDramaCastRequest{SourceProjectID: source, CastIDs: []string{src.ID}, MatchByName: true}
	if _, err := svc.ImportDramaCast("usr-drama", target, req); err == nil {
		t.Fatal("ambiguous same-kind name must not be selected")
	}
	req.MatchByName = false
	src.VoiceSampleResourceID = fake.resource("someone", "audio", "audio/wav")
	if err := fake.db.Save(&src).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ImportDramaCast("usr-drama", target, req); err == nil {
		t.Fatal("foreign voice accepted")
	}
	src.VoiceSampleResourceID = fake.resource("usr-drama", "image", "image/png")
	if err := fake.db.Save(&src).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ImportDramaCast("usr-drama", target, req); err == nil {
		t.Fatal("non-audio sample accepted")
	}
	src.VoiceSampleResourceID, src.VoiceProfileID = "", "missing-voice"
	if err := fake.db.Save(&src).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ImportDramaCast("usr-drama", target, req); err == nil {
		t.Fatal("missing profile accepted")
	}
}
