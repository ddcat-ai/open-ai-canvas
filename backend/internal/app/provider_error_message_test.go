package app

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProviderErrorDetail(t *testing.T) {
	for _, tt := range []struct{ name, raw, want string }{
		{"moderation", `{"error":{"message":"非常抱歉，生成的图片可能违反了关于裸露、色情或情色内容的防护限制。请重试或修改提示语。"}}`, "非常抱歉，生成的图片可能违反了关于裸露、色情或情色内容的防护限制。请重试或修改提示语。"},
		{"parameter", `{"message":"size must be 1024x1024","request_id":"private","url":"https://private.test"}`, "size must be 1024x1024"},
		{"url", `{"error":"请修改图片尺寸 https://private.test/path?q=value"}`, "请修改图片尺寸 [链接已隐藏]"},
		{"detail", `{"detail":"请上传 PNG 图片"}`, "请上传 PNG 图片"},
		{"plain", "请缩短提示词", "请缩短提示词"},
		{"token limit", `{"message":"max_tokens must be less than 4096"}`, "max_tokens must be less than 4096"},
		{"balance", `{"message":"渠道余额不足，剩余 1.25 元"}`, ""},
		{"billing", `{"message":"insufficient credits: $0.25"}`, ""},
		{"key", `{"message":"invalid api_key=private"}`, ""},
		{"cookie", `{"message":"Cookie: session=private"}`, ""},
		{"token", `{"message":"access_token=private"}`, ""},
		{"html", "<html>502 private gateway</html>", ""},
		{"malformed", `{"message":"partial`, ""},
		{"diagnostics", `{"request_id":"private","headers":{"Authorization":"private"}}`, ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := providerErrorDetail(tt.raw); got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestTaskFailurePreservesSafeProviderDetail(t *testing.T) {
	const detail = "非常抱歉，生成的图片可能违反了关于裸露、色情或情色内容的防护限制。请重试或修改提示语。"
	for _, status := range []int{400, 403, 422, 429, 500, 502} {
		err := fmt.Errorf("图片生成失败：%w", providerHTTPError{StatusCode: status, Body: `{"error":{"message":"` + detail + `"}}`})
		if got := taskFailureMessage(err); !strings.Contains(got, "；上游："+detail) {
			t.Fatalf("status %d lost detail: %s", status, got)
		}
	}
	if got := taskFailureMessage(errors.New(providerPayloadErrorMessage(detail))); !strings.Contains(got, detail) {
		t.Fatalf("business failure lost detail: %s", got)
	}
}

func TestProviderErrorDetailThroughHTTPAndBusinessFailures(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	const detail = "生成的图片可能违反了关于裸露、色情或情色内容的防护限制。请修改提示语。"
	for _, status := range []int{http.StatusBadRequest, http.StatusOK} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			fmt.Fprintf(w, `{"error":{"message":%q}}`, detail)
		}))
		for _, target := range []any{&imageResponse{}, &map[string]interface{}{}} {
			req, err := http.NewRequest(http.MethodGet, server.URL, nil)
			if err != nil {
				t.Fatal(err)
			}
			err = doJSON(req, target)
			if err == nil || !strings.Contains(taskFailureMessage(err), detail) {
				t.Errorf("status %d target %T lost upstream detail: %v", status, target, err)
			}
		}
		server.Close()
	}
}
