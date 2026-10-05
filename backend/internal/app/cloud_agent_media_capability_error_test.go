package app

import (
	"errors"
	"strings"
	"testing"
)

// 复现：generate_media 把 size 写成 "9:16" 这类比例值，而模型只接受像素尺寸；
// 修复前结果只有「工具执行失败」，整轮终止，重试时模型原样再错。
func TestCloudAgentMediaCapabilityErrorBecomesCorrectableArgumentError(t *testing.T) {
	wrapped := cloudAgentWrapMediaAdmissionError(BadAuthRequest("图片尺寸不在当前模型支持范围内"))

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
	text := cloudAgentSafeToolError(wrapped)
	if !strings.Contains(text, "图片尺寸不在当前模型支持范围内") || !strings.Contains(text, "model_list") {
		t.Fatalf("model does not see the reason: %q", text)
	}
}

func TestCloudAgentMediaCapabilityErrorCoversDurationRatioAndResolution(t *testing.T) {
	for message, field := range map[string]string{
		"视频时长不在当前模型支持范围内":  "durationSeconds",
		"画面比例不在当前模型支持范围内":  "size",
		"输出分辨率不在当前模型支持范围内": "quality",
		"图片质量不在当前模型支持范围内":  "quality",
	} {
		var fieldErr *cloudAgentFieldArgumentError
		if !errors.As(cloudAgentWrapMediaAdmissionError(BadAuthRequest(message)), &fieldErr) || fieldErr.Field != field {
			t.Fatalf("%s → %#v, want field %s", message, fieldErr, field)
		}
	}
}

// 模型、权限、预算等其它准入失败保持原口径：不可自动重试，交给用户。
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
