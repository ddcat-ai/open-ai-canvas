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
	addr := env("CANVAS_BACKEND_ADDR", ":8080")
	capabilities := service.RuntimeCapabilitiesForDeployment(addr, os.Getenv("CANVAS_DESKTOP_LOCAL_CHANNELS_ENABLED"))
	svc := service.NewWithRuntimeCapabilities(repo, dataDir, capabilities)
	if err := svc.ValidateRuntime(); err != nil {
		log.Fatal(err)
	}
	if err := svc.EnsureSystemChannelModels(); err != nil {
		log.Fatal(err)
	}
	if err := svc.EnsureDefaultPromptTemplates(); err != nil {
		log.Fatal(err)
	}
	if err := svc.EnsureBuiltinProjectWorkflowTemplate(); err != nil {
		log.Fatal(err)
	}
	if err := svc.EnsureBuiltinSkills(); err != nil {
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
	r.Use(handler.RequestCorrelationMiddleware())
	corsMiddleware, err := cors()
	if err != nil {
		log.Fatal(err)
	}
	r.Use(corsMiddleware)
	handler.ConfigureRuntime(svc)
	api := r.Group("/api")
	api.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"code": 0, "data": gin.H{"status": "ok"}, "msg": "ok"})
	})
	handler.RegisterOAuthCallbackRoutes(r, svc)
	handler.RegisterAuthRoutes(api, svc)
	handler.RegisterFeatureAvailabilityRoutes(api, svc)
	handler.RegisterResponseInterceptionRoutes(api, svc)
	handler.RegisterAdminRoutes(api, svc)
	handler.RegisterAdminAnalyticsRoutes(api, svc)
	handler.RegisterAnnouncementRoutes(api, svc)
	handler.RegisterFinanceRoutes(api, svc)
	handler.RegisterLibTVRoutes(api, svc)
	handler.RegisterTapNowRoutes(api, svc)
	// 登录态模型目录代理：避免浏览器直连各上游时分别处理 CORS。
	handler.RegisterChannelModelRoutes(api, svc)
	handler.RegisterLogicalModelRoutes(api, svc)
	handler.RegisterModelCatalogRoutes(api, svc)
	handler.RegisterSystemProxyRoutes(api, svc)
	handler.RegisterCustomRelayRoutes(api, svc)
	handler.RegisterTaskRoutes(api, svc)
	handler.RegisterSessionRoutes(api, svc)
	handler.RegisterSkillRoutes(api, svc)
	handler.RegisterUserDataRoutes(api, svc)
	handler.RegisterDiagnosticsRoutes(api, svc)
	handler.RegisterPluginRoutes(api, svc)
	handler.RegisterProtocolRoutes(api, svc)
	projectAPI := api.Group("")
	projectAPI.Use(handler.RequireFeature(svc, service.FeatureShortDrama))
	handler.RegisterProjectRoutes(projectAPI, svc)
	handler.RegisterCanvasShareRoutes(api, svc)
	r.NoRoute(handler.SystemProxyNoRouteHandler(svc))

	log.Printf("影策 backend listening on %s", addr)
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

const corsAllowedHeaders = "Accept, Content-Type, Authorization, X-Requested-With, X-Canvas-Scene, X-Idempotency-Key, X-Canvas-Trace-ID, X-Canvas-Upstream-URL, X-Canvas-Upstream-Format, X-Canvas-Allow-Local-Channel, X-Canvas-Upstream-Base-URL"

const corsAllowedMethods = "GET, POST, PUT, PATCH, DELETE, OPTIONS"

type corsPolicy struct {
	origins  map[string]struct{}
	allowAny bool
}

func cors() (gin.HandlerFunc, error) {
	policy, err := parseCORSPolicy(os.Getenv("CANVAS_CORS_ORIGINS"))
	if err != nil {
		return nil, err
	}
	return func(c *gin.Context) {
		origin := strings.TrimSpace(c.GetHeader("Origin"))
		if origin != "" && !allowedOriginWithPolicy(c, origin, policy) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": http.StatusForbidden, "data": nil, "msg": "不允许的跨域来源"})
			return
		}
		if origin != "" {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers")
		}
		c.Header("Access-Control-Allow-Headers", corsAllowedHeaders)
		c.Header("Access-Control-Expose-Headers", "X-Request-ID, X-Canvas-Trace-ID, X-Diagnostic-Bundle-ID, X-Diagnostic-Schema-Version")
		c.Header("Access-Control-Allow-Methods", corsAllowedMethods)
		c.Header("Access-Control-Max-Age", "86400")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}, nil
}

func allowedOrigin(c *gin.Context, origin string) bool {
	policy, err := parseCORSPolicy(os.Getenv("CANVAS_CORS_ORIGINS"))
	if err != nil {
		return false
	}
	return allowedOriginWithPolicy(c, origin, policy)
}

func parseCORSPolicy(raw string) (corsPolicy, error) {
	policy := corsPolicy{origins: make(map[string]struct{})}
	for _, value := range strings.Split(raw, ",") {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if value == "*" {
			policy.allowAny = true
			continue
		}
		normalized, err := normalizeCORSOrigin(value)
		if err != nil {
			return corsPolicy{}, fmt.Errorf("CANVAS_CORS_ORIGINS contains invalid origin %q: %w", value, err)
		}
		policy.origins[normalized] = struct{}{}
	}
	return policy, nil
}

func normalizeCORSOrigin(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", fmt.Errorf("origin is empty")
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || parsed.User != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", fmt.Errorf("origin must be an http or https origin")
	}
	if parsed.Path != "" && parsed.Path != "/" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("origin must not contain a path, query, or fragment")
	}
	return strings.ToLower(parsed.Scheme) + "://" + strings.ToLower(parsed.Host), nil
}

func allowedOriginWithPolicy(c *gin.Context, origin string, policy corsPolicy) bool {
	normalizedOrigin, err := normalizeCORSOrigin(origin)
	if err != nil {
		return false
	}
	parsed, err := url.Parse(normalizedOrigin)
	if err != nil {
		return false
	}
	requestHost := c.Request.Host
	if forwardedHost := strings.TrimSpace(c.GetHeader("X-Forwarded-Host")); forwardedHost != "" {
		requestHost = strings.TrimSpace(strings.Split(forwardedHost, ",")[0])
	}
	if strings.EqualFold(parsed.Host, strings.TrimSpace(requestHost)) {
		return true
	}
	if policy.allowAny {
		return true
	}
	if _, ok := policy.origins[normalizedOrigin]; ok {
		return true
	}
	if len(policy.origins) > 0 {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return (host == "localhost" || host == "127.0.0.1" || host == "::1") && (parsed.Scheme == "http" || parsed.Scheme == "https")
}
