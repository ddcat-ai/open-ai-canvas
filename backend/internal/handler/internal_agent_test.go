package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func newInternalAgentRouter(t *testing.T, token, workerID, workerToken string) (*gin.Engine, []gin.RouteInfo) {
	t.Helper()
	t.Setenv("CANVAS_AGENT_INTERNAL_TOKEN", token)
	t.Setenv("CANVAS_AGENT_WORKER_ID", workerID)
	t.Setenv("CANVAS_AGENT_WORKER_TOKEN", workerToken)
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterInternalAgentRoutes(router, &service.Service{})
	return router, router.Routes()
}

func internalAgentRequest(t *testing.T, router *gin.Engine, method, target, identity, bearer string, header ProtocolHeaders) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, target, nil)
	request.Header.Set("X-Agent-Identity", identity)
	request.Header.Set("Authorization", "Bearer "+bearer)
	request.Header.Set("X-Agent-Protocol-Version", header.wire)
	request.Header.Set("X-Pi-SDK-Version", header.sdk)
	request.Header.Set("X-Pi-Session-Format", header.format)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

type ProtocolHeaders struct {
	wire, sdk, format string
}

var goodProtocol = ProtocolHeaders{wire: internalAgentWireVersion, sdk: internalAgentPiSDKVersion, format: internalAgentSessionFormat}

// 默认关闭：不给强 token 就不注册任何 internal-agent 路由，路由表与上游基线一致。
func TestInternalAgentRoutesNotMountedWithoutToken(t *testing.T) {
	_, mounted := newInternalAgentRouter(t, "", "", "")
	for _, route := range mounted {
		if strings.Contains(route.Path, "/internal-agent") {
			t.Fatalf("internal-agent route mounted without a strong token: %s", route.Method+" "+route.Path)
		}
	}
}

func TestInternalAgentRoutesMountedWithStrongToken(t *testing.T) {
	_, mounted := newInternalAgentRouter(t, strings.Repeat("t", 32), "compose", strings.Repeat("w", 32))
	found := false
	for _, route := range mounted {
		if route.Method == http.MethodGet && route.Path == "/internal-agent/health" {
			found = true
		}
	}
	if !found {
		t.Fatalf("health route missing with a strong token, routes=%d", len(mounted))
	}
}

func TestInternalAgentHealthRequiresWorkerAndProtocol(t *testing.T) {
	const token = "token-is-long-enough-32-chars-00"
	const workerSecret = "worker-secret-long-enough-32-chars"
	router, _ := newInternalAgentRouter(t, token, "compose", workerSecret)

	// 正确身份 + 正确协议 → 200，形状只含协议三元组。
	recorder := internalAgentRequest(t, router, http.MethodGet, "/internal-agent/health", "compose", workerSecret, goodProtocol)
	if recorder.Code != http.StatusOK {
		t.Fatalf("health status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Code int             `json:"code"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil || body.Code != 0 {
		t.Fatalf("health envelope = %s err=%v", recorder.Body.String(), err)
	}
	if !strings.Contains(recorder.Body.String(), internalAgentWireVersion) || !strings.Contains(recorder.Body.String(), internalAgentPiSDKVersion) || !strings.Contains(recorder.Body.String(), internalAgentSessionFormat) {
		t.Fatalf("health payload must report the protocol triple: %s", recorder.Body.String())
	}

	// 错凭据 → 裸 401，无 body 无原因。
	recorder = internalAgentRequest(t, router, http.MethodGet, "/internal-agent/health", "compose", "wrong-secret-long-enough-32-b", goodProtocol)
	if recorder.Code != http.StatusUnauthorized || recorder.Body.Len() != 0 {
		t.Fatalf("wrong credentials must be a bare 401, got %d %q", recorder.Code, recorder.Body.String())
	}

	// 身份头与凭据不匹配的组合（好凭据 + 错身份名）→ 401。
	recorder = internalAgentRequest(t, router, http.MethodGet, "/internal-agent/health", "other", workerSecret, goodProtocol)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("identity without matching credential must 401, got %d", recorder.Code)
	}

	// 缺协议头任一 → 426 + 固定 reason；逐一清空验证不能跳过任何一项。
	for _, missing := range []string{"wire", "sdk", "format"} {
		bad := goodProtocol
		switch missing {
		case "wire":
			bad.wire = ""
		case "sdk":
			bad.sdk = ""
		default:
			bad.format = ""
		}
		recorder = internalAgentRequest(t, router, http.MethodGet, "/internal-agent/health", "compose", workerSecret, bad)
		if recorder.Code != http.StatusUpgradeRequired || !strings.Contains(recorder.Body.String(), "agent_protocol_mismatch") {
			t.Fatalf("empty protocol header %s must 426 with fixed reason, got %d %s", missing, recorder.Code, recorder.Body.String())
		}
	}

	// 协议版本不匹配的同形（旧 wire）→ 426。
	old := goodProtocol
	old.wire = "canvas-pi-wire/v3"
	recorder = internalAgentRequest(t, router, http.MethodGet, "/internal-agent/health", "compose", workerSecret, old)
	if recorder.Code != http.StatusUpgradeRequired {
		t.Fatalf("old wire version must 426, got %d", recorder.Code)
	}

	// 未经身份的裸 internal token 直连 → 401（健康检查不放宽身份要求）。
	request := httptest.NewRequest(http.MethodGet, "/internal-agent/health", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("internal token without worker identity must 401, got %d", recorder.Code)
	}
}

func TestInternalAgentMountGateRejectsWeakToken(t *testing.T) {
	_, mounted := newInternalAgentRouter(t, "short", "compose", strings.Repeat("w", 32))
	for _, route := range mounted {
		if strings.Contains(route.Path, "/internal-agent") {
			t.Fatalf("short token must keep routes unmounted: %s", route.Path)
		}
	}
}
