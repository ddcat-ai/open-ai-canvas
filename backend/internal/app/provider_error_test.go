package app

import (
	"strings"
	"testing"
)

func TestProviderFailureDetailsReadsTopLevelModerationError(t *testing.T) {
	code, message := providerFailureDetails(map[string]any{
		"code":    contentModerationErrorCode,
		"message": "prompt rejected",
	})
	if code != contentModerationErrorCode {
		t.Fatalf("unexpected code: %q", code)
	}
	if message != "prompt rejected" {
		t.Fatalf("unexpected message: %q", message)
	}
}

func TestProviderFailureDetailsReadsNestedError(t *testing.T) {
	code, message := providerFailureDetails(map[string]any{
		"error": map[string]any{"code": "invalid_request", "message": "invalid size"},
	})
	if code != "invalid_request" || message != "invalid size" {
		t.Fatalf("unexpected failure details: code=%q message=%q", code, message)
	}
}

func TestProviderFailureDetailsPrefersNestedBusinessCode(t *testing.T) {
	code, message := providerFailureDetails(map[string]any{
		"code": float64(400),
		"data": map[string]any{"code": contentModerationErrorCode, "message": "prompt rejected"},
	})
	if code != contentModerationErrorCode || message != "prompt rejected" {
		t.Fatalf("unexpected wrapped failure details: code=%q message=%q", code, message)
	}
}

func TestContentModerationFailureRequiresExactProviderCode(t *testing.T) {
	if !isContentModerationFailure(`{"code":"sensitive_words_detected"}`) {
		t.Fatal("expected moderation error to be detected")
	}
	if isContentModerationFailure("上游 HTTP 400") {
		t.Fatal("generic HTTP 400 must remain retryable")
	}
}

func TestProviderPayloadBusinessFailureRecognizesStringErrorCode(t *testing.T) {
	code, message, failed := providerPayloadBusinessFailure(map[string]any{
		"code": "RequestParameterIsWrong",
		"data": nil,
		"msg":  "参数: prompt 的长度: 23142 大于最大长度 10000",
	})
	if !failed || code != "RequestParameterIsWrong" || message != "参数: prompt 的长度: 23142 大于最大长度 10000" {
		t.Fatalf("business failure = (%q, %q, %v)", code, message, failed)
	}
}

func TestProviderPayloadBusinessFailureAcceptsStringSuccessCode(t *testing.T) {
	if code, message, failed := providerPayloadBusinessFailure(map[string]any{"code": "Success", "data": map[string]any{"task_id": "task-1"}}); failed {
		t.Fatalf("success payload was marked failed: (%q, %q)", code, message)
	}
}

func TestProviderPayloadBusinessFailureReadsNestedOutputFailure(t *testing.T) {
	code, message, failed := providerPayloadBusinessFailure(map[string]any{
		"output": map[string]any{
			"code":        "InvalidParameter",
			"message":     "Input should be '1080P', '720P' or '480P': parameters.resolution",
			"task_id":     "e0d8c86d-4939-4f2e-93f7-e2cd10a07d58",
			"task_status": "FAILED",
		},
		"request_id": "c3c98e67-830d-9f1d-8a62-fff019ffa522",
	})
	if !failed || code != "InvalidParameter" {
		t.Fatalf("nested output failure = (%q, %q, %v)", code, message, failed)
	}
	if !strings.Contains(message, "parameters.resolution") {
		t.Fatalf("unexpected message: %q", message)
	}
}

func TestProviderResponseBusinessFailureExplainsDoubaoSpeechDenial(t *testing.T) {
	body := []byte(`{"code":0,"data":"AAAA"}{"header":{"code":45000030,"message":"[resource_id=volc.seedtts.default] requested resource not granted"}}`)
	code, message, failed := providerResponseBusinessFailure(body)
	if !failed || !strings.Contains(message, "requested resource not granted") {
		t.Fatalf("business failure = (%q, %q, %v)", code, message, failed)
	}
	if code != "45000030" && code != "4.500003e+07" {
		t.Fatalf("unexpected code %q", code)
	}
}

func TestProviderPayloadBusinessFailureIgnoresOrdinaryHeader(t *testing.T) {
	if _, _, failed := providerPayloadBusinessFailure(map[string]any{
		"header": map[string]any{"code": float64(200), "message": "ok"},
		"data":   map[string]any{"audio": "AAAA"},
	}); failed {
		t.Fatal("ordinary header code was treated as a business failure")
	}
}

func TestProviderPayloadBusinessFailureIgnoresPendingOutput(t *testing.T) {
	if code, message, failed := providerPayloadBusinessFailure(map[string]any{
		"output":     map[string]any{"task_id": "task-1", "task_status": "PENDING"},
		"request_id": "req-1",
	}); failed {
		t.Fatalf("pending output marked failed: (%q, %q)", code, message)
	}
}
