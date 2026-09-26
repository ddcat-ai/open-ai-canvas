package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

type tableMigration struct {
	name string
	run  func(source *gorm.DB, target *gorm.DB, copyRows bool) (int, error)
}

func main() {
	sourcePath := strings.TrimSpace(os.Getenv("SQLITE_SOURCE_PATH"))
	targetDSN := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if sourcePath == "" || targetDSN == "" {
		log.Fatal("必须配置 SQLITE_SOURCE_PATH 和 DATABASE_URL")
	}
	if _, err := os.Stat(sourcePath); err != nil {
		log.Fatalf("读取 SQLite 源文件失败：%v", err)
	}

	source, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:" + sourcePath + "?mode=ro&_busy_timeout=5000"})
	if err != nil {
		log.Fatalf("连接 SQLite 失败：%v", err)
	}
	target, err := database.Open(database.Config{Driver: "postgres", DSN: targetDSN})
	if err != nil {
		log.Fatalf("连接 PostgreSQL 失败：%v", err)
	}
	if err := verifySQLite(source); err != nil {
		log.Fatalf("SQLite 完整性检查失败：%v", err)
	}
	if err := verifyMigrationCoverage(source); err != nil {
		log.Fatalf("迁移表清单检查失败：%v", err)
	}
	source = source.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	target = target.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})

	// PostgreSQL 的 DDL 参与事务；任一表复制或核对失败都会回滚整个新库结构。
	if err := target.Transaction(func(tx *gorm.DB) error {
		tableNames, err := publicTableNames(tx)
		if err != nil {
			return err
		}
		copyRows := len(tableNames) == 0
		if copyRows {
			if err := database.MigrateSchema(tx); err != nil {
				return fmt.Errorf("创建目标表结构：%w", err)
			}
		} else if err := validateTargetTableNames(tableNames); err != nil {
			return err
		}

		total := 0
		for _, migration := range migrations() {
			count, err := migration.run(source, tx, copyRows)
			if err != nil {
				return fmt.Errorf("迁移表 %s：%w", migration.name, err)
			}
			total += count
			log.Printf("已迁移并核对 %s：%d 行", migration.name, count)
		}
		if copyRows {
			log.Printf("全量迁移核对完成：%d 张表，%d 行", len(migrations()), total)
		} else {
			log.Printf("目标库已有完整迁移结果，未重复写入：%d 张表，%d 行", len(migrations()), total)
		}
		if err := database.ReconcilePrefixedIDSequences(tx); err != nil {
			return fmt.Errorf("校准可读 ID 序列：%w", err)
		}
		return nil
	}); err != nil {
		log.Fatal(err)
	}
}

func verifySQLite(db *gorm.DB) error {
	var result string
	if err := db.Raw("PRAGMA quick_check").Scan(&result).Error; err != nil {
		return err
	}
	if result != "ok" {
		return fmt.Errorf("quick_check 返回 %q", result)
	}
	return nil
}

func publicTableNames(db *gorm.DB) ([]string, error) {
	var names []string
	err := db.Raw(`
		SELECT table_name
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
		ORDER BY table_name
	`).Scan(&names).Error
	return names, err
}

// validateTargetTableNames compares the existing PostgreSQL schema against the
// same business-table list used by Models() and migrations().
// schema_migrations is created by database.MigrateSchema and is intentionally
// not part of the row-copy list, so it is allowed as the only system table.
func validateTargetTableNames(actual []string) error {
	expected := make(map[string]struct{}, len(migrations()))
	for _, migration := range migrations() {
		expected[migration.name] = struct{}{}
	}

	actualSet := make(map[string]struct{}, len(actual))
	for _, name := range actual {
		actualSet[name] = struct{}{}
	}
	missing := make([]string, 0)
	for name := range expected {
		if _, ok := actualSet[name]; !ok {
			missing = append(missing, name)
		}
	}
	extra := make([]string, 0)
	for name := range actualSet {
		if name == "schema_migrations" {
			continue
		}
		if _, ok := expected[name]; !ok {
			extra = append(extra, name)
		}
	}
	sort.Strings(missing)
	sort.Strings(extra)
	if len(missing) > 0 || len(extra) > 0 {
		return fmt.Errorf("PostgreSQL public schema 与当前模型清单不一致，缺少表：%s，额外表：%s；拒绝覆盖或补写", strings.Join(missing, ", "), strings.Join(extra, ", "))
	}
	return nil
}

