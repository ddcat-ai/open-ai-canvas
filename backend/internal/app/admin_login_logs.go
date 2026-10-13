package app

import (
	"errors"
	"net"
	"strings"
	"time"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

type LoginLogQuery struct{ Keyword, Event, Method, Result, IP, From, To string }
type LoginLogPage struct {
	Logs     []model.LoginLog `json:"logs"`
	Total    int64            `json:"total"`
	Page     int              `json:"page"`
	PageSize int              `json:"pageSize"`
}

func (s *Service) AdminLoginLogs(actor *model.User, query LoginLogQuery, page, pageSize int) (*LoginLogPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	filter := repository.LoginLogFilter{Keyword: strings.TrimSpace(query.Keyword), Event: strings.TrimSpace(query.Event), Method: strings.TrimSpace(query.Method), Result: strings.TrimSpace(query.Result), IP: strings.TrimSpace(query.IP)}
	for _, enum := range []struct {
		value   string
		options []string
	}{
		{filter.Event, []string{"", "login", "logout"}},
		{filter.Result, []string{"", "success", "failed"}},
		{filter.Method, []string{"", "password", "email", "sms", "linuxdo", "verification", "unknown"}},
	} {
		valid := false
		for _, option := range enum.options {
			if option == enum.value {
				valid = true
				break
			}
		}
		if !valid {
			return nil, kernel.BadAuthRequest("登录日志筛选参数无效")
		}
	}
	if len([]rune(filter.Keyword)) > 160 || (filter.IP != "" && net.ParseIP(filter.IP) == nil) {
		return nil, kernel.BadAuthRequest("关键词或 IP 参数无效")
	}
	for _, bound := range []struct {
		raw   string
		value **time.Time
	}{{query.From, &filter.From}, {query.To, &filter.To}} {
		if bound.raw == "" {
			continue
		}
		parsed, err := time.Parse(time.RFC3339, bound.raw)
		if err != nil {
			return nil, kernel.BadAuthRequest("时间必须使用 RFC3339 格式")
		}
		*bound.value = &parsed
	}
	if filter.From != nil && filter.To != nil && filter.From.After(*filter.To) {
		return nil, kernel.BadAuthRequest("开始时间不能晚于结束时间")
	}
	page, pageSize = normalizeAdminPage(page, pageSize)
	logs, total, err := s.repo.LoginLogs(filter, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, err
	}
	return &LoginLogPage{Logs: logs, Total: total, Page: page, PageSize: pageSize}, nil
}

func (s *Service) AdminLoginLog(actor *model.User, id string) (*model.LoginLog, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	event, err := s.repo.LoginLog(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.NotFound("登录日志不存在")
	}
	return event, err
}

func (s *Service) RecordRejectedLogin(method string, context LoginContext, status int) error {
	return s.authDomain().RecordRejectedLogin(method, context, status)
}
