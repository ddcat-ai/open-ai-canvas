package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestAPIMartVideoBodyUsesOfficialMultimodalFields(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()

	body, err := apiMartVideoBody(canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{
			Model:              "doubao-seedance-2.0-mini",
			Size:               "9:16",
			VideoSeconds:       "4",
			VQuality:           "720p",
			VideoGenerateAudio: "false",
		},
		ReferenceImages: []providerMedia{{ID: "image", URL: server.URL + "/image.png"}},
		ReferenceVideos: []providerMedia{{ID: "video", URL: server.URL + "/video.mp4"}},
		ReferenceAudios: []providerMedia{{ID: "audio", URL: server.URL + "/audio.mp3"}},
	})
	if err != nil {
		t.Fatalf("apiMartVideoBody() error = %v", err)
	}
	if body["model"] != "doubao-seedance-2.0-mini" || body["size"] != "9:16" || body["duration"] != 5 || body["resolution"] != "720p" {
		t.Fatalf("body settings = %#v", body)
	}
	if body["generate_audio"] != false || body["return_last_frame"] != true {
		t.Fatalf("body flags = %#v", body)
	}
	if body["seconds"] != nil || body["aspect_ratio"] != nil {
		t.Fatalf("unexpected legacy fields = %#v", body)
	}
	if images, ok := body["image_urls"].([]string); !ok || len(images) != 1 || images[0] != server.URL+"/image.png" {
		t.Fatalf("image_urls = %#v", body["image_urls"])
	}
	if videos, ok := body["video_urls"].([]string); !ok || len(videos) != 1 || videos[0] != server.URL+"/video.mp4" {
		t.Fatalf("video_urls = %#v", body["video_urls"])
	}
	if audios, ok := body["audio_urls"].([]string); !ok || len(audios) != 1 || audios[0] != server.URL+"/audio.mp3" {
		t.Fatalf("audio_urls = %#v", body["audio_urls"])
	}
}

func TestAPIMartVideoBodyEnforcesReferenceLimits(t *testing.T) {
	images := make([]providerMedia, 10)
	for index := range images {
		images[index] = providerMedia{URL: "asset://image"}
	}
	videos := make([]providerMedia, 4)
	for index := range videos {
		videos[index] = providerMedia{URL: "asset://video"}
	}
	audios := make([]providerMedia, 4)
	for index := range audios {
		audios[index] = providerMedia{URL: "asset://audio"}
	}
	for name, input := range map[string]canvasGenerationInput{
		"images": {ReferenceImages: images},
		"videos": {ReferenceVideos: videos},
		"audios": {ReferenceAudios: audios},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := apiMartVideoBody(input)
			if err == nil || !strings.Contains(err.Error(), "最多支持") {
				t.Fatalf("apiMartVideoBody() error = %v", err)
			}
		})
	}
}

func TestAPIMartVideoBodyUsesImageRolesForFrames(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()

	body, err := apiMartVideoBody(canvasGenerationInput{
		Prompt: "day to night",
		Config: providerConfig{Model: "doubao-seedance-2.0", VideoSeconds: "8"},
		ReferenceImages: []providerMedia{
			{ID: "first", URL: server.URL + "/first.png"},
			{ID: "last", URL: server.URL + "/last.png"},
			{ID: "portrait", URL: "asset://portrait"},
		},
		Metadata: map[string]interface{}{"videoStartFrameNodeId": "first", "videoEndFrameNodeId": "last"},
	})
	if err != nil {
		t.Fatalf("apiMartVideoBody() error = %v", err)
	}
	if body["image_urls"] != nil {
		t.Fatalf("image_urls = %#v, want nil", body["image_urls"])
	}
	roles, ok := body["image_with_roles"].([]map[string]string)
	if !ok || len(roles) != 3 {
		t.Fatalf("image_with_roles = %#v", body["image_with_roles"])
	}
	want := []map[string]string{
		{"url": server.URL + "/first.png", "role": "first_frame"},
		{"url": server.URL + "/last.png", "role": "last_frame"},
		{"url": "asset://portrait", "role": "reference_image"},
	}
	for index := range want {
		if roles[index]["url"] != want[index]["url"] || roles[index]["role"] != want[index]["role"] {
			t.Fatalf("roles[%d] = %#v, want %#v", index, roles[index], want[index])
		}
	}
}

func TestAPIMartVideoBodyRejectsInvalidFrameCombinations(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()

	_, err := apiMartVideoBody(canvasGenerationInput{
		Config:          providerConfig{Model: "doubao-seedance-2.0"},
		ReferenceImages: []providerMedia{{ID: "first", URL: server.URL + "/first.png"}},
		ReferenceVideos: []providerMedia{{ID: "video", URL: server.URL + "/video.mp4"}},
		Metadata:        map[string]interface{}{"videoStartFrameNodeId": "first"},
	})
	if err == nil || !strings.Contains(err.Error(), "不能同时使用参考视频") {
		t.Fatalf("frame/video error = %v", err)
	}

	_, err = apiMartVideoBody(canvasGenerationInput{
		Config: providerConfig{Model: "doubao-seedance-2.0"},
		ReferenceImages: []providerMedia{
			{ID: "first", URL: server.URL + "/first.png"},
			{ID: "extra", URL: server.URL + "/extra.png"},
		},
		Metadata: map[string]interface{}{"videoStartFrameNodeId": "first"},
	})
	if err == nil || !strings.Contains(err.Error(), "不能混用普通参考图") {
		t.Fatalf("frame/reference error = %v", err)
	}
}

