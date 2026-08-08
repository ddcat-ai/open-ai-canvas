package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

const testReferenceImageDataURL = "data:image/png;base64,aGVsbG8="

func TestWriteMediaPartSanitizesFilenameAndSetsMimeType(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writeMediaPart(writer, "image", providerMedia{ID: "image-1", Name: "提示词\n带换行.png", Type: "image/png", DataURL: testReferenceImageDataURL}); err != nil {
		t.Fatalf("writeMediaPart() error = %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("multipart.Writer.Close() error = %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "http://example.test", bytes.NewReader(body.Bytes()))
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if err := request.ParseMultipartForm(1 << 20); err != nil {
		t.Fatalf("ParseMultipartForm() error = %v", err)
	}
	files := request.MultipartForm.File["image"]
	if len(files) != 1 {
		t.Fatalf("image files = %d, want 1", len(files))
	}
	file := files[0]
	if file.Filename != "reference-image-1.png" || strings.ContainsAny(file.Filename, "\r\n") {
		t.Fatalf("filename = %q", file.Filename)
	}
	if got := file.Header.Get("Content-Type"); got != "image/png" {
		t.Fatalf("part Content-Type = %q, want image/png", got)
	}
	opened, err := file.Open()
	if err != nil {
		t.Fatalf("file.Open() error = %v", err)
	}
	defer opened.Close()
	data, err := io.ReadAll(opened)
	if err != nil {
		t.Fatalf("io.ReadAll() error = %v", err)
	}
	if string(data) != "hello" {
		t.Fatalf("file data = %q, want hello", data)
	}
}

func TestParseTextEventStreamSupportsResponsesAndChat(t *testing.T) {
	responses := []byte(`event: response.output_text.delta
data: {"delta":"{\"title\":\"分镜\""}

event: response.output_text.delta
data: {"delta":"}"}

data: [DONE]

`)
	if got, err := parseTextEventStream(responses, "responses"); err != nil || got != `{"title":"分镜"}` {
		t.Fatalf("Responses stream = %q, err = %v", got, err)
	}

	chat := []byte(`data: {"choices":[{"delta":{"content":"第一镜"}}]}

data: {"choices":[{"delta":{"content":"：远景"}}]}

data: [DONE]

`)
	if got, err := parseTextEventStream(chat, "chat-completion"); err != nil || got != "第一镜：远景" {
		t.Fatalf("Chat stream = %q, err = %v", got, err)
	}
}

func TestPostStreamingTextSetsStreamHeaders(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Accept"); got != "text/event-stream" {
			t.Errorf("Accept = %q", got)
		}
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request body: %v", err)
		}
		if stream, ok := body["stream"].(bool); !ok || !stream {
			t.Errorf("stream body field = %#v", body["stream"])
		}
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		_, _ = w.Write([]byte(`data: {"choices":[{"delta":{"content":"流式分镜"}}]}

data: [DONE]

`))
	}))
	defer server.Close()

	got, err := postStreamingText(context.Background(), providerConfig{BaseURL: server.URL, APIKey: "test-key"}, "/chat/completions", map[string]interface{}{"model": "test-model"}, "chat-completion")
	if err != nil || got != "流式分镜" {
		t.Fatalf("postStreamingText() = %q, err = %v", got, err)
	}
}

func TestProviderHTTPErrorWarnsAboutUncertain524Billing(t *testing.T) {
	message := (providerHTTPError{StatusCode: 524, Status: "524 A Timeout Occurred"}).Error()
	if !strings.Contains(message, "可能仍在服务端执行并产生费用") || !strings.Contains(message, "请勿立即重试") {
		t.Fatalf("providerHTTPError.Error() = %q", message)
	}
}

func TestVolcengineArkImageBodyUsesJSONReferencesAndDownscalesSize(t *testing.T) {
	body, err := volcengineArkImageBody(canvasGenerationInput{
		Prompt: "combine the references",
		Config: providerConfig{Model: "doubao-seedream-test", Size: "3840x2160", SystemPrompt: "keep the subject"},
		ReferenceImages: []providerMedia{
			{URL: "https://example.com/first.png"},
			{DataURL: testReferenceImageDataURL},
		},
	})
	if err != nil {
		t.Fatalf("volcengineArkImageBody() error = %v", err)
	}
	images, ok := body["image"].([]string)
	if !ok || len(images) != 2 || images[0] != "https://example.com/first.png" || images[1] != testReferenceImageDataURL {
		t.Fatalf("image = %#v", body["image"])
	}
	if body["prompt"] != "keep the subject\n\ncombine the references" {
		t.Fatalf("prompt = %q", body["prompt"])
	}
	size, _ := body["size"].(string)
	parts := strings.Split(size, "x")
	if len(parts) != 2 {
		t.Fatalf("size = %q", size)
	}
	width, _ := strconv.Atoi(parts[0])
	height, _ := strconv.Atoi(parts[1])
	if width%2 != 0 || height%2 != 0 || int64(width)*int64(height) > volcengineArkImageMaxPixels {
		t.Fatalf("downscaled size = %q", size)
	}
}

func TestVolcengineArkImageRejectsMaskBeforeRequest(t *testing.T) {
	_, err := runImageTask(context.Background(), canvasGenerationInput{
		Prompt: "edit only the masked area",
		Config: providerConfig{InterfaceType: "volcengine-ark-image"},
		Mask:   &providerMedia{DataURL: testReferenceImageDataURL},
	})
	if err == nil || !strings.Contains(err.Error(), "不支持蒙版") {
		t.Fatalf("runImageTask() error = %v", err)
	}
}

