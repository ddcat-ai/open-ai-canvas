package protocol

import (
	"context"
	"reflect"
	"testing"
)

// Verify shipped archives rather than source-only templates.
var nativeTextProfiles = []struct{ name, provider string }{
	{"google-gemini-generate-content", "gemini-generate-content"},
	{"vertex-gemini", "vertex-gemini"},
	{"ollama-chat", "ollama-chat"},
}

func nativeTextRequest(provider string) GenerationRequest {
	return GenerationRequest{Capability: CapabilityText, Model: "test-model", ProviderOptions: map[string]map[string]any{
		provider: {"project": "test-project", "location": "us-central1", "generationConfig": map[string]any{"temperature": 0.25}, "options": map[string]any{"temperature": 0.25}},
	}}
}

func nativeTextBlock(text string) map[string]any {
	return map[string]any{"type": "text", "text": text}
}

func nativeImageBlock(url string) map[string]any {
	return map[string]any{"type": "image_url", "image_url": map[string]any{"url": url}}
}

func nativeTextBody(t *testing.T, adapter Adapter, request GenerationRequest) map[string]any {
	t.Helper()
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Method != "POST" || spec.ContentType != "application/json" {
		t.Fatalf("spec = %#v", spec)
	}
	return manifestTestBody(t, spec)
}

func TestNativeTextProfilesPureTextAndHistory(t *testing.T) {
	for _, profile := range nativeTextProfiles {
		t.Run(profile.name, func(t *testing.T) {
			adapter := officialPackageAdapter(t, profile.name+".yingce-plugin", profile.provider)
			request := nativeTextRequest(profile.provider)
			request.Messages = []Message{{Role: "system", Content: "first system"}, {Role: "system", Content: []any{nativeTextBlock("second system")}}, {Role: "user", Content: "old question"}, {Role: "assistant", Content: "old answer"}, {Role: "user", Content: []any{nativeTextBlock("new "), nativeTextBlock("question")}}}
			body := nativeTextBody(t, adapter, request)
			if profile.name == "ollama-chat" {
				want := []any{map[string]any{"role": "system", "content": "first system"}, map[string]any{"role": "system", "content": "second system"}, map[string]any{"role": "user", "content": "old question"}, map[string]any{"role": "assistant", "content": "old answer"}, map[string]any{"role": "user", "content": "new question"}}
				if !reflect.DeepEqual(body["messages"], want) || body["stream"] != false || body["options"] == nil {
					t.Fatalf("body = %#v", body)
				}
				return
			}
			want := []any{map[string]any{"role": "user", "parts": []any{map[string]any{"text": "old question"}}}, map[string]any{"role": "model", "parts": []any{map[string]any{"text": "old answer"}}}, map[string]any{"role": "user", "parts": []any{map[string]any{"text": "new "}, map[string]any{"text": "question"}}}}
			if !reflect.DeepEqual(body["contents"], want) {
				t.Fatalf("contents = %#v", body["contents"])
			}
			system := map[string]any{"parts": []any{map[string]any{"text": "first system"}, map[string]any{"text": "second system"}}}
			if !reflect.DeepEqual(body["systemInstruction"], system) {
				t.Fatalf("systemInstruction = %#v", body["systemInstruction"])
			}
			request.Instructions = "explicit system"
			body = nativeTextBody(t, adapter, request)
			if !reflect.DeepEqual(body["systemInstruction"], map[string]any{"parts": []any{map[string]any{"text": "explicit system"}}}) {
				t.Fatalf("explicit system = %#v", body)
			}
			for _, forbidden := range []string{"messages", "input", "model", "parameters"} {
				if _, ok := body[forbidden]; ok {
					t.Fatalf("unexpected %s: %#v", forbidden, body)
				}
			}
			if body["generationConfig"] == nil {
				t.Fatalf("lost provider options: %#v", body)
			}
		})
	}
}

