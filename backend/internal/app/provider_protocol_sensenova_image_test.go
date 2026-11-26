package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"yingce/backend/internal/protocol"
)

func TestSenseNovaImageWatermarkUpgradeRetainsPreviousRelease(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "sensenova-image.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := protocol.ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	// Synthetic installed v1 reproduces the old missing-watermark fallback.
	previous := pkg.Manifest
	previous.Metadata.Version = "1.0.0"
	previous.Contributes.Providers[0].Create.Body.(map[string]any)["watermark"] = map[string]any{"$coalesce": []any{map[string]any{"$ref": "request.providerOptions.sensenova-image.watermark"}, true}}
	previousRaw, err := json.Marshal(previous)
	if err != nil {
		t.Fatal(err)
	}
	previousPackage := testPluginPackage(t, previousRaw)
	digest := fmt.Sprintf("%x", sha256.Sum256(previousPackage))
	dataDir := t.TempDir()
	packageDir := filepath.Join(dataDir, "plugin-packages")
	if err := os.MkdirAll(packageDir, 0o700); err != nil {
		t.Fatal(err)
	}
	previousPath := digest + ".yingce-plugin"
	if err := os.WriteFile(filepath.Join(packageDir, previousPath), previousPackage, 0o600); err != nil {
		t.Fatal(err)
	}
	seed := &pluginRuntime{registryPath: filepath.Join(dataDir, "plugin_registry.json")}
	if err := seed.writeRegistry([]pluginRegistryRecord{{ID: "sensenova-image", Raw: previousRaw, Source: PluginOriginOfficial, FileName: "sensenova-image.yingce-plugin", PackagePath: previousPath, PackageSHA256: digest}}); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		center, err := newPluginRuntime(dataDir)
		if err != nil {
			t.Fatalf("upgrade/restart failed: %v", err)
		}
		installed := center.plugins["sensenova-image"]
		if installed.Metadata.Version != "2.0.0" || len(installed.History) != 1 || installed.History[0].Version != "1.0.0" || installed.History[0].SHA256 != digest {
			t.Fatalf("upgrade lost original release: version=%s history=%#v", installed.Metadata.Version, installed.History)
		}
		archived, err := center.verifiedRequestManifest("sensenova-image", requestPackageVersion{Version: "1.0.0", SHA256: digest}, true)
		if err != nil {
			t.Fatal(err)
		}
		archivedRaw, err := json.Marshal(archived)
		if err != nil {
			t.Fatal(err)
		}
		adapters, err := protocol.LoadInstalledProviders(archivedRaw, nil)
		if err != nil || len(adapters) != 1 {
			t.Fatalf("load pinned v1: %v", err)
		}
		current, ok := center.registrySnapshot().Resolve("sensenova-image")
		if !ok {
			t.Fatal("new image protocol missing")
		}
		for _, version := range []struct {
			adapter protocol.Adapter
			want    bool
		}{{adapters[0], true}, {current, false}} {
			spec, err := version.adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocol.GenerationRequest{Capability: protocol.CapabilityImage, Model: "sensenova-u1.6-lite", Prompt: "fixture", AspectRatio: "auto"}})
			if err != nil || protocolBodyObject(spec.Body)["watermark"] != version.want {
				t.Fatalf("version=%s watermark=%#v want=%t err=%v", version.adapter.Metadata().Version, protocolBodyObject(spec.Body)["watermark"], version.want, err)
			}
		}
	}
	retained, err := os.ReadFile(filepath.Join(packageDir, previousPath))
	if err != nil || !bytes.Equal(retained, previousPackage) {
		t.Fatalf("original archived package was changed: %v", err)
	}
}