func TestRunGrokImageTaskUsesJSONEditContract(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/edits" {
			t.Errorf("path = %q, want /v1/images/edits", r.URL.Path)
		}
		if contentType := r.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
			t.Errorf("Content-Type = %q, want application/json", contentType)
		}
		var body grokImageRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if body.Model != "grok-imagine-image-quality" || body.N != 1 || body.ResponseFormat != "url" {
			t.Fatalf("request body = %#v", body)
		}
		if body.Image == nil || body.Image.URL != testReferenceImageDataURL {
			t.Fatalf("image = %#v", body.Image)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"url":"https://example.com/result.png"}]}`))
	}))
	defer server.Close()

	result, err := runImageTask(context.Background(), canvasGenerationInput{
		Mode:            "image",
		Prompt:          "edit the reference",
		Config:          providerConfig{BaseURL: server.URL, APIKey: "key", Model: "grok-imagine-image-quality", InterfaceType: "grok-image"},
		ReferenceImages: []providerMedia{{DataURL: testReferenceImageDataURL}},
	})
	if err != nil {
		t.Fatalf("runImageTask() error = %v", err)
	}
	images, _ := result["images"].([]map[string]string)
	if len(images) != 1 || images[0]["dataUrl"] != "https://example.com/result.png" {
		t.Fatalf("images = %#v", result["images"])
	}
}

func TestGrokImageRequestBodyMapsAspectRatio(t *testing.T) {
	body, path, err := grokImageRequestBody(canvasGenerationInput{
		Prompt: "a cat",
		Config: providerConfig{Model: "grok-imagine-image", InterfaceType: "grok-image", Size: "9:16", Quality: "2k"},
	})
	if err != nil {
		t.Fatalf("grokImageRequestBody() error = %v", err)
	}
	if path != "/images/generations" {
		t.Fatalf("path = %q", path)
	}
	if body.AspectRatio != "9:16" || body.Size != "9:16" || body.Resolution != "2k" {
		t.Fatalf("body = %#v", body)
	}
	if got := normalizeGrokImageAspectRatio("1280x720"); got != "16:9" {
		t.Fatalf("normalize 1280x720 = %q", got)
	}
	if got := normalizeGrokImageAspectRatio("720x1280"); got != "9:16" {
		t.Fatalf("normalize 720x1280 = %q", got)
	}
}

func TestNormalizeGrokImageResolution(t *testing.T) {
	if got := normalizeGrokImageResolution("1k"); got != "1k" {
		t.Fatalf("1k = %q", got)
	}
	if got := normalizeGrokImageResolution("high"); got != "2k" {
		t.Fatalf("high = %q", got)
	}
	if got := normalizeGrokImageResolution("auto"); got != "" {
		t.Fatalf("auto = %q", got)
	}
}

func TestGrokImageRequestBodyRejectsMaskAndMultipleReferences(t *testing.T) {
	if _, _, err := grokImageRequestBody(canvasGenerationInput{Config: providerConfig{InterfaceType: "grok-image"}, Mask: &providerMedia{DataURL: testReferenceImageDataURL}}); err == nil || !strings.Contains(err.Error(), "不支持蒙版") {
		t.Fatalf("mask error = %v", err)
	}
	if _, _, err := grokImageRequestBody(canvasGenerationInput{Config: providerConfig{InterfaceType: "grok-image"}, ReferenceImages: []providerMedia{{DataURL: testReferenceImageDataURL}, {DataURL: testReferenceImageDataURL}}}); err == nil || !strings.Contains(err.Error(), "只支持 1 张") {
		t.Fatalf("multiple reference error = %v", err)
	}
}

func TestGrokImageRequestBodyPrefersPublicURL(t *testing.T) {
	body, path, err := grokImageRequestBody(canvasGenerationInput{
		Config:          providerConfig{Model: "grok-imagine-image", InterfaceType: "grok-image"},
		ReferenceImages: []providerMedia{{URL: "https://example.com/reference.png", DataURL: testReferenceImageDataURL}},
	})
	if err != nil {
		t.Fatalf("grokImageRequestBody() error = %v", err)
	}
	if path != "/images/edits" || body.Image == nil || body.Image.URL != "https://example.com/reference.png" {
		t.Fatalf("path = %q, image = %#v", path, body.Image)
	}
}

func TestNormalizePixelSizeConvertsCanvasAspectRatios(t *testing.T) {
	tests := map[string]string{
		"1:1":  "1024x1024",
		"3:2":  "1536x1024",
		"2:3":  "1024x1536",
		"4:3":  "1360x1024",
		"3:4":  "1024x1360",
		"16:9": "1824x1024",
		"9:16": "1024x1824",
		"21:9": "2352x1008",
	}
	for input, want := range tests {
		t.Run(input, func(t *testing.T) {
			if got := normalizePixelSize(input); got != want {
				t.Fatalf("normalizePixelSize(%q) = %q, want %q", input, got, want)
			}
		})
	}
}

func TestDoBinaryRejectsOversizedProviderResponse(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", strconv.FormatInt(maxProviderResponseBytes+1, 10))
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	_, _, err := getExternalBinary(context.Background(), server.URL)
	if err == nil || !strings.Contains(err.Error(), "超过 64MB") {
		t.Fatalf("getExternalBinary() error = %v", err)
	}
}

func TestTextResponseInputIncludesReferenceMedia(t *testing.T) {
	input := canvasGenerationInput{
		Prompt: "describe this image",
		Config: providerConfig{SystemPrompt: "answer in Chinese"},
		ReferenceImages: []providerMedia{
			{ID: "image-1", Name: "image.png", Type: "image/png", DataURL: testReferenceImageDataURL},
		},
		ReferenceVideos: []providerMedia{
			{ID: "video-1", Name: "video.mp4", Type: "video/mp4", URL: "https://example.com/reference.mp4"},
		},
	}

	value, err := textResponseInput(input)
	if err != nil {
		t.Fatalf("textResponseInput() error = %v", err)
	}
	messages, ok := value.([]map[string]interface{})
	if !ok {
		t.Fatalf("textResponseInput() = %T, want []map[string]interface{}", value)
	}
	if len(messages) != 2 {
		t.Fatalf("len(messages) = %d, want 2", len(messages))
	}
	if messages[0]["role"] != "system" || messages[0]["content"] != "answer in Chinese" {
		t.Fatalf("system message = %#v", messages[0])
	}
	content, ok := messages[1]["content"].([]map[string]interface{})
	if !ok {
		t.Fatalf("user content = %T, want []map[string]interface{}", messages[1]["content"])
	}
	if len(content) != 3 {
		t.Fatalf("len(content) = %d, want 3", len(content))
	}
	if content[0]["type"] != "input_text" || content[0]["text"] != "describe this image" {
		t.Fatalf("text content = %#v", content[0])
	}
	if content[1]["type"] != "input_image" || content[1]["image_url"] != testReferenceImageDataURL {
		t.Fatalf("image content = %#v", content[1])
	}
	if content[2]["type"] != "input_video" || content[2]["video_url"] != "https://example.com/reference.mp4" {
		t.Fatalf("video content = %#v", content[2])
	}
}

func TestTextChatContentIncludesReferenceMedia(t *testing.T) {
	input := canvasGenerationInput{
		Prompt: "describe this image",
		ReferenceImages: []providerMedia{
			{ID: "image-1", Name: "image.png", Type: "image/png", DataURL: testReferenceImageDataURL},
		},
		ReferenceVideos: []providerMedia{
			{ID: "video-1", Name: "video.mp4", Type: "video/mp4", URL: "https://example.com/reference.mp4"},
		},
	}

	value, err := textChatContent(input)
	if err != nil {
		t.Fatalf("textChatContent() error = %v", err)
	}
	content, ok := value.([]map[string]interface{})
	if !ok {
		t.Fatalf("textChatContent() = %T, want []map[string]interface{}", value)
	}
	if len(content) != 3 {
		t.Fatalf("len(content) = %d, want 3", len(content))
	}
	if content[0]["type"] != "text" || content[0]["text"] != "describe this image" {
		t.Fatalf("text content = %#v", content[0])
	}
	imageURL, ok := content[1]["image_url"].(map[string]interface{})
	if !ok {
		t.Fatalf("image_url = %T, want map[string]interface{}", content[1]["image_url"])
	}
	if content[1]["type"] != "image_url" || imageURL["url"] != testReferenceImageDataURL {
		t.Fatalf("image content = %#v", content[1])
	}
	videoURL, ok := content[2]["video_url"].(map[string]interface{})
	if !ok {
		t.Fatalf("video_url = %T, want map[string]interface{}", content[2]["video_url"])
	}
	if content[2]["type"] != "video_url" || videoURL["url"] != "https://example.com/reference.mp4" {
		t.Fatalf("video content = %#v", content[2])
	}
}

func TestTextReferenceImageRejectsInternalAssetURL(t *testing.T) {
	_, err := textResponseInput(canvasGenerationInput{
		Prompt: "describe this image",
		ReferenceImages: []providerMedia{
			{ID: "image-1", Name: "image.png", URL: "asset://local-image"},
		},
	})
	if err == nil {
		t.Fatal("textResponseInput() error = nil, want error")
	}
}

func TestSeedanceVideosBodyUsesVideosEndpointFields(t *testing.T) {
	body, err := seedanceVideosRequestBody(canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{
			Model:              "seedance-2.0-mini-480p",
			Size:               "9:16",
			VideoSeconds:       "8",
			VideoGenerateAudio: "true",
		},
		ReferenceImages: []providerMedia{
			{ID: "image-1", DataURL: testReferenceImageDataURL},
			{ID: "image-2", DataURL: "data:image/png;base64,d29ybGQ="},
		},
		ReferenceVideos: []providerMedia{{ID: "video-1", URL: "https://example.com/ref.mp4"}},
		ReferenceAudios: []providerMedia{{ID: "audio-1", DataURL: "data:audio/mpeg;base64,AAAA"}},
	})
	if err != nil {
		t.Fatalf("seedanceVideosBody() error = %v", err)
	}
	if body.Model != "seedance-2.0-mini-480p" {
		t.Fatalf("model = %#v", body.Model)
	}
	if body.AspectRatio != "9:16" || body.Duration != 8 {
		t.Fatalf("size fields = %#v %#v", body.AspectRatio, body.Duration)
	}
	if body.GenerateAudio == nil || !*body.GenerateAudio {
		t.Fatalf("generate_audio = %#v, want true", body.GenerateAudio)
	}
	if body.ImageURL != testReferenceImageDataURL {
		t.Fatalf("image_url = %#v", body.ImageURL)
	}
	if len(body.ReferenceImageURLs) != 1 || body.ReferenceImageURLs[0] != "data:image/png;base64,d29ybGQ=" {
		t.Fatalf("reference_image_urls = %#v", body.ReferenceImageURLs)
	}
	if len(body.ReferenceVideos) != 1 || body.ReferenceVideos[0] != "https://example.com/ref.mp4" {
		t.Fatalf("reference_videos = %#v", body.ReferenceVideos)
	}
	if len(body.ReferenceAudios) != 1 || body.ReferenceAudios[0] != "data:audio/mpeg;base64,AAAA" {
		t.Fatalf("reference_audios = %#v", body.ReferenceAudios)
	}
}

func TestSeedanceVideosBodyHonorsGenerateAudio(t *testing.T) {
	for _, test := range []struct {
		name  string
		value string
		want  bool
	}{
		{name: "default enabled", want: true},
		{name: "explicit enabled", value: "true", want: true},
		{name: "explicit disabled", value: "false", want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			body, err := seedanceVideosRequestBody(canvasGenerationInput{
				Prompt: "make it move",
				Config: providerConfig{
					Model:              "seedance-2.0-mini-480p",
					VideoGenerateAudio: test.value,
				},
			})
			if err != nil {
				t.Fatalf("seedanceVideosBody() error = %v", err)
			}
			if body.GenerateAudio == nil || *body.GenerateAudio != test.want {
				t.Fatalf("generate_audio = %#v, want %v", body.GenerateAudio, test.want)
			}
		})
	}
}

func TestSeedanceVideosBodyUsesOrderedFrameImageURLsWhenConfigured(t *testing.T) {
	body, err := seedanceVideosRequestBody(canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{Model: "seedance-2.0-mini-480p"},
		ReferenceImages: []providerMedia{
			{ID: "character", DataURL: "data:image/png;base64,Y2hhcmFjdGVy"},
			{ID: "end-frame", DataURL: "data:image/png;base64,d29ybGQ="},
			{ID: "front-frame", DataURL: testReferenceImageDataURL},
		},
		Metadata: map[string]interface{}{"videoStartFrameNodeId": "front-frame", "videoEndFrameNodeId": "end-frame"},
	})
	if err != nil {
		t.Fatalf("seedanceVideosBody() error = %v", err)
	}
	imageURLs := body.ImageURLs
	if len(imageURLs) != 3 {
		t.Fatalf("image_urls = %#v", imageURLs)
	}
	want := []string{testReferenceImageDataURL, "data:image/png;base64,d29ybGQ=", "data:image/png;base64,Y2hhcmFjdGVy"}
	for index := range want {
		if imageURLs[index] != want[index] {
			t.Fatalf("image_urls = %#v, want %#v", imageURLs, want)
		}
	}
	if body.ImageURL != "" || body.ReferenceImageURLs != nil {
		t.Fatalf("unexpected legacy image fields in body: %#v", body)
	}
	if body.Prompt != "make it move" {
		t.Fatalf("prompt = %#v", body.Prompt)
	}
}

func TestRunVideoTaskUsesNewAPIForAnyVideoModel(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	paths := make([]string, 0, 3)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/videos":
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Errorf("parse create body: %v", err)
			}
			if r.FormValue("model") != "custom-video-v1" || r.FormValue("prompt") != "make it move" {
				t.Errorf("create form = %#v", r.MultipartForm.Value)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"video-1","status":"queued"}`))
		case "GET /v1/videos/video-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"video-1","status":"completed"}`))
		case "GET /v1/videos/video-1/content":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runVideoTask(context.Background(), canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{BaseURL: server.URL + "/v1", APIKey: "test-key", Model: "custom-video-v1"},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	video, ok := result["video"].(map[string]interface{})
	if !ok || video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", result["video"])
	}
	want := "POST /v1/videos,GET /v1/videos/video-1,GET /v1/videos/video-1/content"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestRunVideoTaskUsesNestedURLBeforeResultURL(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	paths := make([]string, 0, 3)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/videos":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":{"task_id":"video-1","status":"queued"}}`))
		case "GET /v1/videos/video-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":"success","data":{"task_id":"video-1","status":"SUCCESS","result_url":"` + server.URL + `/v1/videos/video-1/content","data":{"status":"completed","url":"` + server.URL + `/files/video.mp4"}}}`))
		case "GET /files/video.mp4":
			if authorization := r.Header.Get("Authorization"); authorization != "Bearer test-key" {
				t.Errorf("file Authorization = %q, want Bearer test-key", authorization)
			}
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		case "GET /v1/videos/video-1/content":
			http.Error(w, "forbidden", http.StatusForbidden)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runVideoTask(context.Background(), canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "grok-imagine-video-1.5-1080p", VideoSeconds: "15"},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	video, ok := result["video"].(map[string]interface{})
	if !ok || video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", result["video"])
	}
	want := "POST /v1/videos,GET /v1/videos/video-1,GET /files/video.mp4"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestRunVideoTaskUsesJSONForGrokVideo(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/videos":
			if contentType := r.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
				t.Errorf("Content-Type = %q, want application/json", contentType)
			}
			var body map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if body["model"] != "grok-video" || body["prompt"] != "make it move" {
				t.Errorf("request body = %#v", body)
			}
			if body["image"] != testReferenceImageDataURL {
				t.Errorf("image = %#v", body["image"])
			}
			images, ok := body["images"].([]interface{})
			if !ok || len(images) != 1 || images[0] != testReferenceImageDataURL {
				t.Errorf("images = %#v", body["images"])
			}
			_, _ = w.Write([]byte(`{"id":"video-1","status":"queued"}`))
		case "GET /v1/videos/video-1":
			_, _ = w.Write([]byte(`{"id":"video-1","status":"completed"}`))
		case "GET /v1/videos/video-1/content":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runVideoTask(context.Background(), canvasGenerationInput{
		Prompt:          "make it move",
		Config:          providerConfig{BaseURL: server.URL + "/v1", APIKey: "test-key", Model: "grok-video", VideoSeconds: "10"},
		ReferenceImages: []providerMedia{{ID: "image-1", DataURL: testReferenceImageDataURL}},
		Metadata:        map[string]interface{}{"videoEditOperation": "image_to_video"},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	video, ok := result["video"].(map[string]interface{})
	if !ok || video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", result["video"])
	}
}

