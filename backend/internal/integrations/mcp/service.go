package mcpintegration

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
	"yingce/backend/internal/repository"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Service struct {
	repo        *repository.Repository
	encrypt     func(string) (string, error)
	decrypt     func(string) (string, error)
	coordinator *platform.Coordinator
}

var unsafeCatalogWarnings sync.Map

func New(repo *repository.Repository, encrypt, decrypt func(string) (string, error), coordinator *platform.Coordinator) *Service {
	return &Service{repo: repo, encrypt: encrypt, decrypt: decrypt, coordinator: coordinator}
}

func notFound(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return kernel.NotFound("MCP 配置不存在或无权访问")
	}
	return err
}

func conflict(err error) error {
	if errors.Is(err, repository.ErrMCPStorageQuota) {
		return kernel.QuotaExceeded(err.Error())
	}
	if errors.Is(err, repository.ErrCreationConflict) {
		return kernel.NewAppError(409, "MCP 配置已变化或仍被连接引用，请刷新后重试")
	}
	return notFound(err)
}

func (s *Service) Catalog(admin bool) ([]TemplateView, error) {
	rows, err := s.repo.MCPTemplates(!admin)
	if err != nil {
		return nil, err
	}
	views := []TemplateView{}
	for i := range rows {
		view, err := parseTemplate(&rows[i])
		if err != nil {
			return nil, err
		}
		if !admin && validateTemplateCredentials(view.TemplateInput) != nil {
			if _, warned := unsafeCatalogWarnings.LoadOrStore(view.ID, struct{}{}); !warned {
				log.Printf("MCP catalog entry %s excluded: unsafe legacy credential configuration", view.ID)
			}
			continue
		}
		views = append(views, view)
	}
	return views, nil
}

// Admin authorization is established by the app service before entering these
// catalog mutations. No HTTP-supplied role or owner reaches this domain.
func (s *Service) SaveTemplate(id string, input TemplateInput) (TemplateView, error) {
	if err := validateTemplate(&input); err != nil {
		return TemplateView{}, err
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return TemplateView{}, err
	}
	if id == "" {
		row := &model.MCPServerTemplate{ID: uuid.NewString(), Definition: string(raw), Published: input.Published}
		if err := s.repo.CreateMCPTemplate(row); err != nil {
			return TemplateView{}, err
		}
		return parseTemplate(row)
	}
	row, err := s.repo.MCPTemplate(id)
	if err != nil {
		return TemplateView{}, notFound(err)
	}
	row.Definition, row.Published = string(raw), input.Published
	if err := s.repo.UpdateMCPTemplate(row); err != nil {
		return TemplateView{}, notFound(err)
	}
	row, err = s.repo.MCPTemplate(id)
	if err != nil {
		return TemplateView{}, err
	}
	return parseTemplate(row)
}

func (s *Service) DeleteTemplate(id string) error {
	return conflict(s.repo.DeleteMCPTemplate(id))
}

func (s *Service) Connections(userID string, admin bool) ([]ConnectionView, error) {
	var views []ConnectionView
	err := s.repo.MCPReadSnapshot(func(repo *repository.Repository) error {
		var err error
		views, err = New(repo, s.encrypt, s.decrypt, s.coordinator).connectionViews(userID, admin)
		return err
	})
	return views, err
}

func (s *Service) connectionViews(userID string, admin bool) ([]ConnectionView, error) {
	rows, err := s.repo.MCPConnections(userID, admin)
	if err != nil {
		return nil, err
	}
	views := []ConnectionView{}
	for i := range rows {
		view, err := s.connectionView(&rows[i], !admin && rows[i].Scope == "platform")
		if err != nil {
			return nil, err
		}
		views = append(views, view)
	}
	return views, nil
}

func (s *Service) ownedConnection(userID, id string, admin bool) (*model.MCPConnection, error) {
	row, err := s.repo.MCPConnection(id)
	if err != nil {
		return nil, notFound(err)
	}
	if (admin && row.Scope != "platform") || (!admin && (row.Scope != "user" || row.UserID != userID)) {
		return nil, kernel.NotFound("MCP 配置不存在或无权访问")
	}
	return row, nil
}