func TestSenseNovaImageRuntimeWatermarkContract(t *testing.T) {
	allowLoopbackProviderTest(t)
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ctx := withProtocolRegistry(context.Background(), center.registrySnapshot())
	adapter, ok := declarativeProtocolAdapterForContext(ctx, "sensenova-image")
	if !ok {
		t.Fatal("official SenseNova image plugin was not installed")
	}
	var output bytes.Buffer
	if err := png.Encode(&output, image.NewRGBA(image.Rect(0, 0, 512, 512))); err != nil {
		t.Fatal(err)
	}
	encoded := base64.StdEncoding.EncodeToString(output.Bytes())
	for _, tc := range []struct {
		name         string
		enabled      bool
		defaultValue any
		explicit     map[string]any
		want         bool
	}{
		{"disabled-default-true", false, true, nil, false},
		{"disabled-default-false", false, false, nil, false},
		{"enabled-default-true", true, true, nil, true},
		{"enabled-default-false", true, false, nil, false},
		{"enabled-explicit-false", true, true, map[string]any{"watermark": false}, false},
		{"enabled-explicit-true", true, false, map[string]any{"watermark": true}, true},
		{"enabled-without-default", true, nil, nil, false},
	} {
		for _, references := range []int{0, 1} {
			path := "/v1/images/generations"
			if references > 0 {
				path = "/v1/images/edits"
			}
			t.Run(tc.name+path, func(t *testing.T) {
				parameters, err := protocol.ResolveImageParameters(adapter.Metadata().ImageParameters, []protocol.ImageParameter{{Name: "watermark", Enabled: &tc.enabled, Default: tc.defaultValue}}, "sensenova-u1.6-lite")
				if err != nil {
					t.Fatal(err)
				}
				profile := &ImageCapabilityConfig{Parameters: parameters, Size: ImageSizeConfig{Parameter: "size", Default: "auto", AllowCustom: true}}
				var creates atomic.Int32
				upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					creates.Add(1)
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Errorf("decode JSON: %v", err)
						http.Error(w, "invalid JSON", http.StatusBadRequest)
						return
					}
					if r.URL.Path != path || body["watermark"] != tc.want {
						t.Errorf("path=%s watermark=%#v, want %s / %t", r.URL.Path, body["watermark"], path, tc.want)
					}
					for _, name := range []string{"prompt_extend", "self_correction"} {
						if body[name] != true {
							t.Errorf("unrelated %s default changed: %#v", name, body[name])
						}
					}
					w.Header().Set("Content-Type", "application/json")
					// Synthetic host-compatible response, not a vendor schema assertion.
					_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"b64_json": encoded}}, "usage": map[string]any{"output_image_count": 1}})
				}))
				defer upstream.Close()
				config := providerConfig{BaseURL: upstream.URL, APIKey: "fixture-key", InterfaceType: "sensenova-image", Model: "sensenova-u1.6-lite", Size: "auto", Count: "1", ImageParameters: tc.explicit}
				if err := applyImageParameterValues(&config, profile); err != nil {
					t.Fatal(err)
				}
				input := canvasGenerationInput{Mode: "image", Prompt: "fixture watermark", Config: config}
				if references > 0 {
					input.ReferenceImages = []providerMedia{{Name: "reference.png", Type: "image/png", DataURL: "data:image/png;base64," + encoded}}
				}
				if result, err := runProtocolAdapterTask(ctx, input, adapter); err != nil || result == nil {
					t.Fatalf("runtime result=%#v error=%v", result, err)
				}
				if creates.Load() != 1 {
					t.Fatalf("create sent %d times", creates.Load())
				}
			})
		}
	}
}