func TestNativeTextProfilesInlineImagesAndHistory(t *testing.T) {
	for _, profile := range nativeTextProfiles {
		t.Run(profile.name, func(t *testing.T) {
			adapter := officialPackageAdapter(t, profile.name+".yingce-plugin", profile.provider)
			request := nativeTextRequest(profile.provider)
			request.Messages = []Message{{Role: "user", Content: []any{nativeTextBlock("old"), nativeImageBlock("data:image/png;base64,QUJD")}}, {Role: "assistant", Content: "answer"}, {Role: "user", Content: []any{nativeTextBlock("compare"), nativeImageBlock("data:image/jpeg;base64,REVG"), nativeTextBlock("then"), nativeImageBlock("data:image/webp;base64,R0hJ")}}}
			body := nativeTextBody(t, adapter, request)
			if profile.name == "ollama-chat" {
				want := []any{map[string]any{"role": "user", "content": "old", "images": []any{"QUJD"}}, map[string]any{"role": "assistant", "content": "answer"}, map[string]any{"role": "user", "content": "comparethen", "images": []any{"REVG", "R0hJ"}}}
				if !reflect.DeepEqual(body["messages"], want) {
					t.Fatalf("messages = %#v", body["messages"])
				}
			} else {
				messages, ok := body["contents"].([]any)
				if !ok || len(messages) != 3 {
					t.Fatalf("contents = %#v", body)
				}
				want := []any{map[string]any{"text": "compare"}, map[string]any{"inlineData": map[string]any{"mimeType": "image/jpeg", "data": "REVG"}}, map[string]any{"text": "then"}, map[string]any{"inlineData": map[string]any{"mimeType": "image/webp", "data": "R0hJ"}}}
				if !reflect.DeepEqual(messages[2].(map[string]any)["parts"], want) {
					t.Fatalf("parts = %#v", messages[2])
				}
				old := messages[0].(map[string]any)["parts"].([]any)
				if !reflect.DeepEqual(old[1], map[string]any{"inlineData": map[string]any{"mimeType": "image/png", "data": "QUJD"}}) {
					t.Fatalf("history image = %#v", old)
				}
			}
		})
	}
}

func TestNativeTextProfilesRemoteAndInlineMedia(t *testing.T) {
	for _, profile := range nativeTextProfiles[:2] {
		t.Run(profile.name, func(t *testing.T) {
			adapter := officialPackageAdapter(t, profile.name+".yingce-plugin", profile.provider)
			for _, tc := range []struct{ name, kind, mime, value, key string }{
				{"remote-image", "image", "image/png", "https://example.com/photo.png", "fileData"},
				{"remote-video", "video", "video/mp4", "https://example.com/movie.mp4", "fileData"},
				{"remote-audio", "audio", "audio/wav", "https://example.com/sound.wav", "fileData"},
				{"inline-video", "video", "video/mp4", "data:video/mp4;base64,QUJD", "inlineData"},
				{"inline-audio", "audio", "audio/wav", "data:audio/wav;base64,QUJD", "inlineData"},
			} {
				t.Run(tc.name, func(t *testing.T) {
					request := nativeTextRequest(profile.provider)
					block := map[string]any{"type": tc.kind + "_url", tc.kind + "_url": map[string]any{"url": tc.value}, "mimeType": tc.mime}
					request.Messages = []Message{{Role: "user", Content: []any{block}}}
					body := nativeTextBody(t, adapter, request)
					part := body["contents"].([]any)[0].(map[string]any)["parts"].([]any)[0]
					want := map[string]any{"mimeType": tc.mime}
					if tc.key == "inlineData" {
						want["data"] = "QUJD"
					} else {
						want["fileUri"] = tc.value
					}
					if !reflect.DeepEqual(part, map[string]any{tc.key: want}) {
						t.Fatalf("part = %#v, want %#v", part, want)
					}
				})
			}
		})
	}
}