func (s *Service) SaveConnection(userID, id string, admin bool, input ConnectionInput) (ConnectionView, error) {
	if userID == "" {
		return ConnectionView{}, kernel.Unauthorized("请先登录")
	}
	input.Name, input.ServerURL = strings.TrimSpace(input.Name), strings.TrimSpace(input.ServerURL)
	if input.Name == "" || utf8.RuneCountInString(input.Name) > 100 {
		return ConnectionView{}, kernel.BadAuthRequest("MCP 连接名称不能为空且最多 100 字")
	}
	if err := validateTransport(input.Transport); err != nil {
		return ConnectionView{}, err
	}
	// URL validation resolves DNS. It must finish before taking database locks.
	if err := validateURL(input.ServerURL); err != nil {
		return ConnectionView{}, err
	}
	quotaOwner := userID
	if id != "" {
		row, err := s.ownedConnection(userID, id, admin)
		if err != nil {
			return ConnectionView{}, err
		}
		quotaOwner = row.UserID
	}
	var view ConnectionView
	err := s.repo.Transaction(func(repo *repository.Repository) error {
		if err := repo.LockMCPQuota(quotaOwner); err != nil {
			return err
		}
		if admin && id == "" {
			if err := repo.LockMCPPlatformQuota(); err != nil {
				return err
			}
		}
		// Serialize with template edits/deletion before interpreting parameters.
		if input.TemplateID != "" {
			if err := repo.LockMCPTemplate(input.TemplateID); err != nil {
				return notFound(err)
			}
		}
		var err error
		view, err = New(repo, s.encrypt, s.decrypt, s.coordinator).saveConnection(userID, id, admin, input)
		return err
	})
	return view, conflict(err)
}

func (s *Service) saveConnection(userID, id string, admin bool, input ConnectionInput) (ConnectionView, error) {
	scope := "user"
	if admin {
		scope = "platform"
	}
	template, err := s.templateFor(input.TemplateID, scope)
	if err != nil {
		return ConnectionView{}, err
	}
	row := &model.MCPConnection{ID: uuid.NewString(), UserID: userID, Scope: scope, ToolsJSON: "[]", ToolsSummaryJSON: "[]", AllowedToolsJSON: "[]", AllowedUserIDsJSON: "[]", ToolPoliciesJSON: "{}", Revision: 1}
	prior := map[string]string{}
	if id != "" {
		row, err = s.ownedConnection(userID, id, admin)
		if err != nil {
			return ConnectionView{}, err
		}
		prior, err = s.parameterValues(row)
		if err != nil {
			return ConnectionView{}, err
		}
	} else {
		count, err := s.repo.MCPConnectionCount(userID, scope)
		if err != nil {
			return ConnectionView{}, err
		}
		if count >= 30 {
			return ConnectionView{}, kernel.BadAuthRequest("最多配置 30 个 MCP 连接")
		}
	}
	// Never transfer a credential to a different server/template implicitly.
	if id != "" && (row.ServerURL != input.ServerURL || row.TemplateID != input.TemplateID) {
		prior = map[string]string{}
	}
	values, err := mergeParameters(template.Parameters, prior, input.Parameters)
	if err != nil {
		return ConnectionView{}, err
	}
	oldJSON, _ := json.Marshal(prior)
	newJSON, err := json.Marshal(values)
	if err != nil {
		return ConnectionView{}, err
	}
	changed := id == "" || row.ServerURL != input.ServerURL || row.Transport != input.Transport || row.TemplateID != input.TemplateID || string(oldJSON) != string(newJSON)
	if changed {
		row.ToolsJSON, row.ToolsSummaryJSON, row.AllowedToolsJSON, row.LastTestAt = "[]", "[]", "[]", nil
		if input.Enabled || len(input.AllowedTools) > 0 {
			return ConnectionView{}, kernel.BadAuthRequest("连接参数已变化，请先保存并重新检测，再选择允许的工具和启用")
		}
	}
	tools, _, err := decodeTools(row)
	if err != nil {
		return ConnectionView{}, err
	}
	if err := s.validateAccessPolicy(admin, &input, tools); err != nil {
		return ConnectionView{}, err
	}
	names := map[string]bool{}
	for _, tool := range tools {
		names[tool.Name] = true
	}
	seen := map[string]bool{}
	for _, name := range input.AllowedTools {
		if !names[name] || seen[name] {
			return ConnectionView{}, kernel.BadAuthRequest("允许工具必须来自本连接最近检测结果，且不能重复")
		}
		seen[name] = true
	}
	if input.Enabled && (row.LastTestAt == nil || len(input.AllowedTools) == 0) {
		return ConnectionView{}, kernel.BadAuthRequest("启用前请检测连接并至少选择一个允许的工具")
	}
	if input.AllowedTools == nil {
		input.AllowedTools = []string{}
	}
	slices.Sort(input.AllowedTools)
	allowedJSON, _ := json.Marshal(input.AllowedTools)
	usersJSON, _ := json.Marshal(input.AllowedUserIDs)
	policiesJSON, _ := json.Marshal(input.ToolPolicies)
	ciphertext, err := s.encrypt(string(newJSON))
	if err != nil {
		return ConnectionView{}, kernel.WrapAppError(500, "MCP 参数加密失败", err)
	}
	row.Name, row.TemplateID, row.ServerURL, row.Transport = input.Name, input.TemplateID, input.ServerURL, input.Transport
	row.ParametersCiphertext, row.Enabled, row.AllowedToolsJSON = ciphertext, input.Enabled, string(allowedJSON)
	row.AllowedUserIDsJSON, row.ToolPoliciesJSON = string(usersJSON), string(policiesJSON)
	if id == "" {
		err = s.repo.CreateMCPConnection(row)
	} else {
		err = s.repo.UpdateMCPConnection(row, row.Revision)
	}
	if err != nil {
		return ConnectionView{}, conflict(err)
	}
	if err := s.repo.ReplaceMCPConnectionGrants(row.ID, input.AllowedUserIDs); err != nil {
		return ConnectionView{}, err
	}
	return s.connectionView(row, false)
}

