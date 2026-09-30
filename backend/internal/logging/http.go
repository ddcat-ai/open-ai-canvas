package logging

import (
	"io"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// quietWriteSuffixes 是语义上只读、但用 POST 发出的高频路由（心跳、状态查询、批量读取）。
// 与 GET 一样，成功时只在 debug 级别输出。
var quietWriteSuffixes = []string{
	"/heartbeat",
	"/query",
	"/query-provider",
	"/query-task",
	"/checkout/refresh",
	"/assets/batch",
	"/announcements/read",
	"/diagnostics/preview",
	"/system-update/check",
}

// AccessLog 替代 gin.Logger：成功的查询类请求（GET/HEAD/OPTIONS 与 quietWriteSuffixes）降为 debug，
// 写请求记 info，4xx 记 warn，5xx 记 error；超过慢请求阈值的非流式请求无论方法都记 warn。
// redactPath 用于脱敏 URL 中的凭据段（例如分享 token），为 nil 时原样输出。
func AccessLog(redactPath func(string) string) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		latency := time.Since(start)
		status := c.Writer.Status()
		route := c.FullPath()
		level := accessLevel(c.Request.Method, route, status, latency, isStreamResponse(c))
		ctx := c.Request.Context()
		if !slog.Default().Enabled(ctx, level) {
			return
		}
		path := c.Request.URL.Path
		if redactPath != nil {
			path = redactPath(path)
		}
		attrs := []slog.Attr{
			slog.String("method", c.Request.Method),
			slog.String("path", path),
			slog.Int("status", status),
			slog.Int64("latency_ms", latency.Milliseconds()),
			slog.String("ip", c.ClientIP()),
		}
		if requestID := c.Writer.Header().Get("X-Request-ID"); requestID != "" {
			attrs = append(attrs, slog.String("request_id", requestID))
		}
		if message := c.Errors.ByType(gin.ErrorTypePrivate).String(); message != "" {
			attrs = append(attrs, slog.String("error", strings.TrimSpace(message)))
		}
		slog.LogAttrs(ctx, level, "http request", attrs...)
	}
}

func accessLevel(method, route string, status int, latency time.Duration, stream bool) slog.Level {
	switch {
	case status >= http.StatusInternalServerError:
		return slog.LevelError
	case status >= http.StatusBadRequest:
		return slog.LevelWarn
	}
	if threshold := slowRequestThreshold(); threshold > 0 && !stream && latency >= threshold {
		return slog.LevelWarn
	}
	if isQueryRequest(method, route) {
		return slog.LevelDebug
	}
	return slog.LevelInfo
}

func isQueryRequest(method, route string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	case http.MethodPost:
		for _, suffix := range quietWriteSuffixes {
			if strings.HasSuffix(route, suffix) {
				return true
			}
		}
	}
	return false
}

// SSE 与分块下载天然是长连接，耗时不代表慢。
func isStreamResponse(c *gin.Context) bool {
	return strings.Contains(c.Writer.Header().Get("Content-Type"), "text/event-stream")
}

// Recovery 替代 gin.Recovery：panic 与堆栈进入统一日志，而不是直接写带颜色码的 stderr。
func Recovery() gin.HandlerFunc {
	return gin.CustomRecoveryWithWriter(io.Discard, func(c *gin.Context, recovered any) {
		slog.ErrorContext(c.Request.Context(), "http panic recovered",
			"method", c.Request.Method,
			"route", c.FullPath(),
			"request_id", c.Writer.Header().Get("X-Request-ID"),
			"panic", recovered,
			"stack", string(debug.Stack()),
		)
		c.AbortWithStatus(http.StatusInternalServerError)
	})
}
