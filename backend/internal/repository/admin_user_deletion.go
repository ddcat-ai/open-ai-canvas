package repository

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"infinite-canvas/backend/internal/model"
)

type UserDeletionPreflight struct {
	CanDelete bool             `json:"canDelete"`
	Blockers  []string         `json:"blockers"`
	Related   map[string]int64 `json:"related"`
}

const adminUserMutationLock int64 = 0x69676f7573657264

func (r *Repository) lockAdminUserMutation(tx *gorm.DB, actorID string) error {
	if r.Dialect() == "postgres" {
		return tx.Exec("SELECT pg_advisory_xact_lock(?)", adminUserMutationLock).Error
	}
	if r.Dialect() == "sqlite" {
		return tx.Exec("UPDATE users SET updated_at = updated_at WHERE id = ?", actorID).Error
	}
	return nil
}

func (r *Repository) SaveAdminUserWithGuard(actorID string, user *model.User, revokeSessions bool) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := r.lockAdminUserMutation(tx, actorID); err != nil {
			return err
		}
		var actor, previous model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&actor, "id = ?", actorID).Error; err != nil {
			return err
		}
		if actor.Role != model.UserRoleAdmin || actor.Status != model.UserStatusActive {
			return errors.New("当前管理员账号不可用")
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&previous, "id = ?", user.ID).Error; err != nil {
			return err
		}
		if previous.Role == model.UserRoleAdmin && previous.Status == model.UserStatusActive && (user.Role != model.UserRoleAdmin || user.Status != model.UserStatusActive) {
			var remaining int64
			if err := tx.Model(&model.User{}).Where("role = ? AND status = ? AND id <> ?", model.UserRoleAdmin, model.UserStatusActive, user.ID).Count(&remaining).Error; err != nil {
				return err
			}
			if remaining == 0 {
				return ErrBulkLastActiveAdmin
			}
		}
		if revokeSessions {
			if err := tx.Delete(&model.AuthSession{}, "user_id = ?", user.ID).Error; err != nil {
				return err
			}
		}
		return tx.Save(user).Error
	})
}

func (r *Repository) UserDeletionPreflight(actorID, userID string) (*UserDeletionPreflight, error) {
	return r.userDeletionPreflight(r.db, actorID, userID)
}

