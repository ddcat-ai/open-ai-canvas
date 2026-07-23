package main

import (
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/handler"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func main() {
	dataDir := env("CANVAS_BACKEND_DATA_DIR", "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		log.Fatal(err)
	}
	db, err := database.Open(database.Config{
		Driver:  env("CANVAS_DATABASE_DRIVER", "sqlite"),
		DSN:     os.Getenv("DATABASE_URL"),
		DataDir: dataDir,
	})
	if err != nil {
		log.Fatal(err)
	}
	if err := database.ConfigurePool(db); err != nil {
		log.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		log.Fatal(err)
	}

	repo := repository.New(db)
	svc := service.New(repo, dataDir)
	if err := svc.ValidateRuntime(); err != nil {
		log.Fatal(err)
	}
	if err := svc.EnsureSystemChannelModels(); err != nil {
		log.Fatal(err)
	}
	if err := svc.EnsureDefaultStoryboardPromptTemplate(); err != nil {
		log.Fatal(err)
	}
	if err := svc.EnsureBuiltinProjectWorkflowTemplate(); err != nil {
		log.Fatal(err)
	}
	if summary, err := svc.MigrateLegacyStorage(); err != nil {
		log.Printf("storage migration skipped after error: %v", err)
	} else if summary.Backup != "" {
		log.Printf("storage migration completed: tasks=%d assets=%d projects=%d backup=%s", summary.Tasks, summary.Assets, summary.Projects, summary.Backup)
	}
	svc.StartWorker()

	r := gin.New()
	r.Use(gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
		return fmt.Sprintf("%s - [%s] \"%s %s\" %d %s %s\n", param.ClientIP, param.TimeStamp.Format(time.RFC3339), param.Method, redactCanvasSharePath(param.Path), param.StatusCode, param.Latency, param.ErrorMessage)
	}), gin.Recovery())
	r.Use(cors())
	handler.ConfigureRuntime(svc)
	api := r.Group("/api")
	api.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"code": 0, "data": gin.H{"status": "ok"}, "msg": "ok"})
	})
	handler.RegisterOAuthCallbackRoutes(r, svc)
	handler.RegisterAuthRoutes(api, svc)
	handler.RegisterAdminRoutes(api, svc)
	handler.RegisterAdminAnalyticsRoutes(api, svc)
	handler.RegisterAnnouncementRoutes(api, svc)
	handler.RegisterFinanceRoutes(api, svc)
	// 登录态模型目录代理：避免浏览器直连各上游时分别处理 CORS。
	handler.RegisterChannelModelRoutes(api, svc)
	handler.RegisterSystemProxyRoutes(api, svc)
	handler.RegisterCustomRelayRoutes(api, svc)
	handler.RegisterTaskRoutes(api, svc)
	handler.RegisterSessionRoutes(api, svc)
	handler.RegisterSkillRoutes(api, svc)
	handler.RegisterUserDataRoutes(api, svc)
	handler.RegisterProjectRoutes(api, svc)
	handler.RegisterCanvasShareRoutes(api, svc)

	addr := env("CANVAS_BACKEND_ADDR", ":8080")
	log.Printf("Infinite Canvas backend listening on %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatal(err)
	}
}

func redactCanvasSharePath(path string) string {
	const prefix = "/api/public/canvas-shares/"
	if !strings.HasPrefix(path, prefix) {
		return path
	}
	remainder := strings.TrimPrefix(path, prefix)
	if index := strings.IndexByte(remainder, '/'); index >= 0 {
		return prefix + ":token" + remainder[index:]
	}
	return prefix + ":token"
}

func env(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func cors() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := strings.TrimSpace(c.GetHeader("Origin"))
		if origin != "" && !allowedOrigin(c, origin) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": http.StatusForbidden, "data": nil, "msg": "不允许的跨域来源"})
			return
		}
		if origin != "" {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers")
		}
		c.Header("Access-Control-Allow-Headers", "Accept, Content-Type, Authorization, X-Requested-With, X-Canvas-Scene, X-Idempotency-Key, X-Canvas-Upstream-URL, X-Canvas-Upstream-Format")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Max-Age", "86400")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

func allowedOrigin(c *gin.Context, origin string) bool {
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return false
	}
	requestHost := c.Request.Host
	if forwardedHost := strings.TrimSpace(c.GetHeader("X-Forwarded-Host")); forwardedHost != "" {
		requestHost = strings.TrimSpace(strings.Split(forwardedHost, ",")[0])
	}
	if strings.EqualFold(parsed.Host, strings.TrimSpace(requestHost)) {
		return true
	}
	for _, allowed := range strings.Split(os.Getenv("CANVAS_CORS_ORIGINS"), ",") {
		if strings.TrimSpace(allowed) == "*" {
			return true
		}
		if strings.EqualFold(strings.TrimRight(strings.TrimSpace(allowed), "/"), strings.TrimRight(origin, "/")) {
			return true
		}
	}
	host := strings.ToLower(parsed.Hostname())
	return (host == "localhost" || host == "127.0.0.1" || host == "::1") && (parsed.Scheme == "http" || parsed.Scheme == "https")
}
