package database

import (
	"database/sql"
	"errors"
	"fmt"

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
		&model.ProjectAssetFolder{},
		&model.ProjectAssetCandidate{},
		&model.AssetVersion{},
		&model.AssetRepresentation{},
		&model.VoiceProfile{},
		&model.CharacterVoiceBinding{},
		&model.Project{},
		&model.StyleProfile{},
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
		&model.TaskTextDelta{},
		&model.Session{},
		&model.Message{},
		&model.TaskLog{},
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
	if err := widenPostgresAssetIDColumns(db); err != nil {
		return err
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
	return db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nonempty ON users(lower(email)) WHERE email <> ''").Error
}

type varcharColumnMigration struct {
	table     string
	column    string
	statement string
}

var assetIDColumnMigrations = []varcharColumnMigration{
	{table: "assets", column: "id", statement: `ALTER TABLE "assets" ALTER COLUMN "id" TYPE varchar(80)`},
	{table: "project_asset_links", column: "asset_id", statement: `ALTER TABLE "project_asset_links" ALTER COLUMN "asset_id" TYPE varchar(80)`},
	{table: "project_asset_candidates", column: "resolved_asset_id", statement: `ALTER TABLE "project_asset_candidates" ALTER COLUMN "resolved_asset_id" TYPE varchar(80)`},
	{table: "asset_versions", column: "asset_id", statement: `ALTER TABLE "asset_versions" ALTER COLUMN "asset_id" TYPE varchar(80)`},
}

// PostgreSQL Migrator 跳过主键列变更，素材 ID 扩容必须在 AutoMigrate 前显式执行。
func widenPostgresAssetIDColumns(db *gorm.DB) error {
	if db.Dialector.Name() != "postgres" {
		return nil
	}
	for _, migration := range assetIDColumnMigrations {
		var currentLength sql.NullInt64
		err := db.Raw(
			"SELECT character_maximum_length FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?",
			migration.table,
			migration.column,
		).Row().Scan(&currentLength)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return fmt.Errorf("检查 PostgreSQL 素材 ID 列 %s.%s：%w", migration.table, migration.column, err)
		}
		if !currentLength.Valid || currentLength.Int64 >= model.AssetIDMaxLength {
			continue
		}
		if err := db.Exec(migration.statement).Error; err != nil {
			return fmt.Errorf("扩容 PostgreSQL 素材 ID 列 %s.%s：%w", migration.table, migration.column, err)
		}
	}
	return nil
}
