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

func TestPublicResourceCORSOmitsVaryAndUsesWildcard(t *testing.T) {
	t.Setenv("CANVAS_CORS_ORIGINS", "https://creator.example.com")
	middleware, err := cors()
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware)
	router.GET("/api/public/resources/:id/file", func(c *gin.Context) {
		c.String(200, "ok")
	})

	for _, origin := range []string{"", "https://creator.example.com"} {
		req := httptest.NewRequest("GET", "/api/public/resources/res-1/file", nil)
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		if out.Code != 200 {
			t.Fatalf("origin=%q status=%d", origin, out.Code)
		}
		if got := out.Header().Get("Access-Control-Allow-Origin"); got != "*" {
			t.Fatalf("origin=%q ACAO=%q, want *", origin, got)
		}
		if got := out.Header().Get("Access-Control-Allow-Credentials"); got != "" {
			t.Fatalf("origin=%q ACAC=%q, want empty", origin, got)
		}
		if got := out.Header().Get("Vary"); got != "" {
			t.Fatalf("origin=%q Vary=%q, want empty", origin, got)
		}
	}
}
