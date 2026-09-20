package database

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const CurrentSchemaVersion int64 = 29

const baselineSchemaChecksum = "sha256:open-ai-canvas-schema-v1-20260830"
const schemaMigrationAppliedAtIndexChecksum = "sha256:schema-migrations-applied-at-index-v2-20260830"
const assetTaxonomyCandidateIdentityChecksum = "sha256:asset-taxonomy-candidate-identity-v3-20260831-r1"
const resourceUploadKeyChecksum = "sha256:resource-upload-key-v4-20260901"
const paymentTopupChecksum = "sha256:payment-topup-v5-20260902"
const resourcePlaybackChecksum = "sha256:resource-playback-v6-20260902"
const assetLibraryFoldersChecksum = "sha256:asset-library-folders-v6-20260902"
const logicalModelActiveCodeChecksum = "sha256:logical-model-active-code-v8-20260905"
const creationRuntimeChecksum = "sha256:creation-runtime-v10-20260909"

const postgresSchemaMigrationLockID int64 = 73123910420260830

type SchemaStatus struct {
	Current  int64 `json:"current"`
	Expected int64 `json:"expected"`
	Ready    bool  `json:"ready"`
}

type schemaMigration struct {
	Version   int64     `gorm:"primaryKey"`
	Name      string    `gorm:"size:160;not null"`
	Checksum  string    `gorm:"size:96;not null"`
	AppliedAt time.Time `gorm:"not null"`
}

func (schemaMigration) TableName() string { return "schema_migrations" }

type migration struct {
	version  int64
	name     string
	checksum string
	apply    func(*gorm.DB) error
}

var schemaMigrations = []migration{
	{version: 1, name: "baseline_gorm_schema", checksum: baselineSchemaChecksum, apply: migrateSchemaV1},
	{version: 2, name: "schema_migrations_applied_at_index", checksum: schemaMigrationAppliedAtIndexChecksum, apply: migrateSchemaV2},
	{version: 3, name: "asset_taxonomy_candidate_identity", checksum: assetTaxonomyCandidateIdentityChecksum, apply: migrateSchemaV3},
	{version: 4, name: "resource_upload_key", checksum: resourceUploadKeyChecksum, apply: migrateSchemaV4},
	{version: 5, name: "payment_topup", checksum: paymentTopupChecksum, apply: migrateSchemaV5},
	{version: 6, name: "resource_playback_variant", checksum: resourcePlaybackChecksum, apply: migrateSchemaV6},
	{version: 7, name: "asset_library_folders", checksum: assetLibraryFoldersChecksum, apply: migrateSchemaV7},
	{version: 8, name: "logical_model_active_code", checksum: logicalModelActiveCodeChecksum, apply: migrateSchemaV8},
	{version: 9, name: "channel_presentation", checksum: "sha256:channel-presentation-v9-20260908", apply: migrateChannelPresentation},
	{version: 10, name: "creation_runtime", checksum: creationRuntimeChecksum, apply: migrateSchemaV10},
	{version: 11, name: "cloud_agent_runtime", checksum: "sha256:cloud-agent-runtime-v11-20260912", apply: func(tx *gorm.DB) error { return tx.AutoMigrate(&model.CloudAgentExecution{}) }},
	{version: 12, name: "agent_token_charge_limit", checksum: "sha256:agent-token-charge-limit-v12-20260913", apply: migrateSchemaV12},
	{version: 13, name: "cloud_agent_canvas_mutation", checksum: "sha256:cloud-agent-canvas-mutation-v13-20260913", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.CloudAgentCanvasMutation{})
	}},
	{version: 14, name: "cloud_agent_recovery_control", checksum: "sha256:cloud-agent-recovery-control-v14", apply: migrateSchemaV14},
	{version: 15, name: "agent_profiles", checksum: "sha256:agent-profiles-v15-20260914", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.AgentProfile{})
	}},
	{version: 16, name: "agent_lessons", checksum: "sha256:agent-lessons-v16-20260917", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.AgentLesson{})
	}},
	{version: 17, name: "agent_lessons_owner_index", checksum: "sha256:agent-lessons-owner-index-v17-20260917", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.AgentLesson{})
	}},
	{version: 18, name: "agent_memory_settings", checksum: "sha256:agent-memory-settings-v18-20260917", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.AgentMemorySetting{})
	}},
	{version: 19, name: "payment_plugin_version", checksum: "sha256:payment-plugin-version-v19-20260917", apply: migrateSchemaV19},
	{version: 20, name: "banner_announcements", checksum: "sha256:banner-announcements-v20-20260917", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.BannerAnnouncement{})
	}},
	{version: 21, name: "banner_announcement_title_runs", checksum: "sha256:banner-announcement-title-runs-v21-20260917", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.BannerAnnouncement{})
	}},
	{version: 22, name: "banner_announcement_notice_type", checksum: "sha256:banner-announcement-notice-type-v22-20260917", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.BannerAnnouncement{})
	}},
	{version: 23, name: "canvas_revision_history", checksum: "sha256:canvas-revision-history-v23-20260918", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.CanvasProject{}, &model.CanvasSnapshot{}, &model.CanvasSnapshotResource{})
	}},
	{version: 24, name: "channel_model_label", checksum: "sha256:channel-model-label-v24", apply: migrateChannelModelLabel},
	{version: 25, name: "video_token_formula_snapshot", checksum: "sha256:video-token-formula-snapshot-v25", apply: migrateVideoTokenFormulaSnapshot},
	{version: 26, name: "channel_model_description", checksum: "sha256:channel-model-description-v26", apply: migrateChannelModelDescription},
	{version: 27, name: "channel_credit_cost", checksum: "sha256:channel-credit-cost-v27", apply: migrateChannelCreditCost},
	{version: 28, name: "agent_execution_journal", checksum: "sha256:agent-execution-journal-v28", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.CloudAgentExecution{}, &model.CloudAgentEventRecord{}, &model.CloudAgentMessageRecord{}, &model.Task{}, &model.BillingOrder{})
	}},
	{version: 29, name: "agent_resource_leases", checksum: "sha256:agent-resource-leases-v29-20260919", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.CloudAgentResourceLease{})
	}},
}

