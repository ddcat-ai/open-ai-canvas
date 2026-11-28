package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestTaskForOutputRedactsRoutingAndSecrets(t *testing.T) {
	task := model.Task{
		InputJSON:              `{"mode":"image","metadata":{"source":"create-page"},"config":{"apiKey":"secret"},"resourceId":"resource-1"}`,
		LogicalModelRevisionID: "revision-1",
		RouteID:                "route-1",
		ChannelModelID:         "channel-model-1",
	}

	output := taskForOutput(task)
	if output.LogicalModelRevisionID != "" || output.RouteID != "" || output.ChannelModelID != "" {
		t.Fatalf("internal routing fields leaked: %+v", output)
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(output.InputJSON), &input); err != nil {
		t.Fatalf("public input is not valid JSON: %v", err)
	}
	if _, exists := input["config"]; exists {
		t.Fatal("provider config must not be exposed")
	}
	if input["resourceId"] != "resource-1" {
		t.Fatalf("resource identity was not preserved: %#v", input)
	}
}

func TestTaskForOutputRedactsHistoricalFailure(t *testing.T) {
	task := model.Task{Error: `模型服务暂时不可用（HTTP 503）；上游：{"error":{"code":"model_not_found","message":"request id abc at https://private.example/task_abc123"}}`, ProviderCancelError: "取消失败 task_abc123"}
	output := taskForOutput(task)
	if strings.Contains(output.Error, "private.example") || strings.Contains(output.Error, "request id") || strings.Contains(output.Error, "task_abc123") || !strings.Contains(output.Error, "更换模型") {
		t.Fatalf("unsafe task error: %q", output.Error)
	}
	if strings.Contains(output.ProviderCancelError, "task_abc123") {
		t.Fatalf("unsafe cancel error: %q", output.ProviderCancelError)
	}
}

func TestTaskOutputIncludesOnlySafeWorkbenchRestoreData(t *testing.T) {
	task := model.Task{InputJSON: `{"mode":"video","metadata":{"source":"workbench","workbenchKind":"video","workbenchToolId":"tool-1","workbenchPresetId":"preset-1","workbench":{"kind":"video","parameters":{"seconds":8,"ratio":"16:9","resolution":"1080p","generateAudio":true},"references":[{"resourceId":"resource-1","kind":"image","role":"first_frame","slotKey":"subject"}]}},"config":{"apiKey":"private-key","videoSeconds":"8","size":"16:9","vquality":"1080p"},"referenceImages":[{"resourceId":"resource-1","storageKey":"resource:resource-1","role":"first_frame","slotKey":"subject"}]}`}
	publicJSON := publicTaskInputJSON(task.InputJSON)
	var output map[string]any
	if err := json.Unmarshal([]byte(publicJSON), &output); err != nil {
		t.Fatal(err)
	}
	if _, exists := output["config"]; exists {
		t.Fatal("provider config leaked from workbench restore data")
	}
	workbench, ok := output["workbench"].(map[string]any)
	if !ok || workbench["kind"] != "video" {
		t.Fatalf("workbench restore data missing: %#v", output)
	}
	parameters, ok := workbench["parameters"].(map[string]any)
	if !ok || parameters["seconds"] != float64(8) || parameters["ratio"] != "16:9" || parameters["generateAudio"] != true {
		t.Fatalf("workbench parameters not preserved safely: %#v", workbench)
	}
	references, ok := workbench["references"].([]any)
	if !ok || len(references) != 1 {
		t.Fatalf("workbench references missing: %#v", workbench)
	}
	reference := references[0].(map[string]any)
	if reference["resourceId"] != "resource-1" || reference["kind"] != "image" || reference["role"] != "first_frame" || reference["slotKey"] != "subject" {
		t.Fatalf("safe reference fields not preserved: %#v", reference)
	}
}