func TestNativeTextProfilesRejectBeforeHTTP(t *testing.T) {
	for _, profile := range nativeTextProfiles {
		t.Run(profile.name, func(t *testing.T) {
			adapter := officialPackageAdapter(t, profile.name+".yingce-plugin", profile.provider)
			cases := []struct {
				name    string
				message Message
			}{
				{"malformed-base64", Message{Role: "user", Content: []any{nativeImageBlock("data:image/png;base64,%%%")}}},
				{"empty-image", Message{Role: "user", Content: []any{nativeImageBlock("")}}},
				{"mime-mismatch", Message{Role: "user", Content: []any{nativeImageBlock("data:audio/wav;base64,QUJD")}}},
				{"unknown-block", Message{Role: "user", Content: []any{map[string]any{"type": "document", "value": "secret"}}}},
				{"tool-history", Message{Role: "tool", Content: "tool result"}},
			}
			for _, tc := range cases {
				t.Run(tc.name, func(t *testing.T) {
					request := nativeTextRequest(profile.provider)
					// A valid newest turn must not hide invalid history.
					request.Messages = []Message{tc.message, {Role: "user", Content: "new question"}}
					if spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
						t.Fatalf("invalid input produced HTTP spec: %#v", spec)
					}
				})
			}
			if profile.name == "ollama-chat" {
				for _, block := range []any{nativeImageBlock("https://example.com/a.png"), map[string]any{"type": "input_audio", "input_audio": map[string]any{"data": "QUJD", "format": "wav"}}, map[string]any{"type": "video_url", "video_url": map[string]any{"url": "data:video/mp4;base64,QUJD"}}} {
					request := nativeTextRequest(profile.provider)
					request.Messages = []Message{{Role: "user", Content: []any{block}}}
					if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
						t.Fatalf("unsupported Ollama media accepted: %#v", block)
					}
				}
			} else {
				request := nativeTextRequest(profile.provider)
				request.Messages = []Message{{Role: "system", Content: []any{nativeImageBlock("data:image/png;base64,QUJD")}}, {Role: "user", Content: "question"}}
				if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
					t.Fatal("system media silently discarded")
				}
			}
		})
	}
}

func TestNativeTextProfilesParseNativeResponses(t *testing.T) {
	for _, profile := range nativeTextProfiles {
		t.Run(profile.name, func(t *testing.T) {
			adapter := officialPackageAdapter(t, profile.name+".yingce-plugin", profile.provider)
			payload := `{"candidates":[{"content":{"parts":[{"text":"first"},{"text":"second"}]}}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":3,"totalTokenCount":10}}`
			if profile.name == "ollama-chat" {
				payload = `{"message":{"role":"assistant","content":"firstsecond","thinking":"reason"},"done":true}`
			}
			result, err := adapter.ParseCreate(context.Background(), []byte(payload))
			if err != nil {
				t.Fatal(err)
			}
			if result.Result == nil || result.Result.Text != "firstsecond" {
				t.Fatalf("result = %#v", result)
			}
			if profile.name == "ollama-chat" {
				if result.Result.Reasoning != "reason" {
					t.Fatalf("reasoning = %#v", result.Result)
				}
			} else if result.Result.Usage["totalTokenCount"] != float64(10) {
				t.Fatalf("usage = %#v", result.Result.Usage)
			}
		})
	}
}

func TestNativeTextProfilesURISchemesAndMissingMIME(t *testing.T) {
	for _, profile := range nativeTextProfiles[:2] {
		t.Run(profile.name, func(t *testing.T) {
			adapter := officialPackageAdapter(t, profile.name+".yingce-plugin", profile.provider)
			for _, tc := range []struct {
				name, uri, mime string
				allowed         bool
			}{
				{"https", "https://example.com/a.png", "image/png", true},
				{"cloud-storage", "gs://example-bucket/a.png", "image/png", profile.name == "vertex-gemini"},
				{"http", "http://example.com/a.png", "image/png", profile.name == "vertex-gemini"},
				{"missing-mime", "https://example.com/a.png", "", false},
				{"local-file", "file:///tmp/a.png", "image/png", false},
			} {
				t.Run(tc.name, func(t *testing.T) {
					request := nativeTextRequest(profile.provider)
					request.Messages = []Message{{Role: "user", Content: []any{map[string]any{"type": "image_url", "image_url": map[string]any{"url": tc.uri}, "mimeType": tc.mime}}}}
					spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
					if !tc.allowed {
						if err == nil {
							t.Fatalf("unsupported URI produced request: %#v", spec)
						}
						return
					}
					if err != nil {
						t.Fatal(err)
					}
					body := manifestTestBody(t, spec)
					part := body["contents"].([]any)[0].(map[string]any)["parts"].([]any)[0]
					if !reflect.DeepEqual(part, map[string]any{"fileData": map[string]any{"mimeType": tc.mime, "fileUri": tc.uri}}) {
						t.Fatalf("part = %#v", part)
					}
				})
			}
		})
	}
}

