package repository

import (
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

// UserPurgeResult 汇总彻底删除用户时清掉的行数（按表）。
type UserPurgeResult struct {
	DeletedByTable   map[string]int64 `json:"deletedByTable"`
	DeletedRowsTotal int64            `json:"deletedRowsTotal"`
}

type purgeSchema struct {
	model      any
	table      string
	dbNameOfGo map[string]string // Go 字段名 → 真实列名（尊重 gorm tag / 命名策略）
}

func (p purgeSchema) column(goName string) string {
	return p.dbNameOfGo[goName]
}

// purgeFKTemplates 描述“指向用户子数据的列”如何回溯到用户。
// 统一以 user_id = ? 收口；模板中 %s 为列名占位，? 为用户 ID 参数。
// 由于所有模板都回溯到“带 user_id 的根表”，而根表行只在第二阶段删除，
// 第一阶段内部任意表间顺序都不会破坏子查询可见性。
var purgeFKTemplates = map[string]string{
	"TaskID":             "%s IN (SELECT id FROM tasks WHERE user_id = ?)",
	"SessionID":          "%s IN (SELECT id FROM sessions WHERE user_id = ?)",
	"ProjectID":          "%s IN (SELECT id FROM projects WHERE user_id = ?)",
	"AssetID":            "%s IN (SELECT id FROM assets WHERE user_id = ?)",
	"CanvasID":           "%s IN (SELECT id FROM canvas_projects WHERE user_id = ?)",
	"ResourceID":         "%s IN (SELECT id FROM resources WHERE user_id = ?)",
	"StorageSettingID":   "%s IN (SELECT id FROM user_oss_settings WHERE user_id = ?)",
	"BillingOrderID":     "%s IN (SELECT id FROM billing_orders WHERE user_id = ?)",
	"PaymentOrderID":     "%s IN (SELECT id FROM payment_orders WHERE user_id = ?)",
	"AssetVersionID":     "%s IN (SELECT id FROM asset_versions WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ?))",
	"ShotID":             "%s IN (SELECT id FROM shots WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?))",
	"UnitID":             "%s IN (SELECT id FROM project_units WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?))",
	"WorkflowInstanceID": "%s IN (SELECT id FROM workflow_instances WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?))",
	"WorkflowStepID":     "%s IN (SELECT id FROM workflow_step_instances WHERE workflow_instance_id IN (SELECT id FROM workflow_instances WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)))",
	"RevisionID":         "%s IN (SELECT id FROM shot_revisions WHERE shot_id IN (SELECT id FROM shots WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)))",
	"FolderID":           "%s IN (SELECT id FROM project_asset_folders WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?))",
	"VoiceProfileID":     "%s IN (SELECT id FROM voice_profiles WHERE user_id = ?)",
}

// purgeOwnColumns 第二阶段直接归属用户的字段（Go 字段名）。
var purgeOwnColumns = []string{"UserID", "OwnerID", "RedeemedBy"}

// PurgeUserData 在单个事务内彻底删除一个用户及其名下业务数据，并（可选）
// 在事务尾部原子写入一条管理员审计记录（如 user.purge）。
// 阶段一：删除所有能通过 FK 回溯到该用户的子数据（根表行仍在，子查询始终可见）；
// 阶段二：删除直接归属该用户的行（user_id / owner_id / redeemed_by）；
// 阶段三：审计记录（保留本次传入的审计）、邮箱验证码与用户主行。
// 用户主行最后删，保证事务内全程可回溯。
func (r *Repository) PurgeUserData(user *model.User, keepAudit *model.AdminAuditEvent) (*UserPurgeResult, error) {
	userID := strings.TrimSpace(user.ID)
	if userID == "" {
		return nil, fmt.Errorf("缺少用户 ID")
	}
	email := strings.TrimSpace(user.Email)

	result := &UserPurgeResult{DeletedByTable: map[string]int64{}}
	keepAction := ""
	if keepAudit != nil {
		keepAction = strings.TrimSpace(keepAudit.Action)
	}
	err := r.db.Transaction(func(tx *gorm.DB) error {
		schemas, err := parsePurgeSchemas(tx)
		if err != nil {
			return err
		}

		// 阶段一：子表级联（不含用户主行，也不含 user_id 直属行）
		for _, schema := range schemas {
			if _, isUser := schema.model.(*model.User); isUser {
				continue
			}
			conds, args := buildFKPurgeConds(schema, userID)
			if len(conds) == 0 {
				continue
			}
			if err := deletePurgedRows(tx, schema, conds, args, result); err != nil {
				return err
			}
		}
		// 阶段二：直属行
		for _, schema := range schemas {
			if _, isUser := schema.model.(*model.User); isUser {
				continue
			}
			conds := make([]string, 0, 1)
			args := make([]any, 0, 1)
			for _, goName := range purgeOwnColumns {
				if column := schema.column(goName); column != "" {
					conds = append(conds, column+" = ?")
					args = append(args, userID)
				}
			}
			if len(conds) == 0 {
				continue
			}
			if err := deletePurgedRows(tx, schema, conds, args, result); err != nil {
				return err
			}
		}
		// 阶段三：审计（该用户作操作者/被操作对象）、邮箱验证码、用户主行
		for _, schema := range schemas {
			if _, ok := schema.model.(*model.AdminAuditEvent); ok {
				if err := deleteAdminAuditRows(tx, schema, userID, keepAction, result); err != nil {
					return err
				}
			}
			if _, ok := schema.model.(*model.EmailVerificationCode); ok && email != "" {
				if column := schema.column("Email"); column != "" {
					if err := deletePurgedWhere(tx, schema, column+" = ?", []any{email}, result); err != nil {
						return err
					}
				}
			}
		}
		for _, schema := range schemas {
			if _, isUser := schema.model.(*model.User); isUser {
				if err := deletePurgedWhere(tx, schema, "id = ?", []any{userID}, result); err != nil {
					return err
				}
			}
		}
		// 本次删除动作的审计记录在用户主行删除后写入，避免被上面的清理误删。
		if keepAudit != nil {
			if err := tx.Create(keepAudit).Error; err != nil {
				return fmt.Errorf("写入管理员审计失败：%w", err)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func parsePurgeSchemas(db *gorm.DB) ([]purgeSchema, error) {
	models := database.Models()
	schemas := make([]purgeSchema, 0, len(models))
	for _, dst := range models {
		stmt := &gorm.Statement{DB: db, Dest: dst}
		if err := stmt.Parse(dst); err != nil {
			return nil, fmt.Errorf("解析表结构失败（%T）：%w", dst, err)
		}
		names := make(map[string]string, len(stmt.Schema.Fields))
		for _, field := range stmt.Schema.Fields {
			names[field.Name] = field.DBName
		}
		schemas = append(schemas, purgeSchema{model: dst, table: stmt.Schema.Table, dbNameOfGo: names})
	}
	return schemas, nil
}

// buildFKPurgeConds 汇总一张表中命中“用户子数据 FK”的删除条件。
func buildFKPurgeConds(schema purgeSchema, userID string) ([]string, []any) {
	conds := make([]string, 0, 2)
	args := make([]any, 0, 2)
	for goName, template := range purgeFKTemplates {
		column := schema.column(goName)
		if column == "" {
			continue
		}
		conds = append(conds, fmt.Sprintf(template, column))
		args = append(args, userID)
	}
	return conds, args
}

func deletePurgedRows(tx *gorm.DB, schema purgeSchema, conds []string, args []any, result *UserPurgeResult) error {
	combined := "(" + strings.Join(conds, " OR ") + ")"
	return deletePurgedWhere(tx, schema, combined, args, result)
}

func deletePurgedWhere(tx *gorm.DB, schema purgeSchema, where string, args []any, result *UserPurgeResult) error {
	db := tx.Table(schema.table).Where(where, args...).Delete(schema.model)
	if db.Error != nil {
		return fmt.Errorf("清理 %s 失败：%w", schema.table, db.Error)
	}
	if db.RowsAffected > 0 {
		result.DeletedByTable[schema.table] += db.RowsAffected
		result.DeletedRowsTotal += db.RowsAffected
	}
	return nil
}

func deleteAdminAuditRows(tx *gorm.DB, schema purgeSchema, userID string, keepAction string, result *UserPurgeResult) error {
	actorColumn := schema.column("ActorUserID")
	targetTypeColumn := schema.column("TargetType")
	targetIDColumn := schema.column("TargetID")
	actionColumn := schema.column("Action")
	if actorColumn == "" || targetTypeColumn == "" || targetIDColumn == "" || actionColumn == "" {
		return nil
	}
	where := "(" + actorColumn + " = ? OR (" + targetTypeColumn + " = 'user' AND " + targetIDColumn + " = ?))"
	args := []any{userID, userID}
	if keepAction != "" {
		where += " AND " + actionColumn + " <> ?"
		args = append(args, keepAction)
	}
	return deletePurgedWhere(tx, schema, where, args, result)
}
