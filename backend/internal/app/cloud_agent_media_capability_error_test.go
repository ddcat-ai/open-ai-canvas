package app

import (
	"errors"
	"strings"
	"testing"
)

func TestCloudAgentMediaCapabilityErrorBecomesCorrectableArgumentError(t *testing.T) {
	wrapped := cloudAgentWrapMediaAdmissionError(newModelCapabilityArgumentError("size", "unsupported_value", BadAuthRequest("自定义图片尺寸请使用宽x高，例如 3840x1920")))

	var argumentErr *cloudAgentArgumentError
	if !errors.As(wrapped, &argumentErr) {
		t.Fatalf("capability rejection is not an argument error: %#v", wrapped)
	}
	var fieldErr *cloudAgentFieldArgumentError
	if !errors.As(wrapped, &fieldErr) || fieldErr.Field != "size" {
		t.Fatalf("field = %#v", fieldErr)
	}
	class, retryable, action := cloudAgentToolErrorClass(CloudAgentRequest{}, cloudAgentCall{}, wrapped, true)
	if class != cloudAgentToolErrorSchemaError || !retryable || action != "fix_arguments" {
		t.Fatalf("class=%s retryable=%v action=%s", class, retryable, action)
	}
	if text := cloudAgentSafeToolError(wrapped); !strings.Contains(text, "自定义图片尺寸请使用宽x高") {
		t.Fatalf("model does not see the reason: %q", text)
	}
}

func TestCloudAgentMediaCapabilityErrorsUseStableFields(t *testing.T) {
	for _, test := range []struct {
		field string
		text  string
	}{
		{field: "size", text: "所选模型不支持当前请求"},
		{field: "quality", text: "图片质量不在当前模型支持范围内"},
		{field: "count", text: "输出数量不支持"},
	} {
		t.Run(test.field, func(t *testing.T) {
			wrapped := cloudAgentWrapMediaAdmissionError(newModelCapabilityArgumentError(test.field, "unsupported_value", BadAuthRequest(test.text)))
			var fieldErr *cloudAgentFieldArgumentError
			if !errors.As(wrapped, &fieldErr) || fieldErr.Field != test.field || fieldErr.Issue != "unsupported_value" {
				t.Fatalf("field error = %#v", fieldErr)
			}
		})
	}
	match := CapabilityMatch{Issues: []CapabilityIssue{{Kind: "option", Name: "size", Reason: "参数 画面尺寸超出支持范围"}}}
	wrapped := cloudAgentWrapMediaAdmissionError(modelCapabilityMismatchError(match))
	var fieldErr *cloudAgentFieldArgumentError
	if !errors.As(wrapped, &fieldErr) || fieldErr.Field != "size" {
		t.Fatalf("route mismatch field = %#v", fieldErr)
	}
}

func TestCloudAgentMediaAdmissionFailureMessageKeepsReason(t *testing.T) {
	message := cloudAgentMediaAdmissionFailureMessage(cloudAgentWrapMediaAdmissionError(BadAuthRequest("已超过本轮视频时长预算")))
	if !strings.Contains(message, "已超过本轮视频时长预算") || !strings.Contains(message, "未提交生成任务") {
		t.Fatalf("admission message lost the actionable reason: %q", message)
	}
	generic := cloudAgentMediaAdmissionFailureMessage(cloudAgentWrapMediaAdmissionError(errors.New("opaque failure")))
	if !strings.Contains(generic, "未提交生成任务") || strings.Contains(generic, "opaque failure") {
		t.Fatalf("unsafe admission detail leaked or missing: %q", generic)
	}
}

func TestCloudAgentMediaAdmissionErrorStaysTerminalForOtherFailures(t *testing.T) {
	wrapped := cloudAgentWrapMediaAdmissionError(BadAuthRequest("已超过本轮视频时长预算"))
	var admissionErr *cloudAgentMediaAdmissionError
	if !errors.As(wrapped, &admissionErr) || admissionErr.Retryable || admissionErr.RequiredAction != "report_to_user" {
		t.Fatalf("budget failure changed class: %#v", wrapped)
	}
	var argumentErr *cloudAgentArgumentError
	if errors.As(wrapped, &argumentErr) {
		t.Fatal("budget failure became a correctable argument error")
	}
}

func TestCloudAgentMediaReferenceCountMismatchIsCorrectable(t *testing.T) {
	match := CapabilityMatch{Issues: []CapabilityIssue{{Kind: "input", Name: "image", Reason: "图片数量需在 0-1 之间"}}}
	wrapped := cloudAgentWrapMediaAdmissionError(modelCapabilityMismatchError(match))
	var fieldErr *cloudAgentFieldArgumentError
	if !errors.As(wrapped, &fieldErr) || fieldErr.Field != "referenceNodeIds" || fieldErr.Issue != "unsupported_value" {
		t.Fatalf("reference input mismatch must be a referenceNodeIds field error, got %#v", wrapped)
	}
	if text := cloudAgentSafeToolError(wrapped); !strings.Contains(text, "图片数量需在 0-1 之间") {
		t.Fatalf("model does not see the reason: %q", text)
	}
	var modelErr *ModelError
	if !errors.As(modelCapabilityMismatchError(match), &modelErr) || modelErr.ErrorCode != ErrCodeModelCapabilityNotSupported {
		t.Fatalf("non-Agent callers must keep the capability error code: %#v", modelErr)
	}
}
