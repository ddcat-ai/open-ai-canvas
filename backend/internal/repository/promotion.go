package repository

import (
	"errors"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ErrCommissionInsufficient 表示可用返佣不足以完成本次转入或提现申请。
var ErrCommissionInsufficient = errors.New("可用返佣不足")

// ErrWithdrawalNotPending 表示提现申请已被处理过，重复审核必须失败而不是覆盖结论。
var ErrWithdrawalNotPending = errors.New("提现申请已处理")

// PromotionInvitationRow 是推广记录列表的一行。
type PromotionInvitationRow struct {
	ID                      string    `json:"id" gorm:"column:id"`
	InviteeID               string    `json:"inviteeId" gorm:"column:invitee_id"`
	InviteeName             string    `json:"inviteeName" gorm:"column:invitee_name"`
	InviteeContact          string    `json:"inviteeContact" gorm:"column:invitee_contact"`
	Source                  string    `json:"source" gorm:"column:source"`
	ContributedMicrocredits int64     `json:"contributedMicrocredits" gorm:"column:contributed_microcredits"`
	CommissionMicrocredits  int64     `json:"commissionMicrocredits" gorm:"column:commission_microcredits"`
	CreatedAt               time.Time `json:"createdAt" gorm:"column:created_at"`
}

// CommissionTotals 是推广中心指标卡使用的返佣额度汇总，单位均为微积分。
type CommissionTotals struct {
	FrozenMicrocredits      int64 `gorm:"column:frozen_microcredits"`
	AvailableMicrocredits   int64 `gorm:"column:available_microcredits"`
	ReviewMicrocredits      int64 `gorm:"column:review_microcredits"`
	TransferredMicrocredits int64 `gorm:"column:transferred_microcredits"`
	WithdrawnMicrocredits   int64 `gorm:"column:withdrawn_microcredits"`
	TotalMicrocredits       int64 `gorm:"column:total_microcredits"`
}

func (r *Repository) InviteCodeForUser(userID string) (*model.InviteCode, error) {
	var code model.InviteCode
	if err := r.db.First(&code, "user_id = ?", userID).Error; err != nil {
		return nil, err
	}
	return &code, nil
}

// SaveInviteCode 依靠 user_id 与 code 的唯一索引保证并发下只落一条。
func (r *Repository) SaveInviteCode(code *model.InviteCode) error {
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(code).Error
}

func (r *Repository) InviteCodeByCode(code string) (*model.InviteCode, error) {
	var record model.InviteCode
	if err := r.db.First(&record, "code = ?", code).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

func (r *Repository) InvitationForInvitee(inviteeID string) (*model.Invitation, error) {
	var invitation model.Invitation
	if err := r.db.First(&invitation, "invitee_id = ?", inviteeID).Error; err != nil {
		return nil, err
	}
	return &invitation, nil
}

// SaveInvitation 返回是否真正建立了新关系；重复绑定（含并发）返回 false。
func (r *Repository) SaveInvitation(invitation *model.Invitation) (bool, error) {
	created := r.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "invitee_id"}}, DoNothing: true}).Create(invitation)
	if created.Error != nil {
		return false, created.Error
	}
	return created.RowsAffected == 1, nil
}

func (r *Repository) CountInvitations(inviterID string) (int64, error) {
	var total int64
	err := r.db.Model(&model.Invitation{}).Where("inviter_id = ?", inviterID).Count(&total).Error
	return total, err
}

func (r *Repository) PromotionInvitationPage(inviterID string, offset, limit int) ([]PromotionInvitationRow, int64, error) {
	var total int64
	if err := r.db.Model(&model.Invitation{}).Where("inviter_id = ?", inviterID).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	rows := make([]PromotionInvitationRow, 0, limit)
	err := r.db.Table("invitations").
		Select(`invitations.id AS id, invitations.invitee_id AS invitee_id,
			COALESCE(users.display_name, '') AS invitee_name,
			COALESCE(NULLIF(users.email, ''), users.username) AS invitee_contact,
			invitations.source AS source,
			COALESCE((SELECT SUM(commission_records.base_microcredits) FROM commission_records
				WHERE commission_records.inviter_id = invitations.inviter_id AND commission_records.invitee_id = invitations.invitee_id), 0) AS contributed_microcredits,
			COALESCE((SELECT SUM(commission_records.amount_microcredits) FROM commission_records
				WHERE commission_records.inviter_id = invitations.inviter_id AND commission_records.invitee_id = invitations.invitee_id), 0) AS commission_microcredits,
			invitations.created_at AS created_at`).
		Joins("LEFT JOIN users ON users.id = invitations.invitee_id").
		Where("invitations.inviter_id = ?", inviterID).
		Order("invitations.created_at DESC").
		Offset(offset).Limit(limit).
		Scan(&rows).Error
	return rows, total, err
}

