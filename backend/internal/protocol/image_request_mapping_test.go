package protocol

import (
	"context"
	"strings"
	"testing"
)

func mappingTestAdapter(operation ManifestOperation, capability Capability) manifestAdapter {
	return manifestAdapter{manifest: Manifest{Metadata: Metadata{ID: "fixture"}, Contributes: ManifestContributions{Providers: []ManifestProvider{{}}}, Create: operation}}
}

func TestCommonImageFieldsReachStandardCreateWithoutDeclarations(t *testing.T) {
	a := mappingTestAdapter(ManifestOperation{Method: "POST", Path: "/v1/images/generations", ContentType: "application/json", Body: map[string]any{"model": map[string]any{"$ref": "request.model"}, "metadata": map[string]any{"size": "unrelated", "quality": "unrelated"}}}, CapabilityImage)
	r := GenerationRequest{Capability: CapabilityImage, Model: "fixture", ImageParameters: map[string]any{"size": "2048x1024", "imageResolution": "2k", "quality": "custom-quality", "count": 7, "transparentBackground": true}}
	spec, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if body["size"] != "2048x1024" || body["quality"] != "custom-quality" || body["n"] != float64(7) || body["background"] != "transparent" || body["imageResolution"] != nil {
		t.Fatalf("standard mapping: %#v", body)
	}
	a.manifest.Create.Body = map[string]any{"quality": "explicit-conversion", "size": map[string]any{"$omitEmpty": nil}}
	spec, err = a.BuildCreate(context.Background(), RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	body = manifestTestBody(t, spec)
	if body["quality"] != "explicit-conversion" || body["size"] != nil {
		t.Fatalf("explicit fields overwritten: %#v", body)
	}
}

func TestCommonImageFieldsGeminiAndUnknownMappingBoundaries(t *testing.T) {
	a := mappingTestAdapter(ManifestOperation{Method: "POST", Path: "/v1beta/models/test:generateContent", ContentType: "application/json", Body: map[string]any{"contents": []any{}}}, CapabilityImage)
	r := GenerationRequest{Capability: CapabilityImage, Model: "fixture", ImageParameters: map[string]any{"size": "16:9", "imageResolution": "4k", "count": 1}}
	spec, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	config := body["generationConfig"].(map[string]any)
	image := config["imageConfig"].(map[string]any)
	if image["aspectRatio"] != "16:9" || image["imageSize"] != "4K" || config["candidateCount"] != nil {
		t.Fatalf("Gemini mapping: %#v", body)
	}
	r.ImageParameters["quality"] = "high"
	if _, err := a.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil || !strings.Contains(err.Error(), "quality") {
		t.Fatalf("unmapped Gemini quality silently dropped: %v", err)
	}
	a.manifest.Create.Path = "/custom/create"
	delete(r.ImageParameters, "quality")
	if _, err := a.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil {
		t.Fatal("custom endpoint silently discarded configured parameters")
	}
	a.manifest.Create.Body = map[string]any{"shape": "request.aspectRatio", "tier": "request.resolution"}
	if _, err := a.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil {
		t.Fatal("literal strings mistaken for mapping expressions")
	}
	a.manifest.Create.Body = map[string]any{"shape": map[string]any{"$ref": "request.aspectRatio"}, "tier": map[string]any{"$ref": "request.resolution"}}
	if _, err := a.BuildCreate(context.Background(), RequestContext{Request: r}); err != nil {
		t.Fatalf("explicit custom mapping rejected: %v", err)
	}
	r.ImageParameters["privateUnknown"] = "value"
	if _, err := a.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil {
		t.Fatal("unknown private parameter sent")
	}
}

func TestCommonImageStandardMappingRejectsUnconvertedSize(t *testing.T) {
	for _, test := range []struct{ path, size, target string }{
		{"/v1/images/generations", "16:9", "size"},
		{"/v1beta/models/fixture:generateContent", "2560x1440", "generationConfig.imageConfig.aspectRatio"},
	} {
		a := mappingTestAdapter(ManifestOperation{Method: "POST", Path: test.path, ContentType: "application/json", Body: map[string]any{"model": "fixture"}}, CapabilityImage)
		request := GenerationRequest{Capability: CapabilityImage, ImageParameters: map[string]any{"size": test.size}}
		if _, err := a.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil || !strings.Contains(err.Error(), "size") {
			t.Fatalf("wrong shape accepted: %s %v", test.size, err)
		}
	}
}

func TestCommonImageConfigurationOwnsRangesButCannotChangeBindings(t *testing.T) {
	max := 3.0
	definitions := []ImageParameter{{Name: "quality", Label: "Quality", Type: "string", Values: []any{"standard"}, Binding: "quality", Models: []string{"other"}}, {Name: "count", Label: "Count", Type: "integer", Max: &max, Binding: "imageCount"}}
	requested := 20.0
	configured := []ImageParameter{{Name: "quality", Type: "string", Values: []any{"custom"}, Default: "custom", Binding: "providerOptions.bad.quality"}, {Name: "count", Type: "integer", Max: &requested, Default: 2}, {Name: "imageResolution", Type: "string", Values: []any{"8k"}, Default: "8k"}}
	resolved, err := ResolveImageParameters(definitions, configured, "fixture")
	if err != nil {
		t.Fatal(err)
	}
	if resolved[0].Binding != "quality" || resolved[0].Values[0] != "custom" || *resolved[1].Max != requested || resolved[2].Binding != "resolution" {
		t.Fatalf("configured range/binding: %#v", resolved)
	}
	configured[0].Type = "boolean"
	if _, err := ResolveImageParameters(definitions, configured, "fixture"); err == nil {
		t.Fatal("common parameter type changed")
	}
}

func TestVideoWithoutParameterDescriptionsUsesExistingBody(t *testing.T) {
	operation := ManifestOperation{Method: "POST", Path: "/videos", ContentType: "application/json", Body: map[string]any{"duration": map[string]any{"$ref": "request.duration"}, "ratio": map[string]any{"$ref": "request.aspectRatio"}, "resolution": map[string]any{"$ref": "request.resolution"}}}
	a := mappingTestAdapter(operation, CapabilityVideo)
	r := GenerationRequest{Capability: CapabilityVideo, Model: "fixture", Duration: 8, AspectRatio: "9:16", Resolution: "1080p", GenerateAudio: true}
	spec, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if body["duration"] != float64(8) || body["ratio"] != "9:16" || body["resolution"] != "1080p" || body["generateAudio"] != nil {
		t.Fatalf("video changed: %#v", body)
	}
	a.manifest.Create.Body.(map[string]any)["audio"] = map[string]any{"$ref": "request.generateAudio"}
	for _, enabled := range []bool{true, false} {
		r.GenerateAudio = enabled
		spec, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
		if err != nil || manifestTestBody(t, spec)["audio"] != enabled {
			t.Fatalf("audio mapping: %#v %v", spec, err)
		}
	}
}