func migrateChannelCreditCost(tx *gorm.DB) error {
	for _, entity := range []any{&model.ChannelModelPriceTier{}, &model.BillingOrder{}} {
		for _, column := range []string{"cost_configured", "cost_unit_price_microcredits", "cost_input_token_price_microcredits", "cost_output_token_price_microcredits", "cost_cached_token_price_microcredits"} {
			if !tx.Migrator().HasColumn(entity, column) {
				if err := tx.Migrator().AddColumn(entity, column); err != nil {
					return err
				}
			}
		}
	}
	for _, column := range []string{"CostBillingMode", "CostQuantity", "CostVideoFormulaTokens"} {
		if !tx.Migrator().HasColumn(&model.BillingOrder{}, column) {
			if err := tx.Migrator().AddColumn(&model.BillingOrder{}, column); err != nil {
				return err
			}
		}
	}
	return nil
}

func migrateChannelModelDescription(tx *gorm.DB) error {
	if tx.Migrator().HasColumn(&model.ChannelModel{}, "Description") {
		return nil
	}
	return tx.Migrator().AddColumn(&model.ChannelModel{}, "Description")
}

func migrateVideoTokenFormulaSnapshot(tx *gorm.DB) error {
	for _, field := range []string{"VideoFormulaTokens", "UsageSource"} {
		if !tx.Migrator().HasColumn(&model.BillingOrder{}, field) {
			if err := tx.Migrator().AddColumn(&model.BillingOrder{}, field); err != nil {
				return fmt.Errorf("增加视频 Token 结算字段 %s：%w", field, err)
			}
		}
	}
	return nil
}

func migrateChannelModelLabel(tx *gorm.DB) error {
	if tx.Migrator().HasColumn(&model.ChannelModel{}, "ChannelLabel") {
		return nil
	}
	return tx.Migrator().AddColumn(&model.ChannelModel{}, "ChannelLabel")
}

