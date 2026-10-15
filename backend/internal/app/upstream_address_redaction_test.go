package app

import (
	"errors"
	"net/url"
	"strings"
	"testing"
)

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
