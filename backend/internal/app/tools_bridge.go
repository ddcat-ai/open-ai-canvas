package app

import (
	"fmt"

	"infinite-canvas/backend/internal/tools"
)

type (
	ToolListRequest     = tools.ToolListRequest
	ToolList            = tools.ToolList
	ToolItem            = tools.ToolItem
	ToolSummary         = tools.ToolSummary
	ToolMutationRequest = tools.ToolMutationRequest
)

func (s *Service) toolDomain() *tools.Service {
	if s == nil {
		return tools.New(nil)
	}
	if s.tools != nil {
		return s.tools
	}
	return tools.New(s.repo)
}

func (s *Service) Tools(userID string, req ToolListRequest) (*ToolList, error) {
	return s.toolDomain().List(userID, req)
}

func (s *Service) SetToolFavorite(userID string, toolID int64, favorite bool) (*ToolItem, error) {
	return s.toolDomain().SetFavorite(userID, toolID, favorite)
}

func (s *Service) CreateTool(userID string, req ToolMutationRequest) (*ToolItem, error) {
	return s.toolDomain().Create(userID, req)
}

func (s *Service) DeleteTool(userID string, toolID int64) error {
	return s.toolDomain().Delete(userID, toolID)
}

func (s *Service) EnsureBuiltinTools() error {
	return tools.EnsureBuiltinTools(s.repo, s)
}

// ImportSeedResource 将外部 URL 资源导入本地存储，返回登录态访问路径。
// 使用原始 URL 作为 uploadIdentity 保证幂等：重复启动不会重复下载。
// 公开路径需要签名参数且会过期，不适合持久化存储；内置工具用登录态路径即可。
func (s *Service) ImportSeedResource(ownerID string, rawURL string, kind string) (string, error) {
	resource, err := s.ImportResourceURL(ownerID, rawURL, kind, 0, 0, 0, rawURL)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("/api/resources/%s/file", resource.ID), nil
}
