package storage

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

type rainyunHeadTransport func(*http.Request) (*http.Response, error)

func (f rainyunHeadTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

type rainyunHeadBody struct {
	read, closed bool
}

func (b *rainyunHeadBody) Read([]byte) (int, error) {
	b.read = true
	return 0, errors.New("HEAD must not read an object body")
}

func (b *rainyunHeadBody) Close() error {
	b.closed = true
	return nil
}

func rainyunHeadTestSetting() Settings {
	// 公网 IP 只用于本地 URL 校验；所有 HTTP 都由 fake transport 截获，不发出网络请求。
	return Settings{Enabled: true, Provider: "rainyun", Endpoint: "https://8.8.8.8", Bucket: "test-bucket", AccessKeyID: "test-access", AccessKeySecret: "test-secret", SessionToken: "test-session"}
}

func TestRainyunMonitorOnlySignsHeadAndClosesBody(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusForbidden, http.StatusNotFound, http.StatusServiceUnavailable} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			calls := 0
			body := &rainyunHeadBody{}
			client := &http.Client{Transport: rainyunHeadTransport(func(req *http.Request) (*http.Response, error) {
				calls++
				if req.Method != http.MethodHead || req.URL.Host != "8.8.8.8" || req.URL.Path != "/test-bucket" {
					t.Errorf("unexpected HEAD target or method")
				}
				query := req.URL.Query()
				if query.Get("X-Amz-Algorithm") != "AWS4-HMAC-SHA256" || query.Get("X-Amz-Signature") == "" || query.Get("X-Amz-Expires") != "60" {
					t.Error("missing bounded SigV4 signature")
				}
				if !strings.Contains(query.Get("X-Amz-Credential"), "/rainyun/s3/aws4_request") || query.Get("X-Amz-Security-Token") != "test-session" {
					t.Error("wrong region or session credential")
				}
				if req.Body != nil && req.Body != http.NoBody {
					t.Error("HEAD unexpectedly sends a body")
				}
				if deadline, ok := req.Context().Deadline(); !ok || time.Until(deadline) > 1500*time.Millisecond {
					t.Error("HEAD request has no short deadline")
				}
				return &http.Response{StatusCode: status, Header: make(http.Header), Body: body, Request: req}, nil
			})}
			got, err := headRainyunBucketContext(context.Background(), rainyunHeadTestSetting(), client)
			if err != nil || got != status || calls != 1 || body.read || !body.closed {
				t.Fatalf("HEAD status=%d err=%v calls=%d body=%+v", got, err, calls, body)
			}
		})
	}
}

func TestRainyunMonitorHeadNeverFollowsRedirect(t *testing.T) {
	calls := 0
	client := &http.Client{Transport: rainyunHeadTransport(func(req *http.Request) (*http.Response, error) {
		calls++
		if req.URL.Host != "8.8.8.8" {
			t.Error("signature leaked to redirect destination")
		}
		return &http.Response{StatusCode: http.StatusTemporaryRedirect, Header: http.Header{"Location": {"https://elsewhere.invalid/private"}}, Body: io.NopCloser(strings.NewReader("")), Request: req}, nil
	})}
	status, err := headRainyunBucketContext(context.Background(), rainyunHeadTestSetting(), client)
	if err != nil || status != http.StatusTemporaryRedirect || calls != 1 {
		t.Fatalf("redirect status=%d err=%v calls=%d", status, err, calls)
	}
}

func TestRainyunMonitorHeadRejectsInvalidSettingsBeforeHTTP(t *testing.T) {
	cases := []struct {
		name string
		edit func(*Settings)
	}{
		{"disabled", func(s *Settings) { s.Enabled = false }},
		{"other provider", func(s *Settings) { s.Provider = "s3" }},
		{"no bucket", func(s *Settings) { s.Bucket = "" }},
		{"no access id", func(s *Settings) { s.AccessKeyID = "" }},
		{"no secret", func(s *Settings) { s.AccessKeySecret = "" }},
		{"no endpoint", func(s *Settings) { s.Endpoint = "" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setting := rainyunHeadTestSetting()
			tc.edit(&setting)
			client := &http.Client{Transport: rainyunHeadTransport(func(*http.Request) (*http.Response, error) {
				t.Error("invalid configuration issued HTTP")
				return nil, errors.New("must not call")
			})}
			if _, err := headRainyunBucketContext(context.Background(), setting, client); err == nil {
				t.Fatal("invalid configuration accepted")
			}
		})
	}
}

func TestRainyunMonitorEndpointRejectsUnsafeOrNonRootURLs(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "")
	for _, raw := range []string{
		"", "ftp://8.8.8.8", "https://user:password@8.8.8.8", "https://8.8.8.8/path",
		"https://8.8.8.8?key=secret", "https://8.8.8.8/#fragment", "http://8.8.8.8",
		"https://127.0.0.1", "https://10.0.0.1", "https://169.254.169.254", "https://[::1]", "https://0.0.0.0",
	} {
		t.Run(raw, func(t *testing.T) {
			if _, err := rainyunMonitorEndpoint(context.Background(), raw); err == nil {
				t.Error("unsafe endpoint accepted")
			}
		})
	}
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	if _, err := rainyunMonitorEndpoint(context.Background(), "http://127.0.0.1:18080"); err != nil {
		t.Fatalf("exactly allowed local endpoint rejected: %v", err)
	}
	if _, err := rainyunMonitorEndpoint(context.Background(), "http://127.0.0.2:18080"); err == nil {
		t.Fatal("allowlist matched a different host")
	}
}

func TestRainyunMonitorHeadDeadlineAndErrorsAreRedacted(t *testing.T) {
	calls := 0
	client := &http.Client{Transport: rainyunHeadTransport(func(req *http.Request) (*http.Response, error) {
		calls++
		<-req.Context().Done()
		return nil, errors.New(req.URL.String() + " test-secret test-session")
	})}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err := headRainyunBucketContext(ctx, rainyunHeadTestSetting(), client)
	if err == nil || calls != 1 || time.Since(started) > time.Second {
		t.Fatalf("deadline err=%v calls=%d duration=%s", err, calls, time.Since(started))
	}
	for _, forbidden := range []string{"8.8.8.8", "test-secret", "test-session", "X-Amz", "https://"} {
		if strings.Contains(err.Error(), forbidden) {
			t.Fatalf("HEAD error leaked %q", forbidden)
		}
	}
}

func TestRainyunMonitorDNSHonorsCallerDeadline(t *testing.T) {
	// fake resolver 只等待取消，不会连接 DNS 服务器。
	previous := net.DefaultResolver
	defer func() { net.DefaultResolver = previous }()
	net.DefaultResolver = &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	started := time.Now()
	if _, err := rainyunMonitorEndpoint(ctx, "https://rainyun-monitor.invalid"); err == nil || time.Since(started) > time.Second {
		t.Fatal("DNS resolution escaped caller deadline")
	}
}
