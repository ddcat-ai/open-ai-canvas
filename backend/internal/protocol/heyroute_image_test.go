package protocol

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"testing"
)

func TestHeyrouteSharedCapabilitiesAndImageModels(t *testing.T) {
	frontend, err := os.ReadFile("../../../web/src/lib/heyroute-capabilities.json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(frontend, heyrouteCapabilitiesJSON) {
		t.Fatal("frontend/backend Heyroute defaults drifted")
	}
	data, err := os.ReadFile("../../../plugin-packages/heyroute-image-v1.yingce-plugin")
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	adapters, err := LoadInstalledProviders(pkg.ManifestRaw, nil)
	if err != nil {
		t.Fatal(err)
	}
	a := adapters[0]
	for _, model := range []string{"gpt-image-2", "grok-imagine-image", "flux-klein-2", "gemini-3-pro-image", "gemini-3.1-flash-image", "nano-banana-pro", "nano-banana-2"} {
		t.Run(model, func(t *testing.T) {
			if len(HeyrouteCapabilityDefaults("heyroute-image", model)) == 0 {
				t.Fatal("missing capability")
			}
			r := GenerationRequest{Model: model, Prompt: "paper boat", ImageCount: 1}
			spec, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
			if err != nil {
				t.Fatal(err)
			}
			if spec.ResponseMode != "sse-json" || spec.Path != "/v1/images/generations" || spec.ContentType != "application/json" {
				t.Fatalf("incorrect request: %#v", spec)
			}
			body := spec.Body.(map[string]any)
			if model != "gpt-image-2" {
				if _, exists := body["quality"]; exists {
					t.Fatal("unsupported quality sent")
				}
			}
			if model != "gpt-image-2" && model != "flux-klein-2" {
				if _, exists := body["size"]; exists {
					t.Fatal("ignored size sent")
				}
			}
			r.ImageCount = 2
			_, err = a.BuildCreate(context.Background(), RequestContext{Request: r})
			if (err == nil) != (model == "grok-imagine-image") {
				t.Fatalf("wrong n limit for %s: %v", model, err)
			}
		})
	}
	for _, response := range []string{`{"data":[{"b64_json":"AA=="}]}`, `{"data":[{"url":"https://example.com/image.png"}]}`} {
		r, err := a.ParseCreate(context.Background(), []byte(response))
		if err != nil || r.Status != StatusSucceeded || len(r.Result.Images) != 1 {
			t.Fatalf("image parse: %#v %v", r, err)
		}
	}
	r, err := a.ParseCreate(context.Background(), []byte(`{"error":{"message":"upstream failed"}}`))
	if err != nil || r.Status != StatusFailed || r.Message != "upstream failed" {
		t.Fatalf("error parse: %#v %v", r, err)
	}
}

func TestHeyrouteProviderOptionsPreserveNestedValues(t *testing.T) {
	request := GenerationRequest{ProviderOptions: map[string]map[string]any{"custom": {"seed": 0, "enabled": false, "nested": map[string]any{"value": "test"}}}}
	values := manifestRequestValues(request)
	for path, want := range map[string]any{"providerOptions.custom.seed": float64(0), "providerOptions.custom.enabled": false, "providerOptions.custom.nested.value": "test"} {
		got := manifestPathValue(values, path)
		a, _ := json.Marshal(got)
		b, _ := json.Marshal(want)
		if !bytes.Equal(a, b) {
			t.Fatalf("%s: %s != %s", path, a, b)
		}
	}
}
