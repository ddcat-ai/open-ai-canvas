package auth

import "fmt"

type EmailCodeCooldownError struct{ Seconds int }

func (e *EmailCodeCooldownError) Error() string {
	return fmt.Sprintf("验证码已发送，请查看邮箱；%d 秒后可以重新获取", e.Seconds)
}
