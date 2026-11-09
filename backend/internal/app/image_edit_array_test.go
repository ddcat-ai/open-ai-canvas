package app

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestOpenAIImageEditReferenceArray(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	for _, count := range []int{1, 2, 3} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if err := r.ParseMultipartForm(2 << 20); err != nil {
				t.Error(err)
				return
			}
			defer r.MultipartForm.RemoveAll()
			field := "image"
			if count > 1 {
				field = "image[]"
			}
			files := r.MultipartForm.File[field]
			if len(files) != count {
				t.Errorf("%s count = %d, want %d", field, len(files), count)
			}
			if len(r.MultipartForm.File) != 1 {
				t.Errorf("unexpected file fields: %v", r.MultipartForm.File)
			}
			for _, header := range files {
				f, err := header.Open()
				if err != nil {
					t.Error(err)
					continue
				}
				data, err := io.ReadAll(f)
				f.Close()
				if err != nil || string(data) != "hello" {
					t.Errorf("reference data lost: %v", err)
				}
			}
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"data":[{"b64_json":"aGVsbG8="}]}`)
		}))
		refs := make([]providerMedia, count)
		for i := range refs {
			refs[i] = providerMedia{Name: "reference.png", Type: "image/png", DataURL: testReferenceImageDataURL}
		}
		_, err := runImageTask(context.Background(), canvasGenerationInput{Prompt: "edit", Config: providerConfig{BaseURL: server.URL, APIKey: "key", Model: "gpt-image-2", InterfaceType: "openai-image"}, ImageCapability: DefaultImageCapabilityConfig("openai-image", "gpt-image-2"), ReferenceImages: refs})
		server.Close()
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestFailedProviderCallRuntimeLogRedaction(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	logFailedProviderCall(model.ApiCallLog{Status: model.ApiCallStatusFailed, TaskID: "task-array", ChannelID: "channel", StatusCode: 400, ErrorCode: "duplicate_parameter", Error: "Duplicate parameter: image; Authorization: Bearer private-bearer-key; api_key=private-test-key https://example.com/private?token=secret", RequestBody: "private-prompt", ResponseBody: "private-response"})
	text := output.String()
	for _, want := range []string{"task-array", "duplicate_parameter", "400", "Duplicate parameter"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %s", want)
		}
	}
	for _, secret := range []string{"private-bearer-key", "private-test-key", "example.com", "private-prompt", "private-response"} {
		if strings.Contains(text, secret) {
			t.Errorf("leaked %s", secret)
		}
	}
	output.Reset()
	logFailedProviderCall(model.ApiCallLog{Status: model.ApiCallStatusSucceeded})
	if output.Len() != 0 {
		t.Fatal("successful call logged as failure")
	}
}
