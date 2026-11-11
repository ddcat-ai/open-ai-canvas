package database

import (
	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func migrateAgentMCP(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.MCPServerTemplate{}, &model.MCPConnection{}, &model.MCPToolExecution{}); err != nil {
		return err
	}
	// These are installable configuration templates, not pre-authorized services.
	// A connection must be configured, tested, and granted tools before use.
	for _, row := range []model.MCPServerTemplate{
		{ID: "builtin-github", Published: true, Definition: `{"name":"GitHub","description":"连接 GitHub 官方远端 MCP。请提供具备所需仓库权限的访问令牌，检测后选择允许工具。","homepage":"https://github.com/github/github-mcp-server","transport":"streamable_http","serverUrl":"https://api.githubcopilot.com/mcp/","headers":{"Authorization":"Bearer {{token}}"},"parameters":[{"name":"token","label":"GitHub 访问令牌","description":"仅在服务端加密保存。令牌权限决定可访问的仓库。","type":"secret","required":true}],"published":true}`},
		{ID: "builtin-feishu", Published: true, Definition: `{"name":"飞书 MCP","description":"连接你部署的飞书官方 MCP HTTP 服务。应用凭证在 MCP 服务端配置；这里填写远端地址与网关令牌。接收飞书消息和每日定时任务需另行配置。","homepage":"https://github.com/larksuite/lark-openapi-mcp","transport":"streamable_http","serverUrl":"","headers":{"Authorization":"Bearer {{token}}"},"parameters":[{"name":"token","label":"MCP 网关访问令牌","description":"受保护的 MCP 服务所需访问令牌；无需认证的服务可留空。","type":"secret","required":false}],"published":true}`},
	} {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
			return err
		}
	}
	return nil
}
