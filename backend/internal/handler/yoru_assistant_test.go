package handler

import (
	"github.com/gin-gonic/gin"
	"testing"
	"yingce/backend/internal/service"
)

func TestYoruRoutesRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterYoruAssistantRoutes(router.Group("/api"), &service.Service{})
	want := map[string]bool{"GET /api/public/yoru": false, "GET /api/admin/settings/yoru": false, "PUT /api/admin/settings/yoru": false, "POST /api/yoru/messages": false}
	for _, route := range router.Routes() {
		key := route.Method + " " + route.Path
		if _, ok := want[key]; ok {
			want[key] = true
		}
	}
	for key, found := range want {
		if !found {
			t.Errorf("missing %s", key)
		}
	}
}
