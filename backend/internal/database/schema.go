package database

import (
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"

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
		&model.ChannelModelPriceTier{},
		&model.IDSequence{},
		&model.LogicalModel{},
		&model.LogicalModelRevision{},
		&model.LogicalModelRoute{},
		&model.RouteAttempt{},
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
		&model.ArkPrivateAssetBinding{},
		&model.UserOSSSetting{},
		&model.UserDailyUploadUsage{},
		&model.Skill{},
		&model.UserSkillState{},
		&model.Resource{},
		&model.ResourceDeletionJob{},
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
	if err := migrateLogicalRoutesToChannelModels(db); err != nil {
		return err
	}
	if err := db.AutoMigrate(Models()...); err != nil {
		return err
	}
	if err := migrateChannelModelPriceTierSelectors(db); err != nil {
		return err
	}
	if err := backfillChannelModelPriceTiers(db); err != nil {
		return err
	}
	if err := migrateChannelModelPriceTierSelectors(db); err != nil {
		return err
	}
	if err := dropLegacyPhysicalVariants(db); err != nil {
		return err
	}
	// 为升级前已存在的逻辑模型回填版本序列，避免首次保存时从 0 重新分配。
	if err := db.Exec(`UPDATE logical_models SET revision_sequence = COALESCE((SELECT MAX(version) FROM logical_model_revisions WHERE logical_model_id = logical_models.id), 0) WHERE revision_sequence = 0`).Error; err != nil {
		return err
	}
	// 逻辑删除后的同名模型允许重新添加，旧唯一索引不能继续覆盖已删除记录。
	if err := db.Exec("DROP INDEX IF EXISTS idx_channel_model_key").Error; err != nil {
		return err
	}
	if err := db.Exec("DROP INDEX IF EXISTS idx_users_email").Error; err != nil {
		return err
	}
	if err := db.Exec("DROP INDEX IF EXISTS idx_route_attempt_task_number").Error; err != nil {
		return err
	}
	if err := db.Exec("DROP INDEX IF EXISTS idx_logical_model_source_active").Error; err != nil {
		return err
	}
	if err := db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_logical_model_source_active ON logical_models(source_channel_model_id) WHERE source_channel_model_id <> '' AND archived_at IS NULL").Error; err != nil {
		return err
	}
	return db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nonempty ON users(lower(email)) WHERE email <> ''").Error
}

// migrateChannelModelPriceTierSelectors upgrades the old video-only unique key to
// a canonical SKU selector key. It never changes task, route-attempt, or billing
// foreign keys, so completed work remains auditable after a product SKU merge.
func migrateChannelModelPriceTierSelectors(db *gorm.DB) error {
	if !db.Migrator().HasTable(&model.ChannelModelPriceTier{}) {
		return nil
	}
	var tiers []model.ChannelModelPriceTier
	if err := db.Unscoped().Find(&tiers).Error; err != nil {
		return fmt.Errorf("读取规格价格档：%w", err)
	}
	for _, tier := range tiers {
		selector := model.DecodeSKUSelector(tier.SelectorJSON)
		if len(selector) == 0 {
			selector = map[string]string{}
			if resolution := strings.TrimSpace(tier.Resolution); resolution != "" && resolution != "*" {
				selector["vquality"] = strings.ToLower(resolution)
			}
			if tier.VideoSeconds > 0 {
				selector["videoSeconds"] = strconv.Itoa(tier.VideoSeconds)
			}
		}
		_, key, err := model.CanonicalSKUSelector(selector)
		if err != nil {
			return fmt.Errorf("规范化规格价格档 %s：%w", tier.ID, err)
		}
		if tier.SelectorKey == key && tier.SelectorJSON == key {
			continue
		}
		if err := db.Unscoped().Model(&model.ChannelModelPriceTier{}).Where("id = ?", tier.ID).Updates(map[string]any{"selector_key": key, "selector_json": key}).Error; err != nil {
			return fmt.Errorf("更新规格价格档 %s：%w", tier.ID, err)
		}
	}
	var duplicate struct {
		ChannelModelID string
		SelectorKey    string
		Count          int64
	}
	err := db.Table("channel_model_price_tiers").
		Select("channel_model_id, selector_key, COUNT(*) AS count").
		Where("deleted_at IS NULL").
		Group("channel_model_id, selector_key").
		Having("COUNT(*) > 1").
		First(&duplicate).Error
	if err == nil {
		return fmt.Errorf("渠道模型 %s 存在重复 SKU 选择器 %s，拒绝建立唯一索引", duplicate.ChannelModelID, duplicate.SelectorKey)
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("检查重复 SKU 选择器：%w", err)
	}
	if err := db.Exec("DROP INDEX IF EXISTS idx_channel_model_price_tier_active").Error; err != nil {
		return err
	}
	return db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_model_price_tier_active ON channel_model_price_tiers(channel_model_id, selector_key) WHERE deleted_at IS NULL").Error
}

