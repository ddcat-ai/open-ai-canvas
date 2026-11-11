package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
)

func TestDramaTimelineUsesWholeSegmentAudioAndRejectsMissingMedia(t *testing.T) {
	segments := []model.DramaSegment{{ID: "a", VideoStatus: "ready", VideoResourceID: "video-a", VideoSeconds: 5}, {ID: "b", VideoStatus: "ready", VideoResourceID: "video-b", VideoSeconds: 10}}
	timeline, err := buildDramaTimeline(segments, "9:16", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(timeline.Clips) != 2 || timeline.DurationMs != 15000 || timeline.Clips[1].StartMs != 5000 || timeline.Tracks[0].Muted || timeline.Clips[0].Volume != 1 {
		t.Fatalf("timeline: %+v", timeline)
	}
	for _, status := range []string{"", "failed", "running", "stale"} {
		segments[1].VideoStatus = status
		if _, err := buildDramaTimeline(segments, "9:16", nil); err == nil {
			t.Fatalf("must reject %q", status)
		}
	}
}

func TestDramaTimelinePrefersActualSourceDurationOverPlannedSeconds(t *testing.T) {
	segments := []model.DramaSegment{
		{ID: "a", VideoStatus: "ready", VideoResourceID: "video-a", VideoSeconds: 10},
		{ID: "b", VideoStatus: "ready", VideoResourceID: "video-b", VideoSeconds: 10},
	}
	// 实测略长于/短于设定秒：成片应按文件时长拼接，而不是裁到 10s。
	actual := map[string]int64{"video-a": 10420, "video-b": 9580}
	timeline, err := buildDramaTimeline(segments, "9:16", actual)
	if err != nil {
		t.Fatal(err)
	}
	if timeline.DurationMs != 20000 || timeline.Clips[0].DurationMs != 10420 || timeline.Clips[1].DurationMs != 9580 || timeline.Clips[1].StartMs != 10420 {
		t.Fatalf("expected actual-duration stitch, got %+v", timeline)
	}
	if timeline.Clips[0].SourceDurationMs != 10420 || timeline.Clips[1].SourceDurationMs != 9580 {
		t.Fatalf("source duration must match clip duration: %+v", timeline.Clips)
	}
	// 缺探测时长时回退 video_seconds。
	partial := map[string]int64{"video-a": 10420}
	timeline, err = buildDramaTimeline(segments, "9:16", partial)
	if err != nil {
		t.Fatal(err)
	}
	if timeline.DurationMs != 20420 || timeline.Clips[1].DurationMs != 10000 {
		t.Fatalf("missing probe must fall back to planned seconds: %+v", timeline)
	}
}

func TestDramaSegmentEditInvalidatesDescendantsAndRejectsLateResult(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	runDramaTicks(t, svc, project, 24)
	summary, _ := svc.DramaSummary("usr-drama", project)
	episode := summary.Episodes[0].ID
	detail, err := svc.DramaEpisodeDetail("usr-drama", project, episode)
	if err != nil {
		t.Fatal(err)
	}
	segment := detail.Segments[0]
	rows, _ := svc.repo.DramaSegments(episode)
	old := rows[0]
	var takes int64
	fake.db.Model(&model.DramaTake{}).Where("owner_id = ? AND kind = ?", segment.ID, "video").Count(&takes)
	if takes != 1 {
		t.Fatalf("segment history: %d", takes)
	}
	custom := "用户精确修改的剧情段提示词"
	if err := svc.UpdateDramaSegment("usr-drama", project, episode, segment.Index, UpdateDramaSegmentRequest{VideoPromptOverride: &custom}); err != nil {
		t.Fatal(err)
	}
	rows, _ = svc.repo.DramaSegments(episode)
	if rows[0].Revision <= old.Revision || rows[0].VideoStatus != "stale" || rows[1].VideoStatus != "stale" {
		t.Fatalf("must invalidate own media and downstream tail consumers: %+v", rows)
	}
	payload, _ := json.Marshal(dramaRevisionPayload{Revision: old.Revision, Seconds: 5})
	task := &model.Task{ID: "late-video", ResultJSON: `{"mode":"video","video":{"resourceId":"late-output"}}`, Prompt: "old prompt"}
	run := &dramaRun{s: svc, project: &summary.Project}
	if err := run.applySegmentVideo(&model.DramaJob{ShotID: old.ID, PayloadJSON: string(payload)}, task); err != nil {
		t.Fatal(err)
	}
	rows, _ = svc.repo.DramaSegments(episode)
	if rows[0].VideoResourceID != old.VideoResourceID {
		t.Fatal("late result overwrote new intent")
	}
	before := fake.byKind["video"]
	runDramaTicks(t, svc, project, 4)
	if fake.byKind["video"] != before {
		t.Fatal("editing must not silently regenerate paid media")
	}
	updated, err := svc.DramaEpisodeDetail("usr-drama", project, episode)
	if err != nil {
		t.Fatal(err)
	}
	if !updated.Segments[0].Custom || updated.Segments[0].VideoPrompt != custom || !updated.Episode.FinalStale {
		t.Fatalf("override: %+v", updated)
	}
	if err := svc.UpdateDramaSegment("other", project, episode, 0, UpdateDramaSegmentRequest{VideoPromptOverride: &custom}); err == nil {
		t.Fatal("ownership")
	}
	if _, err := svc.GenerateDramaSegments("usr-drama", project, episode, GenerateDramaSegmentsRequest{Segments: []int{999}}); err == nil {
		t.Fatal("unknown segment")
	}
}

func TestParallelVideoEditDoesNotCascadeStaleLaterSegments(t *testing.T) {
	svc, _ := newDramaTestService(t)
	settings := DramaSettings{ReviewMode: DramaReviewAuto, MediaMode: DramaMediaAuto, Concurrency: 16, Models: fakeDramaModels, VideoContinuity: DramaContinuityParallel}
	settings.EpisodeSeconds = 60
	settings.Storyboard.SegmentMode, settings.Storyboard.SegmentSeconds = production.SegmentFixed, 5
	summary, err := svc.CreateDrama("usr-drama", CreateDramaRequest{Name: "并行编辑", Start: true, Settings: settings, Chapters: []DramaChapterInput{
		{Title: "第一章", Text: "甲……"}, {Title: "第二章", Text: "乙……"}, {Title: "第三章", Text: "丙……"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	project := summary.Project.ID
	runDramaTicks(t, svc, project, 24)
	summary, _ = svc.DramaSummary("usr-drama", project)
	episode := summary.Episodes[0].ID
	rows, err := svc.repo.DramaSegments(episode)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) < 2 || rows[0].VideoStatus != model.DramaMediaReady || rows[1].VideoStatus != model.DramaMediaReady {
		t.Fatalf("need two ready segments under parallel continuity: %+v", rows)
	}
	laterStatus, laterRevision := rows[1].VideoStatus, rows[1].Revision
	custom := "并行模式只改本段提示词"
	if err := svc.UpdateDramaSegment("usr-drama", project, episode, rows[0].SegmentIndex, UpdateDramaSegmentRequest{VideoPromptOverride: &custom}); err != nil {
		t.Fatal(err)
	}
	rows, err = svc.repo.DramaSegments(episode)
	if err != nil {
		t.Fatal(err)
	}
	if rows[0].VideoStatus != model.DramaMediaStale {
		t.Fatalf("edited segment must go stale: %+v", rows[0])
	}
	if rows[1].VideoStatus != laterStatus || rows[1].Revision != laterRevision {
		t.Fatalf("parallel continuity must not cascade-stale later segments: got %+v want status=%s revision=%d", rows[1], laterStatus, laterRevision)
	}
}

func TestParallelVideoRegenerateDoesNotCascadeStaleLaterSegments(t *testing.T) {
	svc, _ := newDramaTestService(t)
	settings := DramaSettings{ReviewMode: DramaReviewAuto, MediaMode: DramaMediaAuto, Concurrency: 16, Models: fakeDramaModels, VideoContinuity: DramaContinuityParallel}
	settings.EpisodeSeconds = 60
	settings.Storyboard.SegmentMode, settings.Storyboard.SegmentSeconds = production.SegmentFixed, 5
	summary, err := svc.CreateDrama("usr-drama", CreateDramaRequest{Name: "并行重生成", Start: true, Settings: settings, Chapters: []DramaChapterInput{
		{Title: "第一章", Text: "甲……"}, {Title: "第二章", Text: "乙……"}, {Title: "第三章", Text: "丙……"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	project := summary.Project.ID
	runDramaTicks(t, svc, project, 24)
	summary, _ = svc.DramaSummary("usr-drama", project)
	episode := summary.Episodes[0].ID
	rows, err := svc.repo.DramaSegments(episode)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) < 2 || rows[0].VideoStatus != model.DramaMediaReady || rows[1].VideoStatus != model.DramaMediaReady {
		t.Fatalf("need two ready segments under parallel continuity: %+v", rows)
	}
	laterStatus, laterRevision := rows[1].VideoStatus, rows[1].Revision
	if _, err := svc.GenerateDramaSegments("usr-drama", project, episode, GenerateDramaSegmentsRequest{Segments: []int{rows[0].SegmentIndex}}); err != nil {
		t.Fatal(err)
	}
	rows, err = svc.repo.DramaSegments(episode)
	if err != nil {
		t.Fatal(err)
	}
	if rows[0].VideoStatus != model.DramaMediaQueued {
		t.Fatalf("regenerated segment must be queued: %+v", rows[0])
	}
	if rows[1].VideoStatus != laterStatus || rows[1].Revision != laterRevision {
		t.Fatalf("parallel regenerate must not cascade-stale later segments: got %+v want status=%s revision=%d", rows[1], laterStatus, laterRevision)
	}
}

func TestDramaShotScriptEditAndPromptRewrite(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDramaWithMedia(t, svc, DramaReviewEvery, DramaMediaManual).Project.ID
	runDramaTicks(t, svc, project, 20)
	summary, _ := svc.DramaSummary("usr-drama", project)
	episode := summary.Episodes[0].ID
	detail, err := svc.DramaEpisodeDetail("usr-drama", project, episode)
	if err != nil {
		t.Fatal(err)
	}
	if detail.ScriptJob == nil || detail.Segments[0].PromptJob == nil || detail.Segments[0].Request.Seconds == 0 {
		t.Fatalf("missing request preview/jobs: %+v", detail)
	}
	camera := "缓慢推近"
	duration := 4.0
	if _, err := svc.UpdateDramaShot("usr-drama", project, detail.Shots[0].ID, UpdateDramaShotRequest{Camera: &camera, DurationSeconds: &duration}); err != nil {
		t.Fatal(err)
	}
	detail, err = svc.DramaEpisodeDetail("usr-drama", project, episode)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Segments[0].PromptStatus != "stale" || detail.Shots[0].Camera != camera {
		t.Fatalf("shot edit must invalidate prompt: %+v", detail)
	}
	if _, err := svc.ApproveDramaEpisode("usr-drama", project, episode); err == nil {
		t.Fatal("stale prompts cannot be approved")
	}
	if _, err := svc.RequestDramaSegmentPrompts("usr-drama", project, episode, GenerateDramaSegmentsRequest{Segments: []int{0}}); err != nil {
		t.Fatal(err)
	}
	runDramaTicks(t, svc, project, 4)
	detail, err = svc.DramaEpisodeDetail("usr-drama", project, episode)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Segments[0].PromptStatus != "ready" || fake.byKind["video"] != 0 {
		t.Fatalf("prompt rewrite must remain text-only: %+v", detail.Segments)
	}
	tooLong := 100.0
	if _, err := svc.UpdateDramaShot("usr-drama", project, detail.Shots[0].ID, UpdateDramaShotRequest{DurationSeconds: &tooLong}); err == nil {
		t.Fatal("duration limit")
	}
}

func TestDramaRequestPreviewEqualsSubmission(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDramaWithMedia(t, svc, DramaReviewAuto, DramaMediaManual).Project.ID
	runDramaTicks(t, svc, project, 20)
	summary, _ := svc.DramaSummary("usr-drama", project)
	episode := summary.Episodes[0].ID
	// Generate only reference images first, then inspect the same inputs that video submission will use.
	if _, err := svc.ReleaseDramaMedia("usr-drama", project, ReleaseDramaMediaRequest{Target: "assets"}); err != nil {
		t.Fatal(err)
	}
	runDramaTicks(t, svc, project, 5)
	detail, err := svc.DramaEpisodeDetail("usr-drama", project, episode)
	if err != nil {
		t.Fatal(err)
	}
	preview := detail.Segments[0]
	kinds := []string{}
	for _, ref := range preview.Request.References {
		kinds = append(kinds, ref.Kind+":"+ref.Name)
		if !ref.Sent || ref.ResourceID == "" {
			t.Fatalf("ready reference images must be sent: %+v", ref)
		}
	}
	if strings.Join(kinds, ",") != "character:萧炎,character:纳兰嫣然,prop:退婚书,scene:萧家大厅" {
		t.Fatalf("references must list characters, props, then scenes: %v", kinds)
	}
	if !strings.Contains(preview.Request.Header, "参考图3：退婚书") {
		t.Fatalf("prop reference must be named in the request header: %q", preview.Request.Header)
	}
	if _, err := svc.ReleaseDramaMedia("usr-drama", project, ReleaseDramaMediaRequest{Target: "episodes", EpisodeIDs: []string{episode}}); err != nil {
		t.Fatal(err)
	}
	runDramaTicks(t, svc, project, 12)
	var actual *CreateTaskRequest
	for i := range fake.requests {
		if fake.requests[i].Type == "canvas_video" {
			actual = &fake.requests[i]
			break
		}
	}
	if actual == nil {
		t.Fatal("video not submitted")
	}
	if actual.Operation != preview.Request.Operation || actual.Prompt != preview.Request.Header+"\n\n"+preview.VideoPrompt || actual.Input["config"].(map[string]any)["videoSeconds"] != itoa(preview.Request.Seconds) {
		t.Fatalf("preview mismatch: %+v %+v", preview, actual)
	}
}

func TestDramaLatePromptDoesNotOverwriteEditedShot(t *testing.T) {
	svc, _ := newDramaTestService(t)
	project := createTestDramaWithMedia(t, svc, DramaReviewAuto, DramaMediaManual).Project.ID
	runDramaTicks(t, svc, project, 20)
	summary, _ := svc.DramaSummary("usr-drama", project)
	episode := summary.Episodes[0].ID
	rows, _ := svc.repo.DramaSegments(episode)
	segment := rows[0]
	shots, _ := svc.repo.DramaShots(episode)
	dialogue := "新的台词"
	if _, err := svc.UpdateDramaShot("usr-drama", project, shots[0].ID, UpdateDramaShotRequest{Dialogue: &dialogue}); err != nil {
		t.Fatal(err)
	}
	text := "第1段视频提示词正文，旧的台词与场面信息。角色动作、机位、环境和声音都已经过时。继续写足长度以便通过基本内容检查。"
	result, _ := json.Marshal(map[string]any{"text": text})
	run := &dramaRun{s: svc, project: &summary.Project}
	payload, _ := json.Marshal(dramaRevisionPayload{Revision: segment.Revision, Seconds: 5})
	if err := run.applySegmentPrompt(&model.DramaJob{ShotID: segment.ID, PayloadJSON: string(payload)}, &model.Task{ID: "late", ResultJSON: string(result), CreatedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	rows, _ = svc.repo.DramaSegments(episode)
	if rows[0].VideoPrompt == text || rows[0].PromptStatus != "stale" {
		t.Fatalf("late prompt overwrote edited script: %+v", rows[0])
	}
}

func TestDramaSettingsRejectUnreadablePromptSkill(t *testing.T) {
	svc, _ := newDramaTestService(t)
	summary := createTestDrama(t, svc, DramaReviewAuto)
	settings := summary.Production.Settings
	settings.PromptSkill = &DramaSkillRef{SkillID: "missing-skill", SkillName: "不存在的技能"}
	if _, err := svc.UpdateDramaSettings("usr-drama", summary.Project.ID, UpdateDramaSettingsRequest{Settings: &settings}); err == nil || !strings.Contains(err.Error(), "不存在的技能") {
		t.Fatalf("an unreadable skill must be rejected with its name, got %v", err)
	}
	settings.PromptSkill = &DramaSkillRef{}
	if _, err := svc.UpdateDramaSettings("usr-drama", summary.Project.ID, UpdateDramaSettingsRequest{Settings: &settings}); err != nil {
		t.Fatalf("an empty skill ref clears the selection: %v", err)
	}
}