func TestTaskOutputRestoresWorkbenchImageResolution(t *testing.T) {
	task := model.Task{InputJSON: `{"mode":"image","metadata":{"source":"workbench","workbenchKind":"image","workbench":{"kind":"image","parameters":{"size":"1824x1024","imageResolution":"2k","quality":"auto","count":1}}},"config":{"size":"1824x1024","imageResolution":"2k","quality":"auto","count":"1"}}`}
	var output map[string]any
	if err := json.Unmarshal([]byte(publicTaskInputJSON(task.InputJSON)), &output); err != nil {
		t.Fatal(err)
	}
	workbench, ok := output["workbench"].(map[string]any)
	if !ok {
		t.Fatalf("workbench restore data missing: %#v", output)
	}
	parameters, ok := workbench["parameters"].(map[string]any)
	if !ok || parameters["imageResolution"] != "2k" {
		t.Fatalf("image resolution not preserved for restore: %#v", workbench)
	}
}

func TestTaskMediaPreviewUsesSafeMediaURLs(t *testing.T) {
	previewURL, previewKind := taskMediaPreview(`{"images":["data:image/png;base64,AAAA","/api/resources/resource-1/file"],"video":"https://cdn.example.com/output.mp4"}`, "video")
	if previewURL != "/api/resources/resource-1/file" || previewKind != "image" {
		t.Fatalf("unexpected preview: url=%q kind=%q", previewURL, previewKind)
	}
	if previewURL, _ := taskMediaPreview(`{"url":"file:///tmp/output.mp4"}`, "video"); previewURL != "" {
		t.Fatalf("unsafe local URL was exposed: %q", previewURL)
	}
}

func TestTaskMediaPreviewSeparatesVideoPoster(t *testing.T) {
	previewURL, previewKind, posterURL := taskMediaPreviewWithPoster(`{"video":{"url":"https://cdn.example.com/output.mp4","posterUrl":"https://cdn.example.com/poster.webp"}}`, "canvas_video")
	if previewURL != "https://cdn.example.com/output.mp4" || previewKind != "video" || posterURL != "https://cdn.example.com/poster.webp" {
		t.Fatalf("unexpected video preview: url=%q kind=%q poster=%q", previewURL, previewKind, posterURL)
	}
	if _, _, posterURL := taskMediaPreviewWithPoster(`{"video":{"url":"https://cdn.example.com/output.mp4","posterUrl":"file:///tmp/poster.png"}}`, "canvas_video"); posterURL != "" {
		t.Fatalf("unsafe local poster was exposed: %q", posterURL)
	}
}

func TestTaskClientContextRequiresCreatePageMetadata(t *testing.T) {
	valid := taskClientContext(`{"metadata":{"source":"create-page","conversationId":"conversation-1","messageId":"message-1","batchIndex":2,"batchCount":4}}`)
	if valid == nil || valid.ConversationID != "conversation-1" || valid.BatchIndex != 2 {
		t.Fatalf("valid client context was not decoded: %+v", valid)
	}
	if context := taskClientContext(`{"metadata":{"source":"other","conversationId":"conversation-1","messageId":"message-1"}}`); context != nil {
		t.Fatalf("unexpected context for non-create-page task: %+v", context)
	}
}

func TestTaskClientContextPreservesCanvasNodeID(t *testing.T) {
	context := taskClientContext(`{"mode":"image","metadata":{"nodeId":"canvas-node-1","source":"canvas"}}`)
	if context == nil || context.NodeID != "canvas-node-1" {
		t.Fatalf("canvas node context was not preserved: %+v", context)
	}
}

