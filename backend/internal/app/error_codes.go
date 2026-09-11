package app

import "infinite-canvas/backend/internal/kernel"

// 错误码和原因已迁到 kernel；此处保留兼容别名。
const (
	CodeOK                  = kernel.CodeOK
	CodeInvalidArgument     = kernel.CodeInvalidArgument
	CodeUnauthorized        = kernel.CodeUnauthorized
	CodeForbidden           = kernel.CodeForbidden
	CodeNotFound            = kernel.CodeNotFound
	CodeConflict            = kernel.CodeConflict
	CodeTooManyRequests     = kernel.CodeTooManyRequests
	CodeInternal            = kernel.CodeInternal
	CodeBadGateway          = kernel.CodeBadGateway
	CodeUnavailable         = kernel.CodeUnavailable
	CodeTimeout             = kernel.CodeTimeout
	CodeQuotaExceeded       = kernel.CodeQuotaExceeded
	CodeIdempotencyConflict = kernel.CodeIdempotencyConflict
	CodeRateLimited         = kernel.CodeRateLimited
)

type ErrorReason = kernel.ErrorReason

const (
	ReasonInvalidArgument    = kernel.ReasonInvalidArgument
	ReasonUnauthorized       = kernel.ReasonUnauthorized
	ReasonForbidden          = kernel.ReasonForbidden
	ReasonNotFound           = kernel.ReasonNotFound
	ReasonConflict           = kernel.ReasonConflict
	ReasonFailedPrecondition = kernel.ReasonFailedPrecondition
	ReasonQuotaExceeded      = kernel.ReasonQuotaExceeded
	ReasonRateLimited        = kernel.ReasonRateLimited
	ReasonUnavailable        = kernel.ReasonUnavailable
	ReasonTimeout            = kernel.ReasonTimeout
	ReasonInternal           = kernel.ReasonInternal
	ReasonBadGateway         = kernel.ReasonBadGateway
)

func ReasonForStatus(status int) ErrorReason {
	return kernel.ReasonForStatus(status)
}
