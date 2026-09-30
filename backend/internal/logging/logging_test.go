package logging

import (
	"bytes"
	"errors"
	"log"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func setupBuffer(t *testing.T, level slog.Level) *bytes.Buffer {
	t.Helper()
	previous := slog.Default()
	buffer := &bytes.Buffer{}
	Setup(Config{Level: level, SlowRequest: time.Second, SlowSQL: 100 * time.Millisecond, Output: buffer})
	t.Cleanup(func() {
		slog.SetDefault(previous)
		log.SetOutput(os.Stderr)
		log.SetFlags(log.LstdFlags)
	})
	return buffer
}

func TestConfigFromEnv(t *testing.T) {
	t.Setenv(EnvLevel, "WARN")
	t.Setenv(EnvFormat, "json")
	t.Setenv(EnvSlowRequest, "0")
	t.Setenv(EnvSlowSQL, "250ms")
	config, err := ConfigFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if config.Level != slog.LevelWarn || !config.JSON || config.SlowRequest != 0 || config.SlowSQL != 250*time.Millisecond {
		t.Fatalf("unexpected config: %+v", config)
	}
	t.Setenv(EnvLevel, "verbose")
	if _, err := ConfigFromEnv(); err == nil {
		t.Fatal("invalid level must be rejected")
	}
}

func TestAccessLogSkipsSuccessfulQueries(t *testing.T) {
	gin.SetMode(gin.TestMode)
	buffer := setupBuffer(t, slog.LevelInfo)
	router := gin.New()
	router.Use(AccessLog(func(path string) string { return strings.ReplaceAll(path, "secret", ":token") }))
	router.GET("/api/items", func(c *gin.Context) { c.Status(http.StatusOK) })
	router.GET("/api/broken", func(c *gin.Context) { c.Status(http.StatusInternalServerError) })
	router.POST("/api/items", func(c *gin.Context) { c.Status(http.StatusCreated) })
	router.POST("/api/runs/:id/heartbeat", func(c *gin.Context) { c.Status(http.StatusOK) })
	router.GET("/api/share/:token", func(c *gin.Context) { c.Status(http.StatusNotFound) })

	serve := func(method, path string) {
		router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(method, path, nil))
	}
	serve(http.MethodGet, "/api/items")
	serve(http.MethodPost, "/api/runs/r1/heartbeat")
	if buffer.Len() != 0 {
		t.Fatalf("successful queries must not be logged at info level: %s", buffer.String())
	}
	serve(http.MethodPost, "/api/items")
	serve(http.MethodGet, "/api/broken")
	serve(http.MethodGet, "/api/share/secret")
	output := buffer.String()
	for _, want := range []string{"level=INFO", "status=201", "level=ERROR", "status=500", "level=WARN", "path=/api/share/:token"} {
		if !strings.Contains(output, want) {
			t.Fatalf("missing %q in %s", want, output)
		}
	}
	if strings.Contains(output, "secret") {
		t.Fatalf("redacted path leaked: %s", output)
	}
}

func TestAccessLevelSlowRequest(t *testing.T) {
	setupBuffer(t, slog.LevelInfo)
	if got := accessLevel(http.MethodGet, "/api/items", 200, 2*time.Second, false); got != slog.LevelWarn {
		t.Fatalf("slow query should warn, got %v", got)
	}
	if got := accessLevel(http.MethodGet, "/api/agent/runs/:id/events", 200, time.Hour, true); got != slog.LevelDebug {
		t.Fatalf("long-lived streams are not slow requests, got %v", got)
	}
}

func TestStdlogBridgesToWarn(t *testing.T) {
	buffer := setupBuffer(t, slog.LevelWarn)
	log.Printf("legacy failure: %v", errors.New("boom"))
	if !strings.Contains(buffer.String(), "level=WARN") || !strings.Contains(buffer.String(), "legacy failure: boom") {
		t.Fatalf("std log should reach the unified handler as WARN: %s", buffer.String())
	}
	slog.Info("info line")
	if strings.Contains(buffer.String(), "info line") {
		t.Fatal("info must be filtered at warn level")
	}
}

func TestGormLoggerOnlyLogsFailuresAndSlowQueries(t *testing.T) {
	buffer := setupBuffer(t, slog.LevelInfo)
	logger := GormLogger()
	sql := func() (string, int64) { return "SELECT * FROM users WHERE id = $1", 1 }
	logger.Trace(t.Context(), time.Now(), sql, nil)
	logger.Trace(t.Context(), time.Now(), sql, gorm.ErrRecordNotFound)
	if buffer.Len() != 0 {
		t.Fatalf("successful or not-found queries must not be logged: %s", buffer.String())
	}
	logger.Trace(t.Context(), time.Now().Add(-time.Second), sql, nil)
	logger.Trace(t.Context(), time.Now(), sql, errors.New("deadlock"))
	output := buffer.String()
	if !strings.Contains(output, `msg="sql slow"`) || !strings.Contains(output, `msg="sql failed"`) || !strings.Contains(output, "deadlock") {
		t.Fatalf("slow and failed SQL must be logged: %s", output)
	}
	filter, ok := logger.(gorm.ParamsFilter)
	if !ok {
		t.Fatal("GORM logger must implement ParamsFilter so SQL parameters stay out of logs")
	}
	if _, vars := filter.ParamsFilter(t.Context(), "SELECT 1", "secret"); vars != nil {
		t.Fatal("SQL parameters must be dropped from logs")
	}
}

func TestEvery(t *testing.T) {
	key := "test-every-" + time.Now().String()
	if !Every(key, time.Hour) || Every(key, time.Hour) {
		t.Fatal("Every should allow the first call and suppress repeats within the interval")
	}
}
