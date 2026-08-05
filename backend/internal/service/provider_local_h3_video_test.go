package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRunLocalH3VideoTaskUsesMultipartUpload(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	paths := make([]string, 0, 3)
	var sawImages int
	var prompt string
	var modelName string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/video/generations/upload":
			if auth := r.Header.Get("Authorization"); auth != "Bearer local-h3" {
				t.Errorf("Authorization = %q", auth)
			}
			if !strings.Contains(r.Header.Get("Content-Type"), "multipart/form-data") {
				t.Errorf("Content-Type = %q", r.Header.Get("Content-Type"))
			}
			if err := r.ParseMultipartForm(8 << 20); err != nil {
				t.Fatalf("ParseMultipartForm: %v", err)
			}
			prompt = r.FormValue("prompt")
			modelName = r.FormValue("model")
			sawImages = len(r.MultipartForm.File["images"])
			if r.FormValue("seconds") != "5" || r.FormValue("size") != "480p" {
				t.Errorf("form seconds/size = %q/%q", r.FormValue("seconds"), r.FormValue("size"))
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"h3-task","task_id":"h3-task","status":"QUEUED"}`))
		case "GET /v1/video/generations/h3-task":
			w.Header().Set("Content-Type", "application/json")
			payload := map[string]interface{}{
				"task_id":    "h3-task",
				"status":     "SUCCESS",
				"result_url": server.URL + "/v1/files/h3-task",
				"video_url":  server.URL + "/v1/files/h3-task",
			}
			_ = json.NewEncoder(w).Encode(payload)
		case "GET /v1/files/h3-task":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("h3-video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runVideoTask(context.Background(), canvasGenerationInput{
		Prompt: "男孩超人与机甲龙",
		Config: providerConfig{
			BaseURL:      server.URL,
			APIKey:       "local-h3",
			Model:        "minimax-h3-r2v-sage",
			InterfaceType: "local-h3-video",
			VideoSeconds: "5",
			Size:         "16:9",
			VQuality:     "480p",
		},
		ReferenceImages: []providerMedia{
			{ID: "image-1", DataURL: testReferenceImageDataURL},
			{ID: "image-2", DataURL: testReferenceImageDataURL},
		},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	if prompt != "男孩超人与机甲龙" || modelName != "minimax-h3-r2v-sage" || sawImages != 2 {
		t.Fatalf("upload form prompt=%q model=%q images=%d", prompt, modelName, sawImages)
	}
	video := result["video"].(map[string]interface{})
	if !strings.HasPrefix(video["dataUrl"].(string), "data:video/mp4;base64,") {
		t.Fatalf("video = %#v", video)
	}
	want := "POST /v1/video/generations/upload,GET /v1/video/generations/h3-task,GET /v1/files/h3-task"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestLocalH3VideoRejectsAudioOnly(t *testing.T) {
	if err := validateLocalH3VideoInput(canvasGenerationInput{
		Prompt:          "only audio",
		ReferenceAudios: []providerMedia{{ID: "a1", DataURL: "data:audio/mpeg;base64,YQ=="}},
	}); err == nil {
		t.Fatal("expected audio-only validation error")
	}
	if err := validateLocalH3VideoInput(canvasGenerationInput{
		Prompt:          "ok",
		ReferenceImages: []providerMedia{{ID: "i1", DataURL: testReferenceImageDataURL}},
		ReferenceAudios: []providerMedia{{ID: "a1", DataURL: "data:audio/mpeg;base64,YQ=="}},
	}); err != nil {
		t.Fatalf("unexpected validation error with image+audio: %v", err)
	}
}

func TestValidateGenerationInterfaceAllowsLocalH3(t *testing.T) {
	if err := validateGenerationInterface("video", "local-h3-video"); err != nil {
		t.Fatalf("validateGenerationInterface() error = %v", err)
	}
}

func TestLocalH3MultipartFieldNames(t *testing.T) {
	body, contentType, err := localH3VideoUploadBody(canvasGenerationInput{
		Prompt: "test",
		Config: providerConfig{Model: "minimax-h3-r2v-sage", VideoSeconds: "8", Size: "9:16", VQuality: "720p"},
		ReferenceImages: []providerMedia{{ID: "i1", DataURL: testReferenceImageDataURL}},
		ReferenceVideos: []providerMedia{{ID: "v1", DataURL: "data:video/mp4;base64,dmlk"}},
	})
	if err != nil {
		t.Fatalf("localH3VideoUploadBody() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://example.test", body)
	req.Header.Set("Content-Type", contentType)
	if err := req.ParseMultipartForm(4 << 20); err != nil {
		t.Fatalf("ParseMultipartForm: %v", err)
	}
	if req.FormValue("seconds") != "8" || req.FormValue("size") != "720p" || req.FormValue("aspect_ratio") != "9:16" {
		t.Fatalf("fields = seconds=%q size=%q aspect=%q", req.FormValue("seconds"), req.FormValue("size"), req.FormValue("aspect_ratio"))
	}
	if len(req.MultipartForm.File["images"]) != 1 || len(req.MultipartForm.File["videos"]) != 1 {
		t.Fatalf("files images=%d videos=%d", len(req.MultipartForm.File["images"]), len(req.MultipartForm.File["videos"]))
	}
	file, err := req.MultipartForm.File["images"][0].Open()
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	raw, _ := io.ReadAll(file)
	if len(raw) == 0 {
		t.Fatal("empty image part")
	}
}
