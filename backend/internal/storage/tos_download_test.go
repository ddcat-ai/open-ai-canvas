package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"yingce/backend/internal/outbound/outboundtest"
)

func TestTOSReadLogMeasuresStorageWait(t *testing.T) {
	var output bytes.Buffer
	original := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(original) })
	ctx := WithReadLogIDs(t.Context(), "log-fixture", "")
	healthy := newObjectReadAttempt(ctx, false)
	healthy.start = healthy.start.Add(-3 * tosReadInterval)
	healthy.begin()
	healthy.end(1)
	_ = healthy.finish("complete", nil)

	stalled := newObjectReadAttempt(ctx, false)
	stalled.waiting = time.Now().Add(-3 * tosReadInterval)
	stalled.end(1)
	_ = stalled.finish("complete", nil)

	canceled := newObjectReadAttempt(ctx, false)
	_ = canceled.finish("failed", context.Canceled)
	if got := output.String(); strings.Count(got, "log-fixture") != 1 || !strings.Contains(got, `"reason":"slow_read"`) {
		t.Fatalf("expected only the slow storage read in logs: %s", got)
	}
}

func TestTOSReadContinuation(t *testing.T) {
	for _, tc := range []struct {
		name, inputRange, continuationRange string
		status                              int
		start, end                          int
		stall, slow, reject, change         bool
	}{
		{name: "slow MP4 without stalling", status: http.StatusOK, slow: true},
		{name: "stalls in browser range", inputRange: "bytes=12-71", continuationRange: "bytes=24-71", status: http.StatusPartialContent, start: 12, end: 71, stall: true},
		{name: "changed object", continuationRange: "bytes=12-95", status: http.StatusOK, end: 95, change: true},
		{name: "both peers fail", continuationRange: "bytes=12-95", status: http.StatusOK, end: 95, reject: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			payload := bytes.Repeat([]byte("123456789abc"), 8)
			if tc.slow {
				ffmpeg, err := exec.LookPath("ffmpeg")
				if err != nil {
					t.Skip(err)
				}
				payload, err = exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=blue:s=32x32:d=1",
					"-c:v", "mpeg4", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1").Output()
				if err != nil {
					t.Fatal(err)
				}
				tc.end = len(payload) - 1
			}
			slowListener, err := net.Listen("tcp4", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer slowListener.Close()
			port := slowListener.Addr().(*net.TCPAddr).Port
			fastListener, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.2:%d", port))
			if err != nil {
				t.Fatal(err)
			}
			defer fastListener.Close()
			for _, name := range []string{"HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"} {
				t.Setenv(name, "")
			}
			root := "tos-s3-cn-beijing.volces.com"
			host := "bucket." + root
			t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", root+","+host)
			outboundtest.DNSAddresses(t, [][4]byte{{127, 0, 0, 1}, {127, 0, 0, 2}}, root, host)
			restore := tosReadInterval
			tosReadInterval = 50 * time.Millisecond
			t.Cleanup(func() { tosReadInterval = restore })
			var mu sync.Mutex
			retryCount := 0
			run := func(listener net.Listener, handler http.HandlerFunc) {
				server := &http.Server{Handler: handler}
				go func() { _ = server.Serve(listener) }()
				t.Cleanup(func() { _ = server.Close() })
			}
			writeHeaders := func(w http.ResponseWriter, start, end, status int, etag string) {
				w.Header().Set("ETag", etag)
				w.Header().Set("Content-Length", fmt.Sprint(end-start+1))
				if status == http.StatusPartialContent {
					w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(payload)))
				}
				w.WriteHeader(status)
			}
			run(slowListener, func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Range") != tc.inputRange {
					t.Errorf("original Range = %q", r.Header.Get("Range"))
				}
				writeHeaders(w, tc.start, tc.end, tc.status, `"version1"`)
				_, _ = w.Write(payload[tc.start : tc.start+12])
				w.(http.Flusher).Flush()
				if tc.slow {
					ticker := time.NewTicker(25 * time.Millisecond)
					defer ticker.Stop()
					for index := tc.start + 12; index <= tc.end; index++ {
						select {
						case <-r.Context().Done():
							return
						case <-ticker.C:
							_, _ = w.Write(payload[index : index+1])
							w.(http.Flusher).Flush()
						}
					}
				} else if tc.stall {
					<-r.Context().Done()
				}
			})
			run(fastListener, func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
				retryCount++
				mu.Unlock()
				if r.Host != fmt.Sprintf("%s:%d", host, port) || r.Header.Get("Authorization") == "" {
					t.Errorf("retry did not keep its host and signature: %q", r.Host)
				}
				if r.Header.Get("If-Match") != `"version1"` {
					t.Errorf("retry If-Match = %q", r.Header.Get("If-Match"))
				}
				continued := r.Header.Get("Range")
				if tc.continuationRange != "" && continued != tc.continuationRange {
					t.Errorf("retry Range = %q, want %q", continued, tc.continuationRange)
				}
				if tc.reject {
					http.Error(w, "unavailable", http.StatusServiceUnavailable)
					return
				}
				var start, end int
				if _, err := fmt.Sscanf(continued, "bytes=%d-%d", &start, &end); err != nil || start < tc.start+12 || end != tc.end {
					t.Errorf("retry has invalid range %q", continued)
					http.Error(w, "bad range", http.StatusBadRequest)
					return
				}
				etag := `"version1"`
				if tc.change {
					etag = `"version2"`
				}
				writeHeaders(w, start, end, http.StatusPartialContent, etag)
				_, _ = w.Write(payload[start : end+1])
			})
			setting := Settings{
				Provider: volcengineTOSProvider, Region: "cn-beijing", Bucket: "bucket",
				Endpoint: fmt.Sprintf("http://%s:%d", root, port), AccessKeyID: "key", AccessKeySecret: "secret",
				Runtime: RuntimePolicy{TransferTimeout: 650 * time.Millisecond},
			}
			stream, err := GetOriginObjectRange(t.Context(), setting, "payload", tc.inputRange)
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Body.Close()
			got, err := io.ReadAll(stream.Body)
			if tc.change || tc.reject {
				if err == nil || len(got) != 12 {
					t.Fatalf("exposed unsafe bytes: got %d bytes, err = %v", len(got), err)
				}
			} else if err != nil || !bytes.Equal(got, payload[tc.start:tc.end+1]) || stream.StatusCode != tc.status {
				t.Fatalf("read %d bytes (%v), response status %d", len(got), err, stream.StatusCode)
			}
			mu.Lock()
			defer mu.Unlock()
			if retryCount != 1 {
				t.Fatalf("attempts on alternate peer = %d", retryCount)
			}
		})
	}
}