func TestRunVideoTaskUsesXAIVideoGenerationEndpoint(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	paths := make([]string, 0, 3)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/videos/generations":
			if contentType := r.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
				t.Errorf("Content-Type = %q, want application/json", contentType)
			}
			var body map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if body["model"] != "grok-imagine-video-1.5" || body["prompt"] != "make it move" {
				t.Errorf("request body = %#v", body)
			}
			if body["duration"] != float64(10) || body["aspect_ratio"] != "1:1" || body["resolution"] != "720p" {
				t.Errorf("xAI settings = %#v", body)
			}
			for _, legacyField := range []string{"seconds", "size", "images"} {
				if _, exists := body[legacyField]; exists {
					t.Errorf("request body includes legacy field %q: %#v", legacyField, body)
				}
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"request_id":"video-1"}`))
		case "GET /v1/videos/video-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"done","video":{"url":"` + server.URL + `/files/video.mp4"}}`))
		case "GET /files/video.mp4":
			if authorization := r.Header.Get("Authorization"); authorization != "Bearer test-key" {
				t.Errorf("file Authorization = %q, want Bearer test-key", authorization)
			}
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
			BaseURL:       server.URL + "/v1",
			APIKey:        "test-key",
			Model:         "grok-imagine-video-1.5",
			InterfaceType: "xai-video",
			VideoSeconds:  "10",
			Size:          "1:1",
			VQuality:      "720",
		},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	video, ok := result["video"].(map[string]interface{})
	if !ok || video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", result["video"])
	}
	want := "POST /v1/videos/generations,GET /v1/videos/video-1,GET /files/video.mp4"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestXAIVideoBodyUsesOfficialImageShapeAndNormalizesSettings(t *testing.T) {
	body, err := xaiVideoRequestBody(canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{
			Model:         "grok-imagine-video-1.5",
			InterfaceType: "xai-video",
			VideoSeconds:  "20",
			Size:          "1024x1792",
			VQuality:      "1080",
		},
		ReferenceImages: []providerMedia{{ID: "image-1", DataURL: testReferenceImageDataURL}},
		Metadata:        map[string]interface{}{"videoEditOperation": "image_to_video"},
	})
	if err != nil {
		t.Fatalf("grokVideoBody() error = %v", err)
	}
	if body.Duration != 20 || body.AspectRatio != "9:16" || body.Resolution != "1080p" {
		t.Fatalf("xAI settings = %#v", body)
	}
	if body.Image == nil || body.Image.URL != testReferenceImageDataURL {
		t.Fatalf("image = %#v", body.Image)
	}
}

