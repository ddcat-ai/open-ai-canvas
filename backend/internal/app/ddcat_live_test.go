package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	_ "image/png"
	"os"
	"strings"
	"testing"
	"time"
)

// Opt-in only: this test makes two paid requests and never logs credentials or payloads.
func TestDDCatLiveImageRoundTrip(t *testing.T) {
	key := os.Getenv("DDCAT_SMOKE_API_KEY")
	if key == "" {
		t.Skip("set DDCAT_SMOKE_API_KEY to explicitly enable paid live verification")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	ctx = withProtocolRegistry(ctx, loadOfficialFallbackRegistry())
	input := canvasGenerationInput{Mode: "image", Prompt: "A single blue ceramic cup on a plain white background, no text.", Config: providerConfig{BaseURL: "https://api.ddcat.pronhubcn.com/v1", APIKey: key, Model: "gpt-image-2.5", InterfaceType: "openai-image", Size: "1:1"}}
	for _, mode := range []string{"generate", "edit"} {
		result, err := runImageTask(ctx, input)
		if err != nil {
			t.Fatalf("%s failed: %v", mode, err)
		}
		images, ok := result["images"].([]interface{})
		if !ok || len(images) == 0 {
			t.Fatalf("%s returned no images", mode)
		}
		item, ok := images[0].(map[string]interface{})
		if !ok {
			t.Fatal("invalid image result")
		}
		dataURL := stringField(item, "dataUrl")
		_, encoded, ok := strings.Cut(dataURL, ",")
		if !ok {
			t.Fatal("missing inline image")
		}
		raw, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			t.Fatal("invalid image base64")
		}
		info, format, err := image.DecodeConfig(bytes.NewReader(raw))
		if err != nil {
			t.Fatalf("invalid image bytes: %v", err)
		}
		t.Logf("%s: %s %dx%d, %d bytes", mode, format, info.Width, info.Height, len(raw))
		if dir := os.Getenv("DDCAT_SMOKE_OUTPUT"); dir != "" {
			if err := os.WriteFile(dir+"/"+mode+".png", raw, 0600); err != nil {
				t.Fatal(err)
			}
		}
		input.ReferenceImages = []providerMedia{{Name: "reference.png", Type: "image/png", DataURL: dataURL}}
		input.Prompt = "Change the blue cup to red. Keep the white background and composition."
	}
}
