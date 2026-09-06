package protocol

import (
	"context"
	"encoding/json"
	"testing"
)

func TestGeminiWeb2APIImageContract(t *testing.T) {
	a := officialPackageAdapter(t, "gemini-web2api-image.yingce-plugin", "gemini-web2api-image")
	spec, err := a.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "gemini-image", Prompt: "Draw a circle", ImageCount: 4, AspectRatio: "16:9",
		Images: []MediaReference{{DataURL: "data:image/png;base64,aGk="}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if spec.Path != "/v1/chat/completions" || body["model"] != "gemini-image" || body["stream"] != false {
		t.Fatal("incorrect image proxy request contract")
	}
	for _, key := range []string{"n", "size", "quality", "response_format"} {
		if _, present := body[key]; present {
			t.Fatalf("unsupported parameter %s was sent", key)
		}
	}
	message := body["messages"].([]any)[0].(map[string]any)
	content := message["content"].([]any)
	if len(content) != 2 || content[0].(map[string]any)["text"] != "Draw a circle" || content[1].(map[string]any)["type"] != "image_url" {
		t.Fatal("prompt or reference image mapping lost")
	}
	for _, tc := range []struct {
		name, content string
		count         int
	}{
		{"image", "Here is your image:\n![image](data:image/png;base64,aGk=)", 1},
		{"two", "![a](data:image/png;base64,aGk=) ![b](data:image/webp;base64,aGk=)", 2},
		{"duplicate", "![a](data:image/png;base64,aGk=) ![b](data:image/png;base64,aGk=)", 1},
		{"text", "Please sign in", 0},
		{"link", "![image](http://127.0.0.1/private)", 0},
		{"bad-base64", "![image](data:image/png;base64,broken)", 0},
		{"svg", "![image](data:image/svg+xml;base64,aGk=)", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			payload, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": tc.content}}}})
			result, err := a.ParseCreate(context.Background(), payload)
			if err != nil {
				t.Fatal(err)
			}
			if tc.count == 0 {
				if result.Status != StatusFailed || result.Result != nil {
					t.Fatal("non-image response must fail without returning provider text")
				}
				return
			}
			if result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Images) != tc.count || result.Result.Images[0].DataURL == "" || result.Result.Images[0].URL != "" {
				t.Fatal("inline image response not normalized correctly")
			}
		})
	}
	result, err := a.ParseCreate(context.Background(), []byte(`{"error":{"message":"private upstream detail"}}`))
	if err != nil || result.Status != StatusFailed || result.Message == "private upstream detail" {
		t.Fatal("provider error must stay failed and sanitized")
	}
}