func TestXAIVideoBodyRejectsMultipleStartImages(t *testing.T) {
	_, err := xaiVideoRequestBody(canvasGenerationInput{
		Config: providerConfig{Model: "grok-imagine-video-1.5", InterfaceType: "xai-video"},
		ReferenceImages: []providerMedia{
			{ID: "image-1", DataURL: testReferenceImageDataURL},
			{ID: "image-2", DataURL: testReferenceImageDataURL},
		},
		Metadata: map[string]interface{}{"videoEditOperation": "image_to_video"},
	})
	if err == nil || !strings.Contains(err.Error(), "只支持 1 张起始图") {
		t.Fatalf("grokVideoBody() error = %v", err)
	}
}

func TestNewAPIVideoPromptKeepsTextOnlyPromptUnchanged(t *testing.T) {
	input := canvasGenerationInput{
		Prompt: "make it move",
	}
	if prompt := newAPIVideoPromptText(input); prompt != "make it move" {
		t.Fatalf("prompt = %q", prompt)
	}
}

func TestVideoProviderPromptsKeepReferencePromptUnchanged(t *testing.T) {
	input := canvasGenerationInput{
		Prompt:          "镜头缓慢前推，人物走向门口",
		ReferenceImages: []providerMedia{{ID: "image-1", DataURL: testReferenceImageDataURL}},
		Metadata:        map[string]interface{}{"videoEditOperation": "image_to_video"},
	}
	for name, prompt := range map[string]string{
		"newapi":           newAPIVideoPromptText(input),
		"seedance-content": seedancePromptText(input),
		"seedance-videos":  seedanceVideosPromptText(input),
	} {
		if prompt != input.Prompt {
			t.Fatalf("%s prompt = %q", name, prompt)
		}
	}
}

