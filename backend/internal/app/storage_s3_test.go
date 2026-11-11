package app

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestRainyunOSSSettingDefaultsRegionAndDoesNotReuseOtherProviderSecret(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()

	next, err := ossSettingFromRequest(OSSSettingRequest{
		Enabled: true, Provider: rainyunOSSProvider, Endpoint: server.URL,
		Bucket: "rainyun-bucket", AccessKeyID: "rainyun-id", AccessKeySecret: "rainyun-secret",
	}, ossSettingValue{Provider: aliyunOSSProvider, AccessKeySecret: "aliyun-secret"})
	if err != nil {
		t.Fatal(err)
	}
	if next.Region != "rainyun" {
		t.Fatalf("Region = %q, want rainyun", next.Region)
	}

	_, err = ossSettingFromRequest(OSSSettingRequest{
		Enabled: true, Provider: rainyunOSSProvider, Endpoint: server.URL,
		Bucket: "rainyun-bucket", AccessKeyID: "rainyun-id",
	}, ossSettingValue{Provider: aliyunOSSProvider, AccessKeySecret: "aliyun-secret"})
	if err == nil || !strings.Contains(err.Error(), "访问密钥 SecretKey") {
		t.Fatalf("ossSettingFromRequest() error = %v", err)
	}
}

func TestRainyunOSSSettingRejectsIncompatibleEndpoint(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, endpoint := range []string{"http://127.0.0.1:8080/s3", "http://127.0.0.1:8080/?token=secret", "http://127.0.0.1:8080/#fragment"} {
		_, err := ossSettingFromRequest(OSSSettingRequest{
			Enabled: true, Provider: rainyunOSSProvider, Endpoint: endpoint,
			Bucket: "rainyun-bucket", AccessKeyID: "rainyun-id", AccessKeySecret: "rainyun-secret",
		}, ossSettingValue{})
		if err == nil {
			t.Fatalf("Endpoint %q should be rejected", endpoint)
		}
	}
	_, err := ossSettingFromRequest(OSSSettingRequest{
		Enabled: true, Provider: rainyunOSSProvider, Endpoint: "http://127.0.0.1:8080",
		Bucket: "rainyun-bucket", AccessKeyID: "rainyun-id", AccessKeySecret: "rainyun-secret",
	}, ossSettingValue{})
	if err != nil {
		t.Fatalf("allowlisted HTTP test endpoint rejected: %v", err)
	}
}

