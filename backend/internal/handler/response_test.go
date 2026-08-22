package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

type failureEnvelope struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
}

func TestFailServiceProjectsAppError(t *testing.T) {
	recorder, context := responseTestContext()
	err := service.NewAppError(http.StatusTooManyRequests, "请求过于频繁，请稍后重试")
	err.Code = 42901

	failService(context, err)

	response := decodeFailureEnvelope(t, recorder)
	if recorder.Code != http.StatusTooManyRequests || response.Code != 42901 || response.Msg != err.Message {
		t.Fatalf("response = status %d, body %#v", recorder.Code, response)
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
