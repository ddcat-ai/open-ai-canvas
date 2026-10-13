package auth

import (
	"errors"
	"strings"
	"time"
	"unicode"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

type LoginContext struct {
	IP        string
	UserAgent string
}

func loginLogText(value string, max int) string {
	value = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, value)
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > max {
		runes = runes[:max]
	}
	return string(runes)
}

func MaskLoginAccount(account string) string {
	account = loginLogText(account, 160)
	if at := strings.LastIndex(account, "@"); at >= 0 {
		if at == 0 {
			return "***" + account[at:]
		}
		return string([]rune(account[:at])[:1]) + "***" + account[at:]
	}
	digits := strings.TrimPrefix(account, "+")
	if len(digits) >= 8 && strings.Trim(digits, "0123456789") == "" {
		return digits[:3] + "****" + digits[len(digits)-4:]
	}
	if len(digits) >= 4 && strings.Trim(digits, "0123456789") == "" {
		return digits[:1] + "****" + digits[len(digits)-1:]
	}
	return account
}

func NewLoginLog(method, source string, context LoginContext) *model.LoginLog {
	return &model.LoginLog{ID: kernel.NewID(), Event: "login", Method: method, Source: source, Result: "success", IP: loginLogText(context.IP, 64), UserAgent: loginLogText(context.UserAgent, 512), CreatedAt: time.Now().UTC()}
}

func loginLogUser(event *model.LoginLog, user *model.User) {
	event.UserID = &user.ID
	event.Username, event.DisplayName, event.Account = user.Username, user.DisplayName, user.Username
}

// 对外错误文案已由 AppError 约束；内部错误仅记固定分类，避免写入 SQL/上游密钥。
func setLoginFailure(event *model.LoginLog, original error) {
	event.Result, event.Reason, event.Message = "failed", "internal_error", "系统处理失败"
	if event.Event == "login" || event.UserID == nil {
		event.SessionRef = ""
	}
	var appErr *kernel.AppError
	if errors.As(original, &appErr) {
		event.Reason = string(appErr.Reason)
		event.Message = loginLogText(appErr.Message, 500)
	}
}

func (s *Service) recordLoginFailure(event *model.LoginLog, original error) error {
	setLoginFailure(event, original)
	if err := s.repo.AppendLoginLog(event); err != nil {
		return kernel.WrapAppError(500, "登录日志写入失败，请稍后重试", errors.Join(original, err))
	}
	return original
}

func (s *Service) RecordRejectedLogin(method string, context LoginContext, status int) error {
	event := NewLoginLog(method, "login", context)
	message := "登录请求被拒绝"
	if status == 400 {
		message = "登录请求参数无效"
	}
	if status == 429 {
		message = "登录请求过于频繁"
	}
	if status >= 500 {
		message = "登录服务暂时不可用"
	}
	setLoginFailure(event, kernel.NewAppError(status, message))
	if err := s.repo.AppendLoginLog(event); err != nil {
		return kernel.WrapAppError(500, "登录日志写入失败", err)
	}
	return nil
}