// backfillChannelModelPriceTiers 将旧的单价模型无损映射为默认价格档。历史订单保存的是
// 金额快照，不能也不需要回写；这里仅保证升级后现有渠道模型仍能按原价格继续结算。
func backfillChannelModelPriceTiers(db *gorm.DB) error {
	var channelModels []model.ChannelModel
	if err := db.Find(&channelModels).Error; err != nil {
		return fmt.Errorf("读取渠道模型价格档回填数据：%w", err)
	}
	for _, channelModel := range channelModels {
		var count int64
		if err := db.Model(&model.ChannelModelPriceTier{}).Where("channel_model_id = ?", channelModel.ID).Count(&count).Error; err != nil {
			return fmt.Errorf("检查渠道模型 %s 价格档：%w", channelModel.ID, err)
		}
		if count > 0 {
			continue
		}
		priceVersion := channelModel.PriceVersion
		if priceVersion < 1 {
			priceVersion = 1
		}
		digest := sha256.Sum256([]byte(channelModel.ID))
		tier := model.ChannelModelPriceTier{
			ID:                           fmt.Sprintf("PTIER-%x", digest[:15]),
			ChannelModelID:               channelModel.ID,
			Resolution:                   "*",
			VideoSeconds:                 0,
			ProviderModelKey:             channelModel.ProviderModelKey,
			BillingMode:                  channelModel.BillingMode,
			UnitPriceMicrocredits:        channelModel.UnitPriceMicrocredits,
			InputTokenPriceMicrocredits:  channelModel.InputTokenPriceMicrocredits,
			OutputTokenPriceMicrocredits: channelModel.OutputTokenPriceMicrocredits,
			CachedTokenPriceMicrocredits: channelModel.CachedTokenPriceMicrocredits,
			PriceConfigured:              channelModel.PriceConfigured,
			Enabled:                      channelModel.Enabled,
			PriceVersion:                 priceVersion,
		}
		if err := db.Create(&tier).Error; err != nil {
			return fmt.Errorf("回填渠道模型 %s 默认价格档：%w", channelModel.ID, err)
		}
	}
	return nil
}

