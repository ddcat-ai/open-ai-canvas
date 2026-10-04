package main

import (
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestAllowedOriginWildcard(t *testing.T) {
	t.Setenv("CANVAS_CORS_ORIGINS", "*")
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest("GET", "http://backend/api/health", nil)
	if !allowedOrigin(context, "https://example.com") {
		t.Fatal("wildcard CORS should allow a valid HTTPS origin")
	}
	if allowedOrigin(context, "ftp://example.com") {
		t.Fatal("wildcard CORS should reject non-HTTP origins")
	}
}

func TestEnvironmentParsers(t *testing.T) {
	t.Setenv("CANVAS_AUTO_MIGRATE", "false")
	value, err := envBool("CANVAS_AUTO_MIGRATE", true)
	if err != nil || value {
		t.Fatalf("envBool = %v, %v", value, err)
	}
	t.Setenv("CANVAS_SHUTDOWN_TIMEOUT", "45s")
	duration, err := envDuration("CANVAS_SHUTDOWN_TIMEOUT", time.Minute)
	if err != nil || duration != 45*time.Second {
		t.Fatalf("envDuration = %v, %v", duration, err)
	}
}

func TestAllowedOriginUsesForwardedHost(t *testing.T) {
	t.Setenv("CANVAS_CORS_ORIGINS", "")
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest("GET", "http://backend/api/health", nil)
	context.Request.Header.Set("X-Forwarded-Host", " canvas.example.com, proxy.internal")
	if !allowedOrigin(context, "https://canvas.example.com") {
		t.Fatal("forwarded public host should be treated as same-origin")
	}
}

func TestParseCORSPolicyNormalizesConfiguredOrigins(t *testing.T) {
	policy, err := parseCORSPolicy(" https://Canvas.example.com/ , http://localhost:3000 ")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := policy.origins["https://canvas.example.com"]; !ok {
		t.Fatal("configured origin was not normalized")
	}
	if _, ok := policy.origins["http://localhost:3000"]; !ok {
		t.Fatal("configured port was not preserved")
	}
}

func TestParseCORSPolicyRejectsNonOriginValue(t *testing.T) {
	if _, err := parseCORSPolicy("https://example.com/app"); err == nil {
		t.Fatal("path-bearing CORS value should be rejected")
	}
	if _, err := parseCORSPolicy("ftp://example.com"); err == nil {
		t.Fatal("non-HTTP CORS value should be rejected")
	}
}

func TestAllowedOriginConfiguredListDoesNotFallbackToArbitraryLocalhost(t *testing.T) {
	t.Setenv("CANVAS_CORS_ORIGINS", "https://app.example.com")
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest("GET", "http://backend/api/health", nil)
	if allowedOrigin(context, "http://localhost:3000") {
		t.Fatal("configured CORS list should disable the implicit localhost fallback")
	}
}

func TestRedactCanvasSharePath(t *testing.T) {
	got := redactCanvasSharePath("/api/public/canvas-shares/private-token/resources/resource-1/file")
	if got != "/api/public/canvas-shares/:token/resources/resource-1/file" {
		t.Fatalf("unexpected redacted path: %s", got)
	}
	if got := redactCanvasSharePath("/api/tasks"); got != "/api/tasks" {
		t.Fatalf("unrelated path changed: %s", got)
	}
}

func TestEnvInt(t *testing.T) {
	t.Setenv("CANVAS_TEST_INT", "")
	if value, err := envInt("CANVAS_TEST_INT", 7); err != nil || value != 7 {
		t.Fatalf("未配置应回退默认值：value = %d, err = %v", value, err)
	}
	t.Setenv("CANVAS_TEST_INT", " 12345 ")
	if value, err := envInt("CANVAS_TEST_INT", 7); err != nil || value != 12345 {
		t.Fatalf("应解析整数值：value = %d, err = %v", value, err)
	}
	t.Setenv("CANVAS_TEST_INT", "12abc")
	if _, err := envInt("CANVAS_TEST_INT", 7); err == nil {
		t.Fatal("非法整数应报错")
	}
}

func TestStaticSiteFromEnvIsOptIn(t *testing.T) {
	t.Setenv("CANVAS_STATIC_DIR", "")
	if site, err := staticSiteFromEnv(); err != nil || site != nil {
		t.Fatalf("未配置静态目录时不应启用静态承载：site = %v, err = %v", site, err)
	}
	t.Setenv("CANVAS_STATIC_DIR", "   ")
	if site, err := staticSiteFromEnv(); err != nil || site != nil {
		t.Fatalf("空白配置等同未配置：site = %v, err = %v", site, err)
	}

	t.Setenv("CANVAS_STATIC_DIR", t.TempDir())
	if _, err := staticSiteFromEnv(); err == nil {
		t.Fatal("缺少 index.html 的目录应快速失败")
	}

	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("<html></html>"), 0o644); err != nil {
		t.Fatalf("写入入口：%v", err)
	}
	t.Setenv("CANVAS_STATIC_DIR", root)
	site, err := staticSiteFromEnv()
	if err != nil || site == nil {
		t.Fatalf("合法目录应启用静态承载：site = %v, err = %v", site, err)
	}
}

func TestWatchParentProcessRequiresParentPID(t *testing.T) {
	t.Setenv("CANVAS_EXIT_WITH_PARENT", "false")
	t.Setenv("CANVAS_PARENT_PID", "")
	if err := watchParentProcess(context.Background(), func() {}); err != nil {
		t.Fatalf("未开启看门狗时不应报错：%v", err)
	}

	t.Setenv("CANVAS_EXIT_WITH_PARENT", "true")
	if err := watchParentProcess(context.Background(), func() {}); err == nil {
		t.Fatal("开启看门狗但缺少父进程号时应快速失败")
	}

	// 父进程号取当前进程：看门狗运行期间不会触发，结束由 cancel 收尾。
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	t.Setenv("CANVAS_PARENT_PID", strconv.Itoa(os.Getpid()))
	if err := watchParentProcess(ctx, cancel); err != nil {
		t.Fatalf("合法父进程号应开启看门狗：%v", err)
	}

	t.Setenv("CANVAS_EXIT_WITH_PARENT", "notabool")
	if err := watchParentProcess(ctx, cancel); err == nil {
		t.Fatal("非法布尔值应报错")
	}
}
