package storage

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestObjectRangeReadsHonorCancellation(t *testing.T) {
	for _, provider := range []string{aliyunOSSProvider, tencentCOSProvider, s3Provider, "cdn"} {
		for _, phase := range []string{"headers", "body"} {
			t.Run(provider+"/"+phase, func(t *testing.T) {
				t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
				for _, name := range []string{"HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"} {
					t.Setenv(name, "")
				}
				started, stopped, release, bodyRead := make(chan struct{}), make(chan struct{}), make(chan struct{}), make(chan struct{})
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.Header.Get("Range") != "bytes=0-3" {
						t.Errorf("range = %q", r.Header.Get("Range"))
					}
					if phase == "body" {
						w.Header().Set("Content-Length", "4")
						w.Header().Set("Content-Range", "bytes 0-3/6")
						w.WriteHeader(http.StatusPartialContent)
						_, _ = w.Write([]byte("x"))
						w.(http.Flusher).Flush()
					}
					close(started)
					select {
					case <-r.Context().Done():
						close(stopped)
					case <-release:
					}
				}))
				defer server.Close()
				defer close(release)
				setting := Settings{Provider: provider, Endpoint: server.URL, Region: "us-east-1", Bucket: "bucket", PathStyle: true, AccessKeyID: "test-id", AccessKeySecret: "test-secret"}
				if provider == "cdn" {
					setting.CDNBaseURL = server.URL
					setting.Delivery.CDNAuthMode = "public"
				}
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				result := make(chan error, 1)
				go func() {
					stream, err := GetOSSObjectRangeContext(ctx, setting, "image.png", "bytes=0-3")
					if stream != nil {
						if phase == "body" && err == nil {
							_, err = io.ReadFull(stream.Body, make([]byte, 1))
							if err == nil {
								close(bodyRead)
								_, err = io.Copy(io.Discard, stream.Body)
							}
						}
						stream.Body.Close()
					}
					result <- err
				}()
				select {
				case <-started:
				case err := <-result:
					t.Fatalf("read failed before reaching upstream: %v", err)
				case <-time.After(5 * time.Second):
					t.Fatal("upstream request did not start")
				}
				if phase == "body" {
					select {
					case <-bodyRead:
					case err := <-result:
						t.Fatalf("body read ended before cancellation: %v", err)
					case <-time.After(5 * time.Second):
						t.Fatal("body read did not start")
					}
				}
				cancel()
				select {
				case err := <-result:
					if err == nil {
						t.Fatal("canceled read succeeded")
					}
				case <-time.After(2 * time.Second):
					t.Fatal("object read ignored cancellation")
				}
				select {
				case <-stopped:
				case <-time.After(2 * time.Second):
					t.Fatal("upstream request was not canceled")
				}
			})
		}
	}
}

func TestObjectRangeReadsRejectCanceledContextBeforeNetwork(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, provider := range []string{aliyunOSSProvider, tencentCOSProvider, qiniuKodoProvider, s3Provider, volcengineTOSProvider} {
		setting := Settings{Provider: provider}
		for _, read := range []func(context.Context, Settings, string, string) (*ObjectStream, error){GetOSSObjectRangeContext, GetOriginObjectRangeContext} {
			stream, err := read(ctx, setting, "image.png", "")
			if stream != nil || !errors.Is(err, context.Canceled) {
				t.Fatalf("provider %s: stream = %#v, error = %v", provider, stream, err)
			}
		}
	}
}

func TestOriginRangeContextPreservesPartialResponse(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") != "bytes=1-3" {
			t.Errorf("range = %q", r.Header.Get("Range"))
		}
		w.Header().Set("Content-Range", "bytes 1-3/6")
		w.Header().Set("ETag", `"test-etag"`)
		w.WriteHeader(http.StatusPartialContent)
		_, _ = io.WriteString(w, "123")
	}))
	defer server.Close()
	setting := Settings{Provider: aliyunOSSProvider, Endpoint: server.URL, Bucket: "bucket", AccessKeyID: "id", AccessKeySecret: "secret"}
	stream, err := GetOriginObjectRangeContext(context.Background(), setting, "image.png", "bytes=1-3")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	body, err := io.ReadAll(stream.Body)
	if err != nil || string(body) != "123" || stream.StatusCode != http.StatusPartialContent || stream.ContentRange != "bytes 1-3/6" || stream.ETag != `"test-etag"` {
		t.Fatalf("partial response = %#v, body %q, error %v", stream, body, err)
	}
}
