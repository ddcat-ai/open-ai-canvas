package app

import (
	"errors"
	"net/url"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestUserFacingErrorsHideDiagnosticsKeepActionableReasons(t *testing.T) {
	for _, tc := range []struct{ name, raw, hint string }{
		{"quota", `模型服务拒绝请求；上游：{"error":{"code":"insufficient_quota","message":"request id req-private task_secret123 https://private.example/v1"}}`, "额度"},
		{"model", `模型服务拒绝请求；上游：{"error":{"code":"model_not_found","message":"request id req-private task_secret123 https://private.example/v1"}}`, "更换模型"},
		{"image limit", `模型服务拒绝请求；上游：image file too large 25MB request id req-private task_secret123 https://private.example/v1`, "压缩图片"},
		{"parameter", `生成失败；上游：请将 aspect_ratio 调整为 16:9，task_secret123 https://private.example/v1`, "16:9"},
		{"content", `生成失败；上游：生成图片违反内容防护限制，请修改提示词。 task_secret123 https://private.example/v1`, "修改提示词"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := userFacingTaskError(tc.raw)
			if !strings.Contains(got, tc.hint) {
				t.Fatalf("actionable reason lost: %q", got)
			}
			for _, private := range []string{"private.example", "task_secret123", "req-private", `"error"`} {
				if strings.Contains(got, private) {
					t.Fatalf("diagnostic %s leaked: %q", private, got)
				}
			}
		})
	}
	if got := userFacingTaskError("请修改参数；诊断号 run-1 可反馈管理员"); !strings.Contains(got, "run-1") {
		t.Fatalf("safe local diagnostic identifier removed: %q", got)
	}
	if got := userFacingTaskError("生成失败；上游：https://private.example request id req-private"); got != "生成失败" {
		t.Fatalf("a redaction placeholder was treated as an actionable reason: %q", got)
	}
}

func TestTaskOutputRedactsHistoricalFailureWithoutMutatingStoredTask(t *testing.T) {
	task := model.Task{ID: "local-task", Status: model.TaskStatusFailed, Error: `模型服务失败；上游：model_not_found task_secret123 https://private.example/v1`, ProviderCancelError: "取消失败 task_secret123 https://private.example/v1", ExecutionDiagnosticJSON: `{"diagnosticId":"local-diagnostic","safeMessage":"任务失败 task_abc123","writebackMessage":"写回失败 task_abc123"}`}
	output := taskForOutput(task)
	summary := taskSummaryForOutput(task)
	for _, text := range []string{output.Error, output.ProviderCancelError, summary.ProviderCancelError} {
		if strings.Contains(text, "private.example") || strings.Contains(text, "task_secret123") {
			t.Fatalf("task output leaked diagnostics: %q", text)
		}
	}
	if output.ID != task.ID || !strings.Contains(output.Error, "更换模型") || !strings.Contains(task.Error, "private.example") {
		t.Fatal("task identity, actionable hint or stored evidence changed")
	}
	if output.Diagnostic == nil || output.Diagnostic.DiagnosticID != "local-diagnostic" || strings.Contains(output.Diagnostic.SafeMessage+output.Diagnostic.WritebackMessage, "task_abc123") {
		t.Fatalf("structured diagnostics leaked upstream ids or lost the local reference: %+v", output.Diagnostic)
	}
}

func TestBillingAndWorkerKeepCauseWithoutUpstreamAddress(t *testing.T) {
	repo := &taskBillingRepositoryStub{}
	billing := newTaskBillingCoordinator(repo)
	raw := `Post "https://private.example/v1?token=mock-only": http2: server sent GOAWAY`
	if err := billing.RefundBilling("order", raw); err != nil {
		t.Fatal(err)
	}
	if err := billing.MarkBillingUncertain("order", raw); err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{repo.refundCalls[0], repo.uncertainCalls[0], taskFailureMessage(errors.New(raw))} {
		if strings.Contains(text, "private.example") || strings.Contains(text, "mock-only") || !strings.Contains(text, "GOAWAY") {
			t.Fatalf("address leaked or diagnostic cause lost: %q", text)
		}
	}
}

func TestUserVisibleNotesRedactQuotedCredentials(t *testing.T) {
	for _, value := range []string{
		`退款原因：{"api_key":"mock-secret-value"}`,
		`退款原因：{"token":"mock-secret-value"}`,
		`退款原因：{"Authorization":"Bearer mock-secret-value"}`,
		`退款原因：{"request_id":"mock-secret-value"}`,
	} {
		got := sanitizeUserVisibleError(value)
		if strings.Contains(got, "mock-secret-value") || !strings.Contains(got, "退款原因") {
			t.Fatalf("quoted credential leaked or business copy lost: %q", got)
		}
	}
	note := `活动积分调整：{"reason":"春节活动","amount":100}`
	if got := sanitizeUserVisibleError(note); got != note {
		t.Fatalf("ordinary adjustment changed: %q", got)
	}
}

func TestRedactUpstreamAddressHidesEndpoint(t *testing.T) {
	cases := []struct{ name, raw, want string }{
		{
			name: "goaway keeps cause but hides host",
			raw:  `Post "https://www.kccai.ai/v1/images/generations": http2: server sent GOAWAY and closed the connection`,
			want: `Post "[链接已隐藏]": http2: server sent GOAWAY and closed the connection`,
		},
		{
			name: "dial tcp hides address",
			raw:  "调用上游失败：dial tcp 10.12.0.7:443: connect: connection refused",
			want: "调用上游失败：dial tcp [地址已隐藏]: connect: connection refused",
		},
		{
			name: "read tcp hides address pair",
			raw:  "read tcp 10.0.0.5:53211->203.0.113.9:443: connection reset by peer",
			want: "read tcp [地址已隐藏]: connection reset by peer",
		},
		{
			name: "provider detail without address stays readable",
			raw:  "模型服务暂时不可用（HTTP 503）；上游：execution mode \"sync\" is not supported",
			want: "模型服务暂时不可用（HTTP 503）；上游：execution mode \"sync\" is not supported",
		},
		{name: "empty stays empty", raw: "", want: ""},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := redactUpstreamAddress(tt.raw); got != tt.want {
				t.Fatalf("redactUpstreamAddress() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestTaskFailureMessageHidesUpstreamHost(t *testing.T) {
	postErr := &url.Error{
		Op:  "Post",
		URL: "https://www.kccai.ai/v1/images/generations",
		Err: errors.New("http2: server sent GOAWAY and closed the connection"),
	}
	got := taskFailureMessage(postErr)
	if strings.Contains(got, "kccai.ai") {
		t.Fatalf("task failure message leaked upstream host: %q", got)
	}
	if !strings.Contains(got, upstreamAddressLinkPlaceholder) {
		t.Fatalf("task failure message should mark the hidden link: %q", got)
	}
	if !strings.Contains(got, "GOAWAY") {
		t.Fatalf("task failure message lost the upstream cause: %q", got)
	}
}
