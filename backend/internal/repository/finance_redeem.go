// 积分调整与兑换码批次。

package repository

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

func (r *Repository) AdjustCredits(userID string, actorUserID string, amount int64, note string) (*model.CreditAccount, error) {
	var account model.CreditAccount
	err := r.db.Transaction(func(tx *gorm.DB) error {
		account = model.CreditAccount{UserID: userID}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
			return err
		}
		accountQuery := tx.Model(&model.CreditAccount{}).Where("user_id = ?", userID)
		if amount < 0 {
			accountQuery = accountQuery.Where("available_microcredits + ? >= 0", amount)
		}
		updated := accountQuery.
			Updates(map[string]any{
				"available_microcredits": gorm.Expr("available_microcredits + ?", amount),
				"version":                gorm.Expr("version + 1"),
				"updated_at":             time.Now(),
			})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrInsufficientCredits
		}
		if err := tx.First(&account, "user_id = ?", userID).Error; err != nil {
			return err
		}
		entryType := model.CreditLedgerAdminAdjust
		if amount > 0 {
			entryType = model.CreditLedgerAdminGrant
		}
		return tx.Create(&model.CreditLedgerEntry{
			ID:                         newRepositoryID(),
			UserID:                     userID,
			Type:                       entryType,
			AmountMicrocredits:         amount,
			AvailableDeltaMicrocredits: amount,
			AvailableAfterMicrocredits: account.AvailableMicrocredits,
			ReservedAfterMicrocredits:  account.ReservedMicrocredits,
			ActorUserID:                actorUserID,
			Note:                       note,
		}).Error
	})
	return &account, err
}

func (r *Repository) CreateRedeemBatch(batch *model.RedeemBatch, codes []model.RedeemCode) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(batch).Error; err != nil {
			return err
		}
		return tx.CreateInBatches(&codes, 200).Error
	})
}

