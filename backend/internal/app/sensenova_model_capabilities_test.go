package app

import (
	"reflect"
	"testing"

	"yingce/backend/internal/protocol"
)

func TestSenseNovaExactModelCapabilityDefaults(t *testing.T) {
	for _, test := range []struct {
		model, mode, defaultLevel string
		context, output, images   int
		levels                    []string
	}{
		{"sensenova-6.8-flash", "always", "high", 1048576, 131072, 16, []string{"minimal", "low", "medium", "high", "max"}},
		{"sensenova-6.8-flash-lite", "levels", "high", 128000, 65536, 16, []string{"off", "low", "medium", "high", "max"}},
		{"deepseek-flash", "levels", "high", 1048576, 393216, 100, []string{"off", "low", "high", "max"}},
		{"glm-5.3", "always", "max", 1048576, 131072, 0, []string{"low", "high", "max"}},
		{"kimi-k3", "levels", "max", 1048576, 131072, 16, []string{"off", "low", "medium", "high", "max"}},
	} {
		t.Run(test.model, func(t *testing.T) {
			profile := DefaultModelCapabilityConfigForModel(senseNovaTextProtocol, test.model).Text
			if profile.Streaming == nil || !*profile.Streaming || profile.ContextWindowTokens != test.context || profile.MaxOutputTokens != test.output || profile.References.MaxImages != test.images || profile.References.MaxVideos != 0 {
				t.Fatalf("text defaults = %#v", profile)
			}
			if profile.Thinking == nil || profile.Thinking.Mode != test.mode || profile.Thinking.Default != test.defaultLevel || !reflect.DeepEqual(profile.Thinking.Levels, test.levels) {
				t.Fatalf("thinking defaults = %#v", profile.Thinking)
			}
			if err := validateTextCapabilityConfig(profile); err != nil {
				t.Fatal(err)
			}
			if _, err := normalizeTextThinkingConfig(profile.Thinking, protocol.TextWireChatCompletion, profile.MaxOutputTokens); err != nil {
				t.Fatal(err)
			}
			if other := DefaultModelCapabilityConfigForModel("deepseek-chat", test.model).Text; other.ContextWindowTokens != 128000 || other.References.MaxImages != 0 || other.Thinking != nil {
				t.Fatalf("another protocol inherited SenseNova defaults: %#v", other)
			}
		})
	}
	unknown := DefaultModelCapabilityConfigForModel(senseNovaTextProtocol, "sensenova-6.8-flash-unknown").Text
	if unknown.ContextWindowTokens != 128000 || unknown.References.MaxImages != 0 || unknown.Thinking != nil {
		t.Fatalf("unknown model inherited a guessed SenseNova contract: %#v", unknown)
	}
}

func TestSenseNovaImageCapabilityDefaults(t *testing.T) {
	profile := DefaultImageCapabilityConfig("sensenova-image", senseNovaImageModel)
	if profile.References.MaxImages != 5 || profile.References.MaskSupported || profile.MaxOutputs != 1 || profile.Quality.Supported || profile.TransparentBackground.Supported || profile.Resolution.Supported {
		t.Fatalf("image defaults = %#v", profile)
	}
	want := []string{"auto", "2048x2048", "2720x1536", "1536x2720", "1664x2496", "2496x1664", "4096x4096"}
	if !reflect.DeepEqual(profile.Size.Values, want) || profile.Size.Default != "2048x2048" || !profile.Size.AllowCustom || profile.ResponseFormat.Default != "url" || !profile.OutputFormat.Supported {
		t.Fatalf("image controls = %#v", profile)
	}
	if err := validateImageCapabilityConfig(profile); err != nil {
		t.Fatal(err)
	}
	profile.Size.Values[1] = "mutated"
	if next := DefaultImageCapabilityConfig("sensenova-image", senseNovaImageModel); next.Size.Values[1] != "2048x2048" {
		t.Fatal("default image profile is shared mutable state")
	}
	if other := DefaultImageCapabilityConfig("openai-image", senseNovaImageModel); other.References.MaxImages != 16 || other.MaxOutputs != 15 {
		t.Fatalf("another protocol inherited SenseNova defaults: %#v", other)
	}
}