func migrateSchemaV14(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.CloudAgentExecution{}); err != nil {
		return err
	}
	// Keep cancellation recoverable for executions admitted before this schema.
	// Bound memory while retaining the migration transaction's all-or-nothing semantics.
	after := ""
	for {
		var runs []model.CloudAgentExecution
		if err := tx.Where("id > ? AND status <> ?", after, "completed").Order("id ASC").Limit(100).Find(&runs).Error; err != nil {
			return err
		}
		if len(runs) == 0 {
			return nil
		}
		for _, run := range runs {
			var state struct {
				Request struct {
					CanvasID string `json:"canvasId"`
				} `json:"request"`
				ActiveTaskID string `json:"activeTaskId"`
				MediaTaskID  string `json:"mediaTaskId"`
			}
			// The root task ID is always a safe cancellation anchor. If an old
			// transcript is damaged, retain a durable warning and cancel that
			// root task during recovery instead of blocking the whole deployment.
			updates := map[string]any{"active_task_id": run.ID}
			if err := json.Unmarshal([]byte(run.StateJSON), &state); err != nil {
				updates["failure_message"] = "旧 Agent 运行记录损坏，已保留根任务并进入安全收尾；请核对任务中心"
			} else {
				updates["canvas_id"] = state.Request.CanvasID
				if state.ActiveTaskID != "" {
					updates["active_task_id"] = state.ActiveTaskID
				}
				updates["media_task_id"] = state.MediaTaskID
			}
			if run.Status == "cancelled" || run.Status == "failed" {
				updates["cleanup_pending"] = true
			}
			if err := tx.Model(&model.CloudAgentExecution{}).Where("id = ?", run.ID).Updates(updates).Error; err != nil {
				return err
			}
			after = run.ID
		}
	}
}

func migrateChannelPresentation(tx *gorm.DB) error {
	for _, column := range []struct {
		model any
		field string
	}{{&model.ModelChannel{}, "PublicAlias"}, {&model.ModelChannel{}, "SortOrder"}, {&model.ChannelModel{}, "SortOrder"}} {
		if !tx.Migrator().HasColumn(column.model, column.field) {
			if err := tx.Migrator().AddColumn(column.model, column.field); err != nil {
				return err
			}
		}
	}
	return nil
}

func migrationsForDatabase(db *gorm.DB) ([]migration, error) {
	var applied schemaMigration
	err := db.First(&applied, "version = ?", 6).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return schemaMigrations, nil
	}
	if err != nil {
		return nil, fmt.Errorf("读取数据库迁移 6：%w", err)
	}
	if applied.Name != "asset_library_folders" {
		return schemaMigrations, nil
	}
	legacy := migration{version: 6, name: "asset_library_folders", checksum: assetLibraryFoldersChecksum, apply: migrateSchemaV7}
	if err := validateMigrationRecord(applied, legacy); err != nil {
		return nil, err
	}
	plan := append([]migration(nil), schemaMigrations...)
	for index, item := range plan {
		switch item.version {
		case 6:
			plan[index] = legacy
		case 7:
			plan[index] = migration{version: 7, name: "resource_playback_variant", checksum: resourcePlaybackChecksum, apply: migrateSchemaV6}
		}
	}
	return plan, nil
}

func migrateSchemaV2(tx *gorm.DB) error {
	return tx.Exec("CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at ON schema_migrations (applied_at)").Error
}

func migrateSchemaV3(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.ProjectAssetCandidate{}); err != nil {
		return fmt.Errorf("扩展资产候选身份字段：%w", err)
	}
	if err := tx.Exec("UPDATE assets SET category = 'prop' WHERE category IN ('wardrobe', 'weapon', 'accessory')").Error; err != nil {
		return fmt.Errorf("合并资产道具分类：%w", err)
	}
	if err := tx.Exec("UPDATE assets SET category = 'material' WHERE category = 'style' OR (category = 'other' AND kind IN ('image', 'video', 'audio', 'model'))").Error; err != nil {
		return fmt.Errorf("迁移资产素材分类：%w", err)
	}
	if err := tx.Exec("UPDATE project_asset_candidates SET category = 'prop' WHERE category IN ('wardrobe', 'weapon', 'accessory')").Error; err != nil {
		return fmt.Errorf("合并候选道具分类：%w", err)
	}
	if err := tx.Exec("UPDATE project_asset_candidates SET category = 'material' WHERE category = 'style'").Error; err != nil {
		return fmt.Errorf("迁移候选素材分类：%w", err)
	}
	var candidates []model.ProjectAssetCandidate
	if err := tx.Order("created_at asc, id asc").Find(&candidates).Error; err != nil {
		return fmt.Errorf("读取资产候选身份：%w", err)
	}
	seenPending := make(map[string]string, len(candidates))
	for _, candidate := range candidates {
		nameKey := model.AssetCandidateNameKey(candidate.Name)
		updates := map[string]any{"name_key": nameKey}
		identity := candidate.ProjectID + ":" + string(candidate.Category) + ":" + nameKey
		if candidate.Status == "pending_confirmation" && nameKey != "" {
			if _, exists := seenPending[identity]; exists {
				updates["status"] = "ignored"
			} else {
				seenPending[identity] = candidate.ID
			}
		}
		if err := tx.Model(&model.ProjectAssetCandidate{}).Where("id = ?", candidate.ID).Updates(updates).Error; err != nil {
			return fmt.Errorf("回填资产候选身份 %s：%w", candidate.ID, err)
		}
	}
	return tx.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_project_asset_candidates_pending_identity ON project_asset_candidates(project_id, category, name_key) WHERE status = 'pending_confirmation' AND name_key <> ''").Error
}

