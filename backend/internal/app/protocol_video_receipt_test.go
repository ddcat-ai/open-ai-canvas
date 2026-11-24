package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
	"yingce/backend/internal/protocol"
)

func TestKlingDetachedPollingKeepsCreationReceipt(t *testing.T) {
	allowLoopbackProviderTest(t)
	t.Setenv("REDIS_URL", "")
	service, db := newMediaRecoveryTestService(t)
	coordinator, err := platform.NewCoordinator("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	service.coordinator = coordinator
	adapter := loadOfficialProtocolAdapterForTest(t, "kling-v4-official.yingce-plugin")
	const id = "upstream-generation"
	const created = `{"code":0,"request_id":"trace-create","data":{"id":"upstream-generation","status":"submitted"}}`
	posts, gets := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case req.Method == "POST" && req.URL.Path == "/text-to-video/kling-4.0":
			posts++
			_, _ = w.Write([]byte(created))
		case req.Method == "GET" && req.URL.Path == "/tasks" && req.URL.Query().Get("task_ids") == id:
			gets++
			if gets == 1 {
				_, _ = w.Write([]byte(`{"code":0,"request_id":"trace-poll-a","data":[{"id":"other","status":"failed"},{"id":"upstream-generation","status":"processing"}]}`))
				return
			}
			_, _ = w.Write([]byte(`{"code":0,"request_id":"trace-poll-b","data":[{"id":"other","status":"processing"},{"id":"upstream-generation","status":"succeeded","outputs":[{"type":"video","url":"https://cdn.example.org/video.mp4"}]}]}`))
		default:
			t.Errorf("unexpected %s %s", req.Method, req.URL)
			http.NotFound(w, req)
		}
	}))
	defer server.Close()
	input := canvasGenerationInput{Mode: "video", Prompt: "街道全景", Config: providerConfig{BaseURL: server.URL, APIKey: "test", Model: "kling-4.0", InterfaceType: "kling-v4-official"}}
	encoded, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	task := model.Task{ID: newID(), UserID: "local-user", Type: "canvas_video", StartedAt: &start, Status: model.TaskStatusRunning, InputJSON: string(encoded), BillingOrderID: newID()}
	order := model.BillingOrder{ID: task.BillingOrderID, UserID: task.UserID, TaskID: task.ID, IdempotencyKey: newID(), Status: model.BillingStatusRunning}
	for _, item := range []any{&task, &order} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		stored, err := service.repo.Task(task.ID)
		if err != nil {
			t.Fatal(err)
		}
		_, runErr := runProtocolAdapterTaskWithPolicy(withProviderAnalytics(t.Context(), service, *stored), input, adapter, fastVideoPollPolicy())
		var pending providerStatePendingError
		if !errors.As(runErr, &pending) || !pending.Detached || pending.TaskID != id {
			t.Fatalf("pending: %v", runErr)
		}
		stored, err = service.repo.Task(task.ID)
		if err != nil || stored.ProviderRequestID != id || !service.shouldDeferProviderTask(*stored, string(encoded), runErr) {
			t.Fatalf("cannot resume original receipt: %v; stored=%+v", err, stored)
		}
	}
	stored, err := service.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := pollProtocolTask(withProviderAnalytics(t.Context(), service, *stored), input.Config, adapter, protocolRequestFromInput(input), stored.ProviderRequestID)
	if err != nil || state.Status != protocol.StatusSucceeded || state.Result == nil || len(state.Result.Videos) != 1 || posts != 1 || gets != 2 {
		t.Fatalf("result=%v err=%v, POST=%d GET=%d", state, err, posts, gets)
	}
	updated, err := service.repo.BillingOrder(order.ID)
	if err != nil || updated.ProviderRequestID != id {
		t.Fatalf("order=%+v err=%v", updated, err)
	}
	var root model.ApiCallLog
	if err := db.First(&root, "task_id = ? AND request_kind = 'create'", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if root.ProviderRequestID != id || root.PollCount != 2 || root.ProviderStatus != "succeeded" || !strings.Contains(root.ResponseBody, "trace-create") || strings.Contains(root.ResponseBody, "trace-poll") {
		t.Fatalf("root=%+v", root)
	}
}

