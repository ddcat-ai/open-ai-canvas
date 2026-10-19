package storage

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestInspectUploadUsesOneBoundedRead(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != http.MethodGet || r.Header.Get("Range") != "bytes=0-8191" {
			t.Error("verification must use one bounded GET")
		}
		w.Header().Set("Content-Length", "8192")
		w.Header().Set("Content-Range", "bytes 0-8191/100000")
		w.Header().Set("ETag", `"verified"`)
		w.WriteHeader(http.StatusPartialContent)
		_, _ = io.WriteString(w, strings.Repeat("x", 8192))
	}))
	defer server.Close()
	size, etag, prefix, err := InspectS3Upload(Settings{Provider: "s3", Region: "auto", Endpoint: server.URL, Bucket: "media", AccessKeyID: "id", AccessKeySecret: "secret", PathStyle: true}, "image.png")
	if err != nil || size != 100000 || etag != "verified" || len(prefix) != 8192 || requests.Load() != 1 {
		t.Fatalf("verification size=%d etag=%s prefix=%d requests=%d error=%v", size, etag, len(prefix), requests.Load(), err)
	}
}

func TestSignedS3UploadIsBoundToObjectAndContentType(t *testing.T) {
	setting := Settings{Provider: "s3", Region: "auto", Endpoint: "https://1.1.1.1", Bucket: "media", AccessKeyID: "upload-id", AccessKeySecret: "upload-secret", PathStyle: true}
	upload, err := SignedS3ObjectUpload(setting, "users/owner/image/test.png", "image/png", 42, time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(upload.URL)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Path != "/media/users/owner/image/test.png" || upload.Method != "PUT" || upload.Headers["Content-Type"] != "image/png" {
		t.Fatalf("upload = %#v", upload)
	}
	if !strings.Contains(parsed.Query().Get("X-Amz-SignedHeaders"), "content-type") || strings.Contains(upload.URL, "upload-secret") {
		t.Fatalf("upload authorization is not scoped: %s", upload.URL)
	}
	if upload.Headers["If-None-Match"] != "*" || !strings.Contains(parsed.Query().Get("X-Amz-SignedHeaders"), "if-none-match") {
		t.Fatalf("upload can overwrite a ready object: %#v", upload)
	}
}

func TestSignedUploadTransmitsWriteOnceCondition(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var mu sync.Mutex
	var stored string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.Header.Get("If-None-Match") != "*" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if stored != "" {
			w.WriteHeader(http.StatusPreconditionFailed)
			return
		}
		data, _ := io.ReadAll(r.Body)
		stored = string(data)
	}))
	defer server.Close()
	upload, err := SignedS3ObjectUpload(Settings{Provider: "s3", Region: "auto", Endpoint: server.URL, Bucket: "bucket", AccessKeyID: "id", AccessKeySecret: "secret", PathStyle: true}, "immutable.png", "image/png", 5, time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	for index, body := range []string{"first", "other"} {
		request, err := http.NewRequest(upload.Method, upload.URL, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		for key, value := range upload.Headers {
			request.Header.Set(key, value)
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		want := http.StatusOK
		if index > 0 {
			want = http.StatusPreconditionFailed
		}
		if response.StatusCode != want {
			t.Fatalf("attempt %d status=%d want=%d", index, response.StatusCode, want)
		}
	}
	if stored != "first" {
		t.Fatalf("object overwritten: %q", stored)
	}
}
