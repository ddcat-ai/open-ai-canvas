package handler

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

const internalErrorMessage = "系统处理失败，请稍后重试"

func ok(c *gin.Context, data any) {
	c.JSON(http.StatusOK, gin.H{"code": service.CodeOK, "data": data, "msg": "ok"})
}

// fail 只接受调用方已经确认可公开的错误；service 返回值统一交给 failService 投影。
func fail(c *gin.Context, status int, err error) {
	message := http.StatusText(status)
	if err != nil && strings.TrimSpace(err.Error()) != "" {
		message = err.Error()
	}
	writeFailure(c, status, status, service.ReasonForStatus(status), message)
}

func failService(c *gin.Context, err error) {
	var cooldown *service.EmailCodeCooldownError
	if errors.As(err, &cooldown) {
		c.Header("Retry-After", strconv.Itoa(cooldown.Seconds))
		writeFailure(c, http.StatusTooManyRequests, service.CodeRateLimited, service.ReasonRateLimited, cooldown.Error())
		return
	}
	var modelErr *service.ModelError
	if errors.As(err, &modelErr) && modelErr.AppError != nil && validErrorStatus(modelErr.Status) {
		writeAppError(c, modelErr.AppError)
		return
	}
	var appErr *service.AppError
	if errors.As(err, &appErr) && validErrorStatus(appErr.Status) {
		writeAppError(c, appErr)
		return
	}
	failInternal(c, http.StatusInternalServerError, err)
}

func writeAppError(c *gin.Context, appErr *service.AppError) {
	code := appErr.Code
	if code == 0 {
		code = appErr.Status
	}
	reason := appErr.Reason
	if reason == "" {
		reason = service.ReasonForStatus(appErr.Status)
	}
	message := strings.TrimSpace(appErr.Message)
	if message == "" {
		message = safeInternalErrorMessage(appErr.Status)
	}
	if appErr.Status >= http.StatusInternalServerError {
		diagnosticErr := appErr.Cause
		if diagnosticErr == nil {
			diagnosticErr = appErr
		}
		logHandlerError(c, appErr.Status, diagnosticErr)
	}
	body := gin.H{"code": code, "data": nil, "msg": message}
	if reason != "" {
		body["reason"] = reason
	}
	if len(appErr.Details) > 0 {
		body["details"] = appErr.Details
	}
	c.JSON(appErr.Status, body)
}

// failInternal 保留真实 HTTP 状态，但绝不把未分类错误原文写入响应。
func failInternal(c *gin.Context, status int, err error) {
	if !validErrorStatus(status) {
		status = http.StatusInternalServerError
	}
	logHandlerError(c, status, err)
	writeFailure(c, status, status, service.ReasonForStatus(status), safeInternalErrorMessage(status))
}

func writeFailure(c *gin.Context, status int, code int, reason service.ErrorReason, message string) {
	body := gin.H{"code": code, "data": nil, "msg": message}
	if reason != "" {
		body["reason"] = reason
	}
	c.JSON(status, body)
}

func validErrorStatus(status int) bool {
	return status >= http.StatusBadRequest && status <= 599
}

func safeInternalErrorMessage(status int) string {
	switch status {
	case http.StatusBadGateway:
		return "上游服务暂时不可用，请稍后重试"
	case http.StatusServiceUnavailable:
		return "服务暂时不可用，请稍后重试"
	case http.StatusGatewayTimeout:
		return "上游服务响应超时，请稍后重试"
	default:
		return internalErrorMessage
	}
}

func logHandlerError(c *gin.Context, status int, err error) {
	if err == nil {
		return
	}
	method := ""
	route := ""
	if c != nil && c.Request != nil {
		method = c.Request.Method
		route = c.FullPath()
		if route == "" {
			route = "<unmatched>"
		}
	}
	// 普通访问日志会输出 Gin error；这里只记录错误类型，避免密钥或上游响应体进入日志。
	log.Printf("handler request failed: method=%s route=%s status=%d error_type=%T", method, route, status, err)
}