func (r *Repository) userDeletionPreflight(db *gorm.DB, actorID, userID string) (*UserDeletionPreflight, error) {
	out := &UserDeletionPreflight{Blockers: []string{}, Related: map[string]int64{}}
	var actor, target model.User
	if err := db.First(&actor, "id = ?", actorID).Error; err != nil {
		return nil, err
	}
	if err := db.First(&target, "id = ?", userID).Error; err != nil {
		return nil, err
	}
	if actor.Role != model.UserRoleAdmin || actor.Status != model.UserStatusActive {
		out.Blockers = append(out.Blockers, "当前管理员账号不可用")
	}
	if actorID == userID {
		out.Blockers = append(out.Blockers, "不能删除当前登录的管理员账号")
	}
	if target.Role == model.UserRoleAdmin {
		var admins int64
		if err := db.Model(&model.User{}).Where("role = ? AND status = ? AND id <> ?", model.UserRoleAdmin, model.UserStatusActive, userID).Count(&admins).Error; err != nil {
			return nil, err
		}
		if admins == 0 {
			out.Blockers = append(out.Blockers, "至少需要保留一个可用管理员")
		}
	}
	if db.Migrator().HasTable(&model.CreditAccount{}) {
		var account model.CreditAccount
		err := db.First(&account, "user_id = ?", userID).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		if err == nil && (account.AvailableMicrocredits != 0 || account.ReservedMicrocredits != 0) {
			out.Blockers = append(out.Blockers, "积分余额或预留余额非零，须先结清")
		}
	}
	checks := []struct {
		key, table, where, label string
		args                     []any
	}{
		{"activeTasks", "tasks", "user_id = ? AND status IN ?", "存在运行中或待处理任务", []any{userID, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning, model.TaskStatusTextReplay}}},
		{"openBilling", "billing_orders", "user_id = ? AND status NOT IN ?", "存在未结算计费单", []any{userID, []model.BillingStatus{model.BillingStatusSettled, model.BillingStatusRefunded}}},
		{"openPayments", "payment_orders", "user_id = ? AND status NOT IN ?", "存在未结算支付订单", []any{userID, []model.PaymentOrderStatus{model.PaymentOrderClosed, model.PaymentOrderCredited}}},
	}
	for _, check := range checks {
		if !db.Migrator().HasTable(check.table) {
			continue
		}
		var n int64
		if err := db.Table(check.table).Where(check.where, check.args...).Count(&n).Error; err != nil {
			return nil, err
		}
		out.Related[check.key] = n
		if n > 0 {
			out.Blockers = append(out.Blockers, fmt.Sprintf("%s（%d）", check.label, n))
		}
	}
	// 所有不属于账务、审计、身份会话的所有权引用均须先人工处理，避免孤儿素材、画布和共享内容。
	allowed := map[string]bool{"users": true, "auth_sessions": true, "auth_verifications": true, "user_identities": true, "credit_accounts": true, "credit_ledger_entries": true, "billing_orders": true, "payment_orders": true, "payment_notifications": true, "admin_audit_events": true, "redeem_codes": true, "redeem_batches": true, "payment_reconciliation_runs": true}
	tables, err := db.Migrator().GetTables()
	if err != nil {
		return nil, err
	}
	for _, table := range tables {
		if allowed[table] || strings.HasPrefix(table, "sqlite_") {
			continue
		}
		for _, column := range []string{"user_id", "owner_user_id", "created_by", "actor_user_id", "started_by", "redeemed_by", "resolved_by"} {
			if !db.Migrator().HasColumn(table, column) {
				continue
			}
			var n int64
			if err := db.Table(table).Where(column+" = ?", userID).Count(&n).Error; err != nil {
				return nil, err
			}
			if n > 0 {
				out.Related["ownedRecords"] += n
				out.Blockers = append(out.Blockers, fmt.Sprintf("存在 %d 条关联内容（%s.%s），需先处理所有权", n, table, column))
			}
		}
	}
	if db.Migrator().HasTable(&model.PaymentNotification{}) && db.Migrator().HasTable(&model.PaymentOrder{}) {
		var n int64
		orders := db.Table("payment_orders").Where("user_id = ?", userID)
		err := db.Table("payment_notifications").Where("(payment_order_id IN (?) OR merchant_order_no IN (?)) AND status <> ?", orders.Select("id"), db.Table("payment_orders").Select("merchant_order_no").Where("user_id = ?", userID), model.PaymentNotificationProcessed).Count(&n).Error
		if err != nil {
			return nil, err
		}
		if n > 0 {
			out.Blockers = append(out.Blockers, fmt.Sprintf("存在 %d 条未处理支付回调", n))
		}
	}
	for _, item := range []struct{ key, table, where string }{{"ledgerEntries", "credit_ledger_entries", "user_id = ?"}, {"billingOrders", "billing_orders", "user_id = ?"}, {"paymentOrders", "payment_orders", "user_id = ?"}, {"auditEvents", "admin_audit_events", "actor_user_id = ? OR (target_type = 'user' AND target_id = ?)"}} {
		if !db.Migrator().HasTable(item.table) {
			continue
		}
		var n int64
		args := []any{userID}
		if item.key == "auditEvents" {
			args = append(args, userID)
		}
		if err := db.Table(item.table).Where(item.where, args...).Count(&n).Error; err != nil {
			return nil, err
		}
		out.Related[item.key] = n
	}
	out.CanDelete = len(out.Blockers) == 0
	return out, nil
}

