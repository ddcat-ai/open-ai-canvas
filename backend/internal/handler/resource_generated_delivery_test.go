package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/service"
)

func TestGeneratedResourceDeliveryRedirectsBeforeSaving(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/resources/generated/file", nil)
	serveResourceDelivery(c, &service.ResourceDelivery{Access: &service.ResourceAccess{Delivery: assets.DeliveryUpstream, URL: "https://upstream.example/image?temporary=1"}}, "", "")
	c.Writer.WriteHeaderNow()
	if w.Code != http.StatusTemporaryRedirect || w.Header().Get("Location") != "https://upstream.example/image?temporary=1" || w.Body.Len() != 0 {
		t.Fatalf("redirect=%d headers=%v body=%q", w.Code, w.Header(), w.Body.String())
	}
	if w.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal("temporary source redirect must not be cached")
	}
}
