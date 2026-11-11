package app

import (
	"errors"
	"hash/crc64"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestTencentCOSConnectionTestUsesStorageEndpointInsteadOfCDN(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	var storageMethods []string
	storageServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		storageMethods = append(storageMethods, r.Method)
		if !strings.HasPrefix(r.URL.Path, "/open-ai-canvas/.yingce-tests/platform/") {
			t.Errorf("path = %q", r.URL.Path)
		}
		if !strings.Contains(r.Header.Get("Authorization"), "q-sign-algorithm=sha1") {
			t.Errorf("Authorization = %q", r.Header.Get("Authorization"))
		}
		switch r.Method {
		case http.MethodPut:
			payload, err := io.ReadAll(r.Body)
			if err != nil {
				t.Error(err)
			}
			if string(payload) != "yingce-storage-test" {
				t.Errorf("payload = %q", payload)
			}
			w.Header().Set("ETag", `"cos-test-etag"`)
			w.Header().Set("x-cos-hash-crc64ecma", strconv.FormatUint(crc64.Checksum(payload, crc64.MakeTable(crc64.ECMA)), 10))
		case http.MethodGet:
			if r.Header.Get("Range") != "bytes=0-3" {
				t.Errorf("Range = %q", r.Header.Get("Range"))
			}
			w.Header().Set("Accept-Ranges", "bytes")
			w.Header().Set("Content-Range", "bytes 0-3/19")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = io.WriteString(w, "ying")
		case http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected method %s", r.Method)
		}
	}))
	defer storageServer.Close()

	cdnRequests := 0
	cdnServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		cdnRequests++
		http.Error(w, "CDN must not be used by storage connection tests", http.StatusBadGateway)
	}))
	defer cdnServer.Close()

	err := verifyOSSConnection(ossSettingValue{
		Provider:        tencentCOSProvider,
		Region:          "ap-guangzhou",
		Endpoint:        storageServer.URL,
		CDNBaseURL:      cdnServer.URL,
		Bucket:          "example-1250000000",
		AccessKeyID:     "secret-id",
		AccessKeySecret: "secret-key",
		PathPrefix:      defaultOSSPathPrefix,
	}, defaultOSSPathPrefix+"/.yingce-tests/platform/test-id")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(storageMethods, ",") != "PUT,GET,DELETE" {
		t.Fatalf("storage methods = %v", storageMethods)
	}
	if cdnRequests != 0 {
		t.Fatalf("CDN requests = %d", cdnRequests)
	}
}

func TestRainyunOSSConnectionTestUsesS3ForCleanup(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var methods []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methods = append(methods, r.Method)
		if r.URL.Path != "/example/open-ai-canvas/.yingce-tests/platform/test-id" {
			t.Errorf("unexpected storage path %q", r.URL.Path)
		}
		if r.URL.Query().Get("X-Amz-Algorithm") != "AWS4-HMAC-SHA256" || r.URL.Query().Get("X-Amz-Signature") == "" {
			w.Header().Set("Content-Type", "application/xml")
			w.WriteHeader(http.StatusForbidden)
			_, _ = io.WriteString(w, `<Error><Code>SignatureDoesNotMatch</Code><Message>wrong protocol</Message></Error>`)
			return
		}
		switch r.Method {
		case http.MethodPut:
			payload, err := io.ReadAll(r.Body)
			if err != nil || string(payload) != "yingce-storage-test" {
				t.Error("unexpected upload payload")
			}
			w.Header().Set("ETag", `"test-etag"`)
		case http.MethodGet:
			if r.Header.Get("Range") != "bytes=0-3" {
				t.Error("missing range header")
			}
			w.Header().Set("Content-Range", "bytes 0-3/19")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = io.WriteString(w, "ying")
		case http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected method %s", r.Method)
		}
	}))
	defer server.Close()
	err := verifyOSSConnection(ossSettingValue{
		Provider: rainyunOSSProvider, Region: "rainyun", Endpoint: server.URL,
		Bucket: "example", AccessKeyID: "test-id", AccessKeySecret: "test-secret",
		CDNBaseURL: "https://media.example.com", PathPrefix: defaultOSSPathPrefix,
	}, defaultOSSPathPrefix+"/.yingce-tests/platform/test-id")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(methods, ",") != "PUT,GET,DELETE" {
		t.Fatalf("methods = %v", methods)
	}
}

func TestOSSConnectionReadAcceptsFullObjectWhenRangeIsIgnored(t *testing.T) {
	payload := []byte("yingce-storage-test")
	stream := &ossObjectStream{
		Body:          io.NopCloser(strings.NewReader(string(payload))),
		StatusCode:    http.StatusOK,
		ContentLength: int64(len(payload)),
	}
	if err := verifyOSSConnectionRead(stream, payload); err != nil {
		t.Fatal(err)
	}
}

func TestOSSConnectionReadRejectsUnexpectedContent(t *testing.T) {
	payload := []byte("yingce-storage-test")
	stream := &ossObjectStream{
		Body:          io.NopCloser(strings.NewReader("error page")),
		StatusCode:    http.StatusOK,
		ContentLength: 10,
	}
	err := verifyOSSConnectionRead(stream, payload)
	if err == nil {
		t.Fatal("verifyOSSConnectionRead() error = nil")
	}
	if !errors.Is(err, errOSSConnectionReadMismatch) {
		t.Fatalf("verifyOSSConnectionRead() error = %v", err)
	}
	publicErr := storageConnectionTestError(tencentCOSProvider, "Range 读取", err)
	var appErr *AppError
	if !errors.As(publicErr, &appErr) || !strings.Contains(appErr.Message, "忽略、改写了 Range 请求") {
		t.Fatalf("storageConnectionTestError() = %#v", publicErr)
	}
}

func TestTencentCOSConnectionTestReturnsActionableAuthError(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w, `<Error><Code>SignatureDoesNotMatch</Code><Message>signature mismatch</Message><RequestId>request-id</RequestId></Error>`)
	}))
	defer server.Close()

	err := verifyOSSConnection(ossSettingValue{
		Provider:        tencentCOSProvider,
		Region:          "ap-guangzhou",
		Endpoint:        server.URL,
		Bucket:          "example-1250000000",
		AccessKeyID:     "secret-id",
		AccessKeySecret: "secret-key",
		PathPrefix:      defaultOSSPathPrefix,
	}, defaultOSSPathPrefix+"/.yingce-tests/platform/test-id")
	if err == nil {
		t.Fatal("verifyOSSConnection() error = nil")
	}
	var appErr *AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("error type = %T, error = %v", err, err)
	}
	if appErr.Status != http.StatusBadGateway || !strings.Contains(appErr.Message, "腾讯云 COS 写入鉴权失败") {
		t.Fatalf("AppError = %#v", appErr)
	}
	if strings.Contains(appErr.Message, "secret-key") || strings.Contains(appErr.Message, "signature mismatch") {
		t.Fatalf("public error leaked upstream detail: %q", appErr.Message)
	}
}