func (r *Repository) AdminRedeemBatches(keyword string, validity string, limit int, offset int) ([]model.RedeemBatch, int64, error) {
	var items []model.RedeemBatch
	var total int64
	query := r.db.Model(&model.RedeemBatch{})
	if value := strings.TrimSpace(keyword); value != "" {
		pattern := "%" + strings.ToLower(value) + "%"
		query = query.Where("lower(note) LIKE ? OR CAST(amount_microcredits AS TEXT) LIKE ? OR CAST(count AS TEXT) LIKE ?", pattern, pattern, pattern)
	}
	if validity == "active" {
		query = query.Where("expires_at IS NULL OR expires_at > ?", time.Now())
	} else if validity == "expired" {
		query = query.Where("expires_at IS NOT NULL AND expires_at <= ?", time.Now())
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	now := time.Now()
	listQuery := query.Select(`redeem_batches.id, redeem_batches.amount_microcredits, redeem_batches.count,
		redeem_batches.note, redeem_batches.created_by, redeem_batches.expires_at, redeem_batches.created_at,
		(SELECT COUNT(*) FROM redeem_codes rc WHERE rc.batch_id = redeem_batches.id AND rc.status = 'unused' AND (rc.expires_at IS NULL OR rc.expires_at > ?)) AS available_count,
		(SELECT COUNT(*) FROM redeem_codes rc WHERE rc.batch_id = redeem_batches.id AND rc.status = 'redeemed') AS redeemed_count,
		(SELECT COUNT(*) FROM redeem_codes rc WHERE rc.batch_id = redeem_batches.id AND rc.status = 'disabled') AS disabled_count,
		(SELECT COUNT(*) FROM redeem_codes rc WHERE rc.batch_id = redeem_batches.id AND rc.status = 'unused' AND rc.expires_at IS NOT NULL AND rc.expires_at <= ?) AS expired_count`, now, now)
	if err := listQuery.Order("created_at desc").Limit(limit).Offset(offset).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *Repository) RedeemBatch(id string) (*model.RedeemBatch, error) {
	var batch model.RedeemBatch
	now := time.Now()
	query := r.db.Model(&model.RedeemBatch{}).Select(`redeem_batches.*,
		(SELECT COUNT(*) FROM redeem_codes rc WHERE rc.batch_id = redeem_batches.id AND rc.status = 'unused' AND (rc.expires_at IS NULL OR rc.expires_at > ?)) AS available_count,
		(SELECT COUNT(*) FROM redeem_codes rc WHERE rc.batch_id = redeem_batches.id AND rc.status = 'redeemed') AS redeemed_count,
		(SELECT COUNT(*) FROM redeem_codes rc WHERE rc.batch_id = redeem_batches.id AND rc.status = 'disabled') AS disabled_count,
		(SELECT COUNT(*) FROM redeem_codes rc WHERE rc.batch_id = redeem_batches.id AND rc.status = 'unused' AND rc.expires_at IS NOT NULL AND rc.expires_at <= ?) AS expired_count`, now, now)
	if err := query.First(&batch, "redeem_batches.id = ?", id).Error; err != nil {
		return nil, err
	}
	return &batch, nil
}

func (r *Repository) AdminRedeemCodes(batchID string, status string, limit int, offset int) ([]AdminRedeemCodeRow, int64, error) {
	var items []AdminRedeemCodeRow
	var total int64
	query := r.db.Model(&model.RedeemCode{}).Where("redeem_codes.batch_id = ?", batchID)
	now := time.Now()
	switch status {
	case "available":
		query = query.Where("redeem_codes.status = ? AND (redeem_codes.expires_at IS NULL OR redeem_codes.expires_at > ?)", model.RedeemCodeUnused, now)
	case "redeemed":
		query = query.Where("redeem_codes.status = ?", model.RedeemCodeRedeemed)
	case "disabled":
		query = query.Where("redeem_codes.status = ?", model.RedeemCodeDisabled)
	case "expired":
		query = query.Where("redeem_codes.status = ? AND redeem_codes.expires_at IS NOT NULL AND redeem_codes.expires_at <= ?", model.RedeemCodeUnused, now)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Select("redeem_codes.*, users.username AS redeemed_username, users.display_name AS redeemed_display_name").
		Joins("LEFT JOIN users ON users.id = redeem_codes.redeemed_by").
		Order("redeem_codes.created_at asc, redeem_codes.id asc").Limit(limit).Offset(offset).Scan(&items).Error
	return items, total, err
}

func (r *Repository) RedeemCode(userID string, codeHash string, redeemedIP string) (*model.CreditAccount, error) {
	var account model.CreditAccount
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var code model.RedeemCode
		if err := tx.First(&code, "code_hash = ?", codeHash).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrRedeemCodeInvalid
			}
			return err
		}
		now := time.Now()
		query := tx.Model(&model.RedeemCode{}).Where("id = ? AND status = ?", code.ID, model.RedeemCodeUnused)
		if code.ExpiresAt != nil {
			query = query.Where("expires_at > ?", now)
		}
		updated := query.Updates(map[string]any{"status": model.RedeemCodeRedeemed, "redeemed_by": userID, "redeemed_at": &now, "redeemed_ip": redeemedIP, "updated_at": now})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrRedeemCodeInvalid
		}
		account = model.CreditAccount{UserID: userID}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.CreditAccount{}).Where("user_id = ?", userID).Updates(map[string]any{
			"available_microcredits": gorm.Expr("available_microcredits + ?", code.AmountMicrocredits),
			"version":                gorm.Expr("version + 1"),
			"updated_at":             now,
		}).Error; err != nil {
			return err
		}
		if err := tx.First(&account, "user_id = ?", userID).Error; err != nil {
			return err
		}
		return tx.Create(&model.CreditLedgerEntry{
			ID:                         newRepositoryID(),
			UserID:                     userID,
			Type:                       model.CreditLedgerRedeem,
			AmountMicrocredits:         code.AmountMicrocredits,
			AvailableDeltaMicrocredits: code.AmountMicrocredits,
			AvailableAfterMicrocredits: account.AvailableMicrocredits,
			ReservedAfterMicrocredits:  account.ReservedMicrocredits,
			RedeemCodeID:               code.ID,
			Note:                       "兑换码充值",
		}).Error
	})
	return &account, err
}
