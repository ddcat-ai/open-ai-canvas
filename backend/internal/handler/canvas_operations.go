package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func logCanvasOperationsFailure(c *gin.Context, stage string, req *service.CanvasOperationsRequest, err error) {
	status, code := http.StatusInternalServerError, http.StatusInternalServerError
	reason, message := service.ReasonForStatus(status), internalErrorMessage
	if stage == "decode_request" {
		status, code = http.StatusBadRequest, http.StatusBadRequest
		reason, message = service.ReasonForStatus(status), "画布操作请求格式错误"
	}
	var appErr *service.AppError
	if errors.As(err, &appErr) && validErrorStatus(appErr.Status) {
		status, code, reason, message = appErr.Status, appErr.Code, appErr.Reason, appErr.Message
		if code == 0 {
			code = status
		}
		if reason == "" {
			reason = service.ReasonForStatus(status)
		}
	}
	attrs := []slog.Attr{
		slog.String("stage", stage),
		slog.String("canvas_id", c.Param("id")),
		slog.String("error_type", fmt.Sprintf("%T", err)),
		slog.Int("status", status),
		slog.Int("code", code),
		slog.String("reason", string(reason)),
	}
	if requestID := RequestID(c); requestID != "" {
		attrs = append(attrs, slog.String("request_id", requestID))
	}
	if req != nil {
		attrs = append(attrs, slog.String("mutation_id", req.MutationID), slog.Int("operation_count", len(req.Operations)))
	}
	// JSON errors can include input values. Keep only field/type/offset metadata;
	// AppError.Message is the service's public, safe diagnostic contract.
	var typeErr *json.UnmarshalTypeError
	var syntaxErr *json.SyntaxError
	var sizeErr *http.MaxBytesError
	switch {
	case errors.As(err, &typeErr):
		message = "JSON 字段类型不匹配"
		attrs = append(attrs, slog.String("field", typeErr.Field), slog.String("expected_type", typeErr.Type.String()), slog.Int64("offset", typeErr.Offset))
	case errors.As(err, &syntaxErr):
		message = "JSON 语法错误"
		attrs = append(attrs, slog.Int64("offset", syntaxErr.Offset))
	case errors.As(err, &sizeErr):
		message = "画布操作请求超过大小限制"
		attrs = append(attrs, slog.Int64("limit", sizeErr.Limit))
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF):
		message = "JSON 请求不完整"
	}
	attrs = append(attrs, slog.String("error", message))
	level := slog.LevelWarn
	if status >= http.StatusInternalServerError {
		level = slog.LevelError
	}
	slog.LogAttrs(c.Request.Context(), level, "canvas operations rejected", attrs...)
}
