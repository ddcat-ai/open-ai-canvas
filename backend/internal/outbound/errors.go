package outbound

// BadRequestError 是出站校验失败（URL/Header 等）的稳定错误类型。
// service 层通过 aliases 转成 AppError，避免 outbound → service 回环。
type BadRequestError struct {
	Message string
}

func (e *BadRequestError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func BadAuthRequest(message string) error {
	return &BadRequestError{Message: message}
}