func TestNewAPIVideoOmitsImagesForTextToVideoOperation(t *testing.T) {
	input := canvasGenerationInput{
		Prompt: "make it move with the described character",
		ReferenceImages: []providerMedia{
			{ID: "image-1", DataURL: testReferenceImageDataURL},
		},
		Metadata: map[string]interface{}{"videoEditOperation": "text_to_video"},
	}
	if shouldSendNewAPIVideoImages(input) {
		t.Fatal("shouldSendNewAPIVideoImages() = true, want false")
	}
	if prompt := newAPIVideoPromptText(input); strings.Contains(prompt, "@image1") {
		t.Fatalf("prompt = %q", prompt)
	}
}

func TestSeedanceVideosBodyRequiresImageForVideoOrAudioReferences(t *testing.T) {
	_, err := seedanceVideosRequestBody(canvasGenerationInput{
		Prompt:          "make it move",
		Config:          providerConfig{Model: "seedance-2.0-mini-480p"},
		ReferenceVideos: []providerMedia{{ID: "video-1", URL: "https://example.com/ref.mp4"}},
	})
	if err == nil {
		t.Fatal("seedanceVideosBody() error = nil, want error")
	}
}

func TestArkPlanConfigStaysSeparateFromSeedanceVideosEndpoint(t *testing.T) {
	config := providerConfig{BaseURL: "https://ark.cn-beijing.volces.com/api/plan/v3", Model: "seedance-2.0-pro"}
	if !isArkPlanVideoConfig(config) {
		t.Fatal("isArkPlanVideoConfig() = false, want true")
	}
	if !isSeedanceVideoConfig(config) {
		t.Fatal("isSeedanceVideoConfig() = false, want true")
	}
}