func TestAPIMartVideoBodyAllowsVideoOnlyAndRejectsAudioOnly(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()

	body, err := apiMartVideoBody(canvasGenerationInput{
		Config:          providerConfig{Model: "doubao-seedance-2.0"},
		ReferenceVideos: []providerMedia{{ID: "video", URL: server.URL + "/video.mp4"}},
	})
	if err != nil {
		t.Fatalf("video-only body error = %v", err)
	}
	if videos, ok := body["video_urls"].([]string); !ok || len(videos) != 1 {
		t.Fatalf("video_urls = %#v", body["video_urls"])
	}

	_, err = apiMartVideoBody(canvasGenerationInput{
		Config:          providerConfig{Model: "doubao-seedance-2.0"},
		ReferenceAudios: []providerMedia{{ID: "audio", URL: server.URL + "/audio.mp3"}},
	})
	if err == nil || !strings.Contains(err.Error(), "不能单独使用") {
		t.Fatalf("audio-only error = %v", err)
	}
}

func TestRunAPIMartVideoTaskUsesOfficialEndpointsAndDownloadsResult(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	paths := make([]string, 0, 3)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/videos/generations":
			if auth := r.Header.Get("Authorization"); auth != "Bearer test-key" {
				t.Errorf("Authorization = %q", auth)
			}
			var body map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode request: %v", err)
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			if body["model"] != "doubao-seedance-2.0-mini" || body["duration"] != float64(5) || body["size"] != "16:9" || body["return_last_frame"] != true {
				t.Errorf("body = %#v", body)
			}
			if body["seconds"] != nil || body["aspect_ratio"] != nil {
				t.Errorf("unexpected legacy body = %#v", body)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":200,"data":[{"status":"submitted","task_id":"task-1"}]}`))
		case "GET /v1/tasks/task-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":200,"data":{"id":"task-1","status":"completed","result":{"videos":[{"url":["` + server.URL + `/files/video.mp4"],"last_frame_url":["` + server.URL + `/files/last.png"]}]}}}`))
		case "GET /files/video.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runVideoTask(context.Background(), canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{
			BaseURL:       server.URL,
			APIKey:        "test-key",
			Model:         "doubao-seedance-2.0-mini",
			InterfaceType: "apimart-video",
			VideoSeconds:  "5",
			Size:          "16:9",
			VQuality:      "720p",
		},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	video, ok := result["video"].(map[string]interface{})
	if !ok || video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", result["video"])
	}
	if video["lastFrameUrl"] != server.URL+"/files/last.png" {
		t.Fatalf("lastFrameUrl = %#v", video["lastFrameUrl"])
	}
	want := "POST /v1/videos/generations,GET /v1/tasks/task-1,GET /files/video.mp4"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestRunAPIMartVideoTaskResumesExistingProviderTask(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	postCount := 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/videos/generations":
			postCount++
			http.Error(w, "unexpected create", http.StatusInternalServerError)
		case "GET /v1/tasks/task-resume":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":200,"data":{"status":"completed","result":{"videos":[{"url":["` + server.URL + `/files/video.mp4"]}]}}}`))
		case "GET /files/video.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	ctx := context.WithValue(context.Background(), providerAnalyticsKey{}, providerAnalyticsContext{ProviderRequestID: "task-resume"})
	result, err := runAPIMartVideoTask(ctx, canvasGenerationInput{Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "doubao-seedance-2.0-mini"}})
	if err != nil {
		t.Fatalf("runAPIMartVideoTask() error = %v", err)
	}
	if postCount != 0 {
		t.Fatalf("POST count = %d, want 0", postCount)
	}
	video, ok := result["video"].(map[string]interface{})
	if !ok || video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", result["video"])
	}
}

func TestRunAPIMartVideoTaskReturnsUpstreamFailure(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/videos/generations":
			_, _ = w.Write([]byte(`{"code":200,"data":[{"status":"submitted","task_id":"task-failed"}]}`))
		case "GET /v1/tasks/task-failed":
			_, _ = w.Write([]byte(`{"code":200,"data":{"status":"failed","error":{"code":"policy_rejected","message":"blocked by policy"}}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	_, err := runAPIMartVideoTask(context.Background(), canvasGenerationInput{Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "doubao-seedance-2.0-mini"}})
	if err == nil || !strings.Contains(err.Error(), "task-failed") || !strings.Contains(err.Error(), "blocked by policy") {
		t.Fatalf("runAPIMartVideoTask() error = %v", err)
	}
}

func TestRequestAPIMartJSONRejectsBusinessError(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":400,"msg":"invalid request"}`))
	}))
	defer server.Close()

	_, err := requestAPIMartJSON(context.Background(), providerConfig{BaseURL: server.URL, APIKey: "test-key"}, http.MethodPost, "/videos/generations", map[string]interface{}{"model": "test"})
	if err == nil || !strings.Contains(err.Error(), "invalid request") {
		t.Fatalf("requestAPIMartJSON() error = %v", err)
	}
}

func TestRequestAPIMartJSONReadsHTTPErrorMessage(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"code":400,"message":"invalid request parameters"}}`))
	}))
	defer server.Close()

	_, err := requestAPIMartJSON(context.Background(), providerConfig{BaseURL: server.URL, APIKey: "test-key"}, http.MethodPost, "/videos/generations", map[string]interface{}{"model": "test"})
	if err == nil || err.Error() != "invalid request parameters" {
		t.Fatalf("requestAPIMartJSON() error = %v", err)
	}
}

func TestEnrichAPICallLogReadsAPIMartArrayData(t *testing.T) {
	log := model.ApiCallLog{Status: model.ApiCallStatusSucceeded, Capability: "video"}
	service := &Service{}
	service.EnrichAPICallLog(&log, []byte(`{"code":200,"data":[{"status":"submitted","task_id":"task-array"}]}`))
	if log.ProviderRequestID != "task-array" || log.ProviderStatus != "submitted" {
		t.Fatalf("log = %#v", log)
	}
}
