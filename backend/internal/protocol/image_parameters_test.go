package protocol

import (
	"context"
	"testing"
)

func TestImageParametersPluginRequestPreservesValuesAndModelScope(t *testing.T) {
	adapter := officialPackageAdapter(t, "kacang-midjourney.yingce-plugin", "kacang-midjourney")
	if len(adapter.Metadata().ImageParameters) == 0 {
		t.Fatal("packaged plugin is missing image parameter declarations")
	}
	request := GenerationRequest{Capability: CapabilityImage, Model: "mj-v8.2", Prompt: "portrait", ImageParameters: map[string]any{
		"size": "1:1", "count": 1, "seed": 0, "raw": false, "chaos": 0, "stylize": 450, "mjQuality": 0.5,
	}}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	for name, expected := range map[string]any{"size": "1:1", "seed": float64(0), "raw": false, "chaos": float64(0), "stylize": float64(450), "quality": 0.5} {
		if body[name] != expected {
			t.Fatalf("%s = %#v, want %#v", name, body[name], expected)
		}
	}
	request.Model = "Midjourney v8.2 高速"
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
		t.Fatal("fast model accepted unsupported stable-only parameters")
	}
	request.Model = "mj-v8.2"
	request.ImageParameters["stylize"] = 1001
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
		t.Fatal("out of range value accepted")
	}
}

func TestImageParametersCannotExpandPluginConstraintsOrBindings(t *testing.T) {
	minimum, maximum := 0.0, 100.0
	definitions := []ImageParameter{{Name: "amount", Label: "Amount", Type: "number", Min: &minimum, Max: &maximum, Binding: "providerOptions.example.amount"}}
	expanded := 101.0
	if _, err := ResolveImageParameters(definitions, []ImageParameter{{Name: "amount", Max: &expanded}}, "model"); err == nil {
		t.Fatal("channel expanded plugin bounds")
	}
	resolved, err := ResolveImageParameters(definitions, []ImageParameter{{Name: "amount", Binding: "providerOptions.evil.amount", Pricing: true, Default: 0}}, "model")
	if err != nil {
		t.Fatal(err)
	}
	if resolved[0].Binding != definitions[0].Binding || resolved[0].Pricing {
		t.Fatalf("channel replaced trusted metadata: %#v", resolved[0])
	}
	if _, err := ResolveImageParameters(definitions, []ImageParameter{{Name: "invented"}}, "model"); err == nil {
		t.Fatal("undeclared field accepted")
	}
}

// 字符串枚举忽略大小写比较，并通过 CanonicalValue 回填声明原值；数字仍严格比较。
func TestImageParametersEnumValuesIgnoreCaseAndReturnDeclaredValue(t *testing.T) {
	parameter := ImageParameter{Name: "imageResolution", Label: "分辨率", Type: "string", Values: []any{"1K", "2K", "4K"}}
	if !parameter.Accepts("2k") || !parameter.Accepts("2K") {
		t.Fatal("string enum values must compare case-insensitively")
	}
	if parameter.Accepts("8K") {
		t.Fatal("undeclared value accepted")
	}
	if got := parameter.CanonicalValue("2k"); got != "2K" {
		t.Fatalf("canonical value = %#v, want declared 2K", got)
	}
	if !ImageParameterValuesEqual("2k", "2K") || ImageParameterValuesEqual("2k", "4k") {
		t.Fatal("case-insensitive equality must still distinguish values")
	}
	// 数字与布尔不接受大小写放宽，仍按原值比较。
	number := ImageParameter{Name: "count", Label: "数量", Type: "integer", Min: new(float64)}
	if !ImageParameterValuesEqual(2, 2.0) || ImageParameterValuesEqual(2, 3) || number.CanonicalValue(2) != 2 {
		t.Fatal("numeric comparison must keep exact semantics")
	}
}

func TestImageParametersGeminiResolutionIsIndependentFromStaleQuality(t *testing.T) {
	adapter := officialPackageAdapter(t, "google-gemini-image.yingce-plugin", "gemini-image")
	request := GenerationRequest{Capability: CapabilityImage, Model: "image-model", Prompt: "portrait", ImageParameters: map[string]any{"imageResolution": "2k", "seed": 0}}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	config := manifestTestBody(t, spec)["generationConfig"].(map[string]any)
	if config["imageConfig"].(map[string]any)["imageSize"] != "2K" || config["seed"] != float64(0) {
		t.Fatalf("mapped request: %#v", config)
	}
}
