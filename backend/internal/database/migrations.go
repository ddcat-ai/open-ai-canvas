package database

import (
	"errors"
	"fmt"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

// CurrentSchemaVersion = 9：影策 fork 与上游迁移编号在此分叉（D-053）。
// 本地生产库已应用 6=asset_library_folders、7=shot_task_chain（W1-01），
// 上游 main 在 v1.2.5 后将 6 改派 resource_playback_variant 并把 folders 挪到 7。
// 为免生产库记录作废，fork 保留自有编号，上游两个新迁移顺延为 8/9。
const CurrentSchemaVersion int64 = 9

const baselineSchemaChecksum = "sha256:open-ai-canvas-schema-v1-20260830"
const schemaMigrationAppliedAtIndexChecksum = "sha256:schema-migrations-applied-at-index-v2-20260830"
const assetTaxonomyCandidateIdentityChecksum = "sha256:asset-taxonomy-candidate-identity-v3-20260831-r1"
const resourceUploadKeyChecksum = "sha256:resource-upload-key-v4-20260901"
const paymentTopupChecksum = "sha256:payment-topup-v5-20260902"
const resourcePlaybackChecksum = "sha256:resource-playback-v6-20260902"
const assetLibraryFoldersChecksum = "sha256:asset-library-folders-v6-20260902"
const shotTaskChainChecksum = "sha256:shot-task-chain-v7-20260904"
const logicalModelActiveCodeChecksum = "sha256:logical-model-active-code-v8-20260905"

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
	{version: 6, name: "asset_library_folders", checksum: assetLibraryFoldersChecksum, apply: migrateSchemaAssetLibraryFolders},
	{version: 7, name: "shot_task_chain", checksum: shotTaskChainChecksum, apply: migrateSchemaShotTaskChain},
	{version: 8, name: "resource_playback_variant", checksum: resourcePlaybackChecksum, apply: migrateSchemaResourcePlaybackVariant},
	{version: 9, name: "logical_model_active_code", checksum: logicalModelActiveCodeChecksum, apply: migrateSchemaLogicalModelActiveCode},
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

// migrateSchemaResourcePlaybackVariant：上游原编号 v6，fork 顺延为 8。
func migrateSchemaResourcePlaybackVariant(tx *gorm.DB) error {
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

// migrateSchemaAssetLibraryFolders：上游原编号 v6（v1.2.5 发布）/ v7（main 重排），fork 定格在 6。
func migrateSchemaAssetLibraryFolders(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.Asset{}, &model.AssetFolder{}); err != nil {
		return fmt.Errorf("创建个人素材分类并扩展素材目录字段：%w", err)
	}
	return nil
}

// migrateSchemaShotTaskChain 打通影策 2.0 的生成任务链（W1-01，决策 D-008/D-009/D-020~D-026）：
//   - 扩列：tasks（shot_id/canvas_node_id/workflow_step_id）
//           comfy_bridge_requests（generation_task_id/shot_id/canvas_node_id/attempt_no/comfy_prompt_id/error_code）
//           shots（canvas_node_id/semantic_type/latest_* 指针）
//           shot_artifacts（request_id/asset_index/checksum/file_size/provider/duration_ms/width/height）
//           workflow_template_versions（workflow_hash/capabilities_json/mapping_json/H3 约束/enabled）
//   - 老数据归一：attempt_no 空值补 1、历史 claimed 状态映射为 running、模板版本 enabled 补 true
//
// D-026（并轨）：本迁移**不新建任何表**。后端已有完整生产域模型
// （Shot / ShotArtifact / WorkflowTemplateVersion / ProductionTaskLink），
// 初版方案另建 shot_registry / output_assets / bridge_workflows 属于重复造轮子（Q-09），已推翻。
// D-020：不新建 comfy_jobs 表——ComfyBridgeRequest 即 ComfyJob 的持久化实现。
func migrateSchemaShotTaskChain(tx *gorm.DB) error {
	// 为什么每一步都要先检查表是否存在：
	// 单元测试（如 TestMigrateSchemaV4AddsResourceUploadKeyToExistingSchema）会构造**精简老 schema**
	// ——它只建了迁移目标相关的少数几张表，根本没有 tasks / shots 等。
	// 迁移必须能在这类库上跑通，否则老库升级会直接崩。缺表就跳过该表的扩列与索引。
	addColumn := func(target any, column string) error {
		if !tx.Migrator().HasTable(target) {
			return nil
		}
		if tx.Migrator().HasColumn(target, column) {
			return nil
		}
		if err := tx.Migrator().AddColumn(target, column); err != nil {
			return fmt.Errorf("扩展 %s：%w", column, err)
		}
		return nil
	}

	type columnPlan struct {
		target   any
		columns  []string
		describe string
	}
	for _, plan := range []columnPlan{
		{&model.Task{}, []string{"ShotID", "CanvasNodeID", "WorkflowStepID", "AgentSessionID", "AgentTurnID"}, "任务链归属与 Agent 溯源（D-031）"},
		{&model.ComfyBridgeRequest{}, []string{"GenerationTaskID", "ShotID", "CanvasNodeID", "AttemptNo", "ComfyPromptID", "ErrorCode"}, "Bridge 任务链字段"},
		{&model.Shot{}, []string{"CanvasNodeID", "SemanticType", "LatestTaskID", "LatestJobID", "LatestArtifactID"}, "分镜 Canvas 绑定与最新指针"},
		{&model.ShotArtifact{}, []string{"RequestID", "AssetIndex", "Checksum", "FileSize", "Provider", "DurationMs", "Width", "Height"}, "产物生成侧溯源"},
		{&model.WorkflowTemplateVersion{}, []string{"WorkflowHash", "CapabilitiesJSON", "MappingJSON", "MaxSegmentDurationSec", "MaxTimelineDurationSec", "MaxFramesPerSegment", "Enabled"}, "模板 Bridge 执行元数据"},
	} {
		for _, column := range plan.columns {
			if err := addColumn(plan.target, column); err != nil {
				return fmt.Errorf("%s：%w", plan.describe, err)
			}
		}
	}

	// 索引必须检查错误：否则“建表成功、索引失败”会被误判为迁移成功。
	// 幂等键一律用**部分唯一索引**（WHERE 值 <> ''）：历史行这些列为空串，
	// 直接建唯一索引会让所有空值行互相冲突，迁移必然失败。
	for _, index := range []struct {
		table    string
		sql      string
		describe string
	}{
		{"comfy_bridge_requests", "CREATE INDEX IF NOT EXISTS idx_cbr_shot ON comfy_bridge_requests (shot_id, created_at)", "Bridge 请求按分镜查询"},
		{"comfy_bridge_requests", "CREATE INDEX IF NOT EXISTS idx_cbr_node ON comfy_bridge_requests (canvas_node_id)", "Bridge 请求按节点查询"},
		{"tasks", "CREATE INDEX IF NOT EXISTS idx_task_shot ON tasks (shot_id)", "任务按分镜查询"},
		{"tasks", "CREATE INDEX IF NOT EXISTS idx_task_node ON tasks (canvas_node_id)", "任务按节点查询"},
		{"tasks", "CREATE INDEX IF NOT EXISTS idx_task_step ON tasks (workflow_step_id)", "任务按工作流步骤查询"},
		// D-038：agent_turn_id 不加 UNIQUE——不同 Runtime 的 turn ID 格式与唯一性不保证。
		{"tasks", "CREATE INDEX IF NOT EXISTS idx_task_agent_session ON tasks (agent_session_id)", "任务按 Agent 会话查询"},
		{"tasks", "CREATE INDEX IF NOT EXISTS idx_task_agent_turn ON tasks (agent_turn_id)", "任务按 Agent turn 查询"},
		{"shots", "CREATE INDEX IF NOT EXISTS idx_shots_canvas_node ON shots (canvas_node_id)", "分镜按节点查询"},
		{"shot_artifacts", "CREATE INDEX IF NOT EXISTS idx_shot_artifacts_request ON shot_artifacts (request_id)", "产物按请求查询"},
		{"shots", "CREATE UNIQUE INDEX IF NOT EXISTS uk_shots_canvas_node ON shots (canvas_node_id) WHERE canvas_node_id <> ''", "一个节点只绑一个分镜（D-025）"},
		{"shot_artifacts", "CREATE UNIQUE INDEX IF NOT EXISTS uk_shot_artifacts_request_index ON shot_artifacts (request_id, asset_index) WHERE request_id <> ''", "Bridge 回调幂等（同请求同序号只落一次）"},
	} {
		if !tx.Migrator().HasTable(index.table) {
			continue
		}
		if err := tx.Exec(index.sql).Error; err != nil {
			return fmt.Errorf("%s：%w", index.describe, err)
		}
	}

	// 回填同样要容缺表——精简老库里没有这些表时直接跳过
	for _, item := range []struct {
		table    string
		sql      string
		describe string
	}{
		{"comfy_bridge_requests", "UPDATE comfy_bridge_requests SET attempt_no = 1 WHERE attempt_no IS NULL OR attempt_no = 0", "回填 attempt_no"},
		{"comfy_bridge_requests", "UPDATE comfy_bridge_requests SET status = 'running' WHERE status = 'claimed'", "归一 claimed → running"},
		{"workflow_template_versions", "UPDATE workflow_template_versions SET enabled = 1 WHERE enabled IS NULL", "回填模板 enabled"},
	} {
		if !tx.Migrator().HasTable(item.table) {
			continue
		}
		if err := tx.Exec(item.sql).Error; err != nil {
			return fmt.Errorf("%s：%w", item.describe, err)
		}
	}
	return nil
}

// migrateSchemaLogicalModelActiveCode：上游 v1.2.6 新增（上游编号 8），fork 顺延为 9。
func migrateSchemaLogicalModelActiveCode(tx *gorm.DB) error {
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
		for _, item := range schemaMigrations {
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
	for _, item := range schemaMigrations {
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