func migrateSchemaV4(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&model.Resource{}) {
		return fmt.Errorf("资源表不存在")
	}
	if !tx.Migrator().HasColumn(&model.Resource{}, "upload_key") {
		if err := tx.Migrator().AddColumn(&model.Resource{}, "UploadKey"); err != nil {
			return fmt.Errorf("增加资源上传幂等列：%w", err)
		}
	}
	if err := tx.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_resources_user_upload_key ON resources (user_id, upload_key)").Error; err != nil {
		return fmt.Errorf("创建资源上传幂等索引：%w", err)
	}
	return nil
}
func migrateSchemaV5(tx *gorm.DB) error {
	if err := tx.AutoMigrate(
		&model.CreditLedgerEntry{},
		&model.TopupProduct{},
		&model.PaymentProviderConfig{},
		&model.PaymentOrder{},
		&model.PaymentNotification{},
		&model.PaymentReconciliationRun{},
		&model.PaymentReconciliationItem{},
	); err != nil {
		return fmt.Errorf("创建积分支付与对账结构：%w", err)
	}
	return nil
}

func migrateSchemaV19(tx *gorm.DB) error {
	for _, value := range []any{&model.PaymentProviderConfig{}, &model.PaymentOrder{}} {
		if !tx.Migrator().HasTable(value) {
			continue
		}
		if err := addPaymentPluginVersionColumn(tx, value); err != nil {
			return err
		}
	}
	return nil
}

func addPaymentPluginVersionColumn(tx *gorm.DB, value any) error {
	if tx.Migrator().HasColumn(value, "plugin_version") {
		return nil
	}
	if err := tx.Migrator().AddColumn(value, "PluginVersion"); err != nil {
		return fmt.Errorf("增加支付插件版本列：%w", err)
	}
	return nil
}

func migrateSchemaV6(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&model.Resource{}) {
		return fmt.Errorf("资源表不存在")
	}
	if !tx.Migrator().HasColumn(&model.Resource{}, "playback_status") {
		if err := tx.Migrator().AddColumn(&model.Resource{}, "PlaybackStatus"); err != nil {
			return fmt.Errorf("增加播放副本状态列：%w", err)
		}
	}
	if !tx.Migrator().HasColumn(&model.Resource{}, "playback_object_key") {
		if err := tx.Migrator().AddColumn(&model.Resource{}, "PlaybackObjectKey"); err != nil {
			return fmt.Errorf("增加播放副本对象键列：%w", err)
		}
	}
	if !tx.Migrator().HasColumn(&model.Resource{}, "playback_error") {
		if err := tx.Migrator().AddColumn(&model.Resource{}, "PlaybackError"); err != nil {
			return fmt.Errorf("增加播放副本错误列：%w", err)
		}
	}
	return nil
}

func migrateSchemaV7(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.Asset{}, &model.AssetFolder{}); err != nil {
		return fmt.Errorf("创建个人素材分类并扩展素材目录字段：%w", err)
	}
	return nil
}

func migrateSchemaV8(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&model.LogicalModel{}) {
		return nil
	}
	if err := tx.Exec("DROP INDEX IF EXISTS idx_logical_models_code").Error; err != nil {
		return fmt.Errorf("移除前台模型旧 code 唯一索引：%w", err)
	}
	if err := tx.Exec("CREATE UNIQUE INDEX idx_logical_models_code ON logical_models(code) WHERE archived_at IS NULL").Error; err != nil {
		return fmt.Errorf("创建前台模型活动 code 唯一索引：%w", err)
	}
	return nil
}

