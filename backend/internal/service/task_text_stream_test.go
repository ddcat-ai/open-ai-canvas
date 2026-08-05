package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCreateTaskUsesSubmissionIDIdempotentlyPerUser(t *testing.T) {
	svc, db := newTaskTextStreamTestService(t)
	request := CreateTaskRequest{
		SubmissionID: "submission-1",
		Type:         "canvas_text",
		Operation:    "text",
		Prompt:       "写一段测试文案",
		Input:        map[string]any{"mode": "text"},
	}

	first, err := svc.CreateTask("user-1", request)
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.CreateTask("user-1", request)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID {
		t.Fatalf("idempotent task IDs = %q, %q", first.ID, second.ID)
	}

	var count int64
	if err := db.Model(&model.Task{}).Where("user_id = ? AND submission_id = ?", "user-1", request.SubmissionID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("task count = %d, want 1", count)
	}

	otherUser, err := svc.CreateTask("user-2", request)
	if err != nil {
		t.Fatal(err)
	}
	if otherUser.ID == first.ID {
		t.Fatal("submission ID was incorrectly shared across users")
	}
}

func TestTaskTextStreamReplaysPartialDraft(t *testing.T) {
	svc, db := newTaskTextStreamTestService(t)
	task := model.Task{ID: "text-task-1", UserID: "user-1", Type: "canvas_text", Status: model.TaskStatusRunning, Prompt: "测试", Attempts: 1}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	writer, err := svc.newTaskTextWriter(task)
	if err != nil {
		t.Fatal(err)
	}
	if err := writer.Write("第一段"); err != nil {
		t.Fatal(err)
	}
	if err := writer.Flush(); err != nil {
		t.Fatal(err)
	}
	if err := writer.Write("第二段"); err != nil {
		t.Fatal(err)
	}
	if err := writer.Flush(); err != nil {
		t.Fatal(err)
	}

	stream, err := svc.TaskTextStream("user-1", task.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(stream.Chunks) != 1 || stream.Chunks[0].Sequence != 2 || stream.Chunks[0].Delta != "第二段" {
		t.Fatalf("replayed chunks = %#v", stream.Chunks)
	}
}

func TestRunTextTaskStreamHandlesResponsesAndChatCompletionsEvents(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	tests := []struct {
		name          string
		interfaceType string
		path          string
		events        string
	}{
		{
			name:          "responses",
			interfaceType: string(model.ChannelInterfaceOpenAIResponse),
			path:          "/v1/responses",
			events: "event: response.output_text.delta\n" +
				"data: {\"type\":\"response.output_text.delta\",\"delta\":\"第一\"}\n\n" +
				"event: response.output_text.delta\n" +
				"data: {\"type\":\"response.output_text.delta\",\"delta\":\"段\"}\n\n" +
				"data: [DONE]\n\n",
		},
		{
			name:          "chat completions",
			interfaceType: string(model.ChannelInterfaceChatCompletion),
			path:          "/v1/chat/completions",
			events: "data: {\"choices\":[{\"delta\":{\"content\":\"第一\"}}]}\n\n" +
				"data: {\"choices\":[{\"delta\":{\"content\":\"段\"}}]}\n\n" +
				"data: [DONE]\n\n",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.URL.Path != test.path {
					t.Errorf("path = %q, want %q", request.URL.Path, test.path)
				}
				var body map[string]any
				if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
					t.Fatal(err)
				}
				if stream, _ := body["stream"].(bool); !stream {
					t.Fatal("stream flag was not sent")
				}
				writer.Header().Set("Content-Type", "text/event-stream")
				_, _ = writer.Write([]byte(test.events))
			}))
			defer server.Close()

			var chunks []string
			result, err := runTextTaskStream(context.Background(), canvasGenerationInput{
				Mode:   "text",
				Prompt: "写一句话",
				Config: providerConfig{BaseURL: server.URL + "/v1", APIKey: "test-key", Model: "test-model", InterfaceType: test.interfaceType},
			}, func(delta string) error {
				chunks = append(chunks, delta)
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			if got := strings.Join(chunks, ""); got != "第一段" {
				t.Fatalf("deltas = %q", got)
			}
			if text, _ := result["text"].(string); text != "第一段" {
				t.Fatalf("result = %#v", result)
			}
		})
	}
}

func newTaskTextStreamTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	return New(repository.New(db), t.TempDir()), db
}