func TestSignedRainyunS3ObjectURLUsesPathStyleAndSigV4(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()

	value, err := signedOriginObjectURL(ossSettingValue{
		Provider: rainyunOSSProvider, Endpoint: server.URL, Bucket: "rainyun-bucket",
		AccessKeyID: "rainyun-id", AccessKeySecret: "rainyun-secret",
	}, "users/u-1/image/test image.png", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(value)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	if parsed.Path != "/rainyun-bucket/users/u-1/image/test image.png" || query.Get("X-Amz-Algorithm") != "AWS4-HMAC-SHA256" || query.Get("X-Amz-Credential") == "" || query.Get("X-Amz-Signature") == "" || !strings.Contains(value, "test%20image.png") {
		t.Fatalf("signed Rainyun URL = %q", value)
	}
	if strings.Contains(value, "rainyun-secret") {
		t.Fatalf("signed URL leaked secret key: %q", value)
	}
}

func TestRainyunS3UploadAndRangeUseS3Endpoint(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	payload := []byte("rainyun payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rainyun-bucket/users/u-1/image/test.png" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.URL.Query().Get("X-Amz-Algorithm") != "AWS4-HMAC-SHA256" {
			t.Errorf("X-Amz-Algorithm = %q, want AWS4-HMAC-SHA256 (presigned)", r.URL.Query().Get("X-Amz-Algorithm"))
		}
		switch r.Method {
		case http.MethodPut:
			if strings.Contains(r.URL.RawQuery, "uploads") || strings.Contains(r.URL.RawQuery, "uploadId") {
				t.Errorf("PUT should not include multipart query: %q", r.URL.RawQuery)
			}
			if !strings.Contains(r.URL.RawQuery, "X-Amz-Signature=") {
				t.Errorf("PUT should include presigned signature in query: %q", r.URL.RawQuery)
			}
			if r.Header.Get("Content-Length") != strconv.Itoa(len(payload)) {
				t.Errorf("Content-Length = %q", r.Header.Get("Content-Length"))
			}
			if r.Header.Get("Content-Type") != "image/png" {
				t.Errorf("Content-Type = %q", r.Header.Get("Content-Type"))
			}
			data, err := io.ReadAll(r.Body)
			if err != nil {
				t.Error(err)
			}
			if !bytes.Equal(data, payload) {
				t.Errorf("upload body = %q", data)
			}
			w.Header().Set("ETag", `"rainyun-etag"`)
			w.WriteHeader(http.StatusOK)
		case http.MethodGet:
			if r.Header.Get("Range") != "bytes=0-3" {
				t.Errorf("Range = %q", r.Header.Get("Range"))
			}
			w.Header().Set("Accept-Ranges", "bytes")
			w.Header().Set("Content-Range", "bytes 0-3/15")
			w.Header().Set("Content-Length", "4")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write([]byte("rain"))
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	defer server.Close()

	setting := ossSettingValue{Provider: rainyunOSSProvider, Endpoint: server.URL, Region: "rainyun", Bucket: "rainyun-bucket", AccessKeyID: "rainyun-id", AccessKeySecret: "rainyun-secret"}
	etag, err := putOSSObject(setting, "users/u-1/image/test.png", "image/png", int64(len(payload)), bytes.NewReader(payload))
	if err != nil || etag != "rainyun-etag" {
		t.Fatalf("putOSSObject() = %q, %v", etag, err)
	}
	stream, err := getOSSObjectRange(setting, "users/u-1/image/test.png", "bytes=0-3")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	data, err := io.ReadAll(stream.Body)
	if err != nil {
		t.Fatal(err)
	}
	if stream.StatusCode != http.StatusPartialContent || stream.ContentRange != "bytes 0-3/15" || string(data) != "rain" {
		t.Fatalf("stream = %#v, data = %q", stream, data)
	}
}

func TestRainyunUploadBodyRejectsSeekableReaderWithWrongRemainingSize(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("mismatched upload must fail before sending a request")
	}))
	defer server.Close()
	reader := bytes.NewReader([]byte("prefixpayload"))
	if _, err := reader.Seek(int64(len("prefix")), io.SeekStart); err != nil {
		t.Fatal(err)
	}
	_, err := putOSSObject(ossSettingValue{Provider: rainyunOSSProvider, Endpoint: server.URL, Region: "rainyun", Bucket: "rainyun-bucket", AccessKeyID: "rainyun-id", AccessKeySecret: "rainyun-secret"}, "users/u-1/image/test.png", "image/png", int64(len("payload")-1), reader)
	if err == nil {
		t.Fatal("putOSSObject() accepted a seekable reader with mismatched remaining size")
	}
}

func TestRainyunS3UploadRetriesRetryableStatusWithCompleteBody(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	payload := []byte("rainyun retry payload")
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		data, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
		}
		if !bytes.Equal(data, payload) {
			t.Errorf("attempt %d body = %q, want the full payload", attempts, data)
		}
		if attempts == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("ETag", `"rainyun-retry-etag"`)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	setting := ossSettingValue{Provider: rainyunOSSProvider, Endpoint: server.URL, Region: "rainyun", Bucket: "rainyun-bucket", AccessKeyID: "rainyun-id", AccessKeySecret: "rainyun-secret"}
	etag, err := putOSSObject(setting, "users/u-1/video/test.mp4", "video/mp4", int64(len(payload)), bytes.NewReader(payload))
	if err != nil || etag != "rainyun-retry-etag" {
		t.Fatalf("putOSSObject() = %q, %v", etag, err)
	}
	if attempts != 2 {
		t.Fatalf("attempts = %d, want 2", attempts)
	}
}