func migrateTable[T any](name string) tableMigration {
	return tableMigration{
		name: name,
		run: func(source *gorm.DB, target *gorm.DB, copyRows bool) (int, error) {
			primaryKey, err := primaryKeyColumn[T](source)
			if err != nil {
				return 0, err
			}
			var sourceRows []T
			if err := source.Order(primaryKey).Find(&sourceRows).Error; err != nil {
				return 0, err
			}
			if err := validateExplicitStringLengths(source, name, sourceRows); err != nil {
				return 0, err
			}
			if copyRows && len(sourceRows) > 0 {
				if err := target.CreateInBatches(&sourceRows, 100).Error; err != nil {
					return 0, err
				}
			}

			var targetRows []T
			if err := target.Order(primaryKey).Find(&targetRows).Error; err != nil {
				return 0, err
			}
			if !equivalent(reflect.ValueOf(sourceRows), reflect.ValueOf(targetRows)) {
				return 0, errors.New("源数据与目标数据逐字段核对不一致")
			}
			return len(sourceRows), nil
		},
	}
}

// validateExplicitStringLengths catches values that SQLite accepts but
// PostgreSQL would reject for a GORM size:N column. SQLite does not enforce
// VARCHAR(N), so this check must happen before the first target insert.
func validateExplicitStringLengths[T any](db *gorm.DB, tableName string, rows []T) error {
	statement := &gorm.Statement{DB: db}
	if err := statement.Parse(new(T)); err != nil {
		return err
	}
	if statement.Schema == nil {
		return fmt.Errorf("表 %s 缺少 GORM schema", tableName)
	}

	for rowIndex := range rows {
		rowValue := reflect.ValueOf(rows[rowIndex])
		key := primaryKeyValue(statement.Schema.PrimaryFields, rowValue)
		for _, field := range statement.Schema.Fields {
			limit, ok := explicitStringSize(field)
			if !ok || field.Serializer != nil || !field.Creatable || !field.Readable {
				continue
			}
			value, zero := field.ValueOf(context.Background(), rowValue)
			if zero {
				continue
			}
			text, ok := stringValue(value)
			if !ok {
				continue
			}
			actual := utf8.RuneCountInString(text)
			if actual <= limit {
				continue
			}
			return fmt.Errorf("表 %s 第 %d 行（主键 %s）列 %s 长度 %d，超过 size:%d", tableName, rowIndex+1, key, field.DBName, actual, limit)
		}
	}
	return nil
}

func explicitStringSize(field *schema.Field) (int, bool) {
	// This adapter keeps the validation logic independent from GORM's inferred
	// default size (often 255). Only an explicit size:N tag is a PostgreSQL
	// contract we can prove from the model.
	sizeText, ok := field.TagSettings["SIZE"]
	if !ok || strings.TrimSpace(sizeText) == "" {
		return 0, false
	}
	if strings.EqualFold(strings.TrimSpace(field.TagSettings["TYPE"]), "text") {
		return 0, false
	}
	if field.IndirectFieldType.Kind() != reflect.String {
		return 0, false
	}
	limit, err := strconv.Atoi(sizeText)
	if err != nil || limit < 0 {
		return 0, false
	}
	return limit, true
}

func stringValue(value any) (string, bool) {
	if value == nil {
		return "", false
	}
	rv := reflect.ValueOf(value)
	for rv.Kind() == reflect.Interface || rv.Kind() == reflect.Pointer {
		if rv.IsNil() {
			return "", false
		}
		rv = rv.Elem()
	}
	if rv.Kind() != reflect.String {
		return "", false
	}
	return rv.String(), true
}

func primaryKeyValue(fields []*schema.Field, rowValue reflect.Value) string {
	if len(fields) == 0 {
		return "<无主键>"
	}
	parts := make([]string, 0, len(fields))
	for _, field := range fields {
		value, zero := field.ValueOf(context.Background(), rowValue)
		if zero || value == nil {
			parts = append(parts, field.DBName+"=<空>")
			continue
		}
		if text, ok := stringValue(value); ok {
			parts = append(parts, field.DBName+"="+text)
			continue
		}
		parts = append(parts, field.DBName+"="+fmt.Sprint(value))
	}
	return strings.Join(parts, ",")
}

func primaryKeyColumn[T any](db *gorm.DB) (string, error) {
	statement := &gorm.Statement{DB: db}
	if err := statement.Parse(new(T)); err != nil {
		return "", err
	}
	if len(statement.Schema.PrimaryFields) == 0 {
		return "", fmt.Errorf("表 %s 必须有主键", statement.Schema.Table)
	}
	columns := make([]string, 0, len(statement.Schema.PrimaryFields))
	for _, field := range statement.Schema.PrimaryFields {
		columns = append(columns, field.DBName)
	}
	return strings.Join(columns, ", "), nil
}

