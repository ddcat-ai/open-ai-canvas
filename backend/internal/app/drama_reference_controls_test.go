package app

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
	"yingce/backend/internal/repository"
)

func TestDramaReferenceReorderPreservesManualPromptAssetIdentity(t *testing.T) {
	svc, fake := newDramaTestService(t)
	summary := createTestDrama(t, svc, DramaReviewSample)
	project := summary.Project.ID
	runDramaTicks(t, svc, project, 24)
	summary, err := svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatal(err)
	}
	episode := summary.Episodes[0].ID
	first, second := fake.resource("usr-drama", "image", "image/png"), fake.resource("usr-drama", "image", "image/png")
	images := []model.DramaReferenceImage{{ResourceID: first, Name: "同名.png"}, {ResourceID: second, Name: "同名.png"}}
	empty := []string{}
	prompt := "参考图1拿起纸条，参考图2保持原位。"
	if err := svc.UpdateDramaSegment("usr-drama", project, episode, 0, UpdateDramaSegmentRequest{ReferenceCastIDs: &empty, ReferenceImages: &images, VideoPromptOverride: &prompt}); err != nil {
		t.Fatal(err)
	}
	rows, err := svc.repo.DramaSegments(episode)
	if err != nil {
		t.Fatal(err)
	}
	before := rows[0]
	reordered := []model.DramaReferenceImage{images[1], images[0]}
	if err := svc.UpdateDramaSegment("usr-drama", project, episode, 0, UpdateDramaSegmentRequest{ReferenceImages: &reordered}); err != nil {
		t.Fatal(err)
	}
	rows, err = svc.repo.DramaSegments(episode)
	if err != nil {
		t.Fatal(err)
	}
	after := rows[0]
	if after.VideoPromptOverride != "参考图2拿起纸条，参考图1保持原位。" || after.Revision != before.Revision+1 {
		t.Fatalf("one atomic edit must retain image identities: before=%+v after=%+v", before, after)
	}
	if err := svc.repo.SaveDramaSegmentEdits(before, map[string]any{"video_prompt_override": "过期写入"}); !errors.Is(err, repository.ErrDramaSegmentEditConflict) {
		t.Fatalf("stale remap must not overwrite a newer selection: %v", err)
	}
	removed := []model.DramaReferenceImage{images[0]}
	if err := svc.UpdateDramaSegment("usr-drama", project, episode, 0, UpdateDramaSegmentRequest{ReferenceImages: &removed}); err == nil || !strings.Contains(err.Error(), "请先修改正文") {
		t.Fatalf("removing an asset used by a manual prompt must be rejected: %v", err)
	}
	rows, err = svc.repo.DramaSegments(episode)
	if err != nil || rows[0].Revision != after.Revision || rows[0].ReferenceImagesJSON != after.ReferenceImagesJSON || rows[0].VideoPromptOverride != after.VideoPromptOverride {
		t.Fatalf("failed removal must leave references and prompt unchanged: %+v %v", rows, err)
	}
	corrected := "参考图1拿起纸条。"
	if err := svc.UpdateDramaSegment("usr-drama", project, episode, 0, UpdateDramaSegmentRequest{ReferenceImages: &removed, VideoPromptOverride: &corrected}); err != nil {
		t.Fatal(err)
	}
	rows, err = svc.repo.DramaSegments(episode)
	if err != nil || rows[0].VideoPromptOverride != corrected {
		t.Fatalf("explicit replacement prompt uses the new reference selection: %+v %v", rows, err)
	}
}

