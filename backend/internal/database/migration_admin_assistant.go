package database

import (
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

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
