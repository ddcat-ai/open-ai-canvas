package app

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"yingce/backend/internal/storage"
)

// 回归测试：连接测试等轻量请求不携带 delivery 字段时，
// 落库配置必须保留现库的 CDN 鉴权方式，而不是被覆盖为空。
// 背景：2026-10-23 生产事故——保存 public 后点「测试」，cdnAuthMode 被静默清空。
func TestOSSSettingFromRequestPreservesDeliveryWhenNotProvided(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")

	current := ossSettingValue{
		Enabled:         true,
		Provider:        s3Provider,
		Endpoint:        server.URL,
		CDNBaseURL:      "https://cdn3.example.com",
		Bucket:          "bucket",
		AccessKeyID:     "key",
		AccessKeySecret: "secret",
		PathPrefix:      "open-ai-canvas",
		S3Preset:        "custom",
		Delivery: storage.DeliverySettings{
			CDNAuthMode: "public",
			RequireCDN:  true,
		},
	}

	// 模拟连接测试 payload：不含 cdnAuthMode/requireCDN/allowPrivateProxy。
	// Enabled=false 仅用于跳过端点 DNS 校验（沙箱无外网 DNS）；delivery 合并逻辑与 Enabled 无关。
	req := OSSSettingRequest{
		Enabled:         false,
		Provider:        s3Provider,
		Endpoint:        current.Endpoint,
		CDNBaseURL:      current.CDNBaseURL,
		Bucket:          current.Bucket,
		AccessKeyID:     current.AccessKeyID,
		AccessKeySecret: current.AccessKeySecret,
		PathPrefix:      current.PathPrefix,
		S3Preset:        current.S3Preset,
		Region:          "auto",
	}
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")

	next, err := ossSettingFromRequest(req, current)
	if err != nil {
		t.Fatalf("ossSettingFromRequest() error = %v", err)
	}
	if next.Delivery.CDNAuthMode != "public" {
		t.Fatalf("CDNAuthMode = %q, want public (must preserve current when delivery not provided)", next.Delivery.CDNAuthMode)
	}
	if !next.Delivery.RequireCDN {
		t.Fatalf("RequireCDN = false, want true (must preserve current when delivery not provided)")
	}

	// 显式提供 delivery 字段时必须以请求值为准（用户主动修改的场景）。
	req.DeliveryProvided = true
	req.CDNAuthMode = "public"
	req.RequireCDN = false
	next, err = ossSettingFromRequest(req, current)
	if err != nil {
		t.Fatalf("ossSettingFromRequest() error = %v", err)
	}
	if next.Delivery.RequireCDN {
		t.Fatalf("RequireCDN = true, want false (explicit request value must win)")
	}
	if next.Delivery.CDNAuthMode != "public" {
		t.Fatalf("CDNAuthMode = %q, want public", next.Delivery.CDNAuthMode)
	}

	// 显式清空鉴权方式也必须生效。
	req.CDNAuthMode = ""
	next, err = ossSettingFromRequest(req, current)
	if err != nil {
		t.Fatalf("ossSettingFromRequest() error = %v", err)
	}
	if next.Delivery.CDNAuthMode != "" {
		t.Fatalf("CDNAuthMode = %q, want empty (explicit clear must win)", next.Delivery.CDNAuthMode)
	}
}