func TestVolcengineArkVideoProtocolUsesContentTaskAndDownloadsResult(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	paths := make([]string, 0, 3)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "POST /api/v3/contents/generations/tasks":
			var body map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			content, _ := body["content"].([]interface{})
			if len(content) != 2 {
				t.Errorf("body = %#v", body)
				return
			}
			imageContent, _ := content[1].(map[string]interface{})
			if body["model"] != "doubao-seedance-test" || imageContent["role"] != "reference_image" {
				t.Errorf("body = %#v", body)
			}
			_, _ = w.Write([]byte(`{"id":"ark-task-1","status":"running"}`))
		case "GET /api/v3/contents/generations/tasks/ark-task-1":
			_, _ = w.Write([]byte(`{"id":"ark-task-1","status":"succeeded","content":{"video_url":"` + server.URL + `/result.mp4"}}`))
		case "GET /result.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runVideoTask(context.Background(), canvasGenerationInput{
		Prompt:          "make it move",
		Config:          providerConfig{BaseURL: server.URL + "/api/v3", APIKey: "test-key", Model: "doubao-seedance-test", InterfaceType: "volcengine-ark-video"},
		ReferenceImages: []providerMedia{{ID: "start", URL: server.URL + "/reference.png"}},
		Metadata:        map[string]interface{}{"videoStartFrameNodeId": "start"},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	video := result["video"].(map[string]interface{})
	if video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", video)
	}
	want := "POST /api/v3/contents/generations/tasks,GET /api/v3/contents/generations/tasks/ark-task-1,GET /result.mp4"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestNewAPIChannel1VideoBodyMapsFramesAndReferences(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()

	body, err := newAPIChannel1VideoBody(canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{Model: "seedance-2.0", Size: "9:16", VQuality: "1080", VideoSeconds: "15", VideoWatermark: "true"},
		ReferenceImages: []providerMedia{
			{ID: "first", URL: server.URL + "/first.png"},
			{ID: "last", URL: server.URL + "/last.png"},
			{ID: "character", URL: server.URL + "/character.png"},
		},
		ReferenceVideos: []providerMedia{{ID: "video", URL: server.URL + "/reference.mp4"}},
		ReferenceAudios: []providerMedia{{ID: "voice", URL: server.URL + "/voice.mp3"}},
		Metadata:        map[string]interface{}{"videoStartFrameNodeId": "first", "videoEndFrameNodeId": "last"},
	})
	if err != nil {
		t.Fatalf("newAPIChannel1VideoBody() error = %v", err)
	}
	input := body["input"].(map[string]interface{})
	media := input["media"].([]map[string]string)
	wantTypes := []string{"first_frame", "last_frame", "reference_image", "reference_video", "reference_voice"}
	if len(media) != len(wantTypes) {
		t.Fatalf("media = %#v", media)
	}
	for index, want := range wantTypes {
		if media[index]["type"] != want {
			t.Fatalf("media[%d].type = %q, want %q", index, media[index]["type"], want)
		}
	}
	parameters := body["parameters"].(map[string]interface{})
	if parameters["resolution"] != "1080P" || parameters["ratio"] != "9:16" || parameters["duration"] != 15 || parameters["watermark"] != true {
		t.Fatalf("parameters = %#v", parameters)
	}
}

func TestNewAPIChannel1VideoBodyRejectsInlineMedia(t *testing.T) {
	_, err := newAPIChannel1VideoBody(canvasGenerationInput{
		Prompt:          "make it move",
		Config:          providerConfig{Model: "seedance-2.0"},
		ReferenceImages: []providerMedia{{ID: "image", DataURL: testReferenceImageDataURL}},
	})
	if err == nil || !strings.Contains(err.Error(), "公网 HTTP(S) URL") {
		t.Fatalf("newAPIChannel1VideoBody() error = %v", err)
	}
}

