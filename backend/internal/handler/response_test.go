package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

type failureEnvelope struct {
	Code   int    `json:"code"`
	Msg    string `json:"msg"`
	Reason string `json:"reason"`
}

func TestFailServiceRegistrationCooldown(t *testing.T) {
	recorder, context := responseTestContext()
	failService(context, &service.EmailCodeCooldownError{Seconds: 47})
	response := decodeFailureEnvelope(t, recorder)
	if recorder.Code != http.StatusTooManyRequests || response.Code != service.CodeRateLimited || response.Reason != string(service.ReasonRateLimited) || recorder.Header().Get("Retry-After") != "47" || !strings.Contains(response.Msg, "47") {
		t.Fatalf("cooldown response: status=%d header=%s body=%#v", recorder.Code, recorder.Header().Get("Retry-After"), response)
	}
}

func TestFailServiceProjectsAppError(t *testing.T) {
	recorder, context := responseTestContext()
	err := service.RateLimited("请求过于频繁，请稍后重试")

	failService(context, err)

	response := decodeFailureEnvelope(t, recorder)
	if recorder.Code != http.StatusTooManyRequests || response.Code != service.CodeRateLimited || response.Reason != string(service.ReasonRateLimited) || response.Msg != err.Message {
		t.Fatalf("response = status %d, body %#v", recorder.Code, response)
	}
}

func TestFailServiceProjectsDNSFailureWithoutTransportDetails(t *testing.T) {
	recorder, context := responseTestContext()
	err := service.WrapAppError(http.StatusBadGateway, "外部服务域名解析失败，请检查渠道域名和后端 DNS 配置", errors.New("private-sentinel resolver failure"))
	err.Reason = service.ReasonUpstreamDNSFailed
	failService(context, &url.Error{Op: "Post", URL: "https://private-sentinel.invalid?token=private-sentinel", Err: err})
	response := decodeFailureEnvelope(t, recorder)
	if recorder.Code != http.StatusBadGateway || response.Code != service.CodeBadGateway || response.Reason != string(service.ReasonUpstreamDNSFailed) || response.Msg != err.Message {
		t.Fatalf("DNS response contract lost: %d %#v", recorder.Code, response)
	}
	if strings.Contains(recorder.Body.String(), "private-sentinel") {
		t.Fatal("raw transport details leaked into HTTP response")
	}
}

func TestFailServiceQuotaExceeded(t *testing.T) {
	recorder, context := responseTestContext()
	failService(context, service.QuotaExceeded("账号素材数量已达到 100 个上限"))

	response := decodeFailureEnvelope(t, recorder)
	if recorder.Code != http.StatusForbidden || response.Code != service.CodeQuotaExceeded || response.Reason != string(service.ReasonQuotaExceeded) {
		t.Fatalf("quota response = status %d, body %#v", recorder.Code, response)
	}
}

func TestFailServiceHidesUnclassifiedInternalError(t *testing.T) {
	recorder, context := responseTestContext()
	failService(context, errors.New("database password=secret"))

	response := decodeFailureEnvelope(t, recorder)
	if recorder.Code != http.StatusInternalServerError || response.Code != http.StatusInternalServerError {
		t.Fatalf("response = status %d, body %#v", recorder.Code, response)
	}
	if response.Msg != internalErrorMessage || strings.Contains(recorder.Body.String(), "password=secret") {
		t.Fatalf("internal error leaked in response: %s", recorder.Body.String())
	}
}

func TestFailInternalKeepsStatusWithoutLeakingCause(t *testing.T) {
	recorder, context := responseTestContext()
	failInternal(context, http.StatusServiceUnavailable, errors.New("redis://user:password@private-host"))

	response := decodeFailureEnvelope(t, recorder)
	if recorder.Code != http.StatusServiceUnavailable || response.Msg != "服务暂时不可用，请稍后重试" {
		t.Fatalf("response = status %d, body %#v", recorder.Code, response)
	}
	if strings.Contains(recorder.Body.String(), "private-host") {
		t.Fatalf("internal cause leaked in response: %s", recorder.Body.String())
	}
}

func TestParsePaginationQueryUsesDefaultsAndRejectsInvalidValues(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name      string
		query     string
		page      int
		pageSize  int
		wantError bool
	}{
		{name: "defaults", query: "", page: 1, pageSize: 40},
		{name: "explicit values", query: "page=3&pageSize=25", page: 3, pageSize: 25},
		{name: "invalid page", query: "page=abc", wantError: true},
		{name: "zero page", query: "page=0", wantError: true},
		{name: "negative page size", query: "pageSize=-1", wantError: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/api/test?"+tt.query, nil)
			context, _ := gin.CreateTestContext(httptest.NewRecorder())
			context.Request = request
			page, pageSize, err := parsePaginationQuery(context, 40)
			if (err != nil) != tt.wantError {
				t.Fatalf("error = %v, wantError = %t", err, tt.wantError)
			}
			if tt.wantError {
				return
			}
			if page != tt.page || pageSize != tt.pageSize {
				t.Fatalf("pagination = (%d, %d), want (%d, %d)", page, pageSize, tt.page, tt.pageSize)
			}
		})
	}
}

func responseTestContext() (*httptest.ResponseRecorder, *gin.Context) {
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)
	return recorder, context
}

func decodeFailureEnvelope(t *testing.T, recorder *httptest.ResponseRecorder) failureEnvelope {
	t.Helper()
	var response failureEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return response
}