func TestProtocolCreateIDUsesDeclaredMeaningOfRequestID(t *testing.T) {
	allowLoopbackProviderTest(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		_, _ = w.Write([]byte(`{"code":0,"request_id":"upstream-id"}`))
	}))
	defer server.Close()
	for _, tc := range []struct{ plugin, model, expected string }{{"fal-queue-video", "model", "upstream-id"}, {"kling-v4-official", "kling-4.0", ""}} {
		adapter := loadOfficialProtocolAdapterForTest(t, tc.plugin+".yingce-plugin")
		input := canvasGenerationInput{Mode: "video", Prompt: "全景", Config: providerConfig{BaseURL: server.URL, APIKey: "test", Model: tc.model, InterfaceType: tc.plugin}}
		request := protocolRequestFromInput(input)
		spec, err := adapter.BuildCreate(t.Context(), protocol.RequestContext{Request: request})
		if err != nil {
			t.Fatal(err)
		}
		receipt, err := submitProtocolMediaTask(t.Context(), input, adapter, request, spec)
		if err != nil || receipt.TaskID != tc.expected || (tc.expected == "" && receipt.Status != protocol.StatusFailed) {
			t.Fatalf("%s: %+v err=%v", tc.plugin, receipt, err)
		}
	}
}

func TestKlingSingleImageFollowsDeclaredCanvasMode(t *testing.T) {
	adapter := loadOfficialProtocolAdapterForTest(t, "kling-v4-official.yingce-plugin")
	for _, tc := range []struct{ operation, role, want string }{
		{"image_to_video", "", "/image-to-video/kling-4.0"},
		{"reference_to_video", "", "/omni-video/kling-4.0"},
		{"reference_to_video", "reference", "/omni-video/kling-4.0"},
		{"", "reference_image", "/omni-video/kling-4.0"},
	} {
		input := canvasGenerationInput{Mode: "video", Prompt: "全景", Config: providerConfig{Model: "kling-4.0"}, Metadata: map[string]any{"videoOperation": tc.operation}, ReferenceImages: []providerMedia{{ID: "image", Role: tc.role, URL: "https://media.example.org/frame.jpg", MimeType: "image/jpeg", Bytes: 10000, Width: 1280, Height: 720}}}
		spec, err := adapter.BuildCreate(t.Context(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
		if err != nil || spec.Path != tc.want {
			t.Fatalf("mode=%q role=%q: %s, %v", tc.operation, tc.role, spec.Path, err)
		}
	}
}

func TestWanWorkbenchReferencesReachOfficialAdapter(t *testing.T) {
	adapter := loadOfficialProtocolAdapterForTest(t, "dashscope-wan3-video.yingce-plugin")
	input := canvasGenerationInput{
		Mode: "video", Prompt: "全景", Config: providerConfig{Model: "wan3.0-video"},
		Metadata:        map[string]any{"videoEditOperation": "reference_to_video"},
		ReferenceImages: []providerMedia{{URL: "https://media.example.org/image.jpg", Role: "reference"}},
		ReferenceVideos: []providerMedia{{URL: "https://media.example.org/video.mp4", Role: "reference"}},
		ReferenceAudios: []providerMedia{{URL: "https://media.example.org/audio.mp3", Role: "reference"}},
	}
	request := protocolRequestFromInput(input)
	if _, err := adapter.BuildCreate(t.Context(), protocol.RequestContext{Request: request}); err != nil {
		t.Fatal(err)
	}
	if request.Images[0].Role != "reference_image" || request.Videos[0].Role != "reference_video" || request.Audios[0].Role != "reference_audio" {
		t.Fatalf("roles: %s, %s, %s", request.Images[0].Role, request.Videos[0].Role, request.Audios[0].Role)
	}
}

func TestProviderTaskWaitBoundary(t *testing.T) {
	start := time.Now()
	task := model.Task{StartedAt: &start}
	if providerTaskWaitExpired(task, start.Add(15*time.Second)) || providerTaskWaitExpired(task, start.Add(detachedProviderTaskMaxAge-time.Nanosecond)) || !providerTaskWaitExpired(task, start.Add(detachedProviderTaskMaxAge)) {
		t.Fatal("wrong 48h deadline")
	}
}

func TestKlingChannelExampleImportsDisabled(t *testing.T) {
	service, _ := newChannelModelTestService(t)
	service.dataDir = channelTestDataDir(t)
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "kling-v4-official", "config", "kling-v4-channels-CN.json"))
	if err != nil {
		t.Fatal(err)
	}
	var payload SystemChannelExport
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatal(err)
	}
	result, err := service.ImportSystemChannels(&model.User{ID: "admin", Role: model.UserRoleAdmin}, payload)
	if err != nil || result.SavedModels != 2 || len(result.CreatedChannels) != 1 || len(result.Errors) != 0 {
		t.Fatalf("import=%+v err=%v", result, err)
	}
	channels, err := service.repo.SystemChannels(true)
	if err != nil || len(channels) != 1 || channels[0].Enabled || channels[0].APIKey != "" {
		t.Fatalf("expected one unconfigured disabled channel, err=%v", err)
	}
}
