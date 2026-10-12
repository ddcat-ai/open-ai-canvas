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

func TestCloudAgentMediaCapabilityErrorCoversDurationRatioResolutionAndModelChoice(t *testing.T) {
	for message, field := range map[string]string{
		"视频时长不在当前模型支持范围内":  "durationSeconds",
		"画面比例不在当前模型支持范围内":  "size",
		"输出分辨率不在当前模型支持范围内": "quality",
		"图片质量不在当前模型支持范围内":  "quality",
		"当前视频模型不支持该生成模式":   "logicalModelId",
		"参考素材数量超过当前模型限制":   "logicalModelId",
		"参考视频时长超过当前模型限制":   "logicalModelId",
		"图片尺寸宽高必须是 16 的倍数": "size",
	} {
		var fieldErr *cloudAgentFieldArgumentError
		if !errors.As(cloudAgentWrapMediaAdmissionError(BadAuthRequest(message)), &fieldErr) || fieldErr.Field != field {
			t.Fatalf("%s → %#v, want field %s", message, fieldErr, field)
		}
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
