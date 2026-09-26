package app

import (
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/tools"
)

type (
	ToolListRequest        = tools.ToolListRequest
	ToolList               = tools.ToolList
	ToolItem               = tools.ToolItem
	ToolSummary            = tools.ToolSummary
	ToolMutationRequest    = tools.ToolMutationRequest
	AdminToolListRequest   = tools.AdminToolListRequest
	AdminToolUpdateRequest = tools.AdminToolUpdateRequest
	AdminToolCreateRequest = tools.AdminToolCreateRequest
	AdminToolEditRequest   = tools.AdminToolEditRequest
	AdminToolPage          = tools.AdminToolPage
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

func (s *Service) ToolDetail(userID string, toolID int64) (*ToolItem, error) {
	return s.toolDomain().Detail(userID, toolID)
}

func (s *Service) SetToolFavorite(userID string, toolID int64, favorite bool) (*ToolItem, error) {
	return s.toolDomain().SetFavorite(userID, toolID, favorite)
}

func (s *Service) CreateTool(userID string, req ToolMutationRequest) (*ToolItem, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, Unauthorized("请先登录")
	}
	values := append([]string{req.Cover, req.MediaURL}, req.ExtraInfo...)
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			continue
		}
		id := resourceIDFromFileURL(value)
		if id == "" {
			return nil, BadAuthRequest("工具预览仅支持本人上传的资源")
		}
		resource, err := s.repo.ResourceForUser(userID, id)
		if err != nil {
			return nil, err
		}
		if resource.Status != model.ResourceStatusReady {
			return nil, BadAuthRequest("预览资源尚未上传完成")
		}
		if req.Visibility == tools.ToolVisibilityPublic {
			return nil, BadAuthRequest("公开工具暂不支持私人预览资源，请移除预览或改为私有")
		}
	}
	return s.toolDomain().Create(userID, req)
}

func (s *Service) DeleteTool(userID string, toolID int64) error {
	return s.toolDomain().Delete(userID, toolID)
}

func (s *Service) AdminListTools(req AdminToolListRequest) (*AdminToolPage, error) {
	return s.toolDomain().AdminList(req)
}

func (s *Service) AdminToolDetail(toolID int64) (*ToolItem, error) {
	return s.toolDomain().AdminDetail(toolID)
}

func (s *Service) AdminCreateTool(adminID string, req AdminToolCreateRequest) (*ToolItem, error) {
	return s.toolDomain().AdminCreate(adminID, req)
}

func (s *Service) AdminEditTool(toolID int64, adminID string, req AdminToolEditRequest) (*ToolItem, error) {
	return s.toolDomain().AdminEdit(toolID, adminID, req)
}

func (s *Service) AdminUpdateTool(toolID int64, req AdminToolUpdateRequest) (*ToolSummary, error) {
	return s.toolDomain().AdminUpdate(toolID, req)
}

func (s *Service) AdminDeleteTool(toolID int64) error {
	return s.toolDomain().AdminDelete(toolID)
}

// ResolveToolMentionTokens 将 prompt 中的 @[tool:type:ID:label:icon] 令牌替换为对应工具的提示词文本。
func (s *Service) ResolveToolMentionTokens(userID, mode, prompt string) (string, error) {
	return s.toolDomain().ResolveToolMentionTokens(userID, mode, prompt)
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