func (s *Service) DeleteConnection(userID, id string, admin bool) error {
	row, err := s.ownedConnection(userID, id, admin)
	if err != nil {
		return err
	}
	return s.repo.Transaction(func(repo *repository.Repository) error {
		if err := repo.LockMCPQuota(row.UserID); err != nil {
			return err
		}
		return notFound(repo.DeleteMCPConnection(row.ID, userID, row.Scope))
	})
}

func (s *Service) TestConnection(ctx context.Context, userID, id string, admin bool) (ConnectionView, error) {
	var row *model.MCPConnection
	var cfg remoteConfig
	var secrets []string
	err := s.repo.MCPReadSnapshot(func(repo *repository.Repository) error {
		scoped := New(repo, s.encrypt, s.decrypt, s.coordinator)
		var err error
		row, err = scoped.ownedConnection(userID, id, admin)
		if err != nil {
			return err
		}
		cfg, secrets, err = scoped.remoteConfig(row)
		return err
	})
	if err != nil {
		return ConnectionView{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	release, err := s.acquireOperation(ctx, "test", userID, id)
	if err != nil {
		return ConnectionView{}, err
	}
	defer release()
	tools, err := discover(ctx, cfg)
	if err != nil {
		return ConnectionView{}, err
	}
	tools, err = sanitizeDiscoveredTools(tools, secrets)
	if err != nil {
		return ConnectionView{}, err
	}
	raw, err := json.Marshal(tools)
	if err != nil {
		return ConnectionView{}, err
	}
	if len(raw) > maxToolDefinitionBytes {
		return ConnectionView{}, kernel.BadAuthRequest("MCP 工具定义安全处理后超过 256 KiB，请减少工具或参数说明")
	}
	// Re-discovery always requires a fresh tool selection, including when a
	// server added a tool or changed a schema under an existing name.
	summary, err := toolSummary(tools)
	if err != nil {
		return ConnectionView{}, err
	}
	row.ToolsJSON, row.ToolsSummaryJSON, row.AllowedToolsJSON, row.ToolPoliciesJSON, row.Enabled = string(raw), summary, "[]", "{}", false
	now := time.Now()
	row.LastTestAt = &now
	var view ConnectionView
	err = s.repo.Transaction(func(repo *repository.Repository) error {
		if err := repo.LockMCPQuota(row.UserID); err != nil {
			return err
		}
		if row.TemplateID != "" {
			if err := repo.LockMCPTemplate(row.TemplateID); err != nil {
				return notFound(err)
			}
		}
		if err := repo.UpdateMCPConnection(row, row.Revision); err != nil {
			return conflict(err)
		}
		var err error
		view, err = New(repo, s.encrypt, s.decrypt, s.coordinator).connectionView(row, false)
		return err
	})
	return view, conflict(err)
}
