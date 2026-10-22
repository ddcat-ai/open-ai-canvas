package handler

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// 未带 X-Canvas-Cold-Fallback 时必须保持原有 302，不产生任何探测请求。
func TestServeResourceDeliveryKeepsRedirectWithoutFallbackHeader(t *testing.T) {
	gin.SetMode(gin.TestMode)
	probes := 0
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		probes++
		w.WriteHeader(http.StatusNotFound)
	}))
	defer cdn.Close()
	restoreProbeClient(t, cdn.Client())

	recorder := serveDeliveryForTest(t, cdn.URL+"/a.png", nil, nil)
	if recorder.Code != http.StatusTemporaryRedirect {
		t.Fatalf("status = %d, want 307", recorder.Code)
	}
	if probes != 0 {
		t.Fatalf("probe requests = %d, want 0 without fallback header", probes)
	}
}

// CDN 返回 404 且本地有冷备时，直接返回本地字节，不再 302。
func TestServeResourceDeliveryFallsBackToColdBackupOnCDN404(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodHead {
			t.Errorf("probe method = %s, want HEAD", r.Method)
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer cdn.Close()
	restoreProbeClient(t, cdn.Client())

	resource := &model.Resource{ID: "r1", MimeType: "image/png", UpdatedAt: time.Now()}
	stream := &service.ResourceStream{
		Resource:      resource,
		Body:          io.NopCloser(strings.NewReader("cold-bytes")),
		StatusCode:    http.StatusOK,
		ContentLength: int64(len("cold-bytes")),
		AcceptRanges:  "bytes",
	}
	headers := map[string]string{coldFallbackHeader: "1"}
	recorder := serveDeliveryForTest(t, cdn.URL+"/a.png", stream, headers)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	if recorder.Body.String() != "cold-bytes" {
		t.Fatalf("body = %q", recorder.Body.String())
	}
	if got := recorder.Header().Get("X-Canvas-Delivery"); got != "cold-backup" {
		t.Fatalf("delivery header = %q", got)
	}
	if got := recorder.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("content-type = %q", got)
	}
}

// CDN 403 同样触发回落：鉴权配置错误对浏览器来说等同于裂图。
func TestServeResourceDeliveryFallsBackOnCDN403(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer cdn.Close()
	restoreProbeClient(t, cdn.Client())

	resource := &model.Resource{ID: "r1", MimeType: "image/png"}
	stream := &service.ResourceStream{Resource: resource, Body: io.NopCloser(strings.NewReader("cold")), StatusCode: http.StatusOK, ContentLength: 4}
	recorder := serveDeliveryForTest(t, cdn.URL+"/a.png", stream, map[string]string{coldFallbackHeader: "1"})
	if recorder.Code != http.StatusOK || recorder.Body.String() != "cold" {
		t.Fatalf("status = %d body = %q", recorder.Code, recorder.Body.String())
	}
}

// CDN 可达时仍然 302，冷备只在真正不可用时生效。
func TestServeResourceDeliveryRedirectsWhenCDNReachable(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer cdn.Close()
	restoreProbeClient(t, cdn.Client())

	resource := &model.Resource{ID: "r1", MimeType: "image/png"}
	stream := &service.ResourceStream{Resource: resource, Body: io.NopCloser(strings.NewReader("cold")), StatusCode: http.StatusOK, ContentLength: 4}
	recorder := serveDeliveryForTest(t, cdn.URL+"/a.png", stream, map[string]string{coldFallbackHeader: "1"})
	if recorder.Code != http.StatusTemporaryRedirect {
		t.Fatalf("status = %d, want 307", recorder.Code)
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("redirect wrote %d body bytes", recorder.Body.Len())
	}
}

// 本地也没有冷备时必须保持 302，绝不能因为兜底失败变成 5xx。
func TestServeResourceDeliveryKeepsRedirectWhenNoColdBackup(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer cdn.Close()
	restoreProbeClient(t, cdn.Client())

	recorder := serveDeliveryForTest(t, cdn.URL+"/a.png", nil, map[string]string{coldFallbackHeader: "1"})
	if recorder.Code != http.StatusTemporaryRedirect {
		t.Fatalf("status = %d, want 307", recorder.Code)
	}
}

// 探测网络错误（连接被拒）也视为 CDN 不可用，回落本地。
func TestServeResourceDeliveryFallsBackOnProbeError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	deadURL := cdn.URL
	cdn.Close()
	restoreProbeClient(t, &http.Client{Timeout: 2 * time.Second})

	resource := &model.Resource{ID: "r1", MimeType: "image/png"}
	stream := &service.ResourceStream{Resource: resource, Body: io.NopCloser(strings.NewReader("cold")), StatusCode: http.StatusOK, ContentLength: 4}
	recorder := serveDeliveryForTest(t, deadURL+"/a.png", stream, map[string]string{coldFallbackHeader: "1"})
	if recorder.Code != http.StatusOK || recorder.Body.String() != "cold" {
		t.Fatalf("status = %d body = %q", recorder.Code, recorder.Body.String())
	}
}

func serveDeliveryForTest(t *testing.T, cdnURL string, stream *service.ResourceStream, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	delivery := &service.ResourceDelivery{
		Access: &assets.ResourceAccess{ResourceID: "r1", URL: cdnURL, Delivery: assets.DeliveryCDN},
	}
	if stream != nil {
		delivery.ColdFallback = func(rangeHeader string) (*service.ResourceStream, error) {
			return stream, nil
		}
	}
	router := gin.New()
	router.GET("/resource", func(c *gin.Context) {
		serveResourceDelivery(c, delivery, "private, no-cache", "")
	})
	request := httptest.NewRequest(http.MethodGet, "/resource", nil)
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func restoreProbeClient(t *testing.T, client *http.Client) {
	t.Helper()
	previous := coldFallbackProbeClient
	coldFallbackProbeClient = client
	t.Cleanup(func() { coldFallbackProbeClient = previous })
}
