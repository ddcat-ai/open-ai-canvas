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

func TestServeResourceDeliveryRedirectsCloudMediaWithoutWritingBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/resource", func(c *gin.Context) {
		serveResourceDelivery(c, &service.ResourceDelivery{Access: &assets.ResourceAccess{
			ResourceID: "resource-1",
			URL:        "https://cdn.example.com/users/user-1/image/test.png?signature=redacted",
			Delivery:   assets.DeliveryCDN,
		}}, "private, no-cache", "")
	})

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/resource", nil))

	if recorder.Code != http.StatusTemporaryRedirect {
		t.Fatalf("status = %d, want 307", recorder.Code)
	}
	if got := recorder.Header().Get("Location"); got != "https://cdn.example.com/users/user-1/image/test.png?signature=redacted" {
		t.Fatalf("location = %q", got)
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("redirect wrote %d body bytes; platform must not send cloud media", recorder.Body.Len())
	}
}

func TestServeResourceDeliveryReturnsAccessDescriptorWithoutRedirect(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/resource", func(c *gin.Context) {
		serveResourceDelivery(c, &service.ResourceDelivery{Access: &assets.ResourceAccess{
			ResourceID: "resource-1",
			URL:        "https://cdn.example.com/test.png",
			Delivery:   assets.DeliveryCDN,
		}}, "private, no-cache", "")
	})

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/resource?access=1", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("cache-control = %q", got)
	}
	if !strings.Contains(recorder.Body.String(), `"url":"https://cdn.example.com/test.png"`) {
		t.Fatalf("access descriptor missing from body: %s", recorder.Body.String())
	}
}

func TestServeResourceDeliveryStreamsPlatformBytesAndRangeMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resource := &model.Resource{ID: "resource-1", MimeType: "video/mp4", UpdatedAt: time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)}
	router := gin.New()
	router.GET("/resource", func(c *gin.Context) {
		serveResourceDelivery(c, &service.ResourceDelivery{
			Resource: resource,
			Access:   &assets.ResourceAccess{ResourceID: resource.ID, URL: "/api/resources/resource-1/file", Delivery: assets.DeliveryProxy},
			Stream:   &assets.ResourceStream{Resource: resource, Body: io.NopCloser(strings.NewReader("partial-media")), StatusCode: http.StatusPartialContent, ContentLength: 13, ContentRange: "bytes 10-22/100", AcceptRanges: "bytes"},
		}, "private, no-cache", `inline; filename="video.mp4"`)
	})

	recorder := httptest.NewRecorder()
	recorder.HeaderMap = make(http.Header)
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/resource", nil))

	if recorder.Code != http.StatusPartialContent || recorder.Body.String() != "partial-media" {
		t.Fatalf("response = status %d body %q", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("Content-Range") != "bytes 10-22/100" || recorder.Header().Get("Accept-Ranges") != "bytes" {
		t.Fatalf("range headers missing: %#v", recorder.Header())
	}
	if recorder.Header().Get("Content-Type") != "video/mp4" {
		t.Fatalf("content-type = %q", recorder.Header().Get("Content-Type"))
	}
	if recorder.Header().Get("Content-Disposition") != `inline; filename="video.mp4"` {
		t.Fatalf("content-disposition = %q", recorder.Header().Get("Content-Disposition"))
	}
}

func TestPublicResourceCacheControl(t *testing.T) {
	gin.SetMode(gin.TestMode)
	now := time.Unix(1_700_000_000, 0).UTC()
	pngDelivery := &service.ResourceDelivery{Resource: &model.Resource{ID: "res-1", MimeType: "image/png"}}
	svgDelivery := &service.ResourceDelivery{Resource: &model.Resource{ID: "res-2", MimeType: "image/svg+xml"}}

	cases := []struct {
		name     string
		target   string
		delivery *service.ResourceDelivery
		want     string
	}{
		{name: "clamps_21d_to_6d", target: "/public/resources/res-1/file?expires=1701814400", delivery: pngDelivery, want: "public, max-age=518400"},
		{name: "uses_remaining_within_6d", target: "/public/resources/res-1/file?expires=1700014400", delivery: pngDelivery, want: "public, max-age=14400"},
		{name: "download_disables_public_cache", target: "/public/resources/res-1/file?expires=1701814400&download=1", delivery: pngDelivery, want: "private, no-store"},
		{name: "purpose_download_disables_public_cache", target: "/public/resources/res-1/file?expires=1701814400&purpose=download", delivery: pngDelivery, want: "private, no-store"},
		{name: "access_disables_public_cache", target: "/public/resources/res-1/file?expires=1701814400&access=1", delivery: pngDelivery, want: "private, no-store"},
		{name: "non_media_disables_public_cache", target: "/public/resources/res-2/file?expires=1701814400", delivery: svgDelivery, want: "private, no-store"},
		{name: "expired_disables_public_cache", target: "/public/resources/res-1/file?expires=1699999999", delivery: pngDelivery, want: "private, no-store"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodGet, tc.target, nil)
			if got := publicResourceCacheControl(c, tc.delivery, now); got != tc.want {
				t.Fatalf("publicResourceCacheControl() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestServeResourceDeliveryHeadSkipsBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resource := &model.Resource{ID: "resource-1", MimeType: "video/mp4", UpdatedAt: time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)}
	router := gin.New()
	router.HEAD("/resource", func(c *gin.Context) {
		serveResourceDelivery(c, &service.ResourceDelivery{
			Resource: resource,
			Access:   &assets.ResourceAccess{ResourceID: resource.ID, Delivery: assets.DeliveryLocal},
			Stream:   &assets.ResourceStream{Resource: resource, Body: io.NopCloser(strings.NewReader("stream-body")), StatusCode: http.StatusOK, ContentLength: 11, AcceptRanges: "bytes"},
		}, "public, max-age=518400", "")
	})

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodHead, "/resource", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("HEAD wrote %d bytes", recorder.Body.Len())
	}
	if recorder.Header().Get("Cache-Control") != "public, max-age=518400" || recorder.Header().Get("Content-Length") != "11" || recorder.Header().Get("Accept-Ranges") != "bytes" {
		t.Fatalf("unexpected HEAD headers: %#v", recorder.Header())
	}
}