func TestRunNewAPIChannel1VideoTaskDownloadsSucceededObject(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	paths := make([]string, 0, 3)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/videos":
			if contentType := r.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
				t.Errorf("Content-Type = %q", contentType)
			}
			var body map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if body["model"] != "seedance-2.0" {
				t.Errorf("body = %#v", body)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"channel-1-task","task_id":"channel-1-task","status":"RUNNING"}`))
		case "GET /v1/videos/channel-1-task":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"channel-1-task","status":"SUCCEEDED","object":"` + server.URL + `/video.mp4"}`))
		case "GET /video.mp4":
			if authorization := r.Header.Get("Authorization"); authorization != "" {
				t.Errorf("file Authorization = %q, want empty", authorization)
			}
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runNewAPIChannel1VideoTask(context.Background(), canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{BaseURL: server.URL + "/v1", APIKey: "test-key", Model: "seedance-2.0", InterfaceType: "newapi-channel-1"},
	})
	if err != nil {
		t.Fatalf("runNewAPIChannel1VideoTask() error = %v", err)
	}
	video := result["video"].(map[string]interface{})
	if video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", video)
	}
	want := "POST /v1/videos,GET /v1/videos/channel-1-task,GET /video.mp4"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestRunNewAPIChannel2VideoTaskDownloadsTemporaryResult(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	paths := make([]string, 0, 3)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/video/generations":
			if auth := r.Header.Get("Authorization"); auth != "Bearer test-key" {
				t.Errorf("Authorization = %q", auth)
			}
			var body map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if body["model"] != "grok-image-video" || body["seconds"] != "15" || body["aspect_ratio"] != "9:16" || body["resolution"] != "720p" {
				t.Errorf("body = %#v", body)
			}
			images, ok := body["image_urls"].([]interface{})
			if !ok || len(images) != 2 || images[0] != testReferenceImageDataURL {
				t.Errorf("image_urls = %#v", body["image_urls"])
			}
			videos, _ := body["video_urls"].([]interface{})
			audios, _ := body["audio_urls"].([]interface{})
			if len(videos) != 1 || len(audios) != 1 || body["generate_audio"] != true {
				t.Errorf("multi-reference body = %#v", body)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"task_id":"grok-task","status":"queued"}`))
		case "GET /v1/video/generations/grok-task":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":"success","data":{"task_id":"grok-task","status":"SUCCESS","result_url":"` + server.URL + `/video.mp4"}}`))
		case "GET /video.mp4":
			if authorization := r.Header.Get("Authorization"); authorization != "Bearer test-key" {
				t.Errorf("file Authorization = %q, want Bearer test-key", authorization)
			}
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runVideoTask(context.Background(), canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "grok-image-video", InterfaceType: "newapi-channel-2", VideoSeconds: "15", Size: "720x1280", VQuality: "high"},
		ReferenceImages: []providerMedia{
			{ID: "image-1", DataURL: testReferenceImageDataURL},
			{ID: "image-2", DataURL: testReferenceImageDataURL},
		},
		ReferenceVideos: []providerMedia{{ID: "video-1", URL: server.URL + "/reference.mp4"}},
		ReferenceAudios: []providerMedia{{ID: "audio-1", URL: server.URL + "/reference.mp3"}},
		Metadata:        map[string]interface{}{"videoEditOperation": "image_to_video"},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	video := result["video"].(map[string]interface{})
	if video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", video)
	}
	want := "POST /v1/video/generations,GET /v1/video/generations/grok-task,GET /video.mp4"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestRunGeminiVeoVideoTaskUsesLongRunningOperation(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	paths := make([]string, 0, 3)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		if r.Header.Get("x-goog-api-key") != "test-key" {
			t.Errorf("x-goog-api-key = %q", r.Header.Get("x-goog-api-key"))
		}
		switch r.Method + " " + r.URL.Path {
		case "POST /v1beta/models/veo-test:predictLongRunning":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"name":"operations/op-1"}`))
		case "GET /v1beta/operations/op-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"done":true,"response":{"generatedSamples":[{"video":{"uri":"` + server.URL + `/video.mp4"}}]}}`))
		case "GET /video.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runVideoTask(context.Background(), canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", APIFormat: "gemini", Model: "veo-test", InterfaceType: "gemini-veo", VideoSeconds: "6", Size: "16:9", VQuality: "720"},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	video := result["video"].(map[string]interface{})
	if video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", video)
	}
	want := "POST /v1beta/models/veo-test:predictLongRunning,GET /v1beta/operations/op-1,GET /video.mp4"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestNewAPIChannel2SingleImageModelsRequireOneReference(t *testing.T) {
	_, err := newAPIChannel2VideoRequestBody(canvasGenerationInput{Config: providerConfig{Model: "grok-video-1.5", VideoSeconds: "6"}})
	if err == nil {
		t.Fatal("newAPIChannel2VideoBody() error = nil")
	}
	if !strings.Contains(err.Error(), "当前 0 张") {
		t.Fatalf("newAPIChannel2VideoBody() error = %q", err)
	}
}

func TestNewAPIChannel2SingleImageModelUsesReferenceForStaleTextToVideoMetadata(t *testing.T) {
	body, err := newAPIChannel2VideoRequestBody(canvasGenerationInput{
		Config:          providerConfig{Model: "grok-video-1.5", VideoSeconds: "6"},
		ReferenceImages: []providerMedia{{ID: "image-1", DataURL: testReferenceImageDataURL}},
		Metadata:        map[string]interface{}{"videoEditOperation": "text_to_video"},
	})
	if err != nil {
		t.Fatalf("newAPIChannel2VideoBody() error = %v", err)
	}
	images := body.ImageURLs
	if len(images) != 1 || images[0] != testReferenceImageDataURL {
		t.Fatalf("image_urls = %#v", images)
	}
}

func TestNewAPIChannel2OrdersFramesBeforeReferenceImages(t *testing.T) {
	body, err := newAPIChannel2VideoRequestBody(canvasGenerationInput{
		Config: providerConfig{Model: "Seedance 2 Mini", VideoSeconds: "10"},
		ReferenceImages: []providerMedia{
			{ID: "character", DataURL: "data:image/png;base64,Y2hhcmFjdGVy"},
			{ID: "last-frame", DataURL: "data:image/png;base64,bGFzdA=="},
			{ID: "first-frame", DataURL: "data:image/png;base64,Zmlyc3Q="},
		},
		Metadata: map[string]interface{}{"videoStartFrameNodeId": "first-frame", "videoEndFrameNodeId": "last-frame", "videoEditOperation": "image_to_video"},
	})
	if err != nil {
		t.Fatalf("newAPIChannel2VideoBody() error = %v", err)
	}
	images := body.ImageURLs
	want := []string{"data:image/png;base64,Zmlyc3Q=", "data:image/png;base64,bGFzdA==", "data:image/png;base64,Y2hhcmFjdGVy"}
	if !reflect.DeepEqual(images, want) {
		t.Fatalf("image_urls = %#v, want %#v", images, want)
	}
}