func TestRainyunS3UploadDoesNotRetryClientError(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	payload := []byte("rainyun payload")
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("<Error><Code>SignatureDoesNotMatch</Code></Error>"))
	}))
	defer server.Close()

	setting := ossSettingValue{Provider: rainyunOSSProvider, Endpoint: server.URL, Region: "rainyun", Bucket: "rainyun-bucket", AccessKeyID: "rainyun-id", AccessKeySecret: "rainyun-secret"}
	if _, err := putOSSObject(setting, "users/u-1/video/test.mp4", "video/mp4", int64(len(payload)), bytes.NewReader(payload)); err == nil {
		t.Fatal("putOSSObject() should fail on 403")
	} else if !strings.Contains(err.Error(), "SignatureDoesNotMatch") {
		t.Fatalf("putOSSObject() error = %v, want the upstream detail preserved", err)
	}
	if attempts != 1 {
		t.Fatalf("attempts = %d, want 1 (4xx must not be retried)", attempts)
	}
}

func TestS3ObjectOperationsUsePathStyleSessionTokenAndNoManagedHeaders(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var methods []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methods = append(methods, r.Method)
		if r.URL.Path != "/bucket/prefix/object.txt" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.Header.Get("X-Amz-Security-Token") != "session-token" {
			t.Errorf("X-Amz-Security-Token = %q", r.Header.Get("X-Amz-Security-Token"))
		}
		if r.Header.Get("X-Amz-Acl") != "" || r.Header.Get("X-Amz-Server-Side-Encryption") != "" {
			t.Errorf("unexpected ACL/SSE headers: %#v", r.Header)
		}
		switch r.Method {
		case http.MethodPut:
			data, _ := io.ReadAll(r.Body)
			if string(data) != "payload" {
				t.Errorf("body = %q", data)
			}
			w.Header().Set("ETag", `"etag-value"`)
		case http.MethodGet:
			if r.Header.Get("Range") != "bytes=0-3" {
				t.Errorf("Range = %q", r.Header.Get("Range"))
			}
			w.Header().Set("Content-Range", "bytes 0-3/7")
			w.Header().Set("Accept-Ranges", "bytes")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = io.WriteString(w, "payl")
		case http.MethodDelete:
			w.Header().Set("Content-Type", "application/xml")
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>`)
		}
	}))
	defer server.Close()

	setting := ossSettingValue{Provider: s3Provider, Region: "us-east-1", Endpoint: server.URL, Bucket: "bucket", AccessKeyID: "access-id", AccessKeySecret: "secret-value", SessionToken: "session-token"}
	etag, err := putS3Object(setting, "prefix/object.txt", "text/plain", 7, bytes.NewReader([]byte("payload")))
	if err != nil || etag != "etag-value" {
		t.Fatalf("putS3Object() = %q, %v", etag, err)
	}
	stream, err := getS3ObjectRange(setting, "prefix/object.txt", "bytes=0-3")
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(stream.Body)
	_ = stream.Body.Close()
	if stream.StatusCode != http.StatusPartialContent || stream.ContentRange != "bytes 0-3/7" || string(data) != "payl" {
		t.Fatalf("stream = %#v, body = %q", stream, data)
	}
	if err := deleteS3Object(setting, "prefix/object.txt"); err != nil {
		t.Fatalf("deleteS3Object(404) error = %v", err)
	}
	if strings.Join(methods, ",") != "PUT,GET,DELETE" {
		t.Fatalf("methods = %v", methods)
	}
}

func TestSignedS3ObjectURLUsesSDKPresignAndSessionToken(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()
	value, err := signedS3ObjectURL(ossSettingValue{
		Provider: s3Provider, Region: "us-east-1", Endpoint: server.URL, Bucket: "bucket",
		AccessKeyID: "access-id", AccessKeySecret: "secret-value", SessionToken: "session-token",
	}, "folder/object.png", time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(value)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Path != "/bucket/folder/object.png" || parsed.Query().Get("X-Amz-Security-Token") != "session-token" || parsed.Query().Get("X-Amz-Signature") == "" {
		t.Fatalf("presigned URL = %q", value)
	}
	if strings.Contains(value, "secret-value") {
		t.Fatal("presigned URL leaked secret key")
	}
}

func TestS3EndpointAndDigestsEnforceStorageContract(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "storage.internal")
	if _, err := validateStorageEndpoint("https://example.com/path"); err == nil {
		t.Fatal("validateStorageEndpoint() accepted a path")
	}
	if _, err := validateStorageEndpoint("http://example.com"); err == nil {
		t.Fatal("validateStorageEndpoint() accepted public HTTP")
	}
	base := ossSettingValue{Provider: s3Provider, Region: "us-east-1", Endpoint: "https://s3.example.com", Bucket: "bucket", PathPrefix: "assets", AccessKeyID: "id", AccessKeySecret: "secret"}
	rotated := base
	rotated.AccessKeySecret = "rotated"
	moved := base
	moved.PathPrefix = "other"
	if storageLocationDigest(base) != storageLocationDigest(rotated) {
		t.Fatal("credential rotation changed the location digest")
	}
	if storageTestDigest(base) == storageTestDigest(rotated) {
		t.Fatal("credential rotation did not invalidate the tested digest")
	}
	if storageLocationDigest(base) == storageLocationDigest(moved) {
		t.Fatal("location change did not create a different digest")
	}
}

func TestOSSSettingKeepsS3SecretsWhenLocationChanges(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	current := ossSettingValue{
		Provider:        s3Provider,
		Region:          "us-east-1",
		Endpoint:        "https://127.0.0.1",
		Bucket:          "old-bucket",
		AccessKeyID:     "access-id",
		AccessKeySecret: "secret-value",
		SessionToken:    "session-token",
		PathPrefix:      defaultOSSPathPrefix,
	}
	next, err := ossSettingFromRequest(OSSSettingRequest{
		Enabled:     true,
		Provider:    s3Provider,
		S3Preset:    "custom",
		Region:      "us-east-1",
		Endpoint:    "https://127.0.0.1",
		Bucket:      "new-bucket",
		AccessKeyID: "access-id",
		PathPrefix:  "changed-prefix",
	}, current)
	if err != nil {
		t.Fatal(err)
	}
	if next.AccessKeySecret != current.AccessKeySecret || next.SessionToken != current.SessionToken {
		t.Fatalf("secrets were not retained: %#v", next)
	}
}

func TestDefaultOSSPathPrefix(t *testing.T) {
	value := normalizeOSSSetting(ossSettingValue{})
	if value.PathPrefix != defaultOSSPathPrefix || defaultOSSSetting().PathPrefix != defaultOSSPathPrefix {
		t.Fatalf("default path prefix = %q, default setting = %q", value.PathPrefix, defaultOSSSetting().PathPrefix)
	}
}

func TestResourceObjectKeyPreservesOrInfersExtension(t *testing.T) {
	setting := ossSettingValue{PathPrefix: "assets"}
	now := time.Date(2026, time.August, 27, 20, 31, 0, 0, time.UTC)

	for _, test := range []struct {
		name     string
		fileName string
		mimeType string
		kind     string
		ext      string
	}{
		{name: "original filename", fileName: "photo.JPEG", mimeType: "image/jpeg", kind: "image", ext: ".jpeg"},
		{name: "mime type", mimeType: "image/png", kind: "image", ext: ".png"},
		{name: "kind fallback", kind: "video", ext: ".mp4"},
	} {
		t.Run(test.name, func(t *testing.T) {
			objectKey := ossObjectKey(setting, "user-1", test.kind, test.fileName, test.mimeType, now)
			if !strings.HasSuffix(objectKey, test.ext) {
				t.Fatalf("object key = %q, want suffix %q", objectKey, test.ext)
			}
		})
	}
}
