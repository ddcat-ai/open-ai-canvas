package handler

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func newStaticSiteFixture(t *testing.T) *StaticSite {
	t.Helper()
	root := t.TempDir()
	writeStaticFixture(t, root, "index.html", "<!doctype html><title>影策</title>")
	writeStaticFixture(t, root, "assets/app.js", "export const version = 1;")
	writeStaticFixture(t, root, "assets/engine.wasm", "\x00asm\x01\x00\x00\x00")
	site, err := NewStaticSite(root)
	if err != nil {
		t.Fatalf("构造静态承载：%v", err)
	}
	return site
}

func writeStaticFixture(t *testing.T, root string, relative string, content string) {
	t.Helper()
	target := filepath.Join(root, filepath.FromSlash(relative))
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatalf("创建目录：%v", err)
	}
	if err := os.WriteFile(target, []byte(content), 0o644); err != nil {
		t.Fatalf("写入文件：%v", err)
	}
}

// serveStaticRequest 走真实路由的 NoRoute 链路：直接调用 handler 时 gin 只记录状态码
// 而不落盘，记录器会永远停在 200。
func serveStaticRequest(site *StaticSite, method string, target string, accept string) *httptest.ResponseRecorder {
	router := gin.New()
	router.NoRoute(site.Serve)
	request := httptest.NewRequest(method, target, nil)
	if accept != "" {
		request.Header.Set("Accept", accept)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func TestNewStaticSiteRejectsUnusableDirectory(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	writeStaticFixture(t, root, "index.html", "<html></html>")
	empty := t.TempDir()

	for _, testCase := range []struct {
		name string
		dir  string
	}{
		{name: "空配置", dir: "  "},
		{name: "目录不存在", dir: filepath.Join(root, "missing")},
		{name: "缺少入口", dir: empty},
		{name: "指向文件", dir: filepath.Join(root, "index.html")},
		{name: "入口是目录", dir: createIndexDirectory(t)},
	} {
		if _, err := NewStaticSite(testCase.dir); err == nil {
			t.Fatalf("%s：应拒绝构造静态承载", testCase.name)
		}
	}
}

func createIndexDirectory(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "index.html"), 0o755); err != nil {
		t.Fatalf("创建入口目录：%v", err)
	}
	return root
}

func TestStaticSiteServesFilesWithTypesAndNoCacheEntry(t *testing.T) {
	gin.SetMode(gin.TestMode)
	site := newStaticSiteFixture(t)

	entry := serveStaticRequest(site, http.MethodGet, "/", "text/html")
	if entry.Code != http.StatusOK {
		t.Fatalf("入口 status = %d", entry.Code)
	}
	if !strings.Contains(entry.Body.String(), "影策") {
		t.Fatalf("入口内容不符：%s", entry.Body.String())
	}
	if got := entry.Header().Get("Cache-Control"); got != "no-cache" {
		t.Fatalf("入口 Cache-Control = %q，应为 no-cache", got)
	}

	script := serveStaticRequest(site, http.MethodGet, "/assets/app.js", "*/*")
	if script.Code != http.StatusOK {
		t.Fatalf("脚本 status = %d", script.Code)
	}
	if contentType := script.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/javascript") {
		t.Fatalf("脚本 Content-Type = %q", contentType)
	}
	if got := script.Header().Get("Cache-Control"); got != "" {
		t.Fatalf("哈希资源不该被强制回源，Cache-Control = %q", got)
	}

	wasm := serveStaticRequest(site, http.MethodGet, "/assets/engine.wasm", "*/*")
	if contentType := wasm.Header().Get("Content-Type"); contentType != "application/wasm" {
		t.Fatalf("wasm Content-Type = %q，流式编译要求 application/wasm", contentType)
	}

	head := serveStaticRequest(site, http.MethodHead, "/", "text/html")
	if head.Code != http.StatusOK || head.Body.Len() != 0 {
		t.Fatalf("HEAD status = %d, body = %d 字节", head.Code, head.Body.Len())
	}
}