func TestNewAPIChannel2RejectsMissingConfiguredFrame(t *testing.T) {
	_, err := newAPIChannel2VideoRequestBody(canvasGenerationInput{
		Config:          providerConfig{Model: "Seedance 2 Mini", VideoSeconds: "10"},
		ReferenceImages: []providerMedia{{ID: "character", DataURL: testReferenceImageDataURL}},
		Metadata:        map[string]interface{}{"videoStartFrameNodeId": "missing-frame", "videoEditOperation": "image_to_video"},
	})
	if err == nil || !strings.Contains(err.Error(), "首帧参考图未包含") {
		t.Fatalf("newAPIChannel2VideoBody() error = %v", err)
	}
}

func TestValidateGenerationInterfaceRejectsMismatchedType(t *testing.T) {
	if err := validateGenerationInterface("video", "chat-completion"); err == nil {
		t.Fatal("validateGenerationInterface() error = nil")
	}
	if err := validateGenerationInterface("video", "newapi-channel-1"); err != nil {
		t.Fatalf("validateGenerationInterface() error = %v", err)
	}
	if err := validateGenerationInterface("video", "newapi-channel-2"); err != nil {
		t.Fatalf("validateGenerationInterface() error = %v", err)
	}
	if err := validateGenerationInterface("video", "xai-video"); err != nil {
		t.Fatalf("validateGenerationInterface() error = %v", err)
	}
	if err := validateGenerationInterface("image", "grok-image"); err != nil {
		t.Fatalf("validateGenerationInterface() error = %v", err)
	}
}

func TestProcessTaskValidatesInterfaceBeforeHydratingMedia(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	input := canvasGenerationInput{
		Mode:            "video",
		Prompt:          "make it move",
		Config:          providerConfig{BaseURL: server.URL + "/v1", APIKey: "key", Model: "text-model", InterfaceType: "chat-completion"},
		ReferenceImages: []providerMedia{{StorageKey: "resource:missing"}},
	}
	raw, _ := json.Marshal(input)
	_, err := (&Service{}).processCanvasGenerationTask(context.Background(), "user-1", "", "video_generate", "", string(raw))
	if err == nil || !strings.Contains(err.Error(), "不支持video生成") {
		t.Fatalf("processCanvasGenerationTask() error = %v", err)
	}
}

func TestResolveGenerationStyleExecutionUsesValidatedPromptAssets(t *testing.T) {
	enabled := true
	profile := styleProfileDocument{
		Prompt:          "base style",
		ExecutionPolicy: "compatible-fallback",
		Assets: []styleProfileAsset{
			{ID: "prompt-1", Kind: "prompt", Title: "色彩约束", Provider: "builtin", Enabled: &enabled, Status: "validated", PromptFragment: "muted palette", TriggerWords: []string{"soft light"}},
			{ID: "lora-1", Kind: "lora", Title: "东方角色 LoRA", Provider: "liblib", Enabled: &enabled, Status: "validated", SourceID: "model-1"},
		},
	}
	prompt, status, warnings := resolveGenerationStyleExecution(profile, "image-model", "openai-image")
	if prompt != "base style\nmuted palette\nsoft light" {
		t.Fatalf("resolveGenerationStyleExecution() prompt = %q", prompt)
	}
	if status != "degraded" || len(warnings) != 1 || !strings.Contains(warnings[0], "LoRA") {
		t.Fatalf("resolveGenerationStyleExecution() status = %q, warnings = %#v", status, warnings)
	}
}

func TestResolveGenerationStyleExecutionStrictPolicyBlocksUnsupportedAsset(t *testing.T) {
	profile := styleProfileDocument{
		Prompt:          "base style",
		ExecutionPolicy: "strict-assets",
		Assets:          []styleProfileAsset{{ID: "reference-1", Kind: "reference", Title: "项目参考图", Provider: "project", Status: "validated", ReferenceResourceIDs: []string{"resource-1"}}},
	}
	_, status, warnings := resolveGenerationStyleExecution(profile, "image-model", "openai-image")
	if status != "blocked" || len(warnings) != 1 {
		t.Fatalf("resolveGenerationStyleExecution() status = %q, warnings = %#v", status, warnings)
	}
}

func TestResolveGenerationStyleExecutionSkipsPromptAssetForOtherModel(t *testing.T) {
	profile := styleProfileDocument{
		Prompt:          "base style",
		ExecutionPolicy: "compatible-fallback",
		Assets: []styleProfileAsset{{
			ID: "template-1", Kind: "template", Title: "专用模板", Provider: "workflow", Status: "validated",
			BaseModels: []string{"supported-model"}, PromptFragment: "must not be injected",
		}},
	}
	prompt, status, warnings := resolveGenerationStyleExecution(profile, "other-model", "openai-image")
	if prompt != "base style" || status != "degraded" || len(warnings) != 1 {
		t.Fatalf("resolveGenerationStyleExecution() prompt = %q, status = %q, warnings = %#v", prompt, status, warnings)
	}
}

func TestEquivalentStyleProfileJSONIgnoresObjectKeyOrder(t *testing.T) {
	equal, err := equivalentStyleProfileJSON(`{"schemaVersion":1,"presetId":"style-1","assets":[]}`, `{"assets":[],"presetId":"style-1","schemaVersion":1}`)
	if err != nil || !equal {
		t.Fatalf("equivalentStyleProfileJSON() equal = %v, err = %v", equal, err)
	}
}