func TestDramaReferenceRemapUsesCastIDsAndRejectsUnknownTokens(t *testing.T) {
	before := []DramaSegmentReference{{CastID: "hero", Label: "参考图1", Name: "同名"}, {CastID: "room", Label: "参考图2", Name: "同名"}}
	after := []DramaSegmentReference{{CastID: "room", Label: "参考图1", Name: "同名"}, {CastID: "hero", Label: "参考图2", Name: "同名"}}
	got, err := remapDramaSegmentPromptReferences("@参考图1进入参考图 2。", before, after)
	if err != nil || got != "参考图2进入参考图1。" {
		t.Fatalf("same names must be resolved by cast ID: %q %v", got, err)
	}
	if _, err := remapDramaSegmentPromptReferences("参考图3进入。", before, after); err == nil {
		t.Fatal("unknown references cannot become silently bound to newly added assets")
	}
}

func TestDramaSegmentReferenceControls(t *testing.T) {
	svc, fake := newDramaTestService(t)
	video := dramaVideoFixture()
	video.References.MaxAudios, video.References.MaxAudioDuration = 1, 15
	setDramaVideoCapability(t, svc, fake, video)
	summary := createTestDrama(t, svc, DramaReviewSample)
	project := summary.Project.ID
	runDramaTicks(t, svc, project, 24)
	summary, err := svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatal(err)
	}
	episode := summary.Episodes[0].ID
	casts, err := svc.repo.DramaCasts(project)
	if err != nil {
		t.Fatal(err)
	}
	characters := []string{}
	for _, cast := range casts {
		if cast.Kind == "character" && cast.ParentID == "" {
			sample := fake.resource("usr-drama", "audio", "audio/wav")
			if _, err := svc.SetDramaCastVoice("usr-drama", project, cast.ID, SetDramaCastVoiceRequest{SampleResourceID: sample}, false); err != nil {
				t.Fatal(err)
			}
			characters = append(characters, cast.ID)
		}
	}
	if len(characters) < 2 {
		t.Fatal("fixture requires two characters")
	}
	imageID := fake.resource("usr-drama", "image", "image/png")
	images := []model.DramaReferenceImage{{ResourceID: imageID, Name: "夜景参考"}}
	empty := []string{}
	selected := characters[:1]
	patch := UpdateDramaSegmentRequest{ReferenceCastIDs: &empty, ReferenceImages: &images, AudioCastIDs: &selected}
	if err := svc.UpdateDramaSegment("someone", project, episode, 0, patch); err == nil {
		t.Fatal("must check project ownership")
	}
	if err := svc.UpdateDramaSegment("usr-drama", project, episode, 0, patch); err != nil {
		t.Fatal(err)
	}
	detail, err := svc.DramaEpisodeDetail("usr-drama", project, episode)
	if err != nil {
		t.Fatal(err)
	}
	segment := detail.Segments[0]
	if segment.AudioReferenceMode != "custom" || len(segment.Request.AudioReferences) != 1 || segment.Request.AudioReferences[0].CastID != selected[0] {
		t.Fatalf("manual audio selection was not persisted: %+v", segment)
	}
	if len(segment.Request.References) != 1 || segment.Request.References[0].ResourceID != imageID || !segment.Request.References[0].Sent || segment.Request.References[0].Label != "参考图1" {
		t.Fatalf("custom image must be numbered and sent: %+v", segment.Request)
	}
	rows, err := svc.repo.DramaSegments(episode)
	if err != nil {
		t.Fatal(err)
	}
	castByID := map[string]model.DramaCast{}
	for _, cast := range casts {
		castByID[cast.ID] = cast
	}
	drafts := buildDramaSegmentDrafts(DramaSettings{}, dramaBibleMeta{}, detail.Shots, castByID, rows)
	if !strings.Contains(production.SegmentVideoPrompt(drafts[0].input), "夜景参考（参考图1）") {
		t.Fatal("prompt writer must receive custom reference numbering")
	}
	refs, err := svc.repo.DramaResourceReferences("usr-drama", []string{imageID})
	if err != nil || len(refs) != 1 {
		t.Fatalf("custom image must be protected from deletion: %+v %v", refs, err)
	}
	if err := svc.UpdateDramaSegment("usr-drama", project, episode, 0, UpdateDramaSegmentRequest{AudioCastIDs: &characters}); err == nil || !strings.Contains(err.Error(), "最多支持 1") {
		t.Fatalf("audio capacity must be enforced: %v", err)
	}
	otherImage := fake.resource("someone", "image", "image/png")
	invalid := []model.DramaReferenceImage{{ResourceID: otherImage, Name: "越权图片"}}
	if err := svc.UpdateDramaSegment("usr-drama", project, episode, 0, UpdateDramaSegmentRequest{ReferenceImages: &invalid}); err == nil {
		t.Fatal("must reject another user's resource")
	}
	invalid = []model.DramaReferenceImage{{ResourceID: fake.resource("usr-drama", "audio", "audio/wav")}}
	if err := svc.UpdateDramaSegment("usr-drama", project, episode, 0, UpdateDramaSegmentRequest{ReferenceImages: &invalid}); err == nil {
		t.Fatal("must reject non-image resources")
	}
	if err := svc.UpdateDramaSegment("usr-drama", project, episode, 0, UpdateDramaSegmentRequest{AudioCastIDs: &empty}); err != nil {
		t.Fatal(err)
	}
	detail, err = svc.DramaEpisodeDetail("usr-drama", project, episode)
	if err != nil || len(detail.Segments[0].Request.AudioReferences) != 0 {
		t.Fatalf("manual empty selection must disable all voices: %v", err)
	}
	if err := svc.UpdateDramaSegment("usr-drama", project, episode, 0, UpdateDramaSegmentRequest{AutoAudioReferences: true}); err != nil {
		t.Fatal(err)
	}
	detail, err = svc.DramaEpisodeDetail("usr-drama", project, episode)
	if err != nil || detail.Segments[0].AudioReferenceMode != "auto" || len(detail.Segments[0].Request.AudioReferences) != 1 {
		t.Fatalf("auto mode must restore the speaking character: %+v %v", detail, err)
	}
	images = []model.DramaReferenceImage{}
	if err := svc.UpdateDramaSegment("usr-drama", project, episode, 0, UpdateDramaSegmentRequest{ReferenceImages: &images}); err != nil {
		t.Fatal(err)
	}
	refs, err = svc.repo.DramaResourceReferences("usr-drama", []string{imageID})
	if err != nil || len(refs) != 0 {
		t.Fatalf("removing reference must release deletion protection: %+v %v", refs, err)
	}
	if _, err := svc.repo.ResourceForUser("usr-drama", imageID); err != nil {
		t.Fatal("removing a reference must preserve the original resource")
	}
}

