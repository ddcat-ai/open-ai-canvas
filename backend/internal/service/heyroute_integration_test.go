package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"infinite-canvas/backend/internal/protocol"
)

func heyrouteImageAdapter(t *testing.T) protocol.Adapter {
	t.Helper()
	data, err := os.ReadFile("../../../plugin-packages/heyroute-image-v1.yingce-plugin")
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := protocol.ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	adapters, err := protocol.LoadInstalledProviders(pkg.ManifestRaw, nil)
	if err != nil {
		t.Fatal(err)
	}
	return adapters[0]
}

func TestHeyrouteImageHTTPTransport(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, editing := range []bool{false, true} {
		t.Run(map[bool]string{false: "JSON generation", true: "multipart editing"}[editing], func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Header.Get("Authorization") != "Bearer test-placeholder" {
					t.Error("missing auth")
				}
				if editing {
					if r.URL.Path != "/v1/images/edits" {
						t.Error("wrong edit path", r.URL.Path)
					}
					if err := r.ParseMultipartForm(1 << 20); err != nil {
						t.Error(err)
						return
					}
					if len(r.MultipartForm.File["image"]) != 2 || len(r.MultipartForm.File["mask"]) != 1 || r.FormValue("stream") != "true" {
						t.Error("incorrect multipart mapping")
					}
				} else {
					if r.URL.Path != "/v1/images/generations" {
						t.Error("wrong create path", r.URL.Path)
					}
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
						return
					}
					if body["n"] != float64(1) || body["response_format"] != "b64_json" || body["stream"] != true {
						t.Error("wrong generation payload")
					}
				}
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = io.WriteString(w, "event: started\ndata: {}\n\nevent: completed\ndata: {\"data\":[{\"b64_json\":\"AA==\"}]}\n\n")
				w.(http.Flusher).Flush()
				<-r.Context().Done()
			}))
			defer server.Close()
			adapter := heyrouteImageAdapter(t)
			request := protocol.GenerationRequest{Model: "gpt-image-2", Prompt: "a paper boat", AspectRatio: "1024x1024", ImageCount: 1}
			if editing {
				request.Images = []protocol.MediaReference{{DataURL: testGeminiReferenceImageDataURL}, {DataURL: testGeminiReferenceImageDataURL}, {DataURL: testGeminiReferenceImageDataURL, Role: "mask", MIMEType: "image/png"}}
			}
			spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: request})
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			data, err := executeProtocolRequest(ctx, providerConfig{BaseURL: server.URL, APIKey: "test-placeholder"}, spec)
			if err != nil {
				t.Fatal(err)
			}
			result, err := adapter.ParseCreate(ctx, data)
			if err != nil || result.Status != protocol.StatusSucceeded || len(result.Result.Images) != 1 {
				t.Fatalf("result %#v %v", result, err)
			}
			if calls.Load() != 1 {
				t.Fatal("generation submitted more than once")
			}
		})
	}
}

func TestHeyroutePluginInstallSurvivesRegistryFormatting(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile("../../../plugin-packages/heyroute-video-v1.yingce-plugin")
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := protocol.ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(pkg.ManifestRaw, &manifest); err != nil {
		t.Fatal(err)
	}
	manifest["id"] = "heyroute-test-upload"
	for _, p := range manifest["contributes"].(map[string]any)["providers"].([]any) {
		p.(map[string]any)["id"] = p.(map[string]any)["id"].(string) + "-test-upload"
	}
	encoded, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	z := zip.NewWriter(&archive)
	f, err := z.Create("manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.Write(encoded); err != nil {
		t.Fatal(err)
	}
	if err = z.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err = center.install(archive.Bytes(), "heyroute-test-upload.yingce-plugin"); err != nil {
		t.Fatal("install failed:", err)
	}
	records, err := center.readRegistry()
	if err != nil {
		t.Fatal(err)
	}
	legacy, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	var inflated []pluginRegistryRecord
	if err := json.Unmarshal(legacy, &inflated); err != nil {
		t.Fatal(err)
	}
	oversized := false
	for _, r := range inflated {
		if r.ID == "heyroute-test-upload" {
			oversized = len(r.Raw) > protocolPluginMaxBytes
		}
	}
	if !oversized {
		t.Fatal("test did not reproduce whitespace inflation")
	}
	if err := os.WriteFile(center.registryPath, legacy, 0600); err != nil {
		t.Fatal(err)
	}
	if err := center.reload(); err != nil {
		t.Fatal("legacy formatted registry rejected:", err)
	}
}

func TestHeyrouteOriginURLsAndCapabilityDefaults(t *testing.T) {
	for _, path := range []string{"/v1/models", "/v1/videos", "/v1/images/generations", "/v1/images/edits", "/v1/videos/task_example/content"} {
		got, err := protocolRequestURL("https://heyroute.ai", protocol.RequestSpec{Path: path})
		if err != nil || got != "https://heyroute.ai"+path {
			t.Fatalf("wrong URL %q %v", got, err)
		}
	}
	for _, pair := range [][2]string{{"heyroute-image", "gpt-image-2"}, {"heyroute-image", "nano-banana-2"}, {"heyroute-video", "grok-video"}, {"heyroute-video", "seedance-2.0"}} {
		cfg := DefaultModelCapabilityConfigForModel(pair[0], pair[1])
		if strings.Contains(pair[0], "image") {
			if cfg.Image == nil || cfg.Image.MaxOutputs != 1 {
				t.Fatal("image defaults")
			}
		} else if cfg.Video == nil {
			t.Fatal("video defaults")
		}
	}
}
