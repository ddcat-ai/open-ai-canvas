package app

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 线上真实报错逐条回放：用户只能看到中文、可操作的原因，看不到地址、IP 或 Go 原始报错；
// 同时不能一律变成"生成失败"。
func TestUserFacingTaskErrorMatchesCanvasNodeClassification(t *testing.T) {
	for _, tc := range []struct{ name, raw, want string }{
		{"connection reset", `Post "https://ai.cangyuansuanli.cn/v1/images/generations": read tcp 192.168.1.7:61229->154.12.46.253:443: read: connection reset by peer`, "网络异常。"},
		{"dial", `dial tcp 10.0.0.1:443: connect: connection refused`, "网络异常。"},
		{"upstream 500 with reason", "模型服务暂时不可用（HTTP 500）；上游：Upstream gateway error", "模型服务暂时不可用（HTTP 500）；上游：Upstream gateway error"},
		{"bare 502", "HTTP 502 Bad Gateway", "网络异常。"},
		{"rate limit", "HTTP 429", "服务当前繁忙，请稍后重试。"},
		{"auth", "status 401", "生成服务鉴权失败，请检查渠道配置。"},
		{"provider json", `接口请求失败：{"error":{"message":"图片尺寸不支持"}}`, "图片尺寸不支持"},
		{"moderation", "sensitive_words_detected", taskErrorModerationMessage},
		{"storage", "参考图片上传失败：bucket denied", "参考素材上传到对象存储失败，请检查对象存储配置后重试。"},
		{"readable chinese", "模型服务拒绝了请求，请检查模型和参数", "模型服务拒绝了请求，请检查模型和参数"},
		{"empty", "", taskErrorDefaultMessage},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := userFacingTaskError(tc.raw); got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
}

func TestUserFacingTaskFailureNamesTheStep(t *testing.T) {
	task := &model.Task{Type: "canvas_image", Status: model.TaskStatusFailed, Error: `Post "https://x/v1/images/generations": read tcp 1.2.3.4:1->5.6.7.8:443: read: connection reset by peer`}
	if got := userFacingTaskFailure(task); got != "图片生成失败：网络异常。" {
		t.Fatalf("got %q", got)
	}
	step := &model.Task{Type: "canvas_text", Operation: cloudAgentStepOperation, Status: model.TaskStatusFailed, Error: "画布 Agent 接口没有返回内容"}
	if got := userFacingTaskFailure(step); got != "模型调用失败：画布 Agent 接口没有返回内容" {
		t.Fatalf("got %q", got)
	}
}

func TestCloudAgentUserFailureMessageHidesInternalEnglish(t *testing.T) {
	internal := fmt.Errorf("load session: %w", errors.New("invalid Agent checkpoint (runtime validation): Agent runtime has multiple active tasks"))
	got := cloudAgentUserFailureMessage("run-1", internal)
	if strings.ContainsAny(got, "abcdefghijklmnopqrstuvwxyz") && !strings.Contains(got, "run-1") {
		t.Fatalf("internal English leaked: %q", got)
	}
	if strings.Contains(got, "checkpoint") || strings.Contains(got, "multiple active") {
		t.Fatalf("internal English leaked: %q", got)
	}
	readable := fmt.Errorf("wrap: %w", BadAuthRequest("图片生成失败：网络异常。"))
	if got := cloudAgentUserFailureMessage("run-1", readable); got != "图片生成失败：网络异常。" {
		t.Fatalf("readable reason lost: %q", got)
	}
	if got := cloudAgentUserFailureMessage("run-1", fmt.Errorf("x: %w", repository.ErrInsufficientCredits)); got != "积分不足，请先充值" {
		t.Fatalf("insufficient credits not localized: %q", got)
	}
}

// 所有仓储层哨兵错误都必须是中文：它们会经 handler 直接返回给用户。
func TestRepositorySentinelErrorsAreChinese(t *testing.T) {
	for _, err := range []error{
		repository.ErrCreationConflict, repository.ErrInsufficientCredits, repository.ErrRedeemCodeInvalid,
		repository.ErrActiveTaskLimit, repository.ErrTaskNotRetryable, repository.ErrBillingStateConflict,
		repository.ErrBillingUsageUnavailable, repository.ErrBillingChargeLimit, repository.ErrChannelModelInUse,
		repository.ErrLogicalModelInUse, repository.ErrLogicalModelUnavailable, repository.ErrTaskStateConflict,
		repository.ErrCanvasRevisionConflict, repository.ErrDailyUploadLimitExceeded, repository.ErrProjectHasActiveTasks,
		repository.ErrPaymentOrderStateConflict, repository.ErrPaymentEvidenceMismatch,
	} {
		if !cloudAgentReadableMessage(err.Error()) {
			t.Errorf("sentinel error is not user-readable Chinese: %q", err.Error())
		}
	}
}
