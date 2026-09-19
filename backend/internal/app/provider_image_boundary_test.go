package app

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOpenAIImageRejectsInvalidSizeBeforeSubmission(t *testing.T) {
	for _, size := range []string{"banana", "7:0", "0x1024", "-1x1024", "4097x1024", "1024x5000"} {
		t.Run(size, func(t *testing.T) {
			_, err := runImageTask(context.Background(), canvasGenerationInput{Mode: "image", Config: providerConfig{InterfaceType: "openai-image", BaseURL: "https://api.ddcat.pronhubcn.com/v1", Size: size}})
			if err == nil || !strings.Contains(err.Error(), "尺寸") {
				t.Fatalf("expected local size rejection: %v", err)
			}
		})
	}
	for _, size := range []string{"", "auto", "1:1", "16:9", "1024x1024", "4096x4096"} {
		if err := validateOpenAIImageInput(canvasGenerationInput{Config: providerConfig{Size: size}}); err != nil {
			t.Fatalf("valid size %q: %v", size, err)
		}
	}
}

func TestOpenAIImageRejectsMaskWithoutSourceBeforePlugin(t *testing.T) {
	_, err := runImageTask(context.Background(), canvasGenerationInput{Mode: "image", Config: providerConfig{InterfaceType: "openai-image"}, Mask: &providerMedia{ID: "mask"}})
	if err == nil || !strings.Contains(err.Error(), "源图片") {
		t.Fatalf("expected missing source rejection: %v", err)
	}
}

func TestProviderConnectionErrorPreservesCause(t *testing.T) {
	for _, cause := range []error{io.EOF, io.ErrUnexpectedEOF} {
		err := providerConnectionError(cause)
		if !errors.Is(err, cause) || !strings.Contains(err.Error(), "扣费记录") {
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if providerConnectionError(context.Canceled) != context.Canceled {
		t.Fatal("cancellation must remain unchanged")
	}
}

func TestImageSubmissionEOFIsNotAutomaticallyReplayed(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		conn.Close()
	}))
	defer server.Close()
	err := postJSON(context.Background(), providerConfig{BaseURL: server.URL}, "/v1/images/generations", map[string]string{"prompt": "cup"}, &map[string]interface{}{})
	if err == nil || !strings.Contains(err.Error(), "连接提前关闭") || calls != 1 {
		t.Fatalf("calls=%d error=%v", calls, err)
	}
}
