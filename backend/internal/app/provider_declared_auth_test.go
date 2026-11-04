package app

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"yingce/backend/internal/protocol"
)

func declaredAuthManifest(id string, auth string) string {
	return fmt.Sprintf(`{
	"apiVersion":"yingce.plugin/v1",
	"id":%q,"version":"1.0.0","name":"Auth Test","author":"Test","documentation":"# Test",
	"contributes":{"providers":[{"id":%q,"label":"Auth Test","capabilities":["text"],"scopes":["canvas"],
	"create":{"method":"POST","path":"/chat/completions","contentType":"application/json","body":{"model":{"$ref":"request.model"}}},
	"response":{"textPaths":["choices.0.message.content"]},
	"auth":%s}]}
}`, id, id, auth)
}

func serviceWithDeclaredPlugins(t *testing.T, manifests map[string]string) *Service {
	t.Helper()
	plugins := make(map[string]pluginRecord, len(manifests))
	for id, raw := range manifests {
		adapter, err := protocol.LoadManifest([]byte(raw))
		if err != nil {
			t.Fatalf("load manifest %s: %v", id, err)
		}
		plugins[id] = pluginRecord{Raw: []byte(raw), Metadata: adapter.Metadata(), Status: "enabled", Source: PluginOriginUploaded}
	}
	return &Service{pluginRuntime: &pluginRuntime{plugins: plugins}}
}

// 系统代理出站鉴权复用声明式协议同一套实现：bearer / 自定义 header / anthropic / google-api-key。
func TestApplyDeclaredProtocolAuthHeaders(t *testing.T) {
	svc := serviceWithDeclaredPlugins(t, map[string]string{
		"plugin-bearer":    declaredAuthManifest("plugin-bearer", `{"type":"bearer","field":"apiKey"}`),
		"plugin-header":    declaredAuthManifest("plugin-header", `{"type":"header","field":"apiKey","header":"api-key"}`),
		"plugin-anthropic": declaredAuthManifest("plugin-anthropic", `{"type":"anthropic","field":"apiKey"}`),
		"plugin-google":    declaredAuthManifest("plugin-google", `{"type":"google-api-key","field":"apiKey"}`),
		"plugin-none":      declaredAuthManifest("plugin-none", `{"type":"none"}`),
		"plugin-sigv4":     declaredAuthManifest("plugin-sigv4", `{"type":"aws-sigv4","field":"apiKey","secretField":"secretKey"}`),
	})

	t.Run("bearer", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "https://upstream.example/v1/chat/completions", nil)
		handled, err := svc.ApplyDeclaredProtocolAuthHeaders(req, "plugin-bearer", "key-1", "")
		if err != nil || !handled {
			t.Fatalf("handled=%v err=%v", handled, err)
		}
		if got := req.Header.Get("Authorization"); got != "Bearer key-1" {
			t.Fatalf("Authorization = %q", got)
		}
	})

	t.Run("custom header", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "https://upstream.example/v1/chat/completions", nil)
		handled, err := svc.ApplyDeclaredProtocolAuthHeaders(req, "plugin-header", "key-1", "")
		if err != nil || !handled {
			t.Fatalf("handled=%v err=%v", handled, err)
		}
		if got := req.Header.Get("api-key"); got != "key-1" {
			t.Fatalf("api-key = %q", got)
		}
	})

	t.Run("anthropic", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "https://upstream.example/v1/messages", nil)
		handled, err := svc.ApplyDeclaredProtocolAuthHeaders(req, "plugin-anthropic", "key-1", "")
		if err != nil || !handled {
			t.Fatalf("handled=%v err=%v", handled, err)
		}
		if req.Header.Get("x-api-key") != "key-1" || req.Header.Get("anthropic-version") == "" {
			t.Fatalf("anthropic headers = %#v", req.Header)
		}
	})

	t.Run("google api key", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "https://upstream.example/v1beta/models/x:generateContent", nil)
		handled, err := svc.ApplyDeclaredProtocolAuthHeaders(req, "plugin-google", "key-1", "")
		if err != nil || !handled {
			t.Fatalf("handled=%v err=%v", handled, err)
		}
		if got := req.Header.Get("x-goog-api-key"); got != "key-1" {
			t.Fatalf("x-goog-api-key = %q", got)
		}
	})

	t.Run("none", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "https://upstream.example/v1/chat/completions", nil)
		handled, err := svc.ApplyDeclaredProtocolAuthHeaders(req, "plugin-none", "key-1", "")
		if err != nil || !handled {
			t.Fatalf("handled=%v err=%v", handled, err)
		}
		if req.Header.Get("Authorization") != "" {
			t.Fatalf("none 鉴权不应写头：%#v", req.Header)
		}
	})

	t.Run("no declaration", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "https://upstream.example/v1/chat/completions", nil)
		handled, err := svc.ApplyDeclaredProtocolAuthHeaders(req, "chat-completion", "key-1", "")
		if err != nil || handled {
			t.Fatalf("未声明应返回 handled=false：handled=%v err=%v", handled, err)
		}
	})

	t.Run("signature auth stays with author branch", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "https://upstream.example/v1/chat/completions", nil)
		handled, err := svc.ApplyDeclaredProtocolAuthHeaders(req, "plugin-sigv4", "key-1", "secret")
		if err != nil || handled {
			t.Fatalf("签名类鉴权应返回 handled=false：handled=%v err=%v", handled, err)
		}
	})
}

