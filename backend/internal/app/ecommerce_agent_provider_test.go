package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestEcommerceAgentImageEditSendsReferenceAndSupportedSize(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	pixel := image.NewRGBA(image.Rect(0, 0, 1, 1))
	pixel.Set(0, 0, color.RGBA{R: 255, A: 255})
	wantSize := "1024x1536"
	var pngBody bytes.Buffer
	if err := png.Encode(&pngBody, pixel); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if (r.URL.Path != "/images/edits" && r.URL.Path != "/v1/images/edits") || r.Header.Get("Authorization") != "Bearer server-key" {
			t.Errorf("request target/auth: %s %s", r.URL.Path, r.Header.Get("Authorization"))
		}
		if err := r.ParseMultipartForm(2 << 20); err != nil {
			t.Error(err)
			return
		}
		if r.FormValue("size") != wantSize || r.FormValue("model") != "gpt-image-1" || r.FormValue("prompt") != "faithful product" {
			t.Errorf("form fields: %v", r.MultipartForm.Value)
		}
		file, _, err := r.FormFile("image")
		if err != nil {
			t.Error(err)
			return
		}
		defer file.Close()
		var received bytes.Buffer
		_, _ = received.ReadFrom(file)
		if !bytes.Equal(received.Bytes(), pngBody.Bytes()) {
			t.Error("source product pixels were not sent")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{{"b64_json": base64.StdEncoding.EncodeToString(pngBody.Bytes())}}})
	}))
	defer server.Close()
	cfg := ecommerceProviderConfig{ImageBaseURL: server.URL, ImageKey: "server-key", ImageModel: "gpt-image-1", ImageTimeout: time.Second}
	got, upstreamURL, err := ecommerceImage(context.Background(), cfg, "test-task", "faithful product", "9:16", "image/png", pngBody.Bytes(), 32000)
	if err != nil || upstreamURL != "" || !bytes.Equal(got, pngBody.Bytes()) {
		t.Fatalf("image result bytes=%d url=%q err=%v", len(got), upstreamURL, err)
	}
	cfg.ImageProvider = &providerConfig{BaseURL: server.URL + "/v1", APIKey: "server-key", APIFormat: "openai", Model: "gpt-image-1"}
	got, upstreamURL, err = ecommerceImage(context.Background(), cfg, "test-task", "faithful product", "9:16", "image/png", pngBody.Bytes(), 32000)
	if err != nil || upstreamURL != "" || !bytes.Equal(got, pngBody.Bytes()) {
		t.Fatalf("existing provider transport: bytes=%d url=%q err=%v", len(got), upstreamURL, err)
	}
	wantSize = "1024x1824"
	cfg.ImageProvider.CapabilityConfig = &ModelCapabilityConfig{Image: &ImageCapabilityConfig{Size: ImageSizeConfig{Presets: []ImageSizePreset{{Tier: "1k", Ratio: "9:16", Size: wantSize, Width: 1024, Height: 1824}}, DefaultTier: "1k"}}}
	got, upstreamURL, err = ecommerceImage(context.Background(), cfg, "test-task", "faithful product", "9:16", "image/png", pngBody.Bytes(), 32000)
	if err != nil || upstreamURL != "" || !bytes.Equal(got, pngBody.Bytes()) {
		t.Fatalf("channel size preset: bytes=%d url=%q err=%v", len(got), upstreamURL, err)
	}
	if _, _, err := ecommerceImage(context.Background(), cfg, "test-task", "faithful product", "16:9", "image/png", pngBody.Bytes(), 32000); err == nil {
		t.Fatal("unsupported channel aspect ratio was sent upstream")
	}
}
