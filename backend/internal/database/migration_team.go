package database

import (
	"errors"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func teamModels() []any {
	return []any{&model.Team{}, &model.TeamMembership{}, &model.TeamInvitation{}, &model.CreditTransfer{}, &model.TeamAssetPublication{}}
}

func migrateTeamWorkspaces(tx *gorm.DB) error {
	if err := tx.AutoMigrate(teamModels()...); err != nil {
		return err
	}
	if err := migrateTeamCreditAccounts(tx); err != nil {
		return err
	}
	for _, item := range []struct {
		entity               any
		table, accountColumn string
	}{
		{&model.CreditLedgerEntry{}, "credit_ledger_entries", "account_id"}, {&model.BillingOrder{}, "billing_orders", "billing_account_id"},
	} {
		if !tx.Migrator().HasTable(item.entity) {
			continue
		}
		if err := tx.AutoMigrate(item.entity); err != nil {
			return err
		}
		if err := tx.Exec("UPDATE " + item.table + " SET " + item.accountColumn + " = 'personal:' || user_id WHERE (" + item.accountColumn + " IS NULL OR " + item.accountColumn + " = '') AND user_id IS NOT NULL AND user_id <> ''").Error; err != nil {
			return err
		}
	}
	return nil
}

func migrateTeamCreditAccounts(tx *gorm.DB) error {
	account := &model.CreditAccount{}
	if !tx.Migrator().HasTable(account) {
		return tx.AutoMigrate(account)
	}
	cols, err := tx.Migrator().ColumnTypes(account)
	if err != nil {
		return err
	}
	for _, col := range cols {
		if primary, ok := col.PrimaryKey(); col.Name() == "id" && ok && primary {
			return tx.AutoMigrate(account)
		}
	}
	// Keep the original rows until the new primary key and every balance have been checked.
	if err = tx.Migrator().RenameTable("credit_accounts", "credit_accounts_v105"); err != nil {
		return err
	}
	if tx.Dialector.Name() == "postgres" {
		if err = tx.Exec(`ALTER TABLE credit_accounts_v105 RENAME CONSTRAINT credit_accounts_pkey TO credit_accounts_v105_pkey`).Error; err != nil {
			return err
		}
	}
	if err = tx.Migrator().CreateTable(account); err != nil {
		return err
	}
	if err = tx.Exec(`INSERT INTO credit_accounts (id, kind, user_id, available_microcredits, reserved_microcredits, version, created_at, updated_at)
		SELECT 'personal:' || user_id, 'personal', user_id, available_microcredits, reserved_microcredits, version, created_at, updated_at FROM credit_accounts_v105`).Error; err != nil {
		return err
	}
	var differences int64
	if err = tx.Raw(`SELECT COUNT(*) FROM credit_accounts_v105 old LEFT JOIN credit_accounts n ON n.user_id = old.user_id
		WHERE old.user_id IS NULL OR old.user_id = '' OR n.id IS NULL OR n.available_microcredits IS DISTINCT FROM old.available_microcredits OR n.reserved_microcredits IS DISTINCT FROM old.reserved_microcredits OR n.version IS DISTINCT FROM old.version`).Scan(&differences).Error; err != nil {
		return err
	}
	if differences != 0 {
		return errors.New("个人积分账户迁移核对不一致")
	}
	return tx.Migrator().DropTable("credit_accounts_v105")
}