// 声明路径与请求路径比对前各自去掉一层版本前缀（前端发的路径不带版本）。
func TestDeclaredPathMatchesIgnoresVersionPrefix(t *testing.T) {
	cases := []struct {
		declared string
		request  string
		want     bool
	}{
		{"GET /v1/videos/{{taskId}}", "/videos/video-1", true},
		{"GET /v1/videos/{{taskId}}", "/v1/videos/video-1", true},
		{"POST /v1/chat/completions", "/chat/completions", true},
		{"POST /v1/images/generations", "/images/generations", true},
		{"POST /api/plan/v3/contents/generations/tasks", "/contents/generations/tasks", true},
		{"POST /v1/chat/completions", "/responses", false},
	}
	for _, test := range cases {
		if got := declaredPathMatches(test.declared, test.request); got != test.want {
			t.Fatalf("declaredPathMatches(%q, %q) = %v, want %v", test.declared, test.request, got, test.want)
		}
	}
	if got := TrimChannelAPIVersionPrefix("/v1beta/models/gemini:generateContent"); got != "/models/gemini:generateContent" {
		t.Fatalf("TrimChannelAPIVersionPrefix = %q", got)
	}
	if got := TrimChannelAPIVersionPrefix("/chat/completions"); got != "/chat/completions" {
		t.Fatalf("TrimChannelAPIVersionPrefix without prefix = %q", got)
	}
}

