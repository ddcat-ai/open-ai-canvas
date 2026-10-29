package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
)

// fakeDramaModels uses a persisted capability contract; only upstream execution is replaced.
var fakeDramaModels = DramaModels{
	Text:  DramaModelChoice{ChannelID: "ch", ModelKey: "text"},
	Image: DramaModelChoice{ChannelID: "ch", ModelKey: "image"},
	Video: DramaModelChoice{ChannelID: "ch", ModelKey: "video"},
}

type fakeDramaBackend struct {
	t        *testing.T
	db       *gorm.DB
	seq      atomic.Int64
	byKind   map[string]int
	renders  []renderProject
	requests []CreateTaskRequest
	fail     func(req CreateTaskRequest) bool
}

func (f *fakeDramaBackend) resource(userID, kind, mime string) string {
	return f.resourceSized(userID, kind, mime, 1080, 1920)
}

func (f *fakeDramaBackend) resourceSized(userID, kind, mime string, width, height int) string {
	id := fmt.Sprintf("res-%d", f.seq.Add(1))
	if err := f.db.Create(&model.Resource{ID: id, UserID: userID, Kind: kind, Status: model.ResourceStatusReady, MimeType: mime, Size: 10, Width: width, Height: height, CreatedAt: time.Now()}).Error; err != nil {
		f.t.Fatalf("seed resource: %v", err)
	}
	return id
}

// submit 立即生成一条已成功的任务，并按任务类型给出与真实执行器同构的结果。
func (f *fakeDramaBackend) submit(userID string, req CreateTaskRequest, timeline *renderProject) (*model.Task, error) {
	if f.fail != nil && f.fail(req) {
		return nil, fmt.Errorf("上游拒绝")
	}
	task := &model.Task{ID: fmt.Sprintf("tsk-%d", f.seq.Add(1)), UserID: userID, Type: req.Type, Status: model.TaskStatusSucceeded, Prompt: req.Prompt}
	f.requests = append(f.requests, req)
	var result any
	switch req.Type {
	case "canvas_text":
		system := ""
		if config, ok := req.Input["config"].(map[string]any); ok {
			system, _ = config["systemPrompt"].(string)
		}
		switch {
		case strings.Contains(system, "作品圣经"):
			f.byKind["bible"]++
			result = map[string]any{"mode": "text", "text": `{"logline":"退婚少年逆袭","visualRules":"冷色调","characters":[{"name":"萧炎","aliases":["炎儿"],"appearance":"黑发少年"},{"name":"纳兰嫣然","appearance":"白衣少女"}],"props":[{"name":"退婚书","appearance":"烫金红纸卷轴"}],"scenes":[{"name":"萧家大厅","appearance":"古朴大厅"}]}`}
		case strings.Contains(system, "整段视频提示词"):
			f.byKind["segment_prompt"]++
			result = map[string]any{"mode": "text", "text": "```\n第1段视频《退婚·登门》——纳兰嫣然当众退婚\n3秒｜9:16｜写实电影感｜中文对白｜无字幕｜1个主镜头\n\n【视觉与首帧】\n萧家大厅，纳兰嫣然立于厅中央，面朝萧炎。\n\n【00.00—03.00秒｜镜头一：当众退婚】\n50mm近景。纳兰嫣然抬手：“我今日来，是要退婚。”\n```"}
		case strings.Contains(system, "分集"):
			f.byKind["plan"]++
			result = map[string]any{"mode": "text", "text": `{"episodes":[{"title":"退婚","chapters":[1,2],"synopsis":"纳兰嫣然登门退婚","hook":"登门","cliffhanger":"三年之约"},{"title":"药老","chapters":[3],"synopsis":"戒指里的老者现身"}]}`}
		default:
			f.byKind["script"]++
			result = map[string]any{"mode": "text", "text": "```json\n" + `{"shots":[{"scene":"萧家大厅","characters":["炎儿","纳兰嫣然"],"props":["退婚书"],"speaker":"纳兰嫣然","dialogue":"我今日来，是要退婚。","action":"她抬手","shotSize":"近景","imagePrompt":"白衣少女站在大厅中央","durationSeconds":3},{"scene":"后山","characters":["萧炎","药老"],"action":"少年握拳","imagePrompt":"少年在后山握紧拳头","durationSeconds":8}]}` + "\n```"}
		}
	case "canvas_image":
		f.byKind["image"]++
		// 按请求的画幅出图（与遵守尺寸参数的真实模型一致）；未声明尺寸时按竖图。
		width, height := 1080, 1920
		if config, ok := req.Input["config"].(map[string]any); ok {
			if ratio, ok := dramaRatioValue(stringValue(config["size"])); ok {
				width, height = int(1080*ratio), 1080
			}
		}
		result = map[string]any{"mode": "image", "images": []any{map[string]any{"resourceId": f.resourceSized(userID, "image", "image/png", width, height)}}}
	case "canvas_video":
		f.byKind["video"]++
		result = map[string]any{"mode": "video", "video": map[string]any{"resourceId": f.resource(userID, "video", "video/mp4")}}
	case model.TaskTypeTimelineRender:
		f.byKind["render"]++
		f.renders = append(f.renders, *timeline)
		result = timelineRenderResult{ResourceID: f.resource(userID, "video", "video/mp4"), DurationMs: timeline.DurationMs, SubtitleSRT: buildRenderSubtitleSRT(*timeline)}
	}
	raw, _ := json.Marshal(result)
	task.ResultJSON = string(raw)
	if err := f.db.Create(task).Error; err != nil {
		f.t.Fatalf("seed task: %v", err)
	}
	return task, nil
}