func (r *Repository) DeleteUserPermanently(actorID, userID, pseudonym string) (*UserDeletionPreflight, error) {
	var out *UserDeletionPreflight
	err := r.db.Transaction(func(tx *gorm.DB) error {
		// PostgreSQL serializes admin role edits and deletions using one transaction lock.
		if err := r.lockAdminUserMutation(tx, actorID); err != nil {
			return err
		}
		var actor, target model.User
		query := tx.Where("id IN ?", []string{actorID, userID})
		if r.Dialect() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		var users []model.User
		if err := query.Find(&users).Error; err != nil {
			return err
		}
		for _, user := range users {
			if user.ID == actorID {
				actor = user
			}
			if user.ID == userID {
				target = user
			}
		}
		if actor.ID == "" || target.ID == "" {
			return gorm.ErrRecordNotFound
		}
		var err error
		out, err = r.userDeletionPreflight(tx, actorID, userID)
		if err != nil || !out.CanDelete {
			return err
		}
		tokens := []string{target.ID, target.Email, target.Phone, target.Username, target.DisplayName}
		if err := scrubUserRetention(tx, target.ID, pseudonym, tokens); err != nil {
			return err
		}
		if tx.Migrator().HasTable(&model.AuthSession{}) {
			if err := tx.Delete(&model.AuthSession{}, "user_id = ?", userID).Error; err != nil {
				return err
			}
		}
		if tx.Migrator().HasTable(&model.UserIdentity{}) {
			if err := tx.Delete(&model.UserIdentity{}, "user_id = ?", userID).Error; err != nil {
				return err
			}
		}
		if target.Email != "" && tx.Migrator().HasTable(&model.EmailVerificationCode{}) {
			if err := tx.Delete(&model.EmailVerificationCode{}, "lower(email) = lower(?)", target.Email).Error; err != nil {
				return err
			}
		}
		if tx.Migrator().HasTable(&model.AuthVerification{}) {
			query := tx.Where("user_id = ?", userID)
			if target.Email != "" {
				query = query.Or("lower(email) = lower(?)", target.Email)
			}
			if target.Phone != "" {
				query = query.Or("phone = ?", target.Phone)
			}
			if err := query.Delete(&model.AuthVerification{}).Error; err != nil {
				return err
			}
		}
		result := tx.Delete(&model.User{}, "id = ?", userID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		if tx.Migrator().HasTable(&model.AdminAuditEvent{}) {
			return tx.Create(&model.AdminAuditEvent{ID: newRepositoryID(), ActorUserID: actorID, Action: "user.delete", TargetType: "user", TargetID: pseudonym, Summary: "删除用户身份并去标识化保留账务和审计", CreatedAt: time.Now()}).Error
		}
		return nil
	})
	return out, err
}

func scrubUserRetention(tx *gorm.DB, oldID, pseudonym string, tokens []string) error {
	if tx.Migrator().HasTable(&model.RedeemCode{}) {
		if err := tx.Model(&model.RedeemCode{}).Where("redeemed_by = ?", oldID).Update("redeemed_ip", "").Error; err != nil {
			return err
		}
	}
	substitutions := map[string]map[string]any{
		"credit_ledger_entries":       {"user_id": pseudonym, "actor_user_id": pseudonym},
		"billing_orders":              {"user_id": pseudonym, "resolved_by": pseudonym},
		"payment_orders":              {"user_id": pseudonym},
		"admin_audit_events":          {"actor_user_id": pseudonym, "target_id": pseudonym},
		"redeem_codes":                {"redeemed_by": pseudonym},
		"redeem_batches":              {"created_by": pseudonym},
		"payment_reconciliation_runs": {"started_by": pseudonym},
	}
	for table, columns := range substitutions {
		if !tx.Migrator().HasTable(table) {
			continue
		}
		for column := range columns {
			if !tx.Migrator().HasColumn(table, column) {
				continue
			}
			if err := tx.Table(table).Where(column+" = ?", oldID).Update(column, pseudonym).Error; err != nil {
				return err
			}
		}
	}
	// 只修改确实属于该身份的保留记录。不能在全库按用户名/显示名做 substring 替换。
	freeform := []struct {
		table, scope string
		args         []any
		columns      []string
	}{
		{"credit_ledger_entries", "user_id = ? OR actor_user_id = ?", []any{pseudonym, pseudonym}, []string{"note", "reference_key"}},
		{"billing_orders", "user_id = ? OR resolved_by = ?", []any{pseudonym, pseudonym}, []string{"idempotency_key", "error", "resolution_note"}},
		{"payment_orders", "user_id = ?", []any{pseudonym}, []string{"idempotency_key", "last_error"}},
		{"admin_audit_events", "actor_user_id = ? OR (target_type = 'user' AND target_id = ?)", []any{pseudonym, pseudonym}, []string{"summary", "metadata_json"}},
	}
	for _, item := range freeform {
		if !tx.Migrator().HasTable(item.table) {
			continue
		}
		columns := []string{"id"}
		for _, column := range item.columns {
			if tx.Migrator().HasColumn(item.table, column) {
				columns = append(columns, column)
			}
		}
		var rows []map[string]any
		if err := tx.Table(item.table).Select(columns).Where(item.scope, item.args...).Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			updates := map[string]any{}
			for _, column := range columns[1:] {
				if row[column] == nil {
					continue
				}
				text, ok := row[column].(string)
				if !ok {
					if raw, yes := row[column].([]byte); yes {
						text = string(raw)
					} else {
						continue
					}
				}
				clean := scrubRetainedIdentityText(text, tokens)
				if column == "metadata_json" {
					clean = scrubRetainedIdentityJSON(text, tokens)
				}
				if (column == "idempotency_key" || column == "reference_key") && clean != text {
					// 不把不同唯一键全部替换为同一个 [deleted user]。
					clean = fmt.Sprintf("deleted:%s:%x", pseudonym, sha256.Sum256([]byte(text)))
				}
				if clean != text {
					updates[column] = clean
				}
			}
			if len(updates) > 0 {
				if err := tx.Table(item.table).Where("id = ?", row["id"]).Updates(updates).Error; err != nil {
					return err
				}
			}
		}
	}

	// 批量审计会在其他目标记录的 userIds 中引用该用户。只替换明确的旧 ID，
	// 不按其用户名/显示名修改其他用户的记录。
	if tx.Migrator().HasTable(&model.AdminAuditEvent{}) {
		var events []model.AdminAuditEvent
		if err := tx.Where("metadata_json LIKE ?", "%"+oldID+"%").Find(&events).Error; err != nil {
			return err
		}
		for _, event := range events {
			clean := scrubRetainedIdentityJSON(event.MetadataJSON, []string{oldID})
			if clean != event.MetadataJSON {
				if err := tx.Model(&model.AdminAuditEvent{}).Where("id = ?", event.ID).Update("metadata_json", clean).Error; err != nil {
					return err
				}
			}
		}
	}

	if tx.Migrator().HasTable(&model.PaymentNotification{}) && tx.Migrator().HasTable(&model.PaymentOrder{}) {
		ids := tx.Table("payment_orders").Select("id").Where("user_id = ?", pseudonym)
		merchantNos := tx.Table("payment_orders").Select("merchant_order_no").Where("user_id = ?", pseudonym)
		if err := tx.Table("payment_notifications").Where("payment_order_id IN (?) OR merchant_order_no IN (?)", ids, merchantNos).Updates(map[string]any{"payload_cipher": "", "normalized_json": "{}"}).Error; err != nil {
			return err
		}
	}
	if tx.Migrator().HasTable(&model.CreditAccount{}) {
		if err := tx.Delete(&model.CreditAccount{}, "user_id = ?", oldID).Error; err != nil {
			return err
		}
	}
	return nil
}

func scrubRetainedIdentityText(text string, tokens []string) string {
	for _, token := range tokens {
		if token != "" {
			text = strings.ReplaceAll(text, token, "[deleted user]")
		}
	}
	return text
}

func scrubRetainedIdentityJSON(raw string, tokens []string) string {
	var value any
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return "{}"
	}
	var clean func(any) any
	clean = func(v any) any {
		switch item := v.(type) {
		case string:
			return scrubRetainedIdentityText(item, tokens)
		case []any:
			for i := range item {
				item[i] = clean(item[i])
			}
			return item
		case map[string]any:
			for key, v := range item {
				item[key] = clean(v)
			}
			return item
		default:
			return v
		}
	}
	result, err := json.Marshal(clean(value))
	if err != nil {
		return "{}"
	}
	return string(result)
}