// migrateLogicalRoutesToChannelModels 在模型结构切换前把历史 variant 外键转换为渠道模型外键。
// 写路径不能接受无法映射的历史引用，否则任务恢复和计费会失去明确执行目标。
func migrateLogicalRoutesToChannelModels(db *gorm.DB) error {
	legacyTargets := []any{
		&model.LogicalModelRoute{},
		&model.Task{},
		&model.RouteAttempt{},
	}
	legacyReferenceFound := false
	for _, target := range legacyTargets {
		if db.Migrator().HasTable(target) && db.Migrator().HasColumn(target, "physical_variant_id") {
			legacyReferenceFound = true
			break
		}
	}
	if !db.Migrator().HasTable("physical_capability_variants") {
		if legacyReferenceFound {
			return fmt.Errorf("发现历史可用配置引用，但 physical_capability_variants 表不存在，拒绝继续迁移")
		}
		return nil
	}
	for _, target := range []struct {
		table any
		field string
	}{
		{table: &model.LogicalModelRoute{}, field: "ChannelModelID"},
		{table: &model.RouteAttempt{}, field: "ChannelModelID"},
		{table: &model.Task{}, field: "ChannelModelID"},
	} {
		if db.Migrator().HasTable(target.table) && !db.Migrator().HasColumn(target.table, target.field) {
			if err := db.Migrator().AddColumn(target.table, target.field); err != nil {
				return fmt.Errorf("新增渠道模型迁移列 %T.%s：%w", target.table, target.field, err)
			}
		}
	}

	if db.Migrator().HasTable(&model.LogicalModelRoute{}) && db.Migrator().HasColumn(&model.LogicalModelRoute{}, "physical_variant_id") {
		if err := db.Exec(`UPDATE logical_model_routes
			SET channel_model_id = (SELECT channel_model_id FROM physical_capability_variants WHERE id = logical_model_routes.physical_variant_id)
			WHERE COALESCE(channel_model_id, '') = '' AND COALESCE(physical_variant_id, '') <> ''`).Error; err != nil {
			return fmt.Errorf("回填供应线路渠道模型：%w", err)
		}
		if err := ensureLegacyReferencesMapped(db, "logical_model_routes", "physical_variant_id", "channel_model_id"); err != nil {
			return err
		}
	}

	if db.Migrator().HasTable(&model.Task{}) && db.Migrator().HasColumn(&model.Task{}, "physical_variant_id") {
		if err := db.Exec(`UPDATE tasks
			SET channel_model_id = (SELECT channel_model_id FROM physical_capability_variants WHERE id = tasks.physical_variant_id)
			WHERE COALESCE(channel_model_id, '') = '' AND COALESCE(physical_variant_id, '') <> ''`).Error; err != nil {
			return fmt.Errorf("回填任务渠道模型：%w", err)
		}
		if err := ensureLegacyReferencesMapped(db, "tasks", "physical_variant_id", "channel_model_id"); err != nil {
			return err
		}
	}

	if db.Migrator().HasTable(&model.RouteAttempt{}) && db.Migrator().HasColumn(&model.RouteAttempt{}, "physical_variant_id") {
		if err := db.Exec(`UPDATE route_attempts
			SET channel_model_id = (SELECT channel_model_id FROM physical_capability_variants WHERE id = route_attempts.physical_variant_id)
			WHERE COALESCE(channel_model_id, '') = '' AND COALESCE(physical_variant_id, '') <> ''`).Error; err != nil {
			return fmt.Errorf("回填路由尝试渠道模型：%w", err)
		}
		if err := ensureLegacyReferencesMapped(db, "route_attempts", "physical_variant_id", "channel_model_id"); err != nil {
			return err
		}
	}
	for _, target := range []struct {
		table  any
		name   string
		column string
	}{
		{table: &model.LogicalModelRoute{}, name: "logical_model_routes", column: "channel_model_id"},
		{table: &model.Task{}, name: "tasks", column: "channel_model_id"},
		{table: &model.RouteAttempt{}, name: "route_attempts", column: "channel_model_id"},
	} {
		if db.Migrator().HasTable(target.table) && db.Migrator().HasColumn(target.table, target.column) {
			if err := ensureChannelModelReferencesExist(db, target.name, target.column); err != nil {
				return err
			}
		}
	}
	if db.Migrator().HasTable(&model.LogicalModelRoute{}) && db.Migrator().HasColumn(&model.LogicalModelRoute{}, "channel_model_id") {
		if err := ensureLogicalRouteMembersUnique(db); err != nil {
			return err
		}
	}
	if db.Migrator().HasTable(&model.LogicalModelRoute{}) && db.Migrator().HasColumn(&model.LogicalModelRoute{}, "physical_variant_id") {
		if err := db.Exec("DROP INDEX IF EXISTS idx_logical_route_member").Error; err != nil {
			return fmt.Errorf("删除旧供应线路唯一索引：%w", err)
		}
	}
	return nil
}

