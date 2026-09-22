package handler

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/service"

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
