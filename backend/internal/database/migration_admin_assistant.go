package database

import (
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func migrateAdminAssistantApprovalMode(tx *gorm.DB) error {
	// 已安装站点必须独立升级；历史凭证保持逐次审批，不能因迁移自动提权。
	for _, row := range []any{&model.AssistantCredential{}, &model.AssistantOAuthCode{}, &model.AssistantGrant{}, &model.MCPConnection{}} {
		if !tx.Migrator().HasColumn(row, "ApprovalMode") {
			if err := tx.Migrator().AddColumn(row, "ApprovalMode"); err != nil {
				return err
			}
		}
	}
	return nil
}

func migrateAdminAssistant(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.AssistantCredential{}, &model.AssistantOAuthClient{}, &model.AssistantOAuthCode{}, &model.AssistantGrant{}, &model.AssistantRefreshUse{}, &model.AssistantInvocation{}, &model.AssistantAttachment{}); err != nil {
		return err
	}
	if tx.Dialector.Name() == "postgres" {
		// Supabase's public PostgREST roles must not read tokens, codes or receipts.
		// The backend database owner/service role continues to bypass RLS.
		for _, table := range []string{"assistant_credentials", "assistant_oauth_clients", "assistant_oauth_codes", "assistant_grants", "assistant_refresh_uses", "assistant_invocations", "assistant_attachments"} {
			if err := tx.Exec(`ALTER TABLE "` + table + `" ENABLE ROW LEVEL SECURITY`).Error; err != nil {
				return err
			}
		}
	}
	return nil
}
