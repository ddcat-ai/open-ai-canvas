package kernel

// AppError 是业务层对外公开的结构化错误。
// Message 必须可安全展示给用户，Cause 仅用于保留内部诊断链路，不得直接写入 HTTP 响应。
type AppError struct {
	Status    int
	Code      int
	Reason    ErrorReason
	Message   string
	Retryable bool
	Cause     error
}

func (e *AppError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func (e *AppError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

func NewAppError(status int, message string) *AppError {
	return &AppError{Status: status, Code: status, Reason: ReasonForStatus(status), Message: message}
}

func WrapAppError(status int, message string, cause error) *AppError {
	err := NewAppError(status, message)
	err.Cause = cause
	return err
}

func RateLimited(message string) *AppError {
	return &AppError{Status: CodeTooManyRequests, Code: CodeRateLimited, Reason: ReasonRateLimited, Message: message, Retryable: true}
}

func QuotaExceeded(message string) *AppError {
	return &AppError{Status: CodeForbidden, Code: CodeQuotaExceeded, Reason: ReasonQuotaExceeded, Message: message}
}

func BadAuthRequest(message string) *AppError {
	return NewAppError(400, message)
}

func NotFound(message string) *AppError {
	return NewAppError(404, message)
}

func Unauthorized(message string) *AppError {
	return NewAppError(401, message)
}

func Forbidden(message string) *AppError {
	return NewAppError(403, message)
}
