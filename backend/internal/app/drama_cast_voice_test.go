package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
)

// 角色指定声音样本后，支持参考音频的视频模型在该角色开口的剧情段里带上这段样本。
func TestDramaCastVoiceTravelsWithSpeakingSegments(t *testing.T) {
	svc, fake := newDramaTestService(t)
	video := dramaVideoFixture()
	video.References.MaxAudios, video.References.MaxAudioDuration = 3, 15
	setDramaVideoCapability(t, svc, fake, video)
	settings := DramaSettings{ReviewMode: DramaReviewAuto, MediaMode: DramaMediaManual, Concurrency: 16, Models: fakeDramaModels, VideoContinuity: DramaContinuityParallel, EpisodeMode: DramaEpisodeModeChapter, ChaptersPerEpisode: 1}
	settings.EpisodeSeconds = 60
	settings.Storyboard.SegmentMode, settings.Storyboard.SegmentSeconds = production.SegmentFixed, 5
	summary, err := svc.CreateDrama("usr-drama", CreateDramaRequest{Name: "声音", Start: true, Settings: settings, Chapters: []DramaChapterInput{{Title: "第一章 退婚", Text: "纳兰嫣然……"}}})
	if err != nil {
		t.Fatal(err)
	}
	project := summary.Project.ID
	runDramaTicks(t, svc, project, 20)
	casts, err := svc.repo.DramaCasts(project)
	if err != nil {
		t.Fatal(err)
	}
	var heroine, scene model.DramaCast
	for _, cast := range casts {
		if cast.Name == "纳兰嫣然" {
			heroine = cast
		}
		if cast.Kind == "scene" && scene.ID == "" {
			scene = cast
		}
	}
	if heroine.ID == "" || scene.ID == "" {
		t.Fatalf("fixture casts missing: %+v", casts)
	}

	profiles, err := svc.ListVoiceProfiles("usr-drama")
	if err != nil || len(profiles) == 0 {
		t.Fatalf("voice library: %v %v", profiles, err)
	}
	if _, err := svc.SetDramaCastVoice("usr-drama", project, heroine.ID, SetDramaCastVoiceRequest{VoiceProfileID: profiles[0].ID}, false); err == nil || !strings.Contains(err.Error(), "没有样本音频") {
		t.Fatalf("voices without a sample cannot drive the video model: %v", err)
	}
	sample := fake.resource("usr-drama", "audio", "audio/wav")
	if _, err := svc.SetDramaCastVoice("usr-drama", project, scene.ID, SetDramaCastVoiceRequest{SampleResourceID: sample}, false); err == nil {
		t.Fatal("only characters have voices")
	}
	if _, err := svc.SetDramaCastVoice("someone", project, heroine.ID, SetDramaCastVoiceRequest{SampleResourceID: sample}, false); err == nil {
		t.Fatal("voice binding must check ownership")
	}
	result, err := svc.SetDramaCastVoice("usr-drama", project, heroine.ID, SetDramaCastVoiceRequest{SampleResourceID: sample, VoiceName: "嫣然原声"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if cast := result["cast"].(*model.DramaCast); cast.VoiceSampleResourceID != sample || cast.VoiceProfileID == "" {
		t.Fatalf("voice not stored: %+v", cast)
	}

	detail, err := svc.DramaEpisodeDetail("usr-drama", project, summary.Episodes[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	// 参考图还没生成：上游要求参考音频与参考图一起发送，预演里说明原因。
	pending := detail.Segments[0].Request
	if len(pending.AudioReferences) != 1 || pending.AudioReferences[0].Sent || !strings.Contains(pending.AudioReferences[0].Note, "参考图") {
		t.Fatalf("voice waits for reference images: %+v", pending.AudioReferences)
	}
	if len(detail.Segments[1].Request.AudioReferences) != 0 {
		t.Fatalf("segments without dialogue carry no voice: %+v", detail.Segments[1].Request.AudioReferences)
	}

	if _, err := svc.ReleaseDramaMedia("usr-drama", project, ReleaseDramaMediaRequest{Target: "all"}); err != nil {
		t.Fatal(err)
	}
	runDramaTicks(t, svc, project, 24)
	detail, err = svc.DramaEpisodeDetail("usr-drama", project, summary.Episodes[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	first := detail.Segments[0].Request
	if len(first.AudioReferences) != 1 || !first.AudioReferences[0].Sent || first.AudioReferences[0].Label != "参考音频1" || !strings.Contains(first.Header, "参考音频1：纳兰嫣然的声音") {
		t.Fatalf("speaking segment must carry the voice sample: %+v %q", first.AudioReferences, first.Header)
	}
	withAudio := 0
	for _, req := range dramaVideoRequests(fake) {
		raw, _ := json.Marshal(req.Input["referenceAudios"])
		if strings.Contains(string(raw), "resource:"+sample) {
			withAudio++
		}
	}
	if withAudio != 1 {
		t.Fatalf("exactly the speaking segment sends the voice sample, got %d of %d", withAudio, len(dramaVideoRequests(fake)))
	}

	cleared, err := svc.SetDramaCastVoice("usr-drama", project, heroine.ID, SetDramaCastVoiceRequest{}, true)
	if err != nil {
		t.Fatal(err)
	}
	if cast := cleared["cast"].(*model.DramaCast); cast.VoiceSampleResourceID != "" || cast.VoiceProfileID != "" {
		t.Fatalf("voice not cleared: %+v", cast)
	}
}

// 尾帧续接的段以首帧生成，不混用参考音频；不支持参考音频的模型说明原因。
func TestDramaCastVoiceSkippedWithReason(t *testing.T) {
	speakers := []model.DramaShot{{Speaker: "炎儿", Dialogue: "三十年河东"}, {Speaker: "旁白", Dialogue: "多年以后"}}
	casts := map[string]model.DramaCast{
		"hero": {ID: "hero", Kind: "character", Name: "萧炎", AliasesJSON: `["炎儿"]`, VoiceSampleResourceID: "voice"},
		"look": {ID: "look", Kind: "character", Name: "萧炎", ParentID: "hero", LookName: "斗帝"},
	}
	voiced := dramaSegmentVoicedSpeakers(speakers, casts)
	if len(voiced) != 1 || voiced[0].ID != "hero" {
		t.Fatalf("aliases resolve to the base character, narrator ignored: %+v", voiced)
	}
	svc := &Service{}
	request := DramaSegmentRequest{Operation: "image_to_video"}
	media, err := svc.dramaSegmentAudioReferences(&request, dramaVideoProfile{MaxAudios: 3}, speakers, casts, true, "")
	if err != nil || len(media) != 0 || len(request.AudioReferences) != 1 || request.AudioReferences[0].Sent || !strings.Contains(request.AudioReferences[0].Note, "尾帧") {
		t.Fatalf("tail-frame segments skip audio with a reason: %+v %v", request.AudioReferences, err)
	}
	request = DramaSegmentRequest{Operation: "reference_to_video"}
	if _, err := svc.dramaSegmentAudioReferences(&request, dramaVideoProfile{}, speakers, casts, true, ""); err != nil || !strings.Contains(request.AudioReferences[0].Note, "不支持参考音频") {
		t.Fatalf("models without audio references explain why: %+v %v", request.AudioReferences, err)
	}
}
