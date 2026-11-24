package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestDramaVideoProviderContinuity(t *testing.T) {
	svc, fake := newDramaTestService(t)
	settings := DramaSettings{Models: fakeDramaModels}
	settings.AspectRatio = "16:9"
	actor := model.DramaCast{ID: "actor", Name: "人物", Kind: "character", ImageStatus: model.DramaMediaReady, ImageResourceID: fake.resource("usr-drama", "image", "image/png")}
	cast := map[string]model.DramaCast{actor.ID: actor}
	previous := &model.DramaSegment{VideoStatus: model.DramaMediaReady, TailFrameResourceID: fake.resource("usr-drama", "image", "image/png")}
	draft := dramaSegmentDraft{view: DramaSegmentView{DurationMs: 5000}}
	draft.view.Request.References = []DramaSegmentReference{{CastID: actor.ID, Name: actor.Name, Label: "参考图1"}}
	segment := model.DramaSegment{SegmentIndex: 1, VideoPrompt: "参考图1中的人物起身。"}
	for _, test := range []struct {
		provider, model, quality, tailRole, tailToken, actorToken string
	}{
		{"kling-v4-official", "kling-4.0-flash", "720p", "first_frame", "", "@Image2"},
		{"kling-v4-official", "kling-4.0", "720p", "first_frame", "", "@Image2"},
		{"dashscope-minimax-video", "MiniMax/MiniMax-H3", "768P", "reference_image", "参考图1作为", "参考图2中的"},
		{"dashscope-wan3-video", "wan3.0-video-prime", "720p", "reference_image", "参考图1作为", "参考图2中的"},
		{"volcengine-ark-seedance-25", "doubao-seedance-2-5-260628", "720p", "reference_image", "参考图1作为", "参考图2中的"},
	} {
		t.Run(test.model, func(t *testing.T) {
			video := dramaVideoFixture()
			video.GenerateAudio = VideoBooleanConfig{}
			video.Resolutions, video.DefaultResolution = []string{test.quality}, test.quality
			setDramaVideoCapability(t, svc, fake, video)
			if err := fake.db.Model(&model.ChannelModel{}).Where("id = ?", "drama-video").Updates(map[string]any{"protocol": test.provider, "provider_model_key": test.model}).Error; err != nil {
				t.Fatal(err)
			}
			preview, refs, _, err := svc.prepareDramaSegment(settings, draft, segment, previous, cast)
			if err != nil {
				t.Fatal(err)
			}
			if preview.Operation != "reference_to_video" || preview.TailFrameAsReference != (test.tailRole == "reference_image") || len(refs) != 2 {
				t.Fatalf("wrong continuation preview: %+v", preview)
			}
			if tail := refs[0].(map[string]any); tail["role"] != test.tailRole || tail["storageKey"] != "resource:"+previous.TailFrameResourceID {
				t.Fatalf("wrong previous tail: %v", tail)
			}
			input := canvasGenerationInput{Mode: "video", Config: providerConfig{InterfaceType: test.provider, Model: test.model, Size: preview.Size, VideoSeconds: "5", VQuality: test.quality},
				Metadata: map[string]any{"videoEditOperation": preview.Operation}}
			input.Prompt = preview.bindVideoReferences(input.Metadata) + "\n\n" + segment.VideoPrompt
			data, _ := json.Marshal(refs)
			if err := json.Unmarshal(data, &input.ReferenceImages); err != nil {
				t.Fatal(err)
			}
			input.ReferenceImages[0].URL = "https://media.example/tail.png"
			input.ReferenceImages[1].URL = "https://media.example/actor.png"
			request := protocolRequestFromInput(input)
			spec := buildDramaReferenceSpec(t, input, request)
			if err := compileDramaReferenceRequest(input, request, &spec, test.provider); err != nil {
				t.Fatal(err)
			}
			body := spec.Body.(map[string]any)
			var prompt string
			var media []any
			if test.provider == "kling-v4-official" || test.provider == "volcengine-ark-seedance-25" {
				key := "content"
				if test.provider == "kling-v4-official" {
					key = "contents"
					if spec.Path != "/omni-video/"+test.model {
						t.Fatal(spec.Path)
					}
				}
				parts := body[key].([]any)
				prompt, _ = parts[0].(map[string]any)["text"].(string)
				media = parts[1:]
			} else {
				payload := body["input"].(map[string]any)
				media = payload["media"].([]any)
				prompt, _ = payload["prompt"].(string)
			}
			if !strings.Contains(prompt, test.actorToken) || !strings.Contains(prompt, test.tailToken) || strings.Contains(prompt, dramaTailReferenceLabel) || len(media) != 2 {
				t.Fatalf("wrong provider prompt or media: %q, %v", prompt, media)
			}
			for i, raw := range media {
				value, _ := json.Marshal(raw)
				if !strings.Contains(string(value), input.ReferenceImages[i].URL) {
					t.Fatalf("media %d does not match original input: %s", i, value)
				}
			}
			if test.provider == "kling-v4-official" && media[0].(map[string]any)["type"] != "first_frame" {
				t.Fatalf("Kling omitted the keyframe: %v", media)
			}
			opening, _, _, err := svc.prepareDramaSegment(settings, draft, segment, nil, cast)
			if err != nil || opening.Operation != "reference_to_video" || opening.FirstFrameResourceID != "" || !opening.References[0].Sent {
				t.Fatalf("opening should accept numbered references: preview=%+v err=%v", opening, err)
			}
			if test.tailRole != "reference_image" {
				return
			}
			noOtherImages := draft
			noOtherImages.view.Request.References = nil
			preview, refs, _, err = svc.prepareDramaSegment(settings, noOtherImages, model.DramaSegment{SegmentIndex: 1}, previous, nil)
			if err != nil || preview.Operation != "image_to_video" || preview.TailFrameAsReference || len(refs) != 1 || refs[0].(map[string]any)["role"] != "first_frame" {
				t.Fatalf("single tail preview=%+v refs=%v err=%v", preview, refs, err)
			}
			input.ReferenceImages = input.ReferenceImages[:1]
			input.ReferenceImages[0].Role = "first_frame"
			input.Metadata = map[string]any{"videoEditOperation": preview.Operation}
			input.Prompt = preview.bindVideoReferences(input.Metadata) + "人物起身。"
			spec = buildDramaReferenceSpec(t, input, protocolRequestFromInput(input))
			if test.provider == "volcengine-ark-seedance-25" && spec.Body.(map[string]any)["ratio"] != "adaptive" {
				t.Fatalf("Seedance must follow the actual tail image ratio: %v", spec.Body)
			}
		})
	}

	video := dramaVideoFixture()
	video.Resolutions, video.DefaultResolution = []string{"768p横"}, "768p横"
	setDramaVideoCapability(t, svc, fake, video)
	if err := fake.db.Model(&model.ChannelModel{}).Where("id = ?", "drama-video").Updates(map[string]any{"protocol": "autodl-comfyui", "provider_model_key": "minimax_h3_z0902"}).Error; err != nil {
		t.Fatal(err)
	}
	preview, refs, _, err := svc.prepareDramaSegment(settings, draft, segment, previous, cast)
	if err == nil || !strings.Contains(preview.Warning, "不支持短剧尾帧续接") || len(refs) != 0 {
		t.Fatalf("AutoDL should stop before dropping the tail: preview=%+v, refs=%v, err=%v", preview, refs, err)
	}
	settings.VideoContinuity = DramaContinuityParallel
	preview, refs, _, err = svc.prepareDramaSegment(settings, draft, segment, previous, cast)
	if err != nil || preview.Operation != "reference_to_video" || len(refs) != 1 {
		t.Fatalf("AutoDL parallel path: preview=%+v, refs=%v, err=%v", preview, refs, err)
	}
}
