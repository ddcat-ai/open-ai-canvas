package database

import (
	"fmt"

	"yingce/backend/internal/invite"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func migrateInviteRewards(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.InviteRecord{}, &model.RewardAccount{}, &model.InviteRewardRecord{},
		&model.WithdrawRequest{}, &model.WithdrawAccount{}, &model.TransferRecord{}); err != nil {
		return fmt.Errorf("创建邀请奖励结构：%w", err)
	}
	for _, entity := range []any{&model.User{}, &model.OAuthState{}} {
		if tx.Migrator().HasTable(entity) && !tx.Migrator().HasColumn(entity, "InviteCode") {
			if err := tx.Migrator().AddColumn(entity, "InviteCode"); err != nil {
				return fmt.Errorf("增加邀请码字段 %T：%w", entity, err)
			}
		}
	}
	if !tx.Migrator().HasTable(&model.User{}) {
		return nil
	}
	if err := tx.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code_nonempty ON users(invite_code) WHERE invite_code <> ''").Error; err != nil {
		return fmt.Errorf("创建邀请码唯一索引：%w", err)
	}
	var ids []string
	if err := tx.Model(&model.User{}).Where("invite_code = '' OR invite_code IS NULL").Order("id").Pluck("id", &ids).Error; err != nil {
		return err
	}
	for _, id := range ids {
		code, err := generateInviteCodeDB(tx)
		if err != nil {
			return err
		}
		if err := tx.Model(&model.User{}).Where("id = ? AND (invite_code = '' OR invite_code IS NULL)", id).UpdateColumn("invite_code", code).Error; err != nil {
			return fmt.Errorf("回填用户邀请码：%w", err)
		}
	}
	return nil
}

func generateInviteCodeDB(tx *gorm.DB) (string, error) {
	for attempt := 0; attempt < 32; attempt++ {
		code, err := invite.GenerateInviteCode()
		if err != nil {
			return "", err
		}
		var count int64
		if err := tx.Model(&model.User{}).Where("invite_code = ?", code).Count(&count).Error; err != nil {
			return "", err
		}
		if count == 0 {
			return code, nil
		}
	}
	return "", fmt.Errorf("邀请码生成冲突次数过多")
}