// SaveCommissionRecord 以 reference_key 去重：回调重放或重复结算都只落一条。
func (r *Repository) SaveCommissionRecord(record *model.CommissionRecord) (bool, error) {
	created := r.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "reference_key"}}, DoNothing: true}).Create(record)
	if created.Error != nil {
		return false, created.Error
	}
	return created.RowsAffected == 1, nil
}

// CommissionTotals 汇总某个邀请人的返佣额度。可用额度扣除已分配部分，
// 审核占用与已转积分按分配明细统计，因此部分占用的记录也能算准。
func (r *Repository) CommissionTotals(inviterID string) (CommissionTotals, error) {
	totals := CommissionTotals{}
	if err := r.db.Model(&model.CommissionRecord{}).
		Select(`COALESCE(SUM(CASE WHEN status = 'frozen' THEN amount_microcredits ELSE 0 END), 0) AS frozen_microcredits,
			COALESCE(SUM(CASE WHEN status = 'available' THEN amount_microcredits - allocated_microcredits ELSE 0 END), 0) AS available_microcredits,
			COALESCE(SUM(CASE WHEN status = 'withdrawn' THEN amount_microcredits ELSE 0 END), 0) AS withdrawn_microcredits,
			COALESCE(SUM(amount_microcredits), 0) AS total_microcredits`).
		Where("inviter_id = ?", inviterID).
		Scan(&totals).Error; err != nil {
		return totals, err
	}
	type allocationTotals struct {
		ReviewMicrocredits      int64 `gorm:"column:review_microcredits"`
		TransferredMicrocredits int64 `gorm:"column:transferred_microcredits"`
	}
	var allocations allocationTotals
	if err := r.db.Model(&model.CommissionAllocation{}).
		Select(`COALESCE(SUM(CASE WHEN kind = 'withdrawal' AND status = 'pending' THEN amount_microcredits ELSE 0 END), 0) AS review_microcredits,
			COALESCE(SUM(CASE WHEN kind = 'transfer' AND status = 'completed' THEN amount_microcredits ELSE 0 END), 0) AS transferred_microcredits`).
		Where("user_id = ?", inviterID).
		Scan(&allocations).Error; err != nil {
		return totals, err
	}
	totals.ReviewMicrocredits = allocations.ReviewMicrocredits
	totals.TransferredMicrocredits = allocations.TransferredMicrocredits
	return totals, nil
}

// ReleaseDueCommissions 把冻结期满的返佣转为可用，返回本次解冻的条数。
func (r *Repository) ReleaseDueCommissions(inviterID string, now time.Time) (int64, error) {
	updated := r.db.Model(&model.CommissionRecord{}).
		Where("inviter_id = ? AND status = ? AND available_at <= ?", inviterID, model.CommissionFrozen, now).
		Updates(map[string]any{"status": model.CommissionAvailable, "updated_at": now})
	return updated.RowsAffected, updated.Error
}

func (r *Repository) CommissionRecordsForUser(inviterID string, status string, offset, limit int) ([]model.CommissionRecord, int64, error) {
	query := r.db.Model(&model.CommissionRecord{}).Where("inviter_id = ?", inviterID)
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	records := make([]model.CommissionRecord, 0, limit)
	err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&records).Error
	return records, total, err
}

