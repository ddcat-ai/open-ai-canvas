package app

import (
	"context"

	mcpintegration "yingce/backend/internal/integrations/mcp"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type MCPTemplateInput = mcpintegration.TemplateInput
type MCPTemplateView = mcpintegration.TemplateView
type MCPConnectionInput = mcpintegration.ConnectionInput
type MCPConnectionView = mcpintegration.ConnectionView

func (s *Service) mcpDomain() *mcpintegration.Service {
	return mcpintegration.New(s.repo, s.encryptSettingSecret, s.decryptSettingSecret)
}

func (s *Service) requireMCPActor(actor *model.User, admin bool) error {
	if actor == nil || actor.ID == "" {
		return Unauthorized("请先登录")
	}
	if admin {
		return s.RequireAdmin(actor)
	}
	return nil
}

func (s *Service) MCPCatalog(actor *model.User, admin bool) ([]MCPTemplateView, error) {
	if err := s.requireMCPActor(actor, admin); err != nil {
		return nil, err
	}
	return s.mcpDomain().Catalog(admin)
}

func (s *Service) SaveMCPTemplate(actor *model.User, id string, input MCPTemplateInput) (MCPTemplateView, error) {
	if err := s.requireMCPActor(actor, true); err != nil {
		return MCPTemplateView{}, err
	}
	var view MCPTemplateView
	err := s.repo.Transaction(func(repo *repository.Repository) error {
		var err error
		view, err = mcpintegration.New(repo, s.encryptSettingSecret, s.decryptSettingSecret).SaveTemplate(id, input)
		if err != nil {
			return err
		}
		event, err := newAdminAuditEvent(actor, "mcp.catalog.save", "mcp_template", view.ID, "保存 MCP 市场配置", map[string]any{"published": view.Published, "parameterCount": len(view.Parameters)})
		if err != nil {
			return err
		}
		return repo.AppendAdminAudit(event)
	})
	return view, err
}

func (s *Service) DeleteMCPTemplate(actor *model.User, id string) error {
	if err := s.requireMCPActor(actor, true); err != nil {
		return err
	}
	return s.repo.Transaction(func(repo *repository.Repository) error {
		if err := mcpintegration.New(repo, s.encryptSettingSecret, s.decryptSettingSecret).DeleteTemplate(id); err != nil {
			return err
		}
		event, err := newAdminAuditEvent(actor, "mcp.catalog.delete", "mcp_template", id, "删除 MCP 市场配置", nil)
		if err != nil {
			return err
		}
		return repo.AppendAdminAudit(event)
	})
}

func (s *Service) MCPConnections(actor *model.User, admin bool) ([]MCPConnectionView, error) {
	if err := s.requireMCPActor(actor, admin); err != nil {
		return nil, err
	}
	return s.mcpDomain().Connections(actor.ID, admin)
}

func (s *Service) SaveMCPConnection(actor *model.User, id string, admin bool, input MCPConnectionInput) (MCPConnectionView, error) {
	if err := s.requireMCPActor(actor, admin); err != nil {
		return MCPConnectionView{}, err
	}
	if !admin {
		return s.mcpDomain().SaveConnection(actor.ID, id, false, input)
	}
	var view MCPConnectionView
	err := s.repo.Transaction(func(repo *repository.Repository) error {
		var err error
		view, err = mcpintegration.New(repo, s.encryptSettingSecret, s.decryptSettingSecret).SaveConnection(actor.ID, id, true, input)
		if err != nil {
			return err
		}
		event, err := newAdminAuditEvent(actor, "mcp.connection.save", "mcp_connection", view.ID, "保存平台 MCP 连接", map[string]any{"enabled": view.Enabled, "allowedTools": view.AllowedTools, "revision": view.Revision})
		if err != nil {
			return err
		}
		return repo.AppendAdminAudit(event)
	})
	return view, err
}

func (s *Service) DeleteMCPConnection(actor *model.User, id string, admin bool) error {
	if err := s.requireMCPActor(actor, admin); err != nil {
		return err
	}
	if !admin {
		return s.mcpDomain().DeleteConnection(actor.ID, id, false)
	}
	return s.repo.Transaction(func(repo *repository.Repository) error {
		if err := mcpintegration.New(repo, s.encryptSettingSecret, s.decryptSettingSecret).DeleteConnection(actor.ID, id, true); err != nil {
			return err
		}
		event, err := newAdminAuditEvent(actor, "mcp.connection.delete", "mcp_connection", id, "删除平台 MCP 连接", nil)
		if err != nil {
			return err
		}
		return repo.AppendAdminAudit(event)
	})
}

func (s *Service) TestMCPConnection(ctx context.Context, actor *model.User, id string, admin bool) (MCPConnectionView, error) {
	if err := s.requireMCPActor(actor, admin); err != nil {
		return MCPConnectionView{}, err
	}
	return s.mcpDomain().TestConnection(ctx, actor.ID, id, admin)
}
