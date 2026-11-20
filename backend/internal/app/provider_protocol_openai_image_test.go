package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/gif"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOpenAIImageProtocolPreservesAnimatedGIF(t *testing.T) {
	allowLoopbackProviderTest(t)
	adapter := imageParameterTestAdapter(t, "openai-images", "openai-image")
	palette := color.Palette{color.Black, color.White}
	first := image.NewPaletted(image.Rect(0, 0, 2, 2), palette)
	second := image.NewPaletted(image.Rect(0, 0, 2, 2), palette)
	second.SetColorIndex(0, 0, 1)
	var animation bytes.Buffer
	if err := gif.EncodeAll(&animation, &gif.GIF{Image: []*image.Paletted{first, second}, Delay: []int{10, 20}, LoopCount: 0}); err != nil {
		t.Fatal(err)
	}
	encoded := base64.StdEncoding.EncodeToString(animation.Bytes())
	for _, responseKind := range []string{"base64", "base64-no-format", "base64-wrong-format", "url"} {
		for _, edit := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/edit-%t", responseKind, edit), func(t *testing.T) {
				var server *httptest.Server
				server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == "/animation.gif" {
						w.Header().Set("Content-Type", "image/gif")
						_, _ = w.Write(animation.Bytes())
						return
					}
					var outputFormat string
					if edit {
						if r.URL.Path != "/v1/images/edits" {
							t.Errorf("edit path = %s", r.URL.Path)
						}
						if err := r.ParseMultipartForm(1 << 20); err != nil {
							t.Error(err)
							return
						}
						defer r.MultipartForm.RemoveAll()
						outputFormat = r.FormValue("output_format")
					} else {
						var body map[string]any
						if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
							t.Error(err)
							return
						}
						outputFormat, _ = body["output_format"].(string)
					}
					if outputFormat != "gif" {
						t.Errorf("output_format = %q, want gif", outputFormat)
					}
					response := map[string]any{"data": []any{map[string]string{"b64_json": encoded}}}
					switch responseKind {
					case "base64":
						response["output_format"] = "gif"
					case "base64-wrong-format":
						response["output_format"] = "png"
					case "url":
						response["data"] = []any{map[string]string{"url": server.URL + "/animation.gif"}}
					}
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(response)
				}))
				defer server.Close()
				input := canvasGenerationInput{Mode: "image", Prompt: "animated cat", Config: providerConfig{
					Model: "gpt-image-2.6", InterfaceType: "openai-image", BaseURL: server.URL,
					ImageParameters: map[string]any{"outputFormat": "gif"},
				}}
				if edit {
					input.ReferenceImages = []providerMedia{{Name: "reference.png", Type: "image/png", DataURL: testReferenceImageDataURL}}
				}
				result, err := runProtocolAdapterTask(context.Background(), input, adapter)
				if err != nil {
					t.Fatal(err)
				}
				items := result["images"].([]interface{})
				item := items[0].(map[string]interface{})
				if item["mimeType"] != "image/gif" || item["dataUrl"] != "data:image/gif;base64,"+encoded {
					t.Fatalf("animation bytes or MIME changed: %#v", item)
				}
			})
		}
	}
}

func TestOpenAIImageProtocolKeepsResolutionInSize(t *testing.T) {
	allowLoopbackProviderTest(t)
	adapter := imageParameterTestAdapter(t, "openai-images", "openai-image")
	for _, preset := range []struct{ name, tier, selection, size, quality string }{
		{"1k", "1k", "16:9", "1824x1024", "high"},
		{"2k", "2k", "16:9", "2752x1536", "auto"},
		{"4k", "4k", "16:9", "3840x2160", "medium"},
		{"2k-auto-size", "2k", "auto", "auto", "auto"},
		{"auto", "auto", "auto", "auto", "auto"},
	} {
		for _, references := range []int{0, 1, 4} {
			t.Run(fmt.Sprintf("%s/references-%d", preset.name, references), func(t *testing.T) {
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					path := "/v1/images/generations"
					body := map[string]any{}
					if references == 0 {
						if r.Header.Get("Content-Type") != "application/json" {
							t.Errorf("content type = %q", r.Header.Get("Content-Type"))
						}
						if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
							t.Error(err)
							http.Error(w, "invalid JSON", http.StatusBadRequest)
							return
						}
					} else {
						path = "/v1/images/edits"
						if err := r.ParseMultipartForm(1 << 20); err != nil {
							t.Error(err)
							http.Error(w, "invalid multipart", http.StatusBadRequest)
							return
						}
						defer r.MultipartForm.RemoveAll()
						for key, values := range r.MultipartForm.Value {
							body[key] = values[0]
						}
						field := "image"
						if references > 1 {
							field = "image[]"
						}
						files := r.MultipartForm.File[field]
						if len(files) != references || len(r.MultipartForm.File) != 1 {
							t.Errorf("reference files = %#v", r.MultipartForm.File)
						}
						for _, header := range files {
							file, err := header.Open()
							if err != nil {
								t.Error(err)
								continue
							}
							data, err := io.ReadAll(file)
							_ = file.Close()
							if err != nil || string(data) != "hello" {
								t.Errorf("reference bytes = %q, error = %v", data, err)
							}
						}
					}
					if r.Method != http.MethodPost || r.URL.Path != path {
						t.Errorf("request = %s %s", r.Method, r.URL.Path)
					}
					if _, exists := body["resolution"]; exists {
						t.Errorf("OpenAI Images received unsupported resolution = %#v", body["resolution"])
					}
					if _, exists := body["imageResolution"]; exists {
						t.Error("imageResolution leaked into the upstream request")
					}
					for key, want := range map[string]string{
						"model": "gpt-image-2.6-sunburst", "prompt": "a product photo", "n": "1", "output_format": "png",
						"size": preset.size, "quality": preset.quality,
					} {
						if want == "auto" {
							if _, exists := body[key]; exists {
								t.Errorf("automatic %s should be omitted: %#v", key, body[key])
							}
						} else if fmt.Sprint(body[key]) != want {
							t.Errorf("%s = %#v, want %q", key, body[key], want)
						}
					}
					w.Header().Set("Content-Type", "application/json")
					_, _ = io.WriteString(w, `{"data":[{"b64_json":"aGVsbG8="}]}`)
				}))
				defer server.Close()
				input := canvasGenerationInput{Mode: "image", Prompt: "a product photo", Config: providerConfig{
					Model: "gpt-image-2.6-sunburst", InterfaceType: "openai-image", BaseURL: server.URL, APIKey: "test-key",
					Size: preset.size, ImageResolution: preset.tier, Quality: preset.quality, Count: "1",
					ImageParameters: map[string]any{"size": preset.selection, "imageResolution": preset.tier, "quality": preset.quality, "count": 1, "outputFormat": "png"},
				}}
				for index := 0; index < references; index++ {
					input.ReferenceImages = append(input.ReferenceImages, providerMedia{
						Name: fmt.Sprintf("reference-%d.png", index), Type: "image/png", DataURL: testReferenceImageDataURL,
					})
				}
				result, err := runProtocolAdapterTask(context.Background(), input, adapter)
				if err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(fmt.Sprint(result["images"]), "data:image/png;base64,aGVsbG8=") {
					t.Fatalf("images = %#v", result["images"])
				}
				if input.Config.ImageParameters["imageResolution"] != preset.tier {
					t.Fatal("resolution selection was changed")
				}
			})
		}
	}
}
