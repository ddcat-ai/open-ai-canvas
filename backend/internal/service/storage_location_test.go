package service

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