// migrateSchemaV10 只增加创作运行时表和任务幂等关联；旧任务的空 submission ID 必须继续合法。
func migrateSchemaV10(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.CreationRun{}, &model.CreationSubmission{}, &model.Task{}); err != nil {
		return fmt.Errorf("创建创作运行时结构：%w", err)
	}
	return nil
}

// migrateSchemaV12 为 Agent 的 Token 计费增加最终扣费上限；旧账单保持 0，继续沿用既有按 usage 结算语义。
func migrateSchemaV12(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&model.BillingOrder{}) {
		return nil
	}
	if tx.Migrator().HasColumn(&model.BillingOrder{}, "ChargeLimitMicrocredits") {
		return nil
	}
	if err := tx.Migrator().AddColumn(&model.BillingOrder{}, "ChargeLimitMicrocredits"); err != nil {
		return fmt.Errorf("增加 Agent Token 扣费上限列：%w", err)
	}
	return nil
}

func MigrateSchema(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if tx.Dialector.Name() == "postgres" {
			if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", postgresSchemaMigrationLockID).Error; err != nil {
				return fmt.Errorf("获取数据库迁移锁：%w", err)
			}
		}
		if err := tx.AutoMigrate(&schemaMigration{}); err != nil {
			return fmt.Errorf("初始化数据库迁移记录：%w", err)
		}
		plan, err := migrationsForDatabase(tx)
		if err != nil {
			return err
		}
		for _, item := range plan {
			var applied schemaMigration
			err := tx.First(&applied, "version = ?", item.version).Error
			if err == nil {
				if err := validateMigrationRecord(applied, item); err != nil {
					return err
				}
				continue
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return fmt.Errorf("读取数据库迁移 %d：%w", item.version, err)
			}
			if err := item.apply(tx); err != nil {
				return fmt.Errorf("执行数据库迁移 %d（%s）：%w", item.version, item.name, err)
			}
			record := schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now().UTC()}
			if err := tx.Create(&record).Error; err != nil {
				return fmt.Errorf("记录数据库迁移 %d：%w", item.version, err)
			}
		}
		return RequireSchemaVersion(tx)
	})
}

func ReadSchemaStatus(db *gorm.DB) (SchemaStatus, error) {
	status := SchemaStatus{Expected: CurrentSchemaVersion}
	if !db.Migrator().HasTable(&schemaMigration{}) {
		return status, nil
	}
	if err := db.Model(&schemaMigration{}).Select("COALESCE(MAX(version), 0)").Scan(&status.Current).Error; err != nil {
		return status, fmt.Errorf("读取数据库结构版本：%w", err)
	}
	if status.Current != status.Expected {
		return status, nil
	}
	if err := validateMigrationRecords(db); err != nil {
		return status, err
	}
	status.Ready = true
	return status, nil
}

func validateMigrationRecords(db *gorm.DB) error {
	plan, err := migrationsForDatabase(db)
	if err != nil {
		return err
	}
	for _, item := range plan {
		var applied schemaMigration
		if err := db.First(&applied, "version = ?", item.version).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return fmt.Errorf("数据库缺少迁移记录 %d（%s）", item.version, item.name)
			}
			return fmt.Errorf("读取数据库迁移 %d：%w", item.version, err)
		}
		if err := validateMigrationRecord(applied, item); err != nil {
			return err
		}
	}
	return nil
}

func validateMigrationRecord(applied schemaMigration, expected migration) error {
	if applied.Name != expected.name {
		return fmt.Errorf("数据库迁移 %d 名称不一致：记录为 %s，程序期望 %s", expected.version, applied.Name, expected.name)
	}
	if applied.Checksum != expected.checksum {
		return fmt.Errorf("数据库迁移 %d 校验和不一致：记录为 %s，程序期望 %s", expected.version, applied.Checksum, expected.checksum)
	}
	return nil
}

func RequireSchemaVersion(db *gorm.DB) error {
	status, err := ReadSchemaStatus(db)
	if err != nil {
		return err
	}
	if status.Current < status.Expected {
		return fmt.Errorf("数据库结构版本过旧：当前 %d，程序要求 %d，请先执行 migrate-schema up", status.Current, status.Expected)
	}
	if status.Current > status.Expected {
		return fmt.Errorf("数据库结构版本 %d 高于程序支持的 %d，拒绝使用旧程序连接新数据库", status.Current, status.Expected)
	}
	return nil
}