var timeType = reflect.TypeOf(time.Time{})

func equivalent(left reflect.Value, right reflect.Value) bool {
	if !left.IsValid() || !right.IsValid() {
		return left.IsValid() == right.IsValid()
	}
	if left.Type() != right.Type() {
		return false
	}
	if left.Type() == timeType {
		leftTime := left.Interface().(time.Time).Truncate(time.Microsecond)
		rightTime := right.Interface().(time.Time).Truncate(time.Microsecond)
		return leftTime.Equal(rightTime)
	}
	switch left.Kind() {
	case reflect.Pointer, reflect.Interface:
		if left.IsNil() || right.IsNil() {
			return left.IsNil() == right.IsNil()
		}
		return equivalent(left.Elem(), right.Elem())
	case reflect.Slice, reflect.Array:
		if left.Len() != right.Len() {
			return false
		}
		for index := 0; index < left.Len(); index++ {
			if !equivalent(left.Index(index), right.Index(index)) {
				return false
			}
		}
		return true
	case reflect.Struct:
		for index := 0; index < left.NumField(); index++ {
			field := left.Type().Field(index)
			if field.Tag.Get("gorm") == "-" || strings.Contains(field.Tag.Get("gorm"), "->") {
				continue
			}
			if !equivalent(left.Field(index), right.Field(index)) {
				return false
			}
		}
		return true
	default:
		return reflect.DeepEqual(left.Interface(), right.Interface())
	}
}

func verifyMigrationCoverage(db *gorm.DB) error {
	expected := make(map[string]struct{}, len(database.Models()))
	for _, value := range database.Models() {
		statement := &gorm.Statement{DB: db}
		if err := statement.Parse(value); err != nil {
			return err
		}
		expected[statement.Schema.Table] = struct{}{}
	}
	for _, migration := range migrations() {
		if _, exists := expected[migration.name]; !exists {
			return fmt.Errorf("迁移清单包含未知表 %s", migration.name)
		}
		delete(expected, migration.name)
	}
	if len(expected) > 0 {
		missing := make([]string, 0, len(expected))
		for name := range expected {
			missing = append(missing, name)
		}
		return fmt.Errorf("迁移清单缺少表：%s", strings.Join(missing, ", "))
	}
	return nil
}