func (r *Repository) Withdrawal(id string) (*model.WithdrawalRequest, error) {
	var request model.WithdrawalRequest
	if err := r.db.First(&request, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &request, nil
}

func (r *Repository) WithdrawalPage(userID string, status string, offset, limit int) ([]model.WithdrawalRequest, int64, error) {
	query := r.db.Model(&model.WithdrawalRequest{})
	if userID != "" {
		query = query.Where("user_id = ?", userID)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	requests := make([]model.WithdrawalRequest, 0, limit)
	err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&requests).Error
	return requests, total, err
}

// TransferCommissionToCredits 把可用返佣转为账户积分。分配与入账在同一事务内完成，
// 任一步失败都不会出现“返佣已扣但积分未到账”的中间状态。
func (r *Repository) TransferCommissionToCredits(userID string, amount int64, referenceKey string, note string) (*model.CreditAccount, error) {
	var account model.CreditAccount
	err := r.db.Transaction(func(tx *gorm.DB) error {
		// 幂等：同一请求重放时直接返回当前账户，避免重复占用返佣额度。
		var existing model.CreditLedgerEntry
		lookupErr := tx.First(&existing, "reference_key = ?", referenceKey).Error
		if lookupErr == nil {
			return tx.First(&account, "user_id = ?", userID).Error
		}
		if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			return lookupErr
		}
		if err := allocateCommissions(tx, userID, amount, model.AllocationTransfer, referenceKey, ""); err != nil {
			return err
		}
		// 转入是同步完成的资金动作，分配明细必须立刻生效，否则“已转积分”会一直统计不到。
		if err := tx.Model(&model.CommissionAllocation{}).
			Where("reference_id = ? AND kind = ? AND status = ?", referenceKey, model.AllocationTransfer, model.AllocationPending).
			Updates(map[string]any{"status": model.AllocationCompleted, "updated_at": time.Now()}).Error; err != nil {
			return err
		}
		if err := grantCreditsWithLedger(tx, userID, amount, model.CreditLedgerPromotionCommission, referenceKey, note); err != nil {
			return err
		}
		return tx.First(&account, "user_id = ?", userID).Error
	})
	if err != nil {
		return nil, err
	}
	return &account, nil
}

// CreateWithdrawalWithAllocation 先占用可用返佣再落申请，避免并发提交把同一笔额度提两次。
func (r *Repository) CreateWithdrawalWithAllocation(request *model.WithdrawalRequest) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := allocateCommissions(tx, request.UserID, request.AmountMicrocredits, model.AllocationWithdrawal, request.ID, request.ID); err != nil {
			return err
		}
		return tx.Create(request).Error
	})
}

// ReviewWithdrawal 审核提现：通过后占用额度转为已提现，驳回则按分配明细回退占用。
func (r *Repository) ReviewWithdrawal(adminID string, id string, approve bool, note string) (*model.WithdrawalRequest, error) {
	var request model.WithdrawalRequest
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&request, "id = ?", id).Error; err != nil {
			return err
		}
		if request.Status != model.WithdrawalPending {
			return ErrWithdrawalNotPending
		}
		now := time.Now()
		status := model.WithdrawalRejected
		if approve {
			status = model.WithdrawalApproved
			if err := tx.Model(&model.CommissionAllocation{}).
				Where("reference_id = ? AND kind = ? AND status = ?", id, model.AllocationWithdrawal, model.AllocationPending).
				Updates(map[string]any{"status": model.AllocationCompleted, "updated_at": now}).Error; err != nil {
				return err
			}
			// 整条被本次提现占用的返佣标记为已提现；部分占用的记录仍可继续参与后续操作。
			if err := tx.Model(&model.CommissionRecord{}).
				Where("withdrawal_id = ?", id).
				Updates(map[string]any{"status": model.CommissionWithdrawn, "updated_at": now}).Error; err != nil {
				return err
			}
		} else if err := releaseWithdrawalAllocations(tx, id); err != nil {
			return err
		}
		return tx.Model(&model.WithdrawalRequest{}).Where("id = ?", id).Updates(map[string]any{
			"status": status, "review_note": note, "reviewed_by": adminID, "reviewed_at": now, "updated_at": now,
		}).Error
	})
	if err != nil {
		return nil, err
	}
	return r.Withdrawal(id)
}

