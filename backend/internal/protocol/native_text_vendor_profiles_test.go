package protocol

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

// Test installed artifacts across native request/response boundaries.
func TestNativeTextVendorProfiles(t *testing.T) {
	for _, id := range []string{"aws-bedrock-converse", "dashscope-qwen-native", "cohere-chat-v2", "minimax-text-native", "azure-openai"} {
		t.Run(id, func(t *testing.T) {
			a := officialPackageAdapter(t, id+".yingce-plugin", id)
			r := GenerationRequest{Capability: CapabilityText, Model: "test-model", Instructions: "be concise", Prompt: "inspect", Extra: map[string]any{"max_tokens": 128}, ProviderOptions: map[string]map[string]any{id: {"temperature": 0.25, "top_p": 0.8}}}
			spec, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, spec)
			if body["input"] != nil && id != "dashscope-qwen-native" {
				t.Fatalf("spurious input: %#v", body)
			}
			switch id {
			case "aws-bedrock-converse":
				if body["model"] != nil || body["system"] == nil || body["inferenceConfig"] == nil {
					t.Fatalf("Converse schema: %#v", body)
				}
			case "dashscope-qwen-native":
				input, ok := body["input"].(map[string]any)
				if !ok || input["messages"] == nil || body["messages"] != nil || spec.Headers["X-DashScope-Async"] != "" {
					t.Fatalf("DashScope schema: %#v", spec)
				}
			default:
				if body["messages"] == nil {
					t.Fatalf("messages missing: %#v", body)
				}
			}
			if id == "cohere-chat-v2" && body["p"] != 0.8 {
				t.Fatalf("Cohere top_p must map to p: %#v", body)
			}
			if id == "aws-bedrock-converse" {
				inference := body["inferenceConfig"].(map[string]any)
				if inference["maxTokens"] != float64(128) || inference["topP"] != 0.8 {
					t.Fatalf("Converse inferenceConfig: %#v", inference)
				}
			}
			if id == "azure-openai" && !reflect.DeepEqual(spec.Query["api-version"], []string{"2024-10-21"}) {
				t.Fatalf("Azure version: %#v", spec.Query)
			}
			responses := map[string]string{
				"aws-bedrock-converse":  `{"output":{"message":{"content":[{"text":"one"},{"text":"two"}]}},"usage":{"inputTokens":1,"outputTokens":2}}`,
				"dashscope-qwen-native": `{"output":{"choices":[{"message":{"content":[{"text":"one"},{"text":"two"}]}}]},"usage":{"input_tokens":1}}`,
				"cohere-chat-v2":        `{"message":{"content":[{"type":"text","text":"one"},{"type":"text","text":"two"}]},"usage":{"tokens":{"input_tokens":1}}}`,
				"minimax-text-native":   `{"choices":[{"message":{"content":"onetwo"}}],"base_resp":{"status_code":0},"usage":{"prompt_tokens":1}}`,
				"azure-openai":          `{"choices":[{"message":{"content":"onetwo"}}],"usage":{"prompt_tokens":1}}`,
			}
			parsed, err := a.ParseCreate(context.Background(), []byte(responses[id]))
			if err != nil || parsed.Status != StatusSucceeded || parsed.Result == nil || parsed.Result.Text != "onetwo" || parsed.Result.Usage == nil {
				t.Fatalf("native response: %#v %v", parsed, err)
			}
			r.Messages = []Message{{Role: "user", Content: []any{map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:image/png;base64,QUJD"}}, map[string]any{"type": "text", "text": "earlier"}}}, {Role: "assistant", Content: "previous"}}
			spec, err = a.BuildCreate(context.Background(), RequestContext{Request: r})
			if err != nil {
				t.Fatal(err)
			}
			encoded, _ := json.Marshal(spec.Body)
			want := `"image_url"`
			if id == "aws-bedrock-converse" {
				want = `"bytes":"QUJD"`
			}
			if id == "dashscope-qwen-native" {
				want = `"image":"data:image/png;base64,QUJD"`
				if spec.Path != "/api/v1/services/aigc/multimodal-generation/generation" {
					t.Fatalf("multimodal path: %s", spec.Path)
				}
			}
			if !strings.Contains(string(encoded), want) {
				t.Fatalf("history image missing: %s", encoded)
			}
			for _, bad := range []any{map[string]any{"type": "image_url", "image_url": map[string]any{"url": ""}}, map[string]any{"type": "unknown", "payload": "must not vanish"}, map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:image/png;base64,not-base64"}}, map[string]any{"type": "image_url", "image_url": map[string]any{"url": "gs://bucket/image.png"}}} {
				r.Messages = []Message{{Role: "user", Content: []any{bad}}}
				if _, err := a.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil {
					t.Fatalf("invalid history accepted: %#v", bad)
				}
			}
			for _, role := range []string{"system", "assistant"} {
				r.Messages = []Message{{Role: role, Content: []any{map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:image/png;base64,QUJD"}}}}}
				if _, err := a.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil {
					t.Fatalf("media accepted in %s message", role)
				}
			}
			r.Messages = nil
			r.ProviderOptions[id]["stream"] = true
			if _, err := a.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil {
				t.Fatal("sync profile accepted streaming")
			}
			delete(r.ProviderOptions[id], "stream")
			if id != "aws-bedrock-converse" {
				r.Messages = []Message{{Role: "user", Content: []any{map[string]any{"type": "input_audio", "input_audio": map[string]any{"data": "QUJD", "format": "wav"}}}}}
				if _, err := a.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil {
					t.Fatal("unsupported audio accepted")
				}
			}
		})
	}
}

func TestNativeTextInvokeModelRequiresExactBody(t *testing.T) {
	a := officialPackageAdapter(t, "aws-bedrock-invoke-model.yingce-plugin", "aws-bedrock-invoke-model")
	r := GenerationRequest{Capability: CapabilityText, Model: "opaque", Prompt: "do not inject"}
	if _, err := a.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil {
		t.Fatal("InvokeModel accepted missing model-specific body")
	}
	for _, key := range []string{"body", "extra_body"} {
		body := map[string]any{"inputText": "explicit", "textGenerationConfig": map[string]any{"maxTokenCount": float64(32)}}
		r.ProviderOptions = map[string]map[string]any{"aws-bedrock-invoke-model": {key: body}}
		spec, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
		if err != nil {
			t.Fatal(err)
		}
		if got := manifestTestBody(t, spec); !reflect.DeepEqual(got, body) {
			t.Fatalf("InvokeModel injected generic fields: %#v", got)
		}
	}
	parsed, err := a.ParseCreate(context.Background(), []byte(`{"results":[{"outputText":"opaque answer"}],"inputTextTokenCount":1}`))
	if err != nil || parsed.Result == nil || parsed.Result.Text != "opaque answer" {
		t.Fatalf("InvokeModel response: %#v %v", parsed, err)
	}
}

func TestNativeTextConverseMediaAndMiniMaxErrors(t *testing.T) {
	a := officialPackageAdapter(t, "aws-bedrock-converse.yingce-plugin", "aws-bedrock-converse")
	for _, media := range []MediaReference{{Kind: "image", DataURL: "data:image/png;base64,QUJD"}, {Kind: "audio", DataURL: "data:audio/wav;base64,QUJD"}, {Kind: "video", DataURL: "data:video/mp4;base64,QUJD"}} {
		r := GenerationRequest{Capability: CapabilityText, Model: "test", Prompt: "inspect", Inputs: []MediaReference{media}}
		spec, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
		if err != nil {
			t.Fatal(err)
		}
		encoded, _ := json.Marshal(spec.Body)
		if !strings.Contains(string(encoded), `"bytes":"QUJD"`) {
			t.Fatalf("inline bytes missing: %s", encoded)
		}
		media.DataURL = ""
		media.URL = "https://example.test/file"
		r.Inputs = []MediaReference{media}
		if _, err := a.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil {
			t.Fatal("Converse accepted HTTP media without bytes")
		}
	}
	m := officialPackageAdapter(t, "minimax-text-native.yingce-plugin", "minimax-text-native")
	parsed, err := m.ParseCreate(context.Background(), []byte(`{"base_resp":{"status_code":2013,"status_msg":"invalid parameter"}}`))
	if err == nil && parsed.Status != StatusFailed {
		t.Fatalf("MiniMax business error became success: %#v", parsed)
	}
}
