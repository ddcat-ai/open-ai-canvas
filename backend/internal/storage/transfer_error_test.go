package storage

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestObjectTransferErrorRetryableStatus(t *testing.T) {
	cases := []struct {
		name       string
		statusCode int
		want       bool
	}{
		{name: "rate limited", statusCode: 429, want: true},
		{name: "server error", statusCode: 503, want: true},
		{name: "forbidden", statusCode: 403, want: false},
		{name: "bad request", statusCode: 400, want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := &ObjectTransferError{Provider: "OSS", Operation: "上传", StatusCode: tc.statusCode}
			if got := err.Retryable(); got != tc.want {
				t.Fatalf("Retryable() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestPutAliyunOSSObjectPreservesRetryableStatus(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	_, err := PutAliyunOSSObject(Settings{
		Endpoint:        server.URL,
		Bucket:          "bucket",
		AccessKeyID:     "access-id",
		AccessKeySecret: "access-secret",
	}, "result.png", "image/png", int64(len("payload")), strings.NewReader("payload"))
	var transferErr *ObjectTransferError
	if !errors.As(err, &transferErr) || transferErr.StatusCode != http.StatusServiceUnavailable || !transferErr.Retryable() {
		t.Fatalf("error=%v transfer=%+v", err, transferErr)
	}
}

func TestObjectTransferErrorRetryableDeadlineAndUnwrap(t *testing.T) {
	err := &ObjectTransferError{Provider: "S3", Operation: "上传", Cause: context.DeadlineExceeded}
	if !err.Retryable() {
		t.Fatal("deadline must be retryable")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("transfer error lost its cause")
	}
	if got := err.Error(); got == "" || !containsAll(got, "S3", "上传") {
		t.Fatalf("unexpected error text: %q", got)
	}
}

func containsAll(value string, parts ...string) bool {
	for _, part := range parts {
		if !strings.Contains(value, part) {
			return false
		}
	}
	return true
}