// allocateCommissions 按时间顺序占用可用返佣额度，允许一条记录被多次拆用。
func allocateCommissions(tx *gorm.DB, inviterID string, amount int64, kind model.AllocationKind, referenceID string, withdrawalID string) error {
	if amount <= 0 {
		return ErrCommissionInsufficient
	}
	var records []model.CommissionRecord
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("inviter_id = ? AND status = ? AND amount_microcredits > allocated_microcredits", inviterID, model.CommissionAvailable).
		Order("created_at ASC").
		Find(&records).Error; err != nil {
		return err
	}
	remaining := amount
	now := time.Now()
	for index := range records {
		record := records[index]
		free := record.AmountMicrocredits - record.AllocatedMicrocredits
		if free <= 0 {
			continue
		}
		take := remaining
		if take > free {
			take = free
		}
		allocated := record.AllocatedMicrocredits + take
		status := record.Status
		recordWithdrawalID := ""
		if allocated >= record.AmountMicrocredits {
			recordWithdrawalID = withdrawalID
			if kind == model.AllocationWithdrawal {
				status = model.CommissionWithdrawing
			} else {
				status = model.CommissionTransferred
			}
		}
		if err := tx.Model(&model.CommissionRecord{}).Where("id = ?", record.ID).Updates(map[string]any{
			"allocated_microcredits": allocated,
			"status":                 status,
			"withdrawal_id":          recordWithdrawalID,
			"updated_at":             now,
		}).Error; err != nil {
			return err
		}
		if err := tx.Create(&model.CommissionAllocation{
			ID: newRepositoryID(), CommissionID: record.ID, UserID: inviterID,
			AmountMicrocredits: take, Kind: kind, ReferenceID: referenceID, Status: model.AllocationPending,
		}).Error; err != nil {
			return err
		}
		remaining -= take
		if remaining == 0 {
			break
		}
	}
	if remaining > 0 {
		return ErrCommissionInsufficient
	}
	return nil
}

func releaseWithdrawalAllocations(tx *gorm.DB, withdrawalID string) error {
	var allocations []model.CommissionAllocation
	if err := tx.Where("reference_id = ? AND kind = ? AND status = ?", withdrawalID, model.AllocationWithdrawal, model.AllocationPending).
		Find(&allocations).Error; err != nil {
		return err
	}
	now := time.Now()
	for _, allocation := range allocations {
		if err := tx.Model(&model.CommissionRecord{}).Where("id = ?", allocation.CommissionID).Updates(map[string]any{
			"allocated_microcredits": gorm.Expr("allocated_microcredits - ?", allocation.AmountMicrocredits),
			"status":                 model.CommissionAvailable,
			"withdrawal_id":          "",
			"updated_at":             now,
		}).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.CommissionAllocation{}).Where("id = ?", allocation.ID).
			Updates(map[string]any{"status": model.AllocationReleased, "updated_at": now}).Error; err != nil {
			return err
		}
	}
	return nil
}

// grantCreditsWithLedger 增加可用积分并写入流水，reference_key 复用为幂等键。
func grantCreditsWithLedger(tx *gorm.DB, userID string, amount int64, entryType model.CreditLedgerType, referenceKey string, note string) error {
	if amount <= 0 {
		return ErrCommissionInsufficient
	}
	var existing model.CreditLedgerEntry
	err := tx.First(&existing, "reference_key = ?", referenceKey).Error
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	account := model.CreditAccount{UserID: userID}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
		return err
	}
	if err := tx.Model(&model.CreditAccount{}).Where("user_id = ?", userID).
		Updates(map[string]any{
			"available_microcredits": gorm.Expr("available_microcredits + ?", amount),
			"version":                gorm.Expr("version + 1"),
			"updated_at":             time.Now(),
		}).Error; err != nil {
		return err
	}
	if err := tx.First(&account, "user_id = ?", userID).Error; err != nil {
		return err
	}
	reference := referenceKey
	return tx.Create(&model.CreditLedgerEntry{
		ID:                         newRepositoryID(),
		UserID:                     userID,
		Type:                       entryType,
		AmountMicrocredits:         amount,
		AvailableDeltaMicrocredits: amount,
		AvailableAfterMicrocredits: account.AvailableMicrocredits,
		ReservedAfterMicrocredits:  account.ReservedMicrocredits,
		ReferenceKey:               &reference,
		Note:                       note,
	}).Error
}
