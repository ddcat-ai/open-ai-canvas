package main

import (
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCreationHistoryExpectedUserCORS(t *testing.T) {
	t.Setenv("CANVAS_CORS_ORIGINS", "https://creator.example.com")
	middleware, err := cors()
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware)
	req := httptest.NewRequest("OPTIONS", "/api/creation-conversations", nil)
	req.Header.Set("Origin", "https://creator.example.com")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "X-Canvas-Expected-User,Content-Type")
	out := httptest.NewRecorder()
	router.ServeHTTP(out, req)
	if out.Code != 204 || !strings.Contains(out.Header().Get("Access-Control-Allow-Headers"), "X-Canvas-Expected-User") {
		t.Fatal("scoped history header not allowed by preflight")
	}
}