func migrations() []tableMigration {
	return []tableMigration{
		migrateTable[model.Tool]("tools"),
		migrateTable[model.ToolFavorite]("tool_favorites"),
		migrateTable[model.User]("users"),
		migrateTable[model.AuthSession]("auth_sessions"),
		migrateTable[model.UserIdentity]("user_identities"),
		migrateTable[model.OAuthState]("o_auth_states"),
		migrateTable[model.EmailVerificationCode]("email_verification_codes"),
		migrateTable[model.AuthVerification]("auth_verifications"),
		migrateTable[model.NotificationQuota]("notification_quota"),
		migrateTable[model.SMSChannel]("sms_channels"),
		migrateTable[model.SMSRecord]("sms_records"),
		migrateTable[model.ModelChannel]("model_channels"),
		migrateTable[model.ChannelModel]("channel_models"),
		migrateTable[model.ChannelModelPriceTier]("channel_model_price_tiers"),
		migrateTable[model.IDSequence]("id_sequences"),
		migrateTable[model.LogicalModel]("logical_models"),
		migrateTable[model.LogicalModelRevision]("logical_model_revisions"),
		migrateTable[model.LogicalModelRoute]("logical_model_routes"),
		migrateTable[model.RouteAttempt]("route_attempts"),
		migrateTable[model.ApiCallLog]("api_call_logs"),
		migrateTable[model.ModelPricing]("model_pricings"),
		migrateTable[model.CreditAccount]("credit_accounts"),
		migrateTable[model.CreditLedgerEntry]("credit_ledger_entries"),
		migrateTable[model.BillingOrder]("billing_orders"),
		migrateTable[model.TopupProduct]("topup_products"),
		migrateTable[model.PaymentProviderConfig]("payment_provider_configs"),
		migrateTable[model.PaymentOrder]("payment_orders"),
		migrateTable[model.PaymentNotification]("payment_notifications"),
		migrateTable[model.PaymentReconciliationRun]("payment_reconciliation_runs"),
		migrateTable[model.PaymentReconciliationItem]("payment_reconciliation_items"),
		migrateTable[model.RedeemBatch]("redeem_batches"),
		migrateTable[model.RedeemCode]("redeem_codes"),
		migrateTable[model.AdminAuditEvent]("admin_audit_events"),
		migrateTable[model.UserDailyActivity]("user_daily_activities"),
		migrateTable[model.SystemSetting]("system_settings"),
		migrateTable[model.PluginPlatformState]("plugin_platform_states"),
		migrateTable[model.UserPluginState]("user_plugin_states"),
		migrateTable[model.ArkPrivateAssetBinding]("ark_private_asset_bindings"),
		migrateTable[model.UserOSSSetting]("user_oss_settings"),
		migrateTable[model.StorageLocation]("storage_locations"),
		migrateTable[model.UserDailyUploadUsage]("user_daily_upload_usages"),
		migrateTable[model.Skill]("skills"),
		migrateTable[model.SkillVersion]("skill_versions"),
		migrateTable[model.SkillFile]("skill_files"),
		migrateTable[model.UserSkillState]("user_skill_states"),
		migrateTable[model.Resource]("resources"),
		migrateTable[model.ResourceDeletionJob]("resource_deletion_jobs"),
		migrateTable[model.AnnouncementImageDraft]("announcement_image_drafts"),
		migrateTable[model.Asset]("assets"),
		migrateTable[model.AssetFolder]("asset_folders"),
		migrateTable[model.ProjectAssetLink]("project_asset_links"),
		migrateTable[model.ProjectAssetFolder]("project_asset_folders"),
		migrateTable[model.ProjectAssetCandidate]("project_asset_candidates"),
		migrateTable[model.AssetVersion]("asset_versions"),
		migrateTable[model.AssetRepresentation]("asset_representations"),
		migrateTable[model.VoiceProfile]("voice_profiles"),
		migrateTable[model.CharacterVoiceBinding]("character_voice_bindings"),
		migrateTable[model.Project]("projects"),
		migrateTable[model.StyleProfile]("style_profiles"),
		migrateTable[model.ProjectUnit]("project_units"),
		migrateTable[model.CanvasUnitLink]("canvas_unit_links"),
		migrateTable[model.Shot]("shots"),
		migrateTable[model.ShotRevision]("shot_revisions"),
		migrateTable[model.ShotArtifact]("shot_artifacts"),
		migrateTable[model.ShotAssetReference]("shot_asset_references"),
		migrateTable[model.WorkflowTemplateVersion]("workflow_template_versions"),
		migrateTable[model.WorkflowInstance]("workflow_instances"),
		migrateTable[model.WorkflowStepInstance]("workflow_step_instances"),
		migrateTable[model.WorkflowStepTask]("workflow_step_tasks"),
		migrateTable[model.ProductionTaskLink]("production_task_links"),
		migrateTable[model.CanvasProject]("canvas_projects"),
		migrateTable[model.CanvasSnapshot]("canvas_snapshots"),
		migrateTable[model.CanvasSnapshotResource]("canvas_snapshot_resources"),
		migrateTable[model.CanvasShare]("canvas_shares"),
		migrateTable[model.PromptTemplate]("prompt_templates"),
		migrateTable[model.UserPromptCustomization]("user_prompt_customizations"),
		migrateTable[model.Announcement]("announcements"),
		migrateTable[model.UserAnnouncementRead]("user_announcement_reads"),
		migrateTable[model.BannerAnnouncement]("banner_announcements"),
		migrateTable[model.CreationRun]("creation_runs"),
		migrateTable[model.CreationSubmission]("creation_submissions"),
		migrateTable[model.Task]("tasks"),
		migrateTable[model.CloudAgentExecution]("cloud_agent_executions"),
		migrateTable[model.CloudAgentEventRecord]("cloud_agent_event_records"),
		migrateTable[model.CloudAgentMessageRecord]("cloud_agent_message_records"),
		migrateTable[model.CloudAgentCanvasMutation]("cloud_agent_canvas_mutations"),
		migrateTable[model.CloudAgentResourceLease]("cloud_agent_resource_leases"),
		migrateTable[model.CloudAgentGeminiCache]("cloud_agent_gemini_caches"),
		migrateTable[model.AgentProfile]("agent_profiles"),
		migrateTable[model.AgentLesson]("agent_lessons"),
		migrateTable[model.AgentMemorySetting]("agent_memory_settings"),
		migrateTable[model.TaskTextDelta]("task_text_delta"),
		migrateTable[model.TaskLog]("task_logs"),
		migrateTable[model.Result]("results"),
	}
}