func ensureLegacyReferencesMapped(db *gorm.DB, table string, legacyColumn string, targetColumn string) error {
	var count int64
	query := fmt.Sprintf(
		`SELECT COUNT(*) FROM %s WHERE COALESCE(%s, '') <> '' AND COALESCE(%s, '') = ''`,
		table,
		legacyColumn,
		targetColumn,
	)
	if err := db.Raw(query).Scan(&count).Error; err != nil {
		return fmt.Errorf("检查 %s 历史渠道模型映射：%w", table, err)
	}
	if count > 0 {
		return fmt.Errorf("%s 存在 %d 条无法映射到渠道模型的历史引用", table, count)
	}
	query = fmt.Sprintf(
		`SELECT COUNT(*) FROM %s AS source
		LEFT JOIN physical_capability_variants AS legacy ON legacy.id = source.%s
		WHERE COALESCE(source.%s, '') <> '' AND (legacy.id IS NULL OR source.%s <> legacy.channel_model_id)`,
		table,
		legacyColumn,
		legacyColumn,
		targetColumn,
	)
	if err := db.Raw(query).Scan(&count).Error; err != nil {
		return fmt.Errorf("核对 %s 历史渠道模型映射：%w", table, err)
	}
	if count > 0 {
		return fmt.Errorf("%s 存在与历史可用配置不一致的渠道模型引用", table)
	}
	return nil
}

func ensureChannelModelReferencesExist(db *gorm.DB, table string, targetColumn string) error {
	var count int64
	query := fmt.Sprintf(
		`SELECT COUNT(*) FROM %s AS source
		LEFT JOIN channel_models AS channel_model ON channel_model.id = source.%s
		WHERE COALESCE(source.%s, '') <> '' AND channel_model.id IS NULL`,
		table,
		targetColumn,
		targetColumn,
	)
	if err := db.Raw(query).Scan(&count).Error; err != nil {
		return fmt.Errorf("检查 %s 渠道模型引用：%w", table, err)
	}
	if count > 0 {
		return fmt.Errorf("%s 存在 %d 条指向不存在渠道模型的历史引用", table, count)
	}
	return nil
}

func ensureLogicalRouteMembersUnique(db *gorm.DB) error {
	var count int64
	if err := db.Raw(`SELECT COUNT(*) FROM (
		SELECT logical_model_revision_id, channel_model_id
		FROM logical_model_routes
		WHERE COALESCE(channel_model_id, '') <> ''
		GROUP BY logical_model_revision_id, channel_model_id
		HAVING COUNT(*) > 1
	) AS duplicate_routes`).Scan(&count).Error; err != nil {
		return fmt.Errorf("检查供应线路重复渠道模型：%w", err)
	}
	if count > 0 {
		return fmt.Errorf("历史供应线路存在 %d 组同一版本重复引用同一渠道模型的数据，请先清理后再迁移", count)
	}
	return nil
}

func dropLegacyPhysicalVariants(db *gorm.DB) error {
	if db.Migrator().HasColumn(&model.LogicalModelRoute{}, "physical_variant_id") {
		if err := db.Exec("DROP INDEX IF EXISTS idx_logical_route_member").Error; err != nil {
			return fmt.Errorf("删除供应线路迁移索引：%w", err)
		}
		if err := db.Migrator().DropColumn(&model.LogicalModelRoute{}, "physical_variant_id"); err != nil {
			return fmt.Errorf("删除供应线路可用配置列：%w", err)
		}
	}
	if db.Migrator().HasColumn(&model.Task{}, "physical_variant_id") {
		if err := db.Migrator().DropColumn(&model.Task{}, "physical_variant_id"); err != nil {
			return fmt.Errorf("删除任务可用配置列：%w", err)
		}
	}
	if db.Migrator().HasColumn(&model.RouteAttempt{}, "physical_variant_id") {
		if err := db.Migrator().DropColumn(&model.RouteAttempt{}, "physical_variant_id"); err != nil {
			return fmt.Errorf("删除路由尝试可用配置列：%w", err)
		}
	}
	if db.Migrator().HasTable("physical_capability_variants") {
		if err := db.Migrator().DropTable("physical_capability_variants"); err != nil {
			return fmt.Errorf("删除可用配置表：%w", err)
		}
	}
	return db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_logical_route_member ON logical_model_routes(logical_model_revision_id, channel_model_id)`).Error
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