func TestTaskSummaryPreservesCanvasNodeWithoutExposingInput(t *testing.T) {
	summary := taskSummaryForOutput(model.Task{
		ID: "task-1", ProjectID: "project-1", Type: "canvas_image",
		InputJSON: `{"metadata":{"nodeId":"node-1"},"config":{"apiKey":"private-test-value"}}`,
	})
	encoded, err := json.Marshal(summary)
	if err != nil {
		t.Fatal(err)
	}
	var output map[string]any
	if err := json.Unmarshal(encoded, &output); err != nil {
		t.Fatal(err)
	}
	context, ok := output["clientContext"].(map[string]any)
	if !ok || context["nodeId"] != "node-1" || len(context) != 1 {
		t.Fatalf("summary lost safe canvas association: %#v", output)
	}
	for _, key := range []string{"inputJson", "config", "apiKey"} {
		if _, exists := output[key]; exists {
			t.Fatalf("summary leaked %s", key)
		}
	}
}

func TestTaskSummaryExposesSafeFailedError(t *testing.T) {
	timeoutSummary := taskSummaryForOutput(model.Task{
		ID:     "task-timeout",
		Type:   "video_text_to_video",
		Status: model.TaskStatusFailed,
		Error:  "upstream timeout 504",
	})
	if timeoutSummary.Error != taskErrorUnavailableMessage {
		t.Fatalf("expected safe timeout classification %q, got %q", taskErrorUnavailableMessage, timeoutSummary.Error)
	}

	secretSummary := taskSummaryForOutput(model.Task{
		ID:     "task-secret",
		Type:   "canvas_image",
		Status: model.TaskStatusFailed,
		Error:  `模型服务暂时不可用（HTTP 503）；上游：{"error":{"code":"model_not_found","message":"request id abc at https://private.example/task_abc123"}}`,
	})
	if strings.Contains(secretSummary.Error, "private.example") || strings.Contains(secretSummary.Error, "request id") || strings.Contains(secretSummary.Error, "task_abc123") || !strings.Contains(secretSummary.Error, "更换模型") {
		t.Fatalf("unsafe summary error: %q", secretSummary.Error)
	}

	for _, tc := range []struct {
		name string
		task model.Task
	}{
		{name: "blank failed error", task: model.Task{ID: "task-empty", Type: "canvas_image", Status: model.TaskStatusFailed, Error: "   "}},
		{name: "succeeded task", task: model.Task{ID: "task-ok", Type: "canvas_image", Status: model.TaskStatusSucceeded, Error: "upstream timeout 504"}},
	} {
		summary := taskSummaryForOutput(tc.task)
		if summary.Error != "" {
			t.Fatalf("%s should not expose error, got %q", tc.name, summary.Error)
		}
		encoded, err := json.Marshal(summary)
		if err != nil {
			t.Fatal(err)
		}
		var payload map[string]any
		if err := json.Unmarshal(encoded, &payload); err != nil {
			t.Fatal(err)
		}
		if _, exists := payload["error"]; exists {
			t.Fatalf("%s marshaled unexpected error key: %s", tc.name, string(encoded))
		}
	}
}

