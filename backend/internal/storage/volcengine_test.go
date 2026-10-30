package storage

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"yingce/backend/internal/outbound/outboundtest"
)

func TestNormalizeVolcengineTOSLocation(t *testing.T) {
	cases := []struct {
		name     string
		in       Settings
		region   string
		endpoint string
	}{
		{"region derives endpoint", Settings{Provider: volcengineTOSProvider, Region: " cn-beijing "}, "cn-beijing", "https://tos-s3-cn-beijing.volces.com"},
		{"native endpoint without scheme", Settings{Provider: volcengineTOSProvider, Endpoint: "tos-cn-shanghai.volces.com"}, "cn-shanghai", "https://tos-s3-cn-shanghai.volces.com"},
		{"bucket domain", Settings{Provider: volcengineTOSProvider, Endpoint: "https://My-Bucket.tos-cn-guangzhou.volces.com/", Bucket: "my-bucket"}, "cn-guangzhou", "https://tos-s3-cn-guangzhou.volces.com"},
		{"internal s3 endpoint", Settings{Provider: volcengineTOSProvider, Endpoint: "https://tos-s3-ap-southeast-1.ivolces.com", Region: "AP-SOUTHEAST-1"}, "ap-southeast-1", "https://tos-s3-ap-southeast-1.ivolces.com"},
		{"foreign bucket kept for validation", Settings{Provider: volcengineTOSProvider, Endpoint: "https://other.tos-cn-beijing.volces.com", Bucket: "my-bucket"}, "", "https://other.tos-cn-beijing.volces.com"},
		{"custom endpoint kept", Settings{Provider: volcengineTOSProvider, Endpoint: "https://tos.example.com", Region: "cn-beijing"}, "cn-beijing", "https://tos.example.com"},
		{"other providers untouched", Settings{Provider: s3Provider, Endpoint: "tos-cn-beijing.volces.com"}, "", "tos-cn-beijing.volces.com"},
	}
	for _, item := range cases {
		got := NormalizeSettings(item.in)
		if got.Region != item.region || got.Endpoint != item.endpoint {
			t.Errorf("%s: region=%q endpoint=%q", item.name, got.Region, got.Endpoint)
		}
	}
}

func TestValidateVolcengineTOSLocation(t *testing.T) {
	for name, item := range map[string]struct {
		setting Settings
		want    string
	}{
		"bucket mismatch":  {Settings{Provider: volcengineTOSProvider, Endpoint: "https://other.tos-cn-beijing.volces.com", Bucket: "my-bucket"}, "Bucket"},
		"region mismatch":  {Settings{Provider: volcengineTOSProvider, Endpoint: "https://tos-s3-cn-beijing.volces.com", Region: "cn-shanghai", Bucket: "b"}, "地域不一致"},
		"custom no region": {Settings{Provider: volcengineTOSProvider, Endpoint: "https://tos.example.com", Bucket: "b"}, "Region"},
	} {
		err := ValidateVolcengineTOSLocation(item.setting)
		if err == nil || !strings.Contains(err.Error(), item.want) {
			t.Errorf("%s: error = %v, want %q", name, err, item.want)
		}
	}
	if err := ValidateVolcengineTOSLocation(Settings{Provider: volcengineTOSProvider, Endpoint: "tos-cn-beijing.volces.com", Bucket: "b"}); err != nil {
		t.Fatalf("native endpoint rejected: %v", err)
	}
}

func TestVolcengineTOSUsesVirtualHostedSigV4WithoutSessionToken(t *testing.T) {
	for _, name := range []string{"HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"} {
		t.Setenv(name, "")
	}
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "tos-s3-cn-beijing.volces.com,bucket.tos-s3-cn-beijing.volces.com")
	outboundtest.DNS(t, [4]byte{127, 0, 0, 1}, "tos-s3-cn-beijing.volces.com", "bucket.tos-s3-cn-beijing.volces.com")
	var mu sync.Mutex
	var methods []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		methods = append(methods, r.Method)
		mu.Unlock()
		if !strings.HasPrefix(r.Host, "bucket.tos-s3-cn-beijing.volces.com:") || r.URL.Path != "/prefix/object.txt" {
			t.Errorf("request is not virtual-hosted: host=%q path=%q", r.Host, r.URL.Path)
		}
		if auth := r.Header.Get("Authorization"); !strings.HasPrefix(auth, "AWS4-HMAC-SHA256") || !strings.Contains(auth, "/cn-beijing/s3/aws4_request") {
			t.Errorf("Authorization = %q", auth)
		}
		if r.Header.Get("X-Amz-Security-Token") != "" {
			t.Error("session token must not be sent to TOS")
		}
		switch r.Method {
		case http.MethodPut:
			data, _ := io.ReadAll(r.Body)
			if string(data) != "payload" {
				t.Errorf("body = %q", data)
			}
			w.Header().Set("ETag", `"etag-value"`)
		case http.MethodGet:
			w.Header().Set("Content-Range", "bytes 0-3/7")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = io.WriteString(w, "payl")
		case http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		}
	}))
	defer server.Close()
	port := server.URL[strings.LastIndex(server.URL, ":")+1:]
	setting := Settings{Provider: volcengineTOSProvider, Endpoint: "http://tos-s3-cn-beijing.volces.com:" + port, Bucket: "bucket", AccessKeyID: "access-id", AccessKeySecret: "secret-value", SessionToken: "must-not-send", PathStyle: true}

	etag, err := PutOSSObject(setting, "prefix/object.txt", "text/plain", 7, strings.NewReader("payload"))
	if err != nil || etag != "etag-value" {
		t.Fatalf("PutOSSObject() = %q, %v", etag, err)
	}
	stream, err := GetOriginObjectRange(setting, "prefix/object.txt", "bytes=0-3")
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(stream.Body)
	_ = stream.Body.Close()
	if stream.StatusCode != http.StatusPartialContent || string(data) != "payl" {
		t.Fatalf("stream = %#v, body = %q", stream, data)
	}
	if err := DeleteS3Object(setting, "prefix/object.txt"); err != nil {
		t.Fatal(err)
	}
	if strings.Join(methods, ",") != "PUT,GET,DELETE" {
		t.Fatalf("methods = %v", methods)
	}

	signed, err := SignedOriginObjectDownloadURL(setting, "prefix/clip 1.mp4", time.Now().Add(time.Hour), "clip.mp4")
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(signed)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	if parsed.Hostname() != "bucket.tos-s3-cn-beijing.volces.com" || !strings.Contains(query.Get("X-Amz-Credential"), "/cn-beijing/s3/aws4_request") || query.Get("X-Amz-Signature") == "" || query.Get("X-Amz-Security-Token") != "" || query.Get("response-content-disposition") == "" {
		t.Fatalf("signed URL = %s", signed)
	}
	if strings.Contains(signed, "secret-value") {
		t.Fatal("signed URL leaked the secret")
	}
}
