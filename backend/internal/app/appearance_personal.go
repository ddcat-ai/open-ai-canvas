package app

import (
	"mime/multipart"
	"strings"

	"yingce/backend/internal/model"
)

func requirePersonalAppearanceActor(actor *model.User) error {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return Unauthorized("请先登录")
	}
	if actor.Status != model.UserStatusActive {
		return Forbidden("账号不可用")
	}
	return nil
}

func (s *Service) UploadPersonalAgentAvatarBundle(actor *model.User, header *multipart.FileHeader) (*AgentAvatarBundleImport, error) {
	if err := requirePersonalAppearanceActor(actor); err != nil {
		return nil, err
	}
	if err := s.RequireStorageWritable(actor.ID); err != nil {
		return nil, err
	}
	return s.uploadAgentAvatarBundle(actor, header)
}

func (s *Service) UploadPersonalLive2D(actor *model.User, header *multipart.FileHeader) (*Live2DImport, error) {
	if err := requirePersonalAppearanceActor(actor); err != nil {
		return nil, err
	}
	if err := s.RequireStorageWritable(actor.ID); err != nil {
		return nil, err
	}
	return s.uploadLive2D(actor, header)
}

func (s *Service) requirePersonalAvatarOwner(actor *model.User, id, kind string) error {
	if err := requirePersonalAppearanceActor(actor); err != nil {
		return err
	}
	resource, err := s.repo.Resource(id)
	if err != nil || resource.UserID != actor.ID || resource.Kind != kind || resource.Status != model.ResourceStatusReady {
		return NotFound("助手形象不存在")
	}
	return nil
}

func (s *Service) PersonalAgentAvatarBundleAsset(actor *model.User, id, name string) ([]byte, string, error) {
	if err := s.requirePersonalAvatarOwner(actor, id, agentAvatarBundleResourceKind); err != nil {
		return nil, "", err
	}
	return s.AgentAvatarBundleAsset(actor, id, name)
}

func (s *Service) PersonalLive2DAsset(actor *model.User, id, name string) ([]byte, string, error) {
	if err := s.requirePersonalAvatarOwner(actor, id, "live2d"); err != nil {
		return nil, "", err
	}
	return s.Live2DAsset(actor, id, name)
}
