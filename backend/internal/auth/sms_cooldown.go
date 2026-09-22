package auth

import "fmt"

// SmsCodeCooldownError 短信验证码的**重发冷却**（业务冷却，不是限流）。
//
// ⚠️ 与 `EmailCodeCooldownError` 一样：**必须在 `handler/response.go` 的 `failService` 里
// 被 `errors.As` 识别**，写成 429 + `Retry-After`。漏了会掉进 failInternal → HTTP 500，
// 前端的倒计时（靠 `retryAfterMs` 驱动）也就跟着废了。
type SmsCodeCooldownError struct{ Seconds int }

func (e *SmsCodeCooldownError) Error() string {
	return fmt.Sprintf("验证码已发送，请查看短信；%d 秒后可以重新获取", e.Seconds)
}
