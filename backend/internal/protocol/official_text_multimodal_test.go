package protocol

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestOfficialTextMultimodalCompatibleProfiles(t *testing.T) {
	paths, err := filepath.Glob(filepath.Join("..", "..", "..", "plugin-packages", "*.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		pkg, err := ParsePluginPackage(data)
		if err != nil {
			t.Fatal(err)
		}
		for _, provider := range pkg.Manifest.Contributes.Providers {
			if !containsCapability(provider.Capabilities, CapabilityText) || TextWireForPath(provider.Create.Path) != TextWireChatCompletion || provider.ID == "azure-openai" {
				continue
			}
			count++
			t.Run(provider.ID, func(t *testing.T) {
				a := officialPackageAdapter(t, filepath.Base(path), provider.ID)
				r := GenerationRequest{Capability: CapabilityText, Model: "vision-if-declared", Prompt: "inspect", Instructions: "system", Images: []MediaReference{{DataURL: "data:image/png;base64,QUJD"}, {URL: "https://example.test/p.jpg"}}}
				s, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
				if err != nil {
					t.Fatal(err)
				}
				b := manifestTestBody(t, s)
				messages, ok := b["messages"].([]any)
				if !ok || len(messages) != 2 {
					t.Fatalf("messages: %#v", b)
				}
				parts, ok := messages[1].(map[string]any)["content"].([]any)
				if !ok || len(parts) != 3 {
					t.Fatalf("content: %#v", messages)
				}
				if parts[0].(map[string]any)["text"] != "inspect" {
					t.Fatal("prompt lost")
				}
				for i, want := range []string{"data:image/png;base64,QUJD", "https://example.test/p.jpg"} {
					p := parts[i+1].(map[string]any)
					if p["type"] != "image_url" || p["image_url"].(map[string]any)["url"] != want {
						t.Fatalf("image: %#v", p)
					}
				}
			})
		}
	}
	if count != 23 {
		t.Fatalf("compatible text profiles covered = %d, want 23 (Azure covered separately)", count)
	}
}

func TestOfficialTextMultimodalNativeOptions(t *testing.T) {
	t.Run("azure-image-detail", func(t *testing.T) {
		a := officialPackageAdapter(t, "azure-openai.yingce-plugin", "azure-openai")
		r := GenerationRequest{Capability: CapabilityText, Model: "vision", Messages: []Message{{Role: "user", Content: []any{map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://example.test/p.png", "detail": "low"}}}}}}
		s, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
		if err != nil {
			t.Fatal(err)
		}
		b := manifestTestBody(t, s)
		messages := b["messages"].([]any)
		parts := messages[0].(map[string]any)["content"].([]any)
		if parts[0].(map[string]any)["image_url"].(map[string]any)["detail"] != "low" {
			t.Fatalf("image detail lost: %#v", b)
		}
	})
	t.Run("claude-cache-and-opaque", func(t *testing.T) {
		a := officialPackageAdapter(t, "anthropic-messages.yingce-plugin", "claude-api")
		blocks := []any{map[string]any{"type": "text", "text": "context", "cache_control": map[string]any{"type": "ephemeral"}}, map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": "image/png", "data": "QUJD"}, "cache_control": map[string]any{"type": "ephemeral"}}, map[string]any{"type": "tool_result", "tool_use_id": "call-1", "content": "opaque"}}
		r := GenerationRequest{Capability: CapabilityText, Model: "vision", Messages: []Message{{Role: "user", Content: blocks}}}
		s, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
		if err != nil {
			t.Fatal(err)
		}
		b := manifestTestBody(t, s)
		if !reflect.DeepEqual(b["messages"].([]any)[0].(map[string]any)["content"], blocks) {
			t.Fatalf("native blocks changed: %#v", b)
		}
	})
	for _, tc := range []struct{ pkg, id string }{{"google-gemini-generate-content", "gemini-generate-content"}, {"vertex-gemini", "vertex-gemini"}} {
		t.Run(tc.pkg+"-thoughts", func(t *testing.T) {
			a := officialPackageAdapter(t, tc.pkg+".yingce-plugin", tc.id)
			r, err := a.ParseCreate(context.Background(), []byte(`{"candidates":[{"content":{"parts":[{"thought":true,"text":"summary"},{"text":"answer"}]}}]}`))
			if err != nil || r.Result == nil || r.Result.Text != "answer" || r.Result.Reasoning != "summary" {
				t.Fatalf("thoughts mixed into answer: %#v, %v", r.Result, err)
			}
		})
	}
}

func TestOfficialTextMultimodalClaudeHistory(t *testing.T) {
	a := officialPackageAdapter(t, "anthropic-messages.yingce-plugin", "claude-api")
	for _, kind := range []string{"history", "top-level"} {
		t.Run(kind, func(t *testing.T) {
			r := GenerationRequest{Capability: CapabilityText, Model: "vision-if-declared", Prompt: "inspect", InterfaceType: TextWireClaude, Instructions: "system"}
			if kind == "history" {
				r.Messages = []Message{{Role: "user", Content: []any{map[string]any{"type": "text", "text": "earlier"}, map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:image/png;base64,QUJD"}}}}, {Role: "assistant", Content: "previous"}}
			} else {
				r.Images = []MediaReference{{DataURL: "data:image/png;base64,QUJD"}}
			}
			s, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
			if err != nil {
				t.Fatal(err)
			}
			b := manifestTestBody(t, s)
			encoded, _ := json.Marshal(b["messages"])
			if strings.Contains(string(encoded), "image_url") || !strings.Contains(string(encoded), `"media_type":"image/png"`) || !strings.Contains(string(encoded), `"data":"QUJD"`) {
				t.Fatalf("Claude image malformed: %s", encoded)
			}
			if b["system"] != "system" {
				t.Fatalf("system lost: %#v", b)
			}
		})
	}
}
