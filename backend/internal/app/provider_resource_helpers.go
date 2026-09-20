package app

import (
	"errors"
	"time"

	"infinite-canvas/backend/internal/model"
)

// ResourceForUser 是 Provider worker 读取资源时必须经过的 service 层归属校验。
func (s *Service) ResourceForUser(actor *model.User, id string) (*model.Resource, error) {
	if actor == nil || actor.ID == "" {
		return nil, errors.New("用户身份无效")
	}
	return s.repo.ResourceForUser(actor.ID, id)
}

// providerResourceURL 只能接收已经完成用户归属和 ready 状态校验的资源，
// 并为上游签发短时地址；它不是绕过权限校验的通用资源 URL 生成器。
func (s *Service) providerResourceURL(resource *model.Resource, expiresAt time.Time) (string, error) {
	return s.directResourceURL(resource, expiresAt)
}
