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
		&model.UserSkillState{},
		&model.Resource{},
		&model.Asset{},
		&model.Project{},
		&model.ProjectUnit{},
		&model.CanvasUnitLink{},
		&model.CanvasProject{},
		&model.CanvasShare{},
		&model.StoryboardPromptTemplate{},
		&model.Announcement{},
		&model.UserAnnouncementRead{},
		&model.Task{},
		&model.Session{},
		&model.Message{},
		&model.TaskLog{},
		&model.SessionFile{},
		&model.Result{},
	}
}

func MigrateSchema(db *gorm.DB) error {
	if err := db.AutoMigrate(Models()...); err != nil {
		return err
	}
	if err := db.Exec("DROP INDEX IF EXISTS idx_users_email").Error; err != nil {
		return err
	}
	return db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nonempty ON users(lower(email)) WHERE email <> ''").Error
}