func TestStaticSiteFallsBackOnlyForNavigation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	site := newStaticSiteFixture(t)

	deepLink := serveStaticRequest(site, http.MethodGet, "/projects/42/canvas", "text/html")
	if deepLink.Code != http.StatusOK || !strings.Contains(deepLink.Body.String(), "影策") {
		t.Fatalf("SPA 深链回退失败：status = %d, body = %.60s", deepLink.Code, deepLink.Body.String())
	}

	extensionless := serveStaticRequest(site, http.MethodGet, "/projects/42", "*/*")
	if extensionless.Code != http.StatusOK {
		t.Fatalf("无扩展名路径应回退入口：status = %d", extensionless.Code)
	}

	// 末段带点的路由（如 /projects/v1.2）本身像资源路径，浏览器导航声明的 text/html 是唯一依据。
	dottedRoute := serveStaticRequest(site, http.MethodGet, "/projects/v1.2", "text/html,application/xhtml+xml")
	if dottedRoute.Code != http.StatusOK || !strings.Contains(dottedRoute.Body.String(), "影策") {
		t.Fatalf("带点深链应回退入口：status = %d, body = %.60s", dottedRoute.Code, dottedRoute.Body.String())
	}

	for _, testCase := range []struct {
		name   string
		target string
		accept string
	}{
		{name: "脚本缺失", target: "/assets/missing.js", accept: "*/*"},
		{name: "图片缺失", target: "/welcome/banner.png", accept: "image/avif,image/webp,*/*"},
		{name: "带点脚本缺失", target: "/assets/v1.2/chunk.js", accept: "*/*"},
	} {
		response := serveStaticRequest(site, http.MethodGet, testCase.target, testCase.accept)
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s：status = %d，应如实 404", testCase.name, response.Code)
		}
		if strings.Contains(response.Body.String(), "<!doctype html>") {
			t.Fatalf("%s：不应拿入口 HTML 顶替缺失资源", testCase.name)
		}
	}
}

func TestStaticSiteRejectsWriteMethods(t *testing.T) {
	gin.SetMode(gin.TestMode)
	site := newStaticSiteFixture(t)
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch} {
		if response := serveStaticRequest(site, method, "/projects", "*/*"); response.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s status = %d，应为 405", method, response.Code)
		}
	}
}

func TestStaticSiteRejectsPathsOutsideRoot(t *testing.T) {
	gin.SetMode(gin.TestMode)
	base := t.TempDir()
	writeStaticFixture(t, base, "secret.txt", "TOP-SECRET")
	root := filepath.Join(base, "web")
	writeStaticFixture(t, root, "index.html", "<html></html>")
	writeStaticFixture(t, root, "assets/app.js", "export {};")
	site, err := NewStaticSite(root)
	if err != nil {
		t.Fatalf("构造静态承载：%v", err)
	}

	for _, target := range []string{
		"/../secret.txt",
		"/..%2fsecret.txt",
		"/%2e%2e/secret.txt",
		"/assets/../../secret.txt",
		"/..%5csecret.txt",
		"/assets%5c..%5c..%5csecret.txt",
	} {
		response := serveStaticRequest(site, http.MethodGet, target, "*/*")
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s：status = %d，应被拒绝", target, response.Code)
		}
		if strings.Contains(response.Body.String(), "TOP-SECRET") {
			t.Fatalf("%s：泄露了根目录外的文件", target)
		}
	}
}

func TestStaticSiteNoRouteHandlerKeepsAPISemantics(t *testing.T) {
	gin.SetMode(gin.TestMode)
	site := newStaticSiteFixture(t)
	router := gin.New()
	router.NoRoute(StaticSiteNoRouteHandler(&service.Service{}, site))

	api := httptest.NewRecorder()
	router.ServeHTTP(api, httptest.NewRequest(http.MethodGet, "/api/tasks/unknown", nil))
	if api.Code != http.StatusNotFound {
		t.Fatalf("/api 短代理 status = %d，应为 404", api.Code)
	}
	if contentType := api.Header().Get("Content-Type"); !strings.Contains(contentType, "application/json") {
		t.Fatalf("/api 路径被静态承载劫持，Content-Type = %q", contentType)
	}
	if strings.Contains(api.Body.String(), "<!doctype html>") {
		t.Fatalf("/api 路径返回了前端入口：%s", api.Body.String())
	}

	page := httptest.NewRecorder()
	router.ServeHTTP(page, httptest.NewRequest(http.MethodGet, "/projects/42", nil))
	if page.Code != http.StatusOK || !strings.Contains(page.Body.String(), "<!doctype html>") {
		t.Fatalf("非 /api 路径应由静态承载承接：status = %d, body = %.60s", page.Code, page.Body.String())
	}
}

func TestStaticSiteNoRouteHandlerWithoutSiteMatchesProxyOnly(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.NoRoute(StaticSiteNoRouteHandler(&service.Service{}, nil))

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/projects/42", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("未配置静态目录时 status = %d，应保持 404", response.Code)
	}
}