func TestNativeTextProfilesMediaOnlyAndTopLevelReferences(t *testing.T) {
	for _, profile := range nativeTextProfiles {
		t.Run(profile.name, func(t *testing.T) {
			adapter := officialPackageAdapter(t, profile.name+".yingce-plugin", profile.provider)
			request := nativeTextRequest(profile.provider)
			request.Images = []MediaReference{{DataURL: "data:image/png;base64,QUJD", MIMEType: "image/png"}}
			body := nativeTextBody(t, adapter, request)
			if profile.name == "ollama-chat" {
				message := body["messages"].([]any)[0].(map[string]any)
				if message["content"] != "" || !reflect.DeepEqual(message["images"], []any{"QUJD"}) {
					t.Fatalf("message = %#v", message)
				}
			} else {
				parts := body["contents"].([]any)[0].(map[string]any)["parts"].([]any)
				if !reflect.DeepEqual(parts, []any{map[string]any{"inlineData": map[string]any{"mimeType": "image/png", "data": "QUJD"}}}) {
					t.Fatalf("parts = %#v", parts)
				}
			}
		})
	}
}

func TestNativeTextProfilesVertexOptionsAndPath(t *testing.T) {
	adapter := officialPackageAdapter(t, "vertex-gemini.yingce-plugin", "vertex-gemini")
	request := nativeTextRequest("vertex-gemini")
	request.Prompt = "hello"
	request.ProviderOptions["vertex-gemini"] = map[string]any{"project": "project-one", "location": "us-central1", "parameters": map[string]any{"temperature": 0.5}, "extra_body": map[string]any{"labels": map[string]any{"source": "test"}}}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Path != "/v1/projects/project-one/locations/us-central1/publishers/google/models/test-model:generateContent" {
		t.Fatalf("path = %s", spec.Path)
	}
	body := manifestTestBody(t, spec)
	if !reflect.DeepEqual(body["generationConfig"], map[string]any{"temperature": 0.5}) || body["labels"] == nil {
		t.Fatalf("body = %#v", body)
	}
	request.ProviderOptions["vertex-gemini"]["body"] = map[string]any{"generationConfig": map[string]any{"temperature": 0.75}}
	body = nativeTextBody(t, adapter, request)
	if !reflect.DeepEqual(body["generationConfig"], map[string]any{"temperature": 0.75}) {
		t.Fatalf("body override lost: %#v", body)
	}
}

func TestNativeTextProfilesGeminiAgentPassthrough(t *testing.T) {
	adapter := officialPackageAdapter(t, "google-gemini-generate-content.yingce-plugin", "gemini-generate-content")
	request := map[string]any{"contents": []any{map[string]any{"role": "model", "parts": []any{map[string]any{"functionCall": map[string]any{"name": "lookup", "args": map[string]any{}}, "thoughtSignature": "signature"}}}}, "tools": []any{map[string]any{"functionDeclarations": []any{map[string]any{"name": "lookup"}}}}}
	agent, ok := adapter.(AgentAdapter)
	if !ok {
		t.Fatal("missing AgentAdapter")
	}
	spec, err := agent.BuildAgent(context.Background(), AgentRequestContext{Model: "test-model", Request: map[string]any{"gemini": request}})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(manifestTestBody(t, spec), request) {
		t.Fatalf("agent body = %#v", spec.Body)
	}
}