func newDramaTestService(t *testing.T) (*Service, *fakeDramaBackend) {
	t.Helper()
	svc, db := newTimelineTaskTestService(t)
	fake := &fakeDramaBackend{t: t, db: db, byKind: map[string]int{}}
	svc.dramaTaskHook = fake.submit
	svc.dramaTailFrameHook = func(userID, resourceID string) (string, error) {
		return fake.resource(userID, "image", "image/png"), nil
	}
	capability := &ModelCapabilityConfig{Version: 1, Video: &VideoCapabilityConfig{
		Duration:   VideoDurationConfig{Selection: "enum", Values: []int{5, 10}, Default: 5},
		Operations: []string{"text_to_video", "reference_to_video", "image_to_video"}, DefaultOperation: "image_to_video",
		References:    VideoReferenceConfig{PromptMaxChars: DefaultVideoPromptMaxChars, MaxImages: 6},
		GenerateAudio: VideoBooleanConfig{Supported: true, Default: true},
		Ratios:        []string{"9:16", "16:9"}, DefaultRatio: "9:16",
	}}
	raw, _ := json.Marshal(capability)
	if err := db.Create(&model.ChannelModel{ID: "drama-video", ChannelID: "ch", ModelKey: "video", Capability: "video", Protocol: model.ChannelInterfaceVolcengineArkVideo, Enabled: true, CapabilityConfigJSON: string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.dramaVideoProfile(fakeDramaModels.Video); err != nil {
		t.Fatalf("seed video contract: %v", err)
	}
	if err := db.Create(&model.User{ID: "usr-drama", Email: "drama@example.com", Username: "drama"}).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return svc, fake
}

func runDramaTicks(t *testing.T, svc *Service, projectID string, ticks int) {
	t.Helper()
	for i := 0; i < ticks; i++ {
		production, err := svc.repo.DramaProduction(projectID)
		if err != nil {
			t.Fatalf("load production: %v", err)
		}
		if err := svc.tickDrama(production); err != nil {
			t.Fatalf("tick %d: %v", i, err)
		}
	}
}

func createTestDrama(t *testing.T, svc *Service, review string) DramaSummary {
	return createTestDramaWithMedia(t, svc, review, DramaMediaAuto)
}

func createTestDramaWithMedia(t *testing.T, svc *Service, review string, media string) DramaSummary {
	t.Helper()
	settings := DramaSettings{ReviewMode: review, MediaMode: media, Concurrency: 16, Models: fakeDramaModels}
	settings.EpisodeSeconds = 60
	// 剧情段固定 5 秒：夹具剧本的两个镜头（3 秒、6 秒）各成一段，覆盖段间首帧衔接。
	settings.Storyboard.SegmentMode, settings.Storyboard.SegmentSeconds = production.SegmentFixed, 5
	summary, err := svc.CreateDrama("usr-drama", CreateDramaRequest{Name: "斗破", Start: true, Settings: settings, Chapters: []DramaChapterInput{
		{Title: "第一章 陨落的天才", Text: "萧炎……"}, {Title: "第二章 退婚", Text: "纳兰嫣然……"}, {Title: "第三章 药老", Text: "戒指……"},
	}})
	if err != nil {
		t.Fatalf("create drama: %v", err)
	}
	return summary
}

func TestDramaChapterGroupingCreatesEpisodesWithoutPlanning(t *testing.T) {
	svc, fake := newDramaTestService(t)
	settings := DramaSettings{ReviewMode: DramaReviewAuto, MediaMode: DramaMediaManual, Concurrency: 16, Models: fakeDramaModels, EpisodeMode: DramaEpisodeModeChapter, ChaptersPerEpisode: 2}
	summary, err := svc.CreateDrama("usr-drama", CreateDramaRequest{Name: "分组", Settings: settings, Chapters: []DramaChapterInput{{Title: "第一章", Text: "甲"}, {Title: "第二章", Text: "乙"}, {Title: "第三章", Text: "丙"}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(summary.Episodes) != 2 || !summary.Production.PlanDone {
		t.Fatalf("3 chapters at 2 per episode must give 2 episodes: %+v", summary.Episodes)
	}
	first, err := svc.repo.DramaEpisode(summary.Project.ID, summary.Episodes[0].ID)
	if err != nil || len(decodeStringList(first.ChapterIDsJSON)) != 2 {
		t.Fatalf("first episode must hold two chapters: %+v %v", first, err)
	}
	// 分集完成后不能再改分集方式。
	settings.ChaptersPerEpisode = 3
	if _, err := svc.UpdateDramaSettings("usr-drama", summary.Project.ID, UpdateDramaSettingsRequest{Settings: &settings}); err == nil {
		t.Fatal("grouping must be locked once planning is done")
	}
	if fake.byKind["plan"] != 0 {
		t.Fatalf("chapter grouping must not call the planner: %v", fake.byKind)
	}
}

func TestDramaPipelineRunsNovelToFinalCutWithSampleGate(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDrama(t, svc, DramaReviewSample).Project.ID
	runDramaTicks(t, svc, project, 24)
	summary, err := svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatal(err)
	}
	if len(summary.Episodes) != 2 || summary.Episodes[0].Stage != model.DramaEpisodeDone || summary.Episodes[1].Stage != model.DramaEpisodeReview {
		t.Fatalf("sample must finish before remaining episodes: %+v", summary.Episodes)
	}
	if fake.byKind["video"] != 2 {
		t.Fatalf("one video per sample segment: %v", fake.byKind)
	}
	if _, err := svc.ApproveDramaEpisode("someone", project, summary.Episodes[0].ID); err == nil {
		t.Fatal("ownership")
	}
	if _, err := svc.ApproveDramaEpisode("usr-drama", project, summary.Episodes[0].ID); err != nil {
		t.Fatal(err)
	}
	runDramaTicks(t, svc, project, 24)
	summary, err = svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Production.Status != model.DramaStatusCompleted || fake.byKind["video"] != 4 || fake.byKind["render"] != 2 {
		t.Fatalf("pipeline not finished: %+v %v", summary, fake.byKind)
	}
	for _, timeline := range fake.renders {
		if len(timeline.Clips) != 2 || len(timeline.Tracks) != 1 || timeline.Tracks[0].Muted {
			t.Fatalf("must concatenate segment videos with original audio: %+v", timeline)
		}
		for _, clip := range timeline.Clips {
			if clip.Kind != "video" || clip.Volume != 1 || clip.DirectMedia == nil {
				t.Fatalf("invalid clip: %+v", clip)
			}
		}
	}
	requests := []CreateTaskRequest{}
	for _, req := range fake.requests {
		if req.Type == "canvas_video" {
			requests = append(requests, req)
		}
	}
	if requests[0].Operation != "reference_to_video" || requests[1].Operation != "image_to_video" {
		t.Fatalf("operations: %s %s", requests[0].Operation, requests[1].Operation)
	}
	refs := requests[1].Input["referenceImages"].([]any)
	if len(refs) == 0 || refs[0].(map[string]any)["role"] != "first_frame" {
		t.Fatalf("tail must be an actual first-frame reference: %+v", refs)
	}
	if requests[1].Input["config"].(map[string]any)["videoGenerateAudio"] != "true" {
		t.Fatal("native dialogue must stay enabled")
	}
	casts, _ := svc.repo.DramaCasts(project)
	for _, cast := range casts {
		if cast.Name == "炎儿" {
			t.Fatal("cast aliases must resolve")
		}
	}
}

func TestDramaManualMediaWaitsForRelease(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDramaWithMedia(t, svc, DramaReviewAuto, "").Project.ID
	runDramaTicks(t, svc, project, 20)
	if fake.byKind["image"]+fake.byKind["video"] != 0 || fake.byKind["segment_prompt"] != 4 {
		t.Fatalf("manual mode should finish text only: %v", fake.byKind)
	}
	summary, err := svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatal(err)
	}
	for _, ep := range summary.Episodes {
		if !ep.AwaitingMedia {
			t.Fatalf("not waiting: %+v", ep)
		}
	}
	first := summary.Episodes[0].ID
	if _, err := svc.ReleaseDramaMedia("usr-drama", project, ReleaseDramaMediaRequest{Target: "episodes", EpisodeIDs: []string{first}}); err != nil {
		t.Fatal(err)
	}
	runDramaTicks(t, svc, project, 24)
	summary, _ = svc.DramaSummary("usr-drama", project)
	if summary.Episodes[0].Stage != "done" || !summary.Episodes[1].AwaitingMedia || fake.byKind["video"] != 2 {
		t.Fatalf("only released episode should run: %+v %v", summary.Episodes, fake.byKind)
	}
	if _, err := svc.ReleaseDramaMedia("usr-drama", project, ReleaseDramaMediaRequest{Target: "bogus"}); err == nil {
		t.Fatal("invalid target")
	}
}

func TestDramaEveryEpisodeRequiresPromptApproval(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDrama(t, svc, DramaReviewEvery).Project.ID
	runDramaTicks(t, svc, project, 20)
	summary, _ := svc.DramaSummary("usr-drama", project)
	if fake.byKind["video"] != 0 {
		t.Fatal("review must gate videos")
	}
	if _, err := svc.ApproveDramaEpisode("usr-drama", project, summary.Episodes[0].ID); err != nil {
		t.Fatal(err)
	}
	runDramaTicks(t, svc, project, 20)
	summary, _ = svc.DramaSummary("usr-drama", project)
	if summary.Episodes[0].Stage != "done" || summary.Episodes[1].Stage != "review" {
		t.Fatalf("approval is per episode: %+v", summary.Episodes)
	}
}

func TestDramaFailedSegmentSurfacesAndRetries(t *testing.T) {
	svc, fake := newDramaTestService(t)
	fake.fail = func(req CreateTaskRequest) bool { return req.Type == "canvas_video" }
	project := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	runDramaTicks(t, svc, project, 20)
	summary, err := svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatal(err)
	}
	failed := 0
	for _, item := range summary.Inbox {
		if item.Kind == "segment_failed" {
			failed++
		}
	}
	if failed != 2 || fake.byKind["render"] != 0 {
		t.Fatalf("failed video must block render, no black placeholder: %+v %v", summary.Inbox, fake.byKind)
	}
	fake.fail = nil
	if _, err := svc.RetryFailedDrama("usr-drama", project); err != nil {
		t.Fatal(err)
	}
	runDramaTicks(t, svc, project, 24)
	summary, _ = svc.DramaSummary("usr-drama", project)
	if summary.Production.Status != "completed" {
		t.Fatalf("retry did not finish: %+v", summary)
	}
}

func TestDramaTailFailureRetriesPaidOutputWithoutNewGeneration(t *testing.T) {
	svc, fake := newDramaTestService(t)
	svc.dramaTailFrameHook = func(string, string) (string, error) { return "", fmt.Errorf("tail failed") }
	project := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	runDramaTicks(t, svc, project, 20)
	if fake.byKind["video"] != 2 || fake.byKind["render"] != 0 {
		t.Fatalf("tail failure must block successor: %v", fake.byKind)
	}
	summary, _ := svc.DramaSummary("usr-drama", project)
	segs, _ := svc.repo.DramaSegments(summary.Episodes[0].ID)
	if segs[0].VideoResourceID == "" || segs[0].VideoStatus != "failed" {
		t.Fatalf("paid output must be retained: %+v", segs)
	}
	svc.dramaTailFrameHook = func(userID, id string) (string, error) { return fake.resource(userID, "image", "image/png"), nil }
	if _, err := svc.RetryFailedDrama("usr-drama", project); err != nil {
		t.Fatal(err)
	}
	runDramaTicks(t, svc, project, 24)
	if fake.byKind["video"] != 4 || fake.byKind["render"] != 2 {
		t.Fatalf("only successors should buy videos after retry: %v", fake.byKind)
	}
	var takes int64
	fake.db.Model(&model.DramaTake{}).Where("owner_id = ?", segs[0].ID).Count(&takes)
	if takes != 1 {
		t.Fatalf("same task should produce one history take: %d", takes)
	}
}

func TestDramaBudgetPausesDispatch(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	if err := svc.repo.UpdateDramaProduction(project, map[string]any{"budget_microcredits": 100, "spent_microcredits": 100}); err != nil {
		t.Fatal(err)
	}
	runDramaTicks(t, svc, project, 1)
	p, _ := svc.repo.DramaProduction(project)
	if p.Status != "paused" || p.PauseReason != dramaBudgetPauseReason || len(fake.requests) != 0 {
		t.Fatalf("budget: %+v", p)
	}
}

func TestDramaMissingVideoContractFails(t *testing.T) {
	svc, fake := newDramaTestService(t)
	if _, err := svc.dramaVideoProfile(DramaModelChoice{ChannelID: "missing", ModelKey: "missing"}); err == nil {
		t.Fatal("missing model must not synthesize duration/audio settings")
	}
	row, err := svc.repo.ChannelModelByKey("ch", "video")
	if err != nil {
		t.Fatal(err)
	}
	row.CapabilityConfigJSON = `{"version":1,"video":{"operations":["text_to_video","image_to_video"],"duration":{"selection":"select","values":[5],"default":5},"generateAudio":{"supported":false}}}`
	if err := fake.db.Save(row).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.dramaVideoProfile(fakeDramaModels.Video); err == nil {
		t.Fatal("silent video must be rejected")
	}
}
