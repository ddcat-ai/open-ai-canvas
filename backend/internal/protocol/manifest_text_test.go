package protocol

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestManifestTextProjectionPreservesHistoryAndMedia(t *testing.T) {
	history := []Message{
		{Role: "system", Content: "system instruction"},
		{Role: "user", Content: []any{map[string]any{"type": "text", "text": "earlier"}, map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:image/png;base64,QUJD"}}}},
		{Role: "assistant", Content: "previous answer"},
	}
	before, _ := json.Marshal(history)
	request := GenerationRequest{Capability: CapabilityText, Prompt: "inspect", Messages: history, Images: []MediaReference{{URL: "https://example.test/product.jpg", MIMEType: "image/jpeg"}}}
	values := manifestRequestValues(request)
	messages, ok := values["textMessages"].([]any)
	if !ok || len(messages) != 4 {
		t.Fatalf("normalized messages = %#v", values["textMessages"])
	}
	previous := messages[1].(map[string]any)
	parts := previous["parts"].([]any)
	image := parts[1].(map[string]any)
	if image["type"] != "image" || image["data"] != "QUJD" || image["mimeType"] != "image/png" || image["isInline"] != true || image["valid"] != true {
		t.Fatalf("history image = %#v", image)
	}
	last := messages[3].(map[string]any)
	if last["text"] != "inspect" || last["role"] != "user" {
		t.Fatalf("current message = %#v", last)
	}
	input := values["textInput"].(map[string]any)
	if input["invalidCount"] != 0 || input["remoteImageCount"] != 1 {
		t.Fatalf("input summary = %#v", input)
	}
	after, _ := json.Marshal(history)
	if string(before) != string(after) {
		t.Fatal("projection mutated caller history")
	}
	legacy := values["messages"].([]any)
	if !reflect.DeepEqual(legacy[1].(map[string]any)["content"], history[1].Content) {
		t.Fatal("new projection changed legacy messages")
	}
}

func TestManifestTextProjectionCurrentReferences(t *testing.T) {
	for _, tc := range []struct {
		name                   string
		request                GenerationRequest
		wantParts, wantInvalid int
	}{
		{"inputs-only", GenerationRequest{Prompt: "inspect", Inputs: []MediaReference{{Kind: "image", DataURL: "data:image/png;base64,QUJD"}}}, 2, 0},
		{"media-only", GenerationRequest{Images: []MediaReference{{DataURL: "data:image/png;base64,QUJD"}}}, 1, 0},
		{"missing-image", GenerationRequest{Images: []MediaReference{{}}}, 1, 1},
		{"mixed-missing", GenerationRequest{Prompt: "inspect", Images: []MediaReference{{}, {DataURL: "data:image/png;base64,QUJD"}}}, 3, 1},
		{"no-duplicate-inputs", GenerationRequest{Images: []MediaReference{{DataURL: "data:image/png;base64,QUJD"}}, Inputs: []MediaReference{{Kind: "image", DataURL: "data:image/png;base64,QUJD"}}}, 1, 0},
		{"metadata", GenerationRequest{Images: []MediaReference{{URL: "https://example.test/p", MIMEType: "image/jpeg"}}}, 1, 0},
		{"wrong-metadata", GenerationRequest{Images: []MediaReference{{URL: "https://example.test/p", MIMEType: "audio/wav"}}}, 1, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tc.request.Capability = CapabilityText
			tc.request.Messages = []Message{{Role: "assistant", Content: "history"}}
			values := manifestRequestValues(tc.request)
			messages := values["textMessages"].([]any)
			if len(messages) != 2 || messages[0].(map[string]any)["text"] != "history" {
				t.Fatalf("history changed: %#v", messages)
			}
			parts := messages[1].(map[string]any)["parts"].([]any)
			if len(parts) != tc.wantParts {
				t.Fatalf("parts = %#v", parts)
			}
			if values["textInput"].(map[string]any)["invalidCount"] != tc.wantInvalid {
				t.Fatalf("summary = %#v", values["textInput"])
			}
		})
	}
}

func TestManifestTextProjectionValidatesEveryPart(t *testing.T) {
	for _, tc := range []struct {
		name  string
		part  any
		kind  string
		valid bool
	}{
		{"scalar", "hello", "text", true},
		{"claude-base64", map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": "image/png", "data": "QUJD"}}, "image", true},
		{"responses-image", map[string]any{"type": "input_image", "image_url": "https://example.test/a.png"}, "image", true},
		{"bad-base64", map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:image/png;base64,!!"}}, "image", false},
		{"wrong-mime", map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:text/plain;base64,QUJD"}}, "image", false},
		{"internal-resource", map[string]any{"type": "image_url", "image_url": map[string]any{"url": "asset://private"}}, "image", false},
		{"array-text", map[string]any{"type": "text", "text": []any{"not scalar"}}, "text", false},
		{"remote-mismatch", map[string]any{"type": "image_url", "image_url": "https://example.test/p", "mimeType": "audio/wav"}, "image", false},
		{"credentials-in-url", map[string]any{"type": "image_url", "image_url": "https://user@example.test/p"}, "image", false},
		{"unknown", map[string]any{"type": "document", "source": map[string]any{"data": "opaque"}}, "document", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			values := manifestRequestValues(GenerationRequest{Capability: CapabilityText, Messages: []Message{{Role: "user", Content: []any{tc.part}}}})
			messages, ok := values["textMessages"].([]any)
			if !ok || len(messages) != 1 {
				t.Fatalf("normalized messages = %#v", values["textMessages"])
			}
			parts := messages[0].(map[string]any)["parts"].([]any)
			if len(parts) != 1 {
				t.Fatalf("parts = %#v", parts)
			}
			part := parts[0].(map[string]any)
			if part["type"] != tc.kind || part["valid"] != tc.valid {
				t.Fatalf("part = %#v", part)
			}
			input := values["textInput"].(map[string]any)
			want := 1
			if tc.valid {
				want = 0
			}
			if input["invalidCount"] != want {
				t.Fatalf("invalid count = %#v", input)
			}
		})
	}
}