// 系统代理的声明匹配走 DeclaredProxyOperationMatch：真实插件 manifest 的 create/poll/cancel。
func TestDeclaredProxyOperationMatchUsesPluginDeclarations(t *testing.T) {
	svc := serviceWithDeclaredPlugins(t, map[string]string{
		"vendor-chat": `{
	"apiVersion":"yingce.plugin/v1",
	"id":"vendor-chat","version":"1.0.0","name":"Vendor Chat","author":"Test","documentation":"# Test",
	"contributes":{"providers":[{"id":"vendor-chat","label":"Chat","capabilities":["text"],"scopes":["canvas"],
	"create":{"method":"POST","path":"/chat/completions","contentType":"application/json","body":{"model":{"$ref":"request.model"}}},
	"poll":{"method":"GET","path":"/v1/jobs/{{taskId}}"},
	"cancel":{"method":"DELETE","path":"/v1/jobs/{{taskId}}"},
	"response":{"textPaths":["choices.0.message.content"]}}]}
}`,
		"vendor-image-banana": `{
	"apiVersion":"yingce.plugin/v1",
	"id":"vendor-image-banana","version":"1.0.0","name":"Banana","author":"Test","documentation":"# Test",
	"contributes":{"providers":[{"id":"vendor-image-banana","label":"Banana","capabilities":["image"],"scopes":["canvas"],
	"create":{"method":"POST","path":"/v1/images/generations","contentType":"application/json","body":{"model":{"$ref":"request.model"}}},
	"response":{"resultUrlPaths":["data.0.url"]}}]}
}`,
	})

	// 声明 create：POST /chat/completions（前端路径不带版本前缀）。
	declared, create, matched := svc.DeclaredProxyOperationMatch("vendor-chat", http.MethodPost, "/chat/completions")
	if !declared || !create || !matched {
		t.Fatalf("create 匹配 = declared:%v create:%v matched:%v", declared, create, matched)
	}
	// 声明 poll：GET /videos/abc 命中非 create 操作。
	declared, create, matched = svc.DeclaredProxyOperationMatch("vendor-chat", http.MethodGet, "/jobs/job-1")
	if !declared || create || !matched {
		t.Fatalf("poll 匹配 = declared:%v create:%v matched:%v", declared, create, matched)
	}
	// 声明 cancel：DELETE 能被识别（是否放行由 handler 的「非 create 只允许 GET」决定）。
	declared, create, matched = svc.DeclaredProxyOperationMatch("vendor-chat", http.MethodDelete, "/v1/jobs/job-1")
	if !declared || create || !matched {
		t.Fatalf("cancel 匹配 = declared:%v create:%v matched:%v", declared, create, matched)
	}
	// 未声明的 /responses 不命中。
	if _, _, matched = svc.DeclaredProxyOperationMatch("vendor-chat", http.MethodPost, "/responses"); matched {
		t.Fatal("未声明路径不应命中")
	}
	// 声明式图片插件声明的是 /v1/images/generations，前端发的是 /images/generations。
	declared, create, matched = svc.DeclaredProxyOperationMatch("vendor-image-banana", http.MethodPost, "/images/generations")
	if !declared || !create || !matched {
		t.Fatalf("vendor-image-banana 匹配 = declared:%v create:%v matched:%v", declared, create, matched)
	}
	// 没装的协议：declared=false，调用方走作者内置分支。
	if declared, _, _ = svc.DeclaredProxyOperationMatch("vendor-unknown", http.MethodPost, "/chat/completions"); declared {
		t.Fatal("未安装插件时不应声明命中")
	}
}

// 作者官方 chat 类插件声明 POST /v1/chat/completions，系统代理收到 /chat/completions。
func TestDeclaredProxyOperationMatchCoversOfficialChatPlugins(t *testing.T) {
	paths, err := filepath.Glob(filepath.Join("..", "..", "..", "plugin-packages", "*.yingce-plugin"))
	if err != nil || len(paths) == 0 {
		t.Fatalf("official plugin packages: %v", err)
	}
	checked := 0
	for _, path := range paths {
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			t.Fatalf("read %s: %v", filepath.Base(path), readErr)
		}
		pkg, parseErr := protocol.ParsePluginPackage(data)
		if parseErr != nil {
			t.Fatalf("parse %s: %v", filepath.Base(path), parseErr)
		}
		for _, provider := range pkg.Manifest.Contributes.Providers {
			if provider.Create.Path != "/v1/chat/completions" {
				continue
			}
			svc := serviceWithDeclaredPlugins(t, map[string]string{provider.ID: string(pkg.ManifestRaw)})
			declared, create, matched := svc.DeclaredProxyOperationMatch(provider.ID, http.MethodPost, "/chat/completions")
			if !declared || !create || !matched {
				t.Fatalf("%s 声明匹配 = declared:%v create:%v matched:%v", provider.ID, declared, create, matched)
			}
			checked++
			if checked >= 5 {
				return
			}
		}
	}
	t.Fatalf("official chat plugins with /v1/chat/completions = %d, want at least 5", checked)
}
