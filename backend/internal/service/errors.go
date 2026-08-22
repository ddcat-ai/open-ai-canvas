package service

// AppError 是 service 层对外公开的结构化错误。
// Message 必须可安全展示给用户，Cause 仅用于保留内部诊断链路，不得直接写入 HTTP 响应。
type AppError struct {
	Status    int
	Code      int
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
	return &AppError{Status: status, Message: message}
}

func WrapAppError(status int, message string, cause error) *AppError {
	return &AppError{Status: status, Message: message, Cause: cause}
}
