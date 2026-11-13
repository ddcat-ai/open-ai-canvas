package mcpintegration

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

func authorizeConnection(repo *repository.Repository, row *model.MCPConnection, userID string) error {
	if userID == "" {
		return kernel.Unauthorized("请先登录")
	}
	if row.Scope == "user" && row.UserID == userID {
		return nil
	}
	if row.Scope == "platform" {
		granted, err := repo.MCPConnectionGrantedTo(row.ID, userID)
		if err != nil {
			return err
		}
		if granted {
			return nil
		}
	}
	return kernel.NotFound("MCP 配置不存在或无权访问")
}

func (s *Service) validateAccessPolicy(admin bool, input *ConnectionInput, tools []Tool) error {
	if !admin {
		if len(input.AllowedUserIDs) != 0 || len(input.ToolPolicies) != 0 {
			return kernel.Forbidden("个人连接不能配置平台用户授权或平台工具策略")
		}
		input.AllowedUserIDs, input.ToolPolicies = []string{}, map[string]map[string]any{}
		return nil
	}
	if len(input.AllowedUserIDs) > 100 || len(input.ToolPolicies) > maxTools {
		return kernel.BadAuthRequest("平台 MCP 最多授权 100 位用户，工具策略数量不能超过 128")
	}
	seen := map[string]bool{}
	for _, id := range input.AllowedUserIDs {
		if id == "" || len(id) > 36 || strings.TrimSpace(id) != id || seen[id] {
			return kernel.BadAuthRequest("平台 MCP 用户 ID 无效或重复")
		}
		seen[id] = true
		// Revoking a connection must remain possible after a grantee is disabled
		// or deleted. Enabling it always rechecks every granted account.
		if !input.Enabled {
			continue
		}
		user, err := s.repo.User(id)
		if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && user.Status != model.UserStatusActive) {
			return kernel.BadAuthRequest("平台 MCP 只能授权已存在且启用的用户")
		}
		if err != nil {
			return err
		}
	}
	if input.Enabled && len(input.AllowedUserIDs) == 0 {
		return kernel.BadAuthRequest("启用平台 MCP 前必须明确选择允许使用的用户；管理员也需显式授权")
	}
	known := map[string]bool{}
	for _, tool := range tools {
		known[tool.Name] = true
	}
	for name, policy := range input.ToolPolicies {
		if !known[name] || policy == nil || policy["type"] != "object" {
			return kernel.BadAuthRequest("工具策略必须对应已发现工具，并声明 type: object")
		}
		raw, err := json.Marshal(policy)
		if err != nil || len(raw) > 8<<10 {
			return kernel.BadAuthRequest("单个 MCP 工具策略不能超过 8 KiB")
		}
		if _, err := resolveSchema(raw); err != nil {
			return kernel.BadAuthRequest("MCP 工具策略无效或包含外部引用")
		}
	}
	raw, err := json.Marshal(input.ToolPolicies)
	if err != nil || len(raw) > 64<<10 {
		return kernel.BadAuthRequest("MCP 工具策略总大小不能超过 64 KiB")
	}
	if input.Enabled {
		for _, name := range input.AllowedTools {
			if input.ToolPolicies[name] == nil {
				return kernel.BadAuthRequest("每个已授权的平台工具都必须显式配置参数约束")
			}
		}
	}
	if input.AllowedUserIDs == nil {
		input.AllowedUserIDs = []string{}
	}
	if input.ToolPolicies == nil {
		input.ToolPolicies = map[string]map[string]any{}
	}
	slices.Sort(input.AllowedUserIDs)
	return nil
}

func validatePlatformArguments(row *model.MCPConnection, call ToolCall) error {
	if row.Scope != "platform" {
		return nil
	}
	var policies map[string]map[string]any
	if err := json.Unmarshal([]byte(row.ToolPoliciesJSON), &policies); err != nil || policies[call.ToolName] == nil {
		return kernel.Forbidden("平台 MCP 工具缺少参数授权策略")
	}
	raw, err := json.Marshal(policies[call.ToolName])
	if err != nil {
		return kernel.Forbidden("平台 MCP 工具策略无效")
	}
	schema, err := resolveSchema(raw)
	if err != nil || schema.Validate(call.Arguments) != nil {
		return kernel.Forbidden("MCP 调用超出平台授权的资源或参数范围")
	}
	return nil
}