// All servers and image bytes are local fixtures; this does not call SenseNova or charge an account.
func TestSenseNovaImageRuntimeUsesJSONAndMaterializesURL(t *testing.T) {
	allowLoopbackProviderTest(t)
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ctx := withProtocolRegistry(context.Background(), center.registrySnapshot())
	adapter, ok := declarativeProtocolAdapterForContext(ctx, "sensenova-image")
	if !ok {
		t.Fatal("official SenseNova image plugin was not installed")
	}
	var output bytes.Buffer
	if err := png.Encode(&output, image.NewRGBA(image.Rect(0, 0, 512, 512))); err != nil {
		t.Fatal(err)
	}
	encoded := base64.StdEncoding.EncodeToString(output.Bytes())
	var creates, downloads atomic.Int32
	mediaServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		downloads.Add(1)
		if r.URL.Path != "/media/output.png" || r.Header.Get("Authorization") != "" {
			t.Errorf("unexpected media request: %s, authorization present: %t", r.URL.Path, r.Header.Get("Authorization") != "")
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(output.Bytes())
	}))
	defer mediaServer.Close()
	var expectedReferences atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		creates.Add(1)
		if r.Header.Get("Authorization") != "Bearer fixture-key" || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("expected authenticated JSON request on %s", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode JSON: %v", err)
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		path := "/v1/images/generations"
		count := int(expectedReferences.Load())
		if count > 0 {
			path = "/v1/images/edits"
			images, _ := body["images"].([]any)
			if len(images) != count {
				t.Errorf("reference count = %d, want %d", len(images), count)
			}
			for index, raw := range images {
				item, _ := raw.(map[string]any)
				if len(item) != 1 || item["image_url"] != "data:image/png;base64,"+encoded {
					t.Errorf("reference %d does not preserve ordered image_url", index)
				}
			}
		} else if _, present := body["images"]; present {
			t.Error("generation must omit images")
		}
		if r.URL.Path != path || body["model"] != "sensenova-u1.6-lite" || body["n"] != float64(1) || body["size"] != "2720x1536" || body["response_format"] != "url" || body["output_format"] != "png" {
			t.Errorf("request path=%s body contract mismatch", r.URL.Path)
		}
		for _, name := range []string{"watermark", "prompt_extend", "self_correction"} {
			if body[name] != false {
				t.Errorf("%s did not preserve false", name)
			}
		}
		for _, name := range []string{"quality", "background", "mask", "aspect_ratio", "area", "resolution", "output_compression", "stream"} {
			if _, present := body[name]; present {
				t.Errorf("unsupported field %s was sent", name)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []any{map[string]any{"url": mediaServer.URL + "/media/output.png"}},
			"size": "512x512", "output_format": "png",
			"usage": map[string]any{"input_image_count": count, "output_image_count": 1, "total_tokens": 123},
		})
	}))
	defer upstream.Close()
	input := canvasGenerationInput{Mode: "image", Prompt: "fixture image", Config: providerConfig{
		BaseURL: upstream.URL, APIKey: "fixture-key", InterfaceType: "sensenova-image", Model: "sensenova-u1.6-lite", Size: "2720x1536", Count: "1",
		ImageParameters: map[string]any{"size": "2720x1536", "count": 1, "quality": "auto", "transparentBackground": false, "outputFormat": "png", "watermark": false, "promptExtend": false, "selfCorrection": false},
	}}
	for _, references := range []int{0, 1, 5} {
		expectedReferences.Store(int32(references))
		input.ReferenceImages = make([]providerMedia, references)
		for index := range input.ReferenceImages {
			input.ReferenceImages[index] = providerMedia{Name: "reference.png", Type: "image/png", DataURL: "data:image/png;base64," + encoded}
		}
		result, err := runProtocolAdapterTask(ctx, input, adapter)
		if err != nil {
			t.Fatal(err)
		}
		images, _ := result["images"].([]interface{})
		if result["mode"] != "image" || len(images) != 1 {
			t.Fatalf("result image contract mismatch: %#v", result)
		}
		item, _ := images[0].(map[string]interface{})
		if item["dataUrl"] != "data:image/png;base64,"+encoded || item["mimeType"] != "image/png" {
			t.Fatal("temporary URL was not materialized into the expected fixture bytes")
		}
		metadata, _ := item["metadata"].(map[string]any)
		if metadata["size"] != "512x512" || metadata["output_format"] != "png" {
			t.Fatalf("metadata = %#v", metadata)
		}
		usage, _ := result["usage"].(map[string]any)
		if usage["input_image_count"] != float64(references) || usage["output_image_count"] != float64(1) || usage["input_images"] != float64(references) || usage["generated_images"] != float64(1) {
			t.Fatalf("usage = %#v", usage)
		}
	}
	// A base URL ending in /v1 must not produce /v1/v1/images/edits.
	input.Config.BaseURL = upstream.URL + "/v1"
	if _, err := runProtocolAdapterTask(ctx, input, adapter); err != nil {
		t.Fatalf("versioned base URL: %v", err)
	}
	if creates.Load() != 4 || downloads.Load() != 4 {
		t.Fatalf("creates=%d downloads=%d", creates.Load(), downloads.Load())
	}
}

func TestSenseNovaImageRuntimeFailureDoesNotResubmit(t *testing.T) {
	allowLoopbackProviderTest(t)
	adapter := imageParameterTestAdapter(t, "sensenova-image", "sensenova-image")
	for _, test := range []struct {
		name, body, message string
		status              int
	}{
		{"empty result", `{"data":[]}`, "没有返回可用图片", http.StatusOK},
		{"too many outputs", `{"data":[{"url":"https://cdn.example/a.png"},{"url":"https://cdn.example/b.png"}]}`, "n=1", http.StatusOK},
		{"business error", `{"error":{"type":"failed_precondition_error","code":"3","message":"safety check failed"}}`, "safety check failed", http.StatusOK},
		{"invalid request", `{"error":{"type":"invalid_request_error","code":"3","message":"invalid size"}}`, "invalid size", http.StatusBadRequest},
		{"quota", `{"error":{"type":"quota_exceeded_error","message":"quota exceeded"}}`, "模型服务请求过于频繁或额度不足，请稍后重试", http.StatusTooManyRequests},
		{"server error", `{"error":{"type":"internal_server_error","message":"fixture server error"}}`, "fixture server error", http.StatusInternalServerError},
	} {
		t.Run(test.name, func(t *testing.T) {
			var creates atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				creates.Add(1)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(test.body))
			}))
			defer server.Close()
			input := canvasGenerationInput{Mode: "image", Prompt: "fixture image", Config: providerConfig{BaseURL: server.URL, InterfaceType: "sensenova-image", Model: "sensenova-u1.6-lite", APIKey: "fixture-key", Size: "auto", Count: "1"}}
			result, err := runProtocolAdapterTask(context.Background(), input, adapter)
			if err == nil || !strings.Contains(err.Error(), test.message) || result != nil {
				t.Fatalf("result=%#v err=%v", result, err)
			}
			// User-facing quota text is normalized; the HTTP failure remains machine-readable.
			if test.status != http.StatusOK {
				var httpErr providerHTTPError
				if !errors.As(err, &httpErr) || httpErr.StatusCode != test.status {
					t.Fatalf("HTTP status was lost: got %v, want %d", err, test.status)
				}
			}
			if creates.Load() != 1 {
				t.Fatalf("non-idempotent create was retried %d times", creates.Load())
			}
		})
	}
}
