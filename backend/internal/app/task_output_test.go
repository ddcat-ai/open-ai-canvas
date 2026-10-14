package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
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
