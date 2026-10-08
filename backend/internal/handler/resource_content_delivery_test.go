package handler

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/service"
)

func TestNonMediaDeliveryAttachment(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, mimeType := range []string{"text/html", "image/svg+xml", "application/pdf", "application/octet-stream", "image/png"} {
		t.Run(mimeType, func(t *testing.T) {
			router := gin.New()
			router.GET("/file", func(c *gin.Context) {
				r := &model.Resource{ID: "file", MimeType: mimeType}
				serveResourceDelivery(c, &service.ResourceDelivery{Resource: r, Access: &assets.ResourceAccess{Delivery: assets.DeliveryLocal}, Stream: &service.ResourceStream{Resource: r, Body: io.NopCloser(strings.NewReader("content")), StatusCode: 200, ContentLength: 7}}, "", "inline")
			})
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/file", nil))
			if w.Code != 200 {
				t.Fatalf("status=%d", w.Code)
			}
			if mimeType == "image/png" {
				if w.Header().Get("Content-Disposition") != "inline" {
					t.Fatal("media no longer inline")
				}
			} else if !strings.HasPrefix(w.Header().Get("Content-Disposition"), "attachment") || !strings.Contains(w.Header().Get("Content-Security-Policy"), "sandbox") {
				t.Fatalf("unsafe non-media headers: %v", w.Header())
			}
		})
	}
}
