package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/model"
)

func ginContextForTest(request *http.Request) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = request
	return ctx, recorder
}

func TestSessionCookieAcceptsBearerSessionForDesktopClients(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/auth/session", nil)
	request.Header.Set("Authorization", "bEaReR session-id.session-secret")
	ctx, _ := ginContextForTest(request)
	if got := sessionCookie(ctx); got != "session-id.session-secret" {
		t.Fatalf("sessionCookie() = %q", got)
	}
}

func TestSessionCookiePrefersHttpOnlyCookieAndRejectsOtherSchemes(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/auth/session", nil)
	request.AddCookie(&http.Cookie{Name: "open_ai_canvas_session", Value: "cookie-session"})
	request.Header.Set("Authorization", "Basic ignored")
	ctx, _ := ginContextForTest(request)
	if got := sessionCookie(ctx); got != "cookie-session" {
		t.Fatalf("sessionCookie() = %q, want cookie session", got)
	}

	request = httptest.NewRequest("GET", "/api/auth/session", nil)
	request.Header.Set("Authorization", "Basic ignored")
	ctx, _ = ginContextForTest(request)
	if got := sessionCookie(ctx); got != "" {
		t.Fatalf("sessionCookie() = %q, want empty", got)
	}
}

func TestSystemProxyCallLogDoesNotPersistRequestContent(t *testing.T) {
	user := &model.User{ID: "user-1"}
	channel := &model.ModelChannel{ID: "channel-1"}
	entry := apiCallLog(user, channel, "", "text", "", http.MethodPost, "/v1/chat/completions", "https://upstream.example/v1/chat/completions", []byte(`{"prompt":"private prompt"}`), "application/json", model.ApiCallStatusSucceeded, 200, time.Millisecond, "", 1)
	if entry.RequestBody != "" {
		t.Fatalf("request content persisted: %q", entry.RequestBody)
	}
}

func TestMinimizeSystemProxyLogRemovesUpstreamContent(t *testing.T) {
	entry := model.ApiCallLog{RequestBody: "prompt", ResponseBody: "result", Error: "echoed prompt", ErrorCode: "echoed prompt", UpstreamURL: "https://example.test/?prompt=secret", Path: "private path", Model: "private model", ProviderRequestID: "private id", ProviderStatus: "private status", RequestContentType: "private type", InputTokens: 12, UsageAvailable: true}
	minimizeSystemProxyLog(&entry)
	if entry.RequestBody != "" || entry.ResponseBody != "" || entry.Error != "" || entry.ErrorCode != "" || entry.UpstreamURL != "" {
		t.Fatalf("content retained in log: %#v", entry)
	}
	if entry.Path != "" || entry.Model != "" || entry.ProviderRequestID != "" || entry.ProviderStatus != "" || entry.RequestContentType != "" {
		t.Fatalf("untrusted metadata retained in log: %#v", entry)
	}
	if !entry.UsageAvailable || entry.InputTokens != 12 {
		t.Fatalf("billing usage lost: %#v", entry)
	}
}

func TestSystemProxyRequiresStableIdempotencyKey(t *testing.T) {
	for _, test := range []struct {
		value string
		valid bool
	}{
		{value: "", valid: false},
		{value: "   ", valid: false},
		{value: "request-123", valid: true},
		{value: string(make([]byte, 128)), valid: true},
		{value: string(make([]byte, 129)), valid: false},
	} {
		if got := validSystemProxyIdempotencyKey(test.value); got != test.valid {
			t.Errorf("validSystemProxyIdempotencyKey(len=%d) = %v, want %v", len(test.value), got, test.valid)
		}
	}
}