func TestTOSReadCancellationAndPermanentFailure(t *testing.T) {
	for _, name := range []string{"HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"} {
		t.Setenv(name, "")
	}
	for _, deny := range []bool{false, true} {
		t.Run(fmt.Sprint(deny), func(t *testing.T) {
			root, host := "tos-s3-cn-beijing.volces.com", "bucket.tos-s3-cn-beijing.volces.com"
			t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", root+","+host)
			outboundtest.DNSAddresses(t, [][4]byte{{127, 0, 0, 1}, {127, 0, 0, 2}}, root, host)
			listener, err := net.Listen("tcp4", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if deny {
					w.WriteHeader(http.StatusForbidden)
					_, _ = io.WriteString(w, "<Error><Code>AccessDenied</Code></Error>")
					return
				}
				w.Header().Set("Content-Length", "50")
				w.Header().Set("ETag", `"version1"`)
				w.WriteHeader(http.StatusOK)
				w.(http.Flusher).Flush()
				<-r.Context().Done()
			})}
			go func() { _ = server.Serve(listener) }()
			defer server.Close()
			setting := Settings{
				Provider: volcengineTOSProvider, Region: "cn-beijing", Bucket: "bucket", Endpoint: "http://" + root + ":" + strings.Split(listener.Addr().String(), ":")[1],
				AccessKeyID: "key", AccessKeySecret: "secret",
			}
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			stream, err := GetOriginObjectRange(ctx, setting, "payload", "")
			if deny {
				if f := ClassifyError(err); f.StatusCode != http.StatusForbidden {
					t.Fatalf("original storage error replaced: %+v %v", f, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Body.Close()
			cancel()
			if _, err := io.ReadAll(stream.Body); !errors.Is(err, context.Canceled) {
				t.Fatalf("read after cancellation = %v", err)
			}
		})
	}
}
