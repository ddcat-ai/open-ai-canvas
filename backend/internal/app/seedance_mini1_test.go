package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestSeedanceMini1RuntimeUploadsPollsAndDownloads(t *testing.T) {
	allowLoopbackProviderTest(t)
	adapter := loadOfficialProtocolAdapterForTest(t, "seedance-mini1.yingce-plugin")
	for _, withURL := range []bool{true, false} {
		name := "content fallback"
		if withURL {
			name = "response URL"
		}
		t.Run(name, func(t *testing.T) {
			var server *httptest.Server
			var calls []string
			createCalls, pollCalls := 0, 0
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls = append(calls, r.Method+" "+r.URL.Path)
				if got := r.Header.Get("Authorization"); got != "Bearer test-mini1-key" {
					t.Errorf("Authorization = %q", got)
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				switch r.URL.Path {
				case "/v1/uploads/images":
					if err := r.ParseMultipartForm(1 << 20); err != nil {
						t.Errorf("parse upload: %v", err)
						w.WriteHeader(http.StatusBadRequest)
						return
					}
					defer r.MultipartForm.RemoveAll()
					file, header, err := r.FormFile("image")
					if err != nil {
						t.Errorf("read upload: %v", err)
						w.WriteHeader(http.StatusBadRequest)
						return
					}
					defer file.Close()
					data, err := io.ReadAll(file)
					if err != nil || string(data) != "image" || header.Filename == "" {
						t.Errorf("uploaded data=%q header=%#v error=%v", data, header, err)
					}
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"url": server.URL + "/files/ref.png"}}})
				case "/v1/videos":
					createCalls++
					if r.Header.Get("Content-Type") != "application/json" || r.Header.Get("Idempotency-Key") == "" {
						t.Errorf("create headers = %#v", r.Header)
					}
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Errorf("decode create body: %v", err)
					}
					want := map[string]any{
						"model": "seedance20Mini", "prompt": "@Image1 a clip", "seconds": float64(3),
						"size": "9:16", "enhance": "1080p", "face_mode": "off",
						"reference_images": []any{server.URL + "/files/ref.png"},
					}
					if !reflect.DeepEqual(body, want) {
						t.Errorf("create body = %#v, want %#v", body, want)
					}
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(`{"id":"mini1-task","status":"queued"}`))
				case "/v1/videos/mini1-task":
					pollCalls++
					w.Header().Set("Content-Type", "application/json")
					if pollCalls == 1 {
						_, _ = w.Write([]byte(`{"id":"mini1-task","status":"in_progress","stage":"生成中","queue_position":0}`))
						return
					}
					body := map[string]any{"id": "mini1-task", "status": "completed", "enhance": "1080p", "enhanced": "", "width": 720, "height": 1280, "duration": 4}
					if withURL {
						body["url"] = server.URL + "/v1/videos/mini1-task/content"
					}
					_ = json.NewEncoder(w).Encode(body)
				case "/v1/videos/mini1-task/content":
					w.Header().Set("Content-Type", "video/mp4")
					_, _ = w.Write([]byte("video"))
				default:
					t.Errorf("unexpected path: %s", r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			config := providerConfig{
				BaseURL: server.URL + "/v1", APIKey: "test-mini1-key", Model: "seedance20Mini", InterfaceType: "seedance-mini1",
				Size: "9:16", VideoSeconds: "3", VQuality: "1080p",
			}
			result, err := runProtocolAdapterTaskWithPolicy(context.Background(), canvasGenerationInput{
				Mode: "video", Prompt: "@Image1 a clip", Config: config,
				ReferenceImages: []providerMedia{{DataURL: "data:image/png;base64,aW1hZ2U="}},
			}, adapter, fastVideoPollPolicy())
			if err != nil || result["mode"] != "video" {
				t.Fatalf("result = %#v, error=%v, calls=%v", result, err, calls)
			}
			if createCalls != 1 || pollCalls != 2 || len(calls) != 5 {
				t.Fatalf("create=%d poll=%d calls=%v", createCalls, pollCalls, calls)
			}
			video, _ := result["video"].(map[string]interface{})
			if video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
				t.Fatalf("downloaded video = %#v", video)
			}
			usage, _ := result["usage"].(map[string]any)
			if usage["enhanced"] != "" || usage["outputDurationSeconds"] != float64(4) {
				t.Fatalf("actual output usage = %#v", usage)
			}
		})
	}
}
