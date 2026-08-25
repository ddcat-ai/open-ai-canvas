package handler

import (
	"crypto/rand"
	"encoding/hex"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	requestIDHeader = "X-Request-ID"
	traceIDHeader   = "X-Canvas-Trace-ID"
	requestIDKey    = "canvas.request_id"
	traceIDKey      = "canvas.trace_id"
)

var correlationIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,96}$`)

// RequestCorrelationMiddleware 为每个请求生成服务端 requestId，并保留一次业务操作的 traceId。
// requestId 不能被客户端覆盖；traceId 只接受有限字符集，避免把任意请求头内容写入日志和诊断包。
func RequestCorrelationMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := newCorrelationID("req")
		traceID := normalizeCorrelationID(c.GetHeader(traceIDHeader))
		if traceID == "" {
			traceID = newCorrelationID("trace")
		}
		c.Set(requestIDKey, requestID)
		c.Set(traceIDKey, traceID)
		c.Header(requestIDHeader, requestID)
		c.Header(traceIDHeader, traceID)
		c.Next()
	}
}

func RequestID(c *gin.Context) string {
	if value, ok := c.Get(requestIDKey); ok {
		if result, ok := value.(string); ok {
			return result
		}
	}
	return ""
}

func TraceID(c *gin.Context) string {
	if value, ok := c.Get(traceIDKey); ok {
		if result, ok := value.(string); ok {
			return result
		}
	}
	return ""
}

func normalizeCorrelationID(value string) string {
	value = strings.TrimSpace(value)
	if !correlationIDPattern.MatchString(value) {
		return ""
	}
	return value
}

func newCorrelationID(prefix string) string {
	var raw [12]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return prefix + "-unavailable"
	}
	return prefix + "-" + hex.EncodeToString(raw[:])
}
