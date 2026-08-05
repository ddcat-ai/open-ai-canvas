package database

import (
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

// Models 是应用持久化表的唯一清单，服务启动和跨数据库迁移必须共用它。
func Models() []any {
	return []any{
		&model.User{},
		&model.AuthSession{},
		&model.UserIdentity{},
		&model.OAuthState{},
		&model.EmailVerificationCode{},
		&model.ModelChannel{},
		&model.ChannelModel{},
		&model.ApiCallLog{},
		&model.ModelPricing{},
		&model.CreditAccount{},
		&model.CreditLedgerEntry{},
		&model.BillingOrder{},
		&model.RedeemBatch{},
		&model.RedeemCode{},
		&model.AdminAuditEvent{},
		&model.UserDailyActivity{},
		&model.SystemSetting{},
		&model.UserOSSSetting{},
		&model.UserDailyUploadUsage{},
		&model.Skill{},
		&model.UserSkillState{},
		&model.Resource{},
		&model.Asset{},
		&model.ProjectAssetLink{},
		&model.ProjectAssetCandidate{},
		&model.AssetVersion{},
		&model.AssetRepresentation{},
		&model.VoiceProfile{},
		&model.CharacterVoiceBinding{},
		&model.Project{},
		&model.ProjectUnit{},
		&model.CanvasUnitLink{},
		&model.Shot{},
		&model.ShotAssetReference{},
		&model.WorkflowTemplateVersion{},
		&model.WorkflowInstance{},
		&model.WorkflowStepInstance{},
		&model.WorkflowStepTask{},
		&model.CanvasProject{},
		&model.CanvasShare{},
		&model.PromptTemplate{},
		&model.UserPromptCustomization{},
		&model.Announcement{},
		&model.UserAnnouncementRead{},
		&model.Task{},
		&model.Session{},
		&model.Message{},
		&model.TaskLog{},
		&model.TaskTextChunk{},
		&model.SessionFile{},
		&model.Result{},
	}
}

func MigrateSchema(db *gorm.DB) error {
	// 旧表只保存 Updream 目录状态，与本地技能主键没有可迁移关系；首次升级时按产品要求清空重建。
	if db.Migrator().HasColumn(&model.UserSkillState{}, "skill_dir") && !db.Migrator().HasColumn(&model.UserSkillState{}, "skill_id") {
		if err := db.Migrator().DropTable(&model.UserSkillState{}); err != nil {
			return err
		}
	}
	if err := db.AutoMigrate(Models()...); err != nil {
		return err
	}
	// 逻辑删除后的同名模型允许重新添加，旧唯一索引不能继续覆盖已删除记录。
	if err := db.Exec("DROP INDEX IF EXISTS idx_channel_model_key").Error; err != nil {
		return err
	}
	if err := db.Exec("DROP INDEX IF EXISTS idx_users_email").Error; err != nil {
		return err
	}
	if err := db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nonempty ON users(lower(email)) WHERE email <> ''").Error; err != nil {
		return err
	}
	return db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_user_submission_nonempty ON tasks(user_id, submission_id) WHERE submission_id <> ''").Error
}