func TestTaskSummaryListProjectsSafeFailedErrors(t *testing.T) {
	db := newSQLiteTestDB(t)
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	now := time.Now().UTC()
	records := []model.Task{
		{
			ID:        "task-generic-fail",
			UserID:    "user-1",
			Type:      "canvas_image",
			Status:    model.TaskStatusFailed,
			Stage:     "failed",
			Error:     "失败",
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:        "task-timeout-504",
			UserID:    "user-1",
			Type:      "video_text_to_video",
			Status:    model.TaskStatusFailed,
			Stage:     "failed",
			Error:     "upstream timeout 504",
			CreatedAt: now.Add(time.Second),
			UpdatedAt: now.Add(time.Second),
		},
		{
			ID:        "task-secret-fail",
			UserID:    "user-1",
			Type:      "canvas_image",
			Status:    model.TaskStatusFailed,
			Stage:     "failed",
			Error:     `模型服务暂时不可用（HTTP 503）；上游：{"error":{"code":"model_not_found","message":"request id abc at https://private.example/task_abc123"}}`,
			CreatedAt: now.Add(2 * time.Second),
			UpdatedAt: now.Add(2 * time.Second),
		},
		{
			ID:        "task-succeeded",
			UserID:    "user-1",
			Type:      "canvas_image",
			Status:    model.TaskStatusSucceeded,
			Stage:     "completed",
			Error:     "upstream timeout 504",
			CreatedAt: now.Add(3 * time.Second),
			UpdatedAt: now.Add(3 * time.Second),
		},
	}
	if err := db.Create(&records).Error; err != nil {
		t.Fatal(err)
	}

	summaries, err := svc.TasksWithOptions("user-1", TaskListOptions{Limit: 20})
	if err != nil {
		t.Fatalf("TasksWithOptions failed: %v", err)
	}
	if len(summaries) != len(records) {
		t.Fatalf("expected %d summaries, got %d", len(records), len(summaries))
	}

	byID := make(map[string]TaskSummary, len(summaries))
	for _, item := range summaries {
		byID[item.ID] = item
	}

	if got := byID["task-generic-fail"].Error; got != "失败" {
		t.Fatalf("generic failure error = %q, want %q", got, "失败")
	}
	if got := byID["task-timeout-504"].Error; got != taskErrorUnavailableMessage {
		t.Fatalf("timeout 504 error = %q, want %q", got, taskErrorUnavailableMessage)
	}
	secretErr := byID["task-secret-fail"].Error
	if strings.Contains(secretErr, "private.example") || strings.Contains(secretErr, "request id") || strings.Contains(secretErr, "task_abc123") || !strings.Contains(secretErr, "更换模型") {
		t.Fatalf("unsafe secret failure summary error: %q", secretErr)
	}
	okSummary := byID["task-succeeded"]
	if okSummary.Error != "" {
		t.Fatalf("succeeded task exposed error: %q", okSummary.Error)
	}
	encoded, err := json.Marshal(okSummary)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatal(err)
	}
	if _, exists := payload["error"]; exists {
		t.Fatalf("succeeded summary marshaled unexpected error key: %s", string(encoded))
	}
}

func TestTaskClientContextProjectsChapterOperations(t *testing.T) {
	characters := taskClientContext(`{"metadata":{"domainProjectId":"project-1","chapterId":"chapter-1","operation":"chapter_character_breakdown"}}`)
	if characters == nil || characters.DomainProjectID != "project-1" || characters.ChapterID != "chapter-1" || characters.ChapterOperation != "characters" {
		t.Fatalf("character task context was not decoded: %+v", characters)
	}
	storyboard := taskClientContext(`{"metadata":{"source":"short-drama-chapter-storyboard","domainProjectId":"project-1","chapterId":"chapter-2"}}`)
	if storyboard == nil || storyboard.ChapterID != "chapter-2" || storyboard.ChapterOperation != "storyboard" {
		t.Fatalf("storyboard task context was not decoded: %+v", storyboard)
	}
	if context := taskClientContext(`{"metadata":{"domainProjectId":"project-1","chapterId":"chapter-1","operation":"unrelated"}}`); context != nil {
		t.Fatalf("unexpected context for unrelated project task: %+v", context)
	}
}

func TestTaskClientContextProjectsShotWorkflow(t *testing.T) {
	context := taskClientContext(`{"metadata":{"domainProjectId":"project-1","shotId":"shot-1","workflowStepId":"step-1","artifactType":"video"}}`)
	if context == nil || context.DomainProjectID != "project-1" || context.ShotID != "shot-1" || context.WorkflowStepID != "step-1" || context.ArtifactType != "video" {
		t.Fatalf("shot task context was not decoded: %+v", context)
	}
}

func TestTaskOutputResourceReadsPersistedMedia(t *testing.T) {
	id, mediaType := taskOutputResource(`{"mode":"video","video":{"resourceId":"resource-1","storageKey":"resource:resource-1"}}`, "canvas_video")
	if id != "resource-1" || mediaType != "video" {
		t.Fatalf("unexpected task output resource: id=%q mediaType=%q", id, mediaType)
	}
}
