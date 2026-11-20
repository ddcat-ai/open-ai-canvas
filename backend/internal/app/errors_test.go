package app

import (
	"errors"
	"strings"
	"testing"
)

func TestAppErrorPreservesSafeProjectionAndCause(t *testing.T) {
	cause := errors.New("database password=secret")
	err := WrapAppError(503, "服务暂时不可用", cause)
	err.Code = 10001
	err.Retryable = true

	if err.Error() != "服务暂时不可用" {
		t.Fatalf("AppError.Error() = %q", err.Error())
	}
	if err.Status != 503 || err.Code != 10001 || !err.Retryable {
		t.Fatalf("AppError fields = %#v", err)
	}
	if !errors.Is(err, cause) {
		t.Fatal("AppError should unwrap its internal cause")
	}
}

func TestAuthErrorAliasRemainsCompatible(t *testing.T) {
	var err *AuthError = BadAuthRequest("请求参数错误")
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Status != 400 || appErr.Code != 400 || appErr.Reason != ReasonInvalidArgument || appErr.Message != "请求参数错误" {
		t.Fatalf("AuthError compatibility = %#v", err)
	}
}

func TestQuotaExceededUsesStableCodeAndReason(t *testing.T) {
	err := QuotaExceeded("账号素材数量已达到 1 个上限")
	if err.Status != 403 || err.Code != CodeQuotaExceeded || err.Reason != ReasonQuotaExceeded {
		t.Fatalf("QuotaExceeded = %#v", err)
	}
}

// ModelError 内嵌 *AppError；errors.As 不遍历嵌入字段，此前投影和 Agent 错误
// 文案都取不到内嵌状态，可展示的中文原因被脱敏成兜底句。
func TestModelErrorExposesEmbeddedAppError(t *testing.T) {
	err := ModelCapabilityNotSupported("所选模型不支持当前请求：参数 画面尺寸超出支持范围")

	var appErr *AppError
	if !errors.As(err, &appErr) {
		t.Fatal("errors.As should reach the embedded AppError")
	}
	if appErr.Status != 400 || appErr.Reason != ErrorReason(ErrCodeModelCapabilityNotSupported) {
		t.Fatalf("embedded projection = %#v", appErr)
	}
	if text := cloudAgentSafeToolError(err); !strings.Contains(text, "画面尺寸超出支持范围") {
		t.Fatalf("safe tool error lost the reason: %q", text)
	}
}
