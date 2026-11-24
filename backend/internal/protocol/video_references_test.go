package protocol

import (
	"context"
	"strings"
	"testing"
)

func TestVideoReferencesWithTopLevelPrompt(t *testing.T) {
	rule := VideoReferenceContract{Layout: "input-media-top-prompt", Token: "@参考图{n}"}
	request := GenerationRequest{Prompt: "参考图1起身", Images: []MediaReference{{ID: "actor", URL: "actor.png", Role: "reference_image"}}}
	input := map[string]any{"prompt": "独立的嵌套字段", "media": []any{
		map[string]any{"type": "reference_audio", "url": "voice.mp3"},
		map[string]any{"type": "reference_image", "url": "actor.png"},
	}}
	body := map[string]any{"prompt": request.Prompt, "input": input}
	bound, err := rule.Bind(request, &RequestSpec{Body: body})
	if err != nil || bound.Tokens["actor"] != "@参考图1" {
		t.Fatalf("reference binding=%v err=%v", bound.Tokens, err)
	}
	bound.Set("@参考图1起身")
	if body["prompt"] != "@参考图1起身" || input["prompt"] != "独立的嵌套字段" {
		t.Fatalf("wrong prompt slot: %v", body)
	}
}

func TestIndexedVideoReferenceSlots(t *testing.T) {
	rule := VideoReferenceContract{Layout: "indexed-images", Token: "@图片{n}"}
	request := GenerationRequest{Prompt: "参考图1和参考图2", Images: []MediaReference{{ID: "one", URL: "one.png"}, {ID: "two", URL: "two.png"}}}
	body := map[string]any{"prompt": request.Prompt, "ref_image_1": "one.png", "ref_image_0": "two.png", "ref_audio_0": "audio.mp3", "first_frame": "frame.png"}
	spec := RequestSpec{Body: body}
	prompt, err := rule.Bind(request, &spec)
	if err != nil || prompt.Tokens["two"] != "@图片1" || prompt.Tokens["one"] != "@图片2" {
		t.Fatalf("wire order = %v, %v", prompt.Tokens, err)
	}
	delete(body, "ref_image_0")
	if _, err := rule.Bind(request, &spec); err == nil || !strings.Contains(err.Error(), "ref_image_0") {
		t.Fatalf("gap in indexed keys was accepted: %v", err)
	}
}

func TestOpenAIVideoReferenceModes(t *testing.T) {
	adapter := officialPackageAdapter(t, "openai-videos.yingce-plugin", "newapi")
	images := []MediaReference{{ID: "image-b", URL: "same.png", Order: 2}, {ID: "image-a", URL: "same.png", Order: 1}}
	for _, entry := range []struct {
		operation string
		count     int
		field     string
		invalid   bool
	}{
		{"text_to_video", 0, "", false}, {"text_to_video", 1, "", true},
		{"", 1, "input_reference", false}, {"image_to_video", 1, "input_reference", false},
		{"", 2, "", true}, {"image_to_video", 2, "", true},
		{"reference_to_video", 1, "input_reference", false}, {"reference_to_video", 2, "input_reference[]", false},
	} {
		request := GenerationRequest{Model: "video", Prompt: "prompt", Operation: entry.operation, Images: images[:entry.count]}
		spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
		if (err != nil) != entry.invalid {
			t.Fatalf("operation %q count %d: %v", entry.operation, entry.count, err)
		}
		if entry.invalid {
			continue
		}
		if len(spec.Files) != entry.count {
			t.Fatalf("expected %d multipart parts, got %d", entry.count, len(spec.Files))
		}
		for index, part := range spec.Files {
			wantID := images[entry.count-1-index].ID
			if part.Name != entry.field || part.Reference.ID != wantID {
				t.Errorf("part %d = %s, %s; want %s, %s", index, part.Name, part.Reference.ID, entry.field, wantID)
			}
		}
	}
}

func TestAutoDLU30UsesOrderedImageAndAudioSlots(t *testing.T) {
	adapter := officialPackageAdapter(t, "autodl-comfyui.yingce-plugin", "autodl-comfyui")
	request := GenerationRequest{
		Model: "minimax_h3_zm_u30", Prompt: "参考图1", Operation: "image_to_video",
		Images: []MediaReference{{ID: "subject", Role: "reference_image", URL: "subject.png", Order: 2}, {ID: "frame", Role: "first_frame", URL: "frame.png", Order: 1}},
		Audios: []MediaReference{{URL: "voice.mp3"}},
	}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := spec.Body.(map[string]any)
	if body["ref_image_0"] != "frame.png" || body["ref_image_1"] != "subject.png" || body["ref_audio_0"] != "voice.mp3" {
		t.Fatalf("U30 image/audio fields: %v", body)
	}
	prompt, err := adapter.Metadata().VideoReferences.Bind(request, &spec)
	if err != nil || prompt.Tokens["subject"] != "@图片2" {
		t.Fatalf("subject should occupy slot 2: %v, %v", prompt.Tokens, err)
	}
}
