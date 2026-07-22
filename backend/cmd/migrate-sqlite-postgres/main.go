package main

import (
	"errors"
	"fmt"
	"log"
	"os"
	"reflect"
	"strings"
	"time"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
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
		tableCount, err := publicTableCount(tx)
		if err != nil {
			return err
		}
		copyRows := tableCount == 0
		if copyRows {
			if err := database.MigrateSchema(tx); err != nil {
				return fmt.Errorf("创建目标表结构：%w", err)
			}
		} else if tableCount != int64(len(migrations())) {
			return fmt.Errorf("PostgreSQL public schema 已有 %d 张表，拒绝覆盖或补写", tableCount)
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

func publicTableCount(db *gorm.DB) (int64, error) {
	var count int64
	err := db.Raw("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'").Scan(&count).Error
	return count, err
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

func primaryKeyColumn[T any](db *gorm.DB) (string, error) {
	statement := &gorm.Statement{DB: db}
	if err := statement.Parse(new(T)); err != nil {
		return "", err
	}
	if len(statement.Schema.PrimaryFields) != 1 {
		return "", fmt.Errorf("表 %s 必须有且只有一个主键", statement.Schema.Table)
	}
	return statement.Schema.PrimaryFields[0].DBName, nil
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
		migrateTable[model.User]("users"),
		migrateTable[model.AuthSession]("auth_sessions"),
		migrateTable[model.UserIdentity]("user_identities"),
		migrateTable[model.OAuthState]("o_auth_states"),
		migrateTable[model.EmailVerificationCode]("email_verification_codes"),
		migrateTable[model.ModelChannel]("model_channels"),
		migrateTable[model.ChannelModel]("channel_models"),
		migrateTable[model.ApiCallLog]("api_call_logs"),
		migrateTable[model.ModelPricing]("model_pricings"),
		migrateTable[model.CreditAccount]("credit_accounts"),
		migrateTable[model.CreditLedgerEntry]("credit_ledger_entries"),
		migrateTable[model.BillingOrder]("billing_orders"),
		migrateTable[model.RedeemBatch]("redeem_batches"),
		migrateTable[model.RedeemCode]("redeem_codes"),
		migrateTable[model.AdminAuditEvent]("admin_audit_events"),
		migrateTable[model.UserDailyActivity]("user_daily_activities"),
		migrateTable[model.SystemSetting]("system_settings"),
		migrateTable[model.UserOSSSetting]("user_oss_settings"),
		migrateTable[model.UserDailyUploadUsage]("user_daily_upload_usages"),
		migrateTable[model.UserSkillState]("user_skill_states"),
		migrateTable[model.Resource]("resources"),
		migrateTable[model.Asset]("assets"),
		migrateTable[model.CanvasProject]("canvas_projects"),
		migrateTable[model.CanvasShare]("canvas_shares"),
		migrateTable[model.StoryboardPromptTemplate]("storyboard_prompt_templates"),
		migrateTable[model.Announcement]("announcements"),
		migrateTable[model.UserAnnouncementRead]("user_announcement_reads"),
		migrateTable[model.Task]("tasks"),
		migrateTable[model.Session]("sessions"),
		migrateTable[model.Message]("messages"),
		migrateTable[model.TaskLog]("task_logs"),
		migrateTable[model.SessionFile]("session_files"),
		migrateTable[model.Result]("results"),
	}
}