func TestDramaManualAudioSubmission(t *testing.T) {
	svc, fake := newDramaTestService(t)
	sample := fake.resource("usr-drama", "audio", "audio/wav")
	casts := map[string]model.DramaCast{"hero": {ID: "hero", Kind: "character", Name: "主角", VoiceSampleResourceID: sample}}
	request := DramaSegmentRequest{Operation: "reference_to_video"}
	media, err := svc.dramaSegmentAudioReferences(&request, dramaVideoProfile{MaxAudios: 1}, nil, casts, true, `["hero"]`)
	if err != nil || len(media) != 1 || !request.AudioReferences[0].Sent {
		t.Fatalf("manual voices can include non-speakers: %+v %v", request, err)
	}
	raw, _ := json.Marshal(media)
	if !strings.Contains(string(raw), "resource:"+sample) {
		t.Fatal("selected sample must reach provider input")
	}
	request = DramaSegmentRequest{Operation: "reference_to_video"}
	media, err = svc.dramaSegmentAudioReferences(&request, dramaVideoProfile{MaxAudios: 1}, []model.DramaShot{{Speaker: "主角", Dialogue: "你好"}}, casts, true, `[]`)
	if err != nil || len(media) != 0 {
		t.Fatalf("manual off must override dialogue: %+v %v", media, err)
	}
}
