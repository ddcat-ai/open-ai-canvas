package handler

import (
	"net/http/httptest"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func TestTaskTextEventCursorPrefersQueryAndSupportsLastEventID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	request := httptest.NewRequest("GET", "/api/tasks/task-1/text-events?after=7", nil)
	request.Header.Set("Last-Event-ID", "3")
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = request
	after, err := taskTextEventCursor(context)
	if err != nil || after != 7 {
		t.Fatalf("cursor = %d, err = %v", after, err)
	}

	request = httptest.NewRequest("GET", "/api/tasks/task-1/text-events", nil)
	request.Header.Set("Last-Event-ID", "3")
	context, _ = gin.CreateTestContext(httptest.NewRecorder())
	context.Request = request
	after, err = taskTextEventCursor(context)
	if err != nil || after != 3 {
		t.Fatalf("Last-Event-ID cursor = %d, err = %v", after, err)
	}
}

func TestStreamTaskTextEventsWritesSequenceAndTerminalEvent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest("GET", "/api/tasks/task-1/text-events", nil)
	replay := &service.TextReplayResult{
		Deltas:    []model.TaskTextDelta{{Sequence: 8, Content: "增量"}},
		Complete:  true,
		FinalText: "增量",
		Status:    model.TaskStatusSucceeded,
		Stage:     "已完成",
		Progress:  100,
	}
	streamTaskTextEvents(context, nil, "user-1", "task-1", 7, replay)
	if response.Header().Get("Content-Type") != "text/event-stream; charset=utf-8" {
		t.Fatalf("content type = %q", response.Header().Get("Content-Type"))
	}
	body := response.Body.String()
	if !strings.Contains(body, "event: progress") || !strings.Contains(body, `"progress":100`) || !strings.Contains(body, "id: 8\nevent: delta") || !strings.Contains(body, "event: terminal") {
		t.Fatalf("unexpected SSE body: %q", body)
	}
}
