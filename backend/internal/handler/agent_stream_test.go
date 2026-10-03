package handler

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"infinite-canvas/backend/internal/auth"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"
)

type streamedAgentEvent struct {
	Seq     int            `json:"seq"`
	Payload map[string]any `json:"payload"`
}

func TestAgentEventStreamDeliversNewTextWithoutOneSecondBatching(t *testing.T) {
	t.Setenv("REDIS_URL", "")
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte("user\x00stream-test"))
	runID := "ag" + hex.EncodeToString(sum[:16])
	for _, row := range []any{
		&model.User{ID: "user", Username: "stream-user", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "auth", UserID: "user", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.Task{ID: runID, UserID: "user", Operation: "cloud_agent", Status: model.TaskStatusRunning, InputJSON: `{"cloudAgent":{"version":1,"request":{"idempotencyKey":"stream-test"}}}`},
		&model.CloudAgentExecution{ID: runID, UserID: "user", Status: "running", Revision: 1, StateJSON: `{}`},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), t.TempDir())
	t.Cleanup(func() { _ = svc.Close() })
	router := gin.New()
	RegisterAgentRoutes(router.Group("/api"), svc)
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/api/agent/runs/"+runID+"/events?after=1", nil)
	request.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "auth.test-token"})
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = response.Body.Close() })
	if response.StatusCode != http.StatusOK {
		t.Fatalf("SSE request returned %d", response.StatusCode)
	}
	chunks := make(chan streamedAgentEvent, 4)
	go func() {
		scanner := bufio.NewScanner(response.Body)
		kind := ""
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "event: ") {
				kind = strings.TrimPrefix(line, "event: ")
			}
			if kind == "agent_event" && strings.HasPrefix(line, "data: ") {
				var event streamedAgentEvent
				if json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &event) == nil {
					chunks <- event
				}
			}
		}
	}()
	for seq, text := range []string{"连续", "输出。"} {
		sequence := seq + 2
		encoded, _ := json.Marshal(map[string]any{"eventId": runID + ":" + strconv.Itoa(sequence), "runId": runID, "seq": sequence, "type": "assistant_delta", "payload": map[string]any{"messageId": "message", "text": text}})
		if err := db.Create(&model.CloudAgentEventRecord{RunID: runID, UserID: "user", Sequence: sequence, EventJSON: string(encoded)}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", runID).Update("revision", sequence).Error; err != nil {
			t.Fatal(err)
		}
		select {
		case event := <-chunks:
			if event.Seq != sequence || event.Payload["text"] != text {
				t.Fatalf("text was duplicated or reordered: %+v", event)
			}
		case <-time.After(350 * time.Millisecond):
			t.Fatal("persisted Agent text was not delivered within 350ms")
		}
	}
}
