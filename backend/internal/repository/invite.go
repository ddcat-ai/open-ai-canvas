package repository

import (
	"errors"
	"math"
	"sort"
	"strings"
	"time"

	"yingce/backend/internal/invite"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/mattn/go-sqlite3"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrRewardInsufficientBalance = errors.New("reward balance insufficient")
	ErrRewardAmountOverflow      = errors.New("reward balance amount overflow")
	ErrWithdrawDailyLimit        = errors.New("withdraw daily limit reached")
	ErrWithdrawStateConflict     = errors.New("withdraw request state conflict")
	ErrInviteRecordStateConflict = errors.New("invite record state conflict")
)

// 关系和策略变更先串行化；仅锁策略行无法覆盖尚未写入的首次配置。
func lockInviteMutationTx(tx *gorm.DB) error {
	if tx.Dialector.Name() == "postgres" {
		return tx.Exec("SELECT pg_advisory_xact_lock(?)", int64(0x494e56495445)).Error
	}
	return tx.Exec("UPDATE users SET updated_at = updated_at WHERE 1 = 0").Error
}

func appendInviteAuditsTx(tx *gorm.DB, audits []model.AdminAuditEvent) error {
	if len(audits) == 0 {
		return nil
	}
	return tx.Create(&audits).Error
}

// ===== 账户与通用资金移动 =====

// RewardAccount 读取奖励账户；不存在时返回零值账户而不是错误。
func (r *Repository) RewardAccount(userID string) (*model.RewardAccount, error) {
	account := model.RewardAccount{UserID: userID}
	if err := r.db.Where("user_id = ?", userID).First(&account).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &model.RewardAccount{UserID: userID}, nil
		}
		return nil, err
	}
	return &account, nil
}

func ensureRewardAccountTx(tx *gorm.DB, userID string) error {
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.RewardAccount{UserID: userID}).Error
}

// 多账户资金移动前按用户 ID 预锁，避免两级奖励顺序相反时形成死锁。
func lockRewardAccountsTx(tx *gorm.DB, userIDs ...string) error {
	seen := map[string]bool{}
	ids := make([]string, 0, len(userIDs))
	for _, id := range userIDs {
		if id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	for _, id := range ids {
		if err := ensureRewardAccountTx(tx, id); err != nil {
			return err
		}
		var account model.RewardAccount
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", id).First(&account).Error; err != nil {
			return err
		}
	}
	return nil
}

// moveRewardTx 按增量移动奖励账户四池。守恒式 total = available + frozen + used
// 在全部路径上成立：待审核奖励同时计入 total 与 frozen，作废时同步扣减。
// 条件更新同时防止负余额和整数溢出。
func moveRewardTx(tx *gorm.DB, userID string, dTotal, dAvailable, dFrozen, dUsed int64) error {
	if dTotal == 0 && dAvailable == 0 && dFrozen == 0 && dUsed == 0 {
		return nil
	}
	if dTotal == math.MinInt64 || dAvailable == math.MinInt64 || dFrozen == math.MinInt64 || dUsed == math.MinInt64 {
		return ErrRewardAmountOverflow
	}
	sum, ok := checkedRewardAdd(dAvailable, dFrozen)
	if !ok {
		return ErrRewardAmountOverflow
	}
	sum, ok = checkedRewardAdd(sum, dUsed)
	if !ok || sum != dTotal {
		return ErrRewardAmountOverflow
	}
	if err := ensureRewardAccountTx(tx, userID); err != nil {
		return err
	}
	query := tx.Model(&model.RewardAccount{}).Where("user_id = ?", userID)
	for _, delta := range []struct {
		column string
		value  int64
	}{{"total_micro_yuan", dTotal}, {"available_micro_yuan", dAvailable}, {"frozen_micro_yuan", dFrozen}, {"used_micro_yuan", dUsed}} {
		if delta.value < 0 {
			query = query.Where(delta.column+" >= ?", -delta.value)
		} else if delta.value > 0 {
			query = query.Where(delta.column+" <= ?", math.MaxInt64-delta.value)
		}
	}
	result := query.Updates(map[string]any{
		"total_micro_yuan":     gorm.Expr("total_micro_yuan + ?", dTotal),
		"available_micro_yuan": gorm.Expr("available_micro_yuan + ?", dAvailable),
		"frozen_micro_yuan":    gorm.Expr("frozen_micro_yuan + ?", dFrozen),
		"used_micro_yuan":      gorm.Expr("used_micro_yuan + ?", dUsed),
		"version":              gorm.Expr("version + 1"),
		"updated_at":           time.Now(),
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		if dAvailable < 0 {
			return ErrRewardInsufficientBalance
		}
		return ErrRewardAmountOverflow
	}
	return nil
}

func checkedRewardAdd(a, b int64) (int64, bool) {
	if (b > 0 && a > math.MaxInt64-b) || (b < 0 && a < math.MinInt64-b) {
		return 0, false
	}
	return a + b, true
}

// ===== 邀请码与邀请记录 =====

// EnsureUserInviteCode 保证用户持有唯一邀请码；并发冲突时重试。
func (r *Repository) EnsureUserInviteCode(userID string) (string, error) {
	for attempt := 0; attempt < 5; attempt++ {
		var user model.User
		if err := r.db.Select("id", "invite_code").Where("id = ?", userID).First(&user).Error; err != nil {
			return "", err
		}
		if strings.TrimSpace(user.InviteCode) != "" {
			return user.InviteCode, nil
		}
		code, err := invite.GenerateInviteCode()
		if err != nil {
			return "", err
		}
		result := r.db.Model(&model.User{}).Where("id = ? AND (invite_code = '' OR invite_code IS NULL)", userID).
			Update("invite_code", code)
		if result.Error != nil {
			if inviteCodeCollision(result.Error) {
				continue
			}
			return "", result.Error
		}
		if result.RowsAffected == 1 {
			return code, nil
		}
	}
	return "", errors.New("邀请码生成冲突次数过多")
}

func inviteCodeCollision(err error) bool {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	var sqliteErr sqlite3.Error
	return errors.As(err, &sqliteErr) && sqliteErr.ExtendedCode == sqlite3.ErrConstraintUnique
}

// CountDownline 统计某用户的下游被邀请人数（一级 + 二级）。
func (r *Repository) CountDownline(userID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.InviteRecord{}).
		Where("l1_inviter_id = ? OR l2_inviter_id = ?", userID, userID).Count(&count).Error
	return count, err
}

// InviteRecord 读取某用户的邀请记录；不存在返回 nil。
func (r *Repository) InviteRecord(userID string) (*model.InviteRecord, error) {
	var record model.InviteRecord
	err := r.db.Where("user_id = ?", userID).First(&record).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &record, nil
}

// UpdateInvitePolicy 同步审核开关与存量邀请状态，避免开关变化后沿用旧审批结果。
func (r *Repository) UpdateInvitePolicy(setting *model.SystemSetting, policy invite.InvitePolicy, audits ...model.AdminAuditEvent) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockInviteMutationTx(tx); err != nil {
			return err
		}
		var current model.SystemSetting
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("key = ?", invite.SettingKey).First(&current).Error
		oldPolicy := invite.DefaultInvitePolicy()
		if err == nil {
			oldPolicy, err = invite.ParseInvitePolicy(current.ValueJSON)
			if err != nil {
				return err
			}
			setting.CreatedAt = current.CreatedAt
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if oldPolicy.AuditEnabled != policy.AuditEnabled {
			if policy.AuditEnabled {
				if err := tx.Model(&model.InviteRecord{}).Where("status = ?", model.InviteRecordApproved).
					Updates(map[string]any{"status": model.InviteRecordPending, "approved_at": nil, "updated_at": time.Now()}).Error; err != nil {
					return err
				}
			} else {
				var pending []model.InviteRecord
				if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("status = ?", model.InviteRecordPending).
					Order("user_id").Find(&pending).Error; err != nil {
					return err
				}
				if len(pending) > 0 {
					inviteeIDs := make([]string, 0, len(pending))
					for _, record := range pending {
						inviteeIDs = append(inviteeIDs, record.UserID)
					}
					var rewards []model.InviteRewardRecord
					if err := tx.Where("invitee_id IN ? AND status = ?", inviteeIDs, model.InviteRewardPending).Find(&rewards).Error; err != nil {
						return err
					}
					recipients := make([]string, 0, len(rewards))
					for _, reward := range rewards {
						recipients = append(recipients, reward.InviterID)
					}
					if err := lockRewardAccountsTx(tx, recipients...); err != nil {
						return err
					}
				}
				for _, record := range pending {
					if _, err := approveInviteRecordTx(tx, record.UserID); err != nil {
						return err
					}
				}
			}
		}
		if err := tx.Save(setting).Error; err != nil {
			return err
		}
		return appendInviteAuditsTx(tx, audits)
	})
}

// AttachInviteRecord 在注册完成后建立邀请关系：解析 L1/L2、应用人数上限、落记录。
// 邀请码无效、功能不满足条件时返回 (nil, false, nil)，注册流程据此静默忽略。
func (r *Repository) AttachInviteRecord(userID string, code string, policy invite.InvitePolicy) (*model.InviteRecord, bool, error) {
	code = invite.NormalizeInviteCode(code)
	if code == "" {
		return nil, false, nil
	}
	var created *model.InviteRecord
	attached := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		created = nil
		attached = false
		if err := lockInviteMutationTx(tx); err != nil {
			return err
		}
		var setting model.SystemSetting
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("key = ?", invite.SettingKey).First(&setting).Error; err == nil {
			policy, err = invite.ParseInvitePolicy(setting.ValueJSON)
			if err != nil {
				return err
			}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if !policy.Enabled {
			return nil
		}
		var existing model.InviteRecord
		err := tx.Where("user_id = ?", userID).First(&existing).Error
		if err == nil {
			created = &existing
			attached = true
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var inviter model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("invite_code = ? AND status = ?", code, model.UserStatusActive).First(&inviter).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if inviter.ID == userID {
			return nil
		}
		l1ID := inviter.ID
		if policy.InviteeCountLimit > 0 {
			var count int64
			if err := tx.Model(&model.InviteRecord{}).
				Where("l1_inviter_id = ? OR l2_inviter_id = ?", l1ID, l1ID).Count(&count).Error; err != nil {
				return err
			}
			if count >= policy.InviteeCountLimit {
				return nil
			}
		}
		l2ID := ""
		if policy.Level == 2 {
			var inviterRecord model.InviteRecord
			err := tx.Where("user_id = ?", inviter.ID).First(&inviterRecord).Error
			if err == nil && inviterRecord.L1InviterID != "" && inviterRecord.L1InviterID != userID {
				candidate := inviterRecord.L1InviterID
				if policy.InviteeCountLimit > 0 {
					var count int64
					if err := tx.Model(&model.InviteRecord{}).
						Where("l1_inviter_id = ? OR l2_inviter_id = ?", candidate, candidate).Count(&count).Error; err != nil {
						return err
					}
					if count < policy.InviteeCountLimit {
						l2ID = candidate
					}
				} else {
					l2ID = candidate
				}
			} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
		status := model.InviteRecordApproved
		if policy.AuditEnabled {
			status = model.InviteRecordPending
		}
		if err := validateInviteInvitersTx(tx, userID, l1ID, l2ID); err != nil {
			var invalid *kernel.AppError
			if errors.As(err, &invalid) && (invalid.Status == 400 || invalid.Status == 404) {
				return nil
			}
			return err
		}
		record := model.InviteRecord{
			UserID: userID, L1InviterID: l1ID, L2InviterID: l2ID, CodeUsed: code,
			Status: status, CreatedAt: time.Now(), UpdatedAt: time.Now(),
		}
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&record)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 1 {
			created = &record
			attached = true
		}
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return created, attached, nil
}

// AdminInviteRecordView 管理端邀请记录行：携带三方用户展示信息与奖励汇总。
type AdminInviteRecordView struct {
	model.InviteRecord
	InviteeUsername    string `json:"inviteeUsername"`
	InviteeDisplayName string `json:"inviteeDisplayName"`
	L1Username         string `json:"l1Username"`
	L2Username         string `json:"l2Username"`
	CreditedMicroYuan  int64  `json:"creditedMicroYuan"`
	PendingMicroYuan   int64  `json:"pendingMicroYuan"`
}

// AdminInviteQuery 管理端邀请记录筛选。
type AdminInviteQuery struct {
	Status  string
	Keyword string
	Limit   int
	Offset  int
}

// AdminInviteRecords 管理端邀请记录分页列表。
func (r *Repository) AdminInviteRecords(query AdminInviteQuery) ([]AdminInviteRecordView, int64, error) {
	db := r.db.Model(&model.InviteRecord{})
	if query.Status != "" {
		db = db.Where("status = ?", query.Status)
	}
	if keyword := strings.TrimSpace(query.Keyword); keyword != "" {
		pattern := "%" + keyword + "%"
		var ids []string
		if err := r.db.Model(&model.User{}).Where("username LIKE ? OR display_name LIKE ? OR id = ?", pattern, pattern, keyword).Pluck("id", &ids).Error; err != nil {
			return nil, 0, err
		}
		if len(ids) == 0 {
			return []AdminInviteRecordView{}, 0, nil
		}
		db = db.Where("user_id IN ? OR l1_inviter_id IN ? OR l2_inviter_id IN ?", ids, ids, ids)
	}
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []model.InviteRecord
	if err := db.Order("created_at desc").Limit(query.Limit).Offset(query.Offset).Find(&records).Error; err != nil {
		return nil, 0, err
	}
	views, err := r.decorateInviteRecords(records)
	return views, total, err
}

// AdminInviteRecordByUserID 按被邀请人主键读取详情，不使用列表关键词匹配。
func (r *Repository) AdminInviteRecordByUserID(userID string) (*AdminInviteRecordView, error) {
	record, err := r.InviteRecord(userID)
	if err != nil || record == nil {
		return nil, err
	}
	views, err := r.decorateInviteRecords([]model.InviteRecord{*record})
	if err != nil {
		return nil, err
	}
	return &views[0], nil
}

func (r *Repository) decorateInviteRecords(records []model.InviteRecord) ([]AdminInviteRecordView, error) {
	views := make([]AdminInviteRecordView, 0, len(records))
	if len(records) == 0 {
		return views, nil
	}
	userIDSet := map[string]bool{}
	for _, record := range records {
		userIDSet[record.UserID] = true
		if record.L1InviterID != "" {
			userIDSet[record.L1InviterID] = true
		}
		if record.L2InviterID != "" {
			userIDSet[record.L2InviterID] = true
		}
	}
	ids := mapKeys(userIDSet)
	userMap, err := r.UsersByIDs(ids)
	if err != nil {
		return nil, err
	}
	var sums []struct {
		InviteeID string                         `column:"invitee_id"`
		Status    model.InviteRewardRecordStatus `column:"status"`
		Total     int64                          `column:"total"`
	}
	inviteeIDs := mapKeys(mapFromRecords(records, func(record model.InviteRecord) string { return record.UserID }))
	if err := r.db.Model(&model.InviteRewardRecord{}).
		Select("invitee_id, status, SUM(amount_micro_yuan) AS total").
		Where("invitee_id IN ?", inviteeIDs).
		Group("invitee_id, status").Scan(&sums).Error; err != nil {
		return nil, err
	}
	creditedMap := map[string]int64{}
	pendingMap := map[string]int64{}
	for _, sum := range sums {
		if sum.Status == model.InviteRewardCredited {
			creditedMap[sum.InviteeID] = sum.Total
		}
		if sum.Status == model.InviteRewardPending {
			pendingMap[sum.InviteeID] = sum.Total
		}
	}
	for _, record := range records {
		view := AdminInviteRecordView{InviteRecord: record}
		if user, ok := userMap[record.UserID]; ok {
			view.InviteeUsername = user.Username
			view.InviteeDisplayName = user.DisplayName
		}
		if user, ok := userMap[record.L1InviterID]; ok {
			view.L1Username = user.Username
		}
		if user, ok := userMap[record.L2InviterID]; ok {
			view.L2Username = user.Username
		}
		view.CreditedMicroYuan = creditedMap[record.UserID]
		view.PendingMicroYuan = pendingMap[record.UserID]
		views = append(views, view)
	}
	return views, nil
}

func mapKeys(set map[string]bool) []string {
	ids := make([]string, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	return ids
}

func mapFromRecords(records []model.InviteRecord, pick func(model.InviteRecord) string) map[string]bool {
	set := map[string]bool{}
	for _, record := range records {
		set[pick(record)] = true
	}
	return set
}

// UserInviteRecordView 用户端邀请记录行：我（作为一级或二级邀请人）从这名被邀请人处获得的奖励。
type UserInviteRecordView struct {
	model.InviteRecord
	MyLevel             int    `json:"myLevel"`
	InviteeUsername     string `json:"inviteeUsername"`
	InviteeDisplayName  string `json:"inviteeDisplayName"`
	MyCreditedMicroYuan int64  `json:"myCreditedMicroYuan"`
	MyPendingMicroYuan  int64  `json:"myPendingMicroYuan"`
}

// UserInviteRecords 我作为一级/二级邀请人的记录分页。
func (r *Repository) UserInviteRecords(inviterID string, limit, offset int) ([]UserInviteRecordView, int64, error) {
	db := r.db.Model(&model.InviteRecord{}).Where("l1_inviter_id = ? OR l2_inviter_id = ?", inviterID, inviterID)
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []model.InviteRecord
	if err := db.Order("created_at desc").Limit(limit).Offset(offset).Find(&records).Error; err != nil {
		return nil, 0, err
	}
	views := make([]UserInviteRecordView, 0, len(records))
	if len(records) == 0 {
		return views, total, nil
	}
	var sums []struct {
		InviteeID string                         `column:"invitee_id"`
		Status    model.InviteRewardRecordStatus `column:"status"`
		Total     int64                          `column:"total"`
	}
	inviteeIDs := mapKeys(mapFromRecords(records, func(record model.InviteRecord) string { return record.UserID }))
	if err := r.db.Model(&model.InviteRewardRecord{}).
		Select("invitee_id, status, SUM(amount_micro_yuan) AS total").
		Where("inviter_id = ? AND invitee_id IN ?", inviterID, inviteeIDs).
		Group("invitee_id, status").Scan(&sums).Error; err != nil {
		return nil, 0, err
	}
	creditedMap := map[string]int64{}
	pendingMap := map[string]int64{}
	for _, sum := range sums {
		if sum.Status == model.InviteRewardCredited {
			creditedMap[sum.InviteeID] = sum.Total
		}
		if sum.Status == model.InviteRewardPending {
			pendingMap[sum.InviteeID] = sum.Total
		}
	}
	userMap, err := r.UsersByIDs(inviteeIDs)
	if err != nil {
		return nil, 0, err
	}
	for _, record := range records {
		view := UserInviteRecordView{InviteRecord: record}
		view.MyLevel = 1
		if record.L1InviterID != inviterID {
			view.MyLevel = 2
		}
		if user, ok := userMap[record.UserID]; ok {
			view.InviteeUsername = user.Username
			view.InviteeDisplayName = user.DisplayName
		}
		view.MyCreditedMicroYuan = creditedMap[record.UserID]
		view.MyPendingMicroYuan = pendingMap[record.UserID]
		views = append(views, view)
	}
	return views, total, nil
}

// InviteRewardRecordsByInvitee 某被邀请人产生的奖励明细（管理端详情抽屉）。
func (r *Repository) InviteRewardRecordsByInvitee(inviteeID string, limit int) ([]model.InviteRewardRecord, error) {
	var records []model.InviteRewardRecord
	query := r.db.Where("invitee_id = ?", inviteeID).Order("created_at desc")
	if limit > 0 {
		query = query.Limit(limit)
	}
	err := query.Find(&records).Error
	return records, err
}

// reattributePendingRewardsTx 把某级别待审核奖励从旧邀请人改挂到新邀请人；
// 新邀请人为空则作废。历史 credited 记录不改。
func reattributePendingRewardsTx(tx *gorm.DB, inviteeID string, level int, oldInviter, newInviter string) error {
	var pending []model.InviteRewardRecord
	if err := tx.Where("invitee_id = ? AND level = ? AND status = ?", inviteeID, level, model.InviteRewardPending).
		Find(&pending).Error; err != nil {
		return err
	}
	now := time.Now()
	for _, record := range pending {
		if oldInviter != "" {
			if err := moveRewardTx(tx, oldInviter, -record.AmountMicroYuan, 0, -record.AmountMicroYuan, 0); err != nil {
				return err
			}
		}
		if newInviter != "" {
			if err := moveRewardTx(tx, newInviter, record.AmountMicroYuan, 0, record.AmountMicroYuan, 0); err != nil {
				return err
			}
			if err := tx.Model(&model.InviteRewardRecord{}).Where("id = ?", record.ID).
				Updates(map[string]any{"inviter_id": newInviter, "updated_at": now}).Error; err != nil {
				return err
			}
		} else {
			if err := tx.Model(&model.InviteRewardRecord{}).Where("id = ?", record.ID).
				Updates(map[string]any{"status": model.InviteRewardVoided, "updated_at": now}).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

// UpdateInviteInviters 管理端编辑被邀请人的一级/二级邀请人（含待审核奖励改挂）。
func (r *Repository) UpdateInviteInviters(userID, l1InviterID, l2InviterID string, audits ...model.AdminAuditEvent) (*model.InviteRecord, error) {
	var updated *model.InviteRecord
	err := r.db.Transaction(func(tx *gorm.DB) error {
		updated = nil
		if err := lockInviteMutationTx(tx); err != nil {
			return err
		}
		var record model.InviteRecord
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).First(&record).Error; err != nil {
			return err
		}
		if err := validateInviteInvitersTx(tx, userID, l1InviterID, l2InviterID); err != nil {
			return err
		}
		var pending []model.InviteRewardRecord
		if err := tx.Where("invitee_id = ? AND status = ?", userID, model.InviteRewardPending).Find(&pending).Error; err != nil {
			return err
		}
		recipients := make([]string, 0, len(pending)*2)
		for _, reward := range pending {
			recipients = append(recipients, reward.InviterID)
			switch reward.Level {
			case 1:
				recipients = append(recipients, l1InviterID)
			case 2:
				recipients = append(recipients, l2InviterID)
			}
		}
		if err := lockRewardAccountsTx(tx, recipients...); err != nil {
			return err
		}
		if record.L1InviterID != l1InviterID {
			if err := reattributePendingRewardsTx(tx, userID, 1, record.L1InviterID, l1InviterID); err != nil {
				return err
			}
		}
		if record.L2InviterID != l2InviterID {
			if err := reattributePendingRewardsTx(tx, userID, 2, record.L2InviterID, l2InviterID); err != nil {
				return err
			}
		}
		result := tx.Model(&model.InviteRecord{}).Where("user_id = ?", userID).Updates(map[string]any{
			"l1_inviter_id": l1InviterID, "l2_inviter_id": l2InviterID, "updated_at": time.Now(),
		})
		if result.Error != nil {
			return result.Error
		}
		fresh, err := loadInviteRecordTx(tx, userID)
		if err != nil {
			return err
		}
		updated = fresh
		return appendInviteAuditsTx(tx, audits)
	})
	return updated, err
}

func validateInviteInvitersTx(tx *gorm.DB, userID, l1InviterID, l2InviterID string) error {
	if l1InviterID == userID || l2InviterID == userID {
		return kernel.BadAuthRequest("邀请人不能是被邀请人本人")
	}
	if l1InviterID != "" && l1InviterID == l2InviterID {
		return kernel.BadAuthRequest("一级邀请人与二级邀请人不能相同")
	}
	for _, id := range []string{l1InviterID, l2InviterID} {
		if id == "" {
			continue
		}
		var user model.User
		if err := tx.Select("id").Where("id = ?", id).First(&user).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return kernel.NotFound("邀请人用户不存在")
			}
			return err
		}
	}
	// 两级邀请人都构成关系边；持有变更锁时遍历全部祖先，防止并发调整形成环。
	queue := []string{l1InviterID, l2InviterID}
	seen := map[string]bool{}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		if id == userID {
			return kernel.BadAuthRequest("该调整会形成邀请环，请更换邀请人")
		}
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		var record model.InviteRecord
		err := tx.Where("user_id = ?", id).First(&record).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			return err
		}
		queue = append(queue, record.L1InviterID, record.L2InviterID)
	}
	return nil
}

func loadInviteRecordTx(tx *gorm.DB, userID string) (*model.InviteRecord, error) {
	var record model.InviteRecord
	if err := tx.Where("user_id = ?", userID).First(&record).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

// voidPendingRewardsTx 作废被邀请人名下全部待审核奖励并释放对应邀请人冻结余额。
func voidPendingRewardsTx(tx *gorm.DB, inviteeID string) error {
	var pending []model.InviteRewardRecord
	if err := tx.Where("invitee_id = ? AND status = ?", inviteeID, model.InviteRewardPending).Find(&pending).Error; err != nil {
		return err
	}
	recipients := make([]string, 0, len(pending))
	for _, reward := range pending {
		recipients = append(recipients, reward.InviterID)
	}
	if err := lockRewardAccountsTx(tx, recipients...); err != nil {
		return err
	}
	now := time.Now()
	for _, record := range pending {
		if err := moveRewardTx(tx, record.InviterID, -record.AmountMicroYuan, 0, -record.AmountMicroYuan, 0); err != nil {
			return err
		}
		if err := tx.Model(&model.InviteRewardRecord{}).Where("id = ?", record.ID).
			Updates(map[string]any{"status": model.InviteRewardVoided, "updated_at": now}).Error; err != nil {
			return err
		}
	}
	return nil
}

// ApproveInviteRecord 管理员通过邀请记录：全部待审核奖励转入邀请人可用余额。
func (r *Repository) ApproveInviteRecord(userID string, audits ...model.AdminAuditEvent) (*model.InviteRecord, error) {
	var result *model.InviteRecord
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = approveInviteRecordTx(tx, userID)
		if err != nil {
			return err
		}
		return appendInviteAuditsTx(tx, audits)
	})
	return result, err
}

func approveInviteRecordTx(tx *gorm.DB, userID string) (*model.InviteRecord, error) {
	record, err := lockInviteRecordTx(tx, userID)
	if err != nil {
		return nil, err
	}
	if record.Status != model.InviteRecordPending && record.Status != model.InviteRecordFrozen {
		return nil, ErrInviteRecordStateConflict
	}
	if record.Status == model.InviteRecordPending {
		var pending []model.InviteRewardRecord
		if err := tx.Where("invitee_id = ? AND status = ?", userID, model.InviteRewardPending).Find(&pending).Error; err != nil {
			return nil, err
		}
		recipients := make([]string, 0, len(pending))
		for _, reward := range pending {
			recipients = append(recipients, reward.InviterID)
		}
		if err := lockRewardAccountsTx(tx, recipients...); err != nil {
			return nil, err
		}
		now := time.Now()
		for _, reward := range pending {
			// 待审核奖励发放时已计入 total，通过只是冻结转可用。
			if err := moveRewardTx(tx, reward.InviterID, 0, reward.AmountMicroYuan, -reward.AmountMicroYuan, 0); err != nil {
				return nil, err
			}
			if err := tx.Model(&model.InviteRewardRecord{}).Where("id = ?", reward.ID).
				Updates(map[string]any{"status": model.InviteRewardCredited, "credited_at": &now, "updated_at": now}).Error; err != nil {
				return nil, err
			}
		}
	}
	now := time.Now()
	if err := tx.Model(&model.InviteRecord{}).Where("user_id = ?", userID).Updates(map[string]any{
		"status": model.InviteRecordApproved, "approved_at": &now, "frozen_at": nil, "updated_at": now,
	}).Error; err != nil {
		return nil, err
	}
	return loadInviteRecordTx(tx, userID)
}

// FreezeInviteRecord 管理员冻结邀请记录：pending 记录作废待审核奖励；approved 记录仅停止后续奖励。
func (r *Repository) FreezeInviteRecord(userID string, audits ...model.AdminAuditEvent) (*model.InviteRecord, error) {
	var result *model.InviteRecord
	err := r.db.Transaction(func(tx *gorm.DB) error {
		result = nil
		record, err := lockInviteRecordTx(tx, userID)
		if err != nil {
			return err
		}
		if record.Status == model.InviteRecordFrozen {
			return ErrInviteRecordStateConflict
		}
		if record.Status == model.InviteRecordPending {
			if err := voidPendingRewardsTx(tx, userID); err != nil {
				return err
			}
		}
		now := time.Now()
		if err := tx.Model(&model.InviteRecord{}).Where("user_id = ?", userID).Updates(map[string]any{
			"status": model.InviteRecordFrozen, "frozen_at": &now, "updated_at": now,
		}).Error; err != nil {
			return err
		}
		result, err = loadInviteRecordTx(tx, userID)
		if err != nil {
			return err
		}
		return appendInviteAuditsTx(tx, audits)
	})
	return result, err
}

// DeleteInviteRecord 删除邀请记录：先作废待审核奖励，已入账奖励保留。
func (r *Repository) DeleteInviteRecord(userID string, audits ...model.AdminAuditEvent) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		record, err := lockInviteRecordTx(tx, userID)
		if err != nil {
			return err
		}
		if record.Status == model.InviteRecordPending {
			if err := voidPendingRewardsTx(tx, userID); err != nil {
				return err
			}
		}
		if err := tx.Where("user_id = ?", userID).Delete(&model.InviteRecord{}).Error; err != nil {
			return err
		}
		return appendInviteAuditsTx(tx, audits)
	})
}

func lockInviteRecordTx(tx *gorm.DB, userID string) (*model.InviteRecord, error) {
	var record model.InviteRecord
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).First(&record).Error
	if err != nil {
		return nil, err
	}
	return &record, nil
}

// ===== 奖励发放（支付入账事务内调用） =====

// GrantInviteRewardsTx 在支付订单入账事务内为邀请人发放奖励。
// 通过锁定被邀请人的邀请记录行串行化并发订单，保证奖励次数限制计数准确；
// 是否冻结以行上实际状态为准（frozen 直接跳过，pending 冻结入账）。
func (r *Repository) GrantInviteRewardsTx(tx *gorm.DB, order *model.PaymentOrder, instruction *invite.InviteRewardInstruction) error {
	if instruction == nil || order == nil || order.AmountFen <= 0 {
		return nil
	}
	if instruction.InviteeID != order.UserID {
		return ErrInviteRecordStateConflict
	}
	lock, err := lockInviteRecordTx(tx, instruction.InviteeID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if lock.Status == model.InviteRecordFrozen {
		return nil
	}
	holdForAudit := lock.Status == model.InviteRecordPending
	now := time.Now()
	recipients := make([]string, 0, len(instruction.Levels))
	for _, level := range instruction.Levels {
		switch level.Level {
		case 1:
			recipients = append(recipients, lock.L1InviterID)
		case 2:
			recipients = append(recipients, lock.L2InviterID)
		}
	}
	if err := lockRewardAccountsTx(tx, recipients...); err != nil {
		return err
	}
	for _, level := range instruction.Levels {
		inviterID := ""
		switch level.Level {
		case 1:
			inviterID = lock.L1InviterID
		case 2:
			inviterID = lock.L2InviterID
		}
		if inviterID == "" || inviterID == instruction.InviteeID || level.RateBP <= 0 {
			continue
		}
		if level.RateBP > 10_000 || order.AmountFen > math.MaxInt64/level.RateBP {
			return ErrRewardAmountOverflow
		}
		if instruction.RewardCountLimit > 0 {
			var count int64
			if err := tx.Model(&model.InviteRewardRecord{}).
				Where("invitee_id = ? AND level = ? AND status <> ?", instruction.InviteeID, level.Level, model.InviteRewardVoided).
				Count(&count).Error; err != nil {
				return err
			}
			if count >= instruction.RewardCountLimit {
				continue
			}
		}
		amount := invite.RewardAmountMicroYuan(order.AmountFen, level.RateBP)
		if amount <= 0 {
			continue
		}
		referenceKey := invite.ReferenceKey(order.ID, level.Level)
		status := model.InviteRewardPending
		var creditedAt *time.Time
		if !holdForAudit {
			status = model.InviteRewardCredited
			creditedAt = &now
		}
		record := model.InviteRewardRecord{
			ID: newRepositoryID(), InviterID: inviterID, InviteeID: instruction.InviteeID,
			Level: level.Level, Source: instruction.Source, PaymentOrderID: order.ID,
			OrderAmountFen: order.AmountFen, RateBP: level.RateBP, AmountMicroYuan: amount,
			Status: status, ReferenceKey: referenceKey, CreditedAt: creditedAt,
			CreatedAt: now, UpdatedAt: now,
		}
		created := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "reference_key"}}, DoNothing: true}).Create(&record)
		if created.Error != nil {
			return created.Error
		}
		if created.RowsAffected == 0 {
			continue
		}
		if holdForAudit {
			// 待审核奖励同时计入 total 与 frozen，管理员通过后转入 available。
			if err := moveRewardTx(tx, inviterID, amount, 0, amount, 0); err != nil {
				return err
			}
		} else {
			if err := moveRewardTx(tx, inviterID, amount, amount, 0, 0); err != nil {
				return err
			}
		}
	}
	return nil
}

// InviteRewardSummary 今日获得奖励等汇总查询使用。
func (r *Repository) InviteRewardsCreditedSince(inviterID string, since time.Time) (int64, error) {
	var total int64
	err := r.db.Model(&model.InviteRewardRecord{}).
		Where("inviter_id = ? AND status = ? AND credited_at >= ?", inviterID, model.InviteRewardCredited, since).
		Select("COALESCE(SUM(amount_micro_yuan), 0)").Scan(&total).Error
	return total, err
}

// ===== 提现 =====

// CreateWithdrawRequest 串行化账户更新、每日次数校验、落单与常用账户保存。
func (r *Repository) CreateWithdrawRequest(request *model.WithdrawRequest, dailyLimit int64, saved *model.WithdrawAccount) error {
	if request == nil || request.UserID == "" || request.AmountMicroYuan <= 0 || request.FeeMicroYuan < 0 ||
		request.FeeMicroYuan > request.AmountMicroYuan || request.ActualMicroYuan != request.AmountMicroYuan-request.FeeMicroYuan {
		return ErrRewardAmountOverflow
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := moveRewardTx(tx, request.UserID, 0, -request.AmountMicroYuan, request.AmountMicroYuan, 0); err != nil {
			return err
		}
		if dailyLimit > 0 {
			created := request.CreatedAt
			start := time.Date(created.Year(), created.Month(), created.Day(), 0, 0, 0, 0, time.Local)
			var count int64
			if err := tx.Model(&model.WithdrawRequest{}).Where("user_id = ? AND created_at >= ?", request.UserID, start).Count(&count).Error; err != nil {
				return err
			}
			if count >= dailyLimit {
				return ErrWithdrawDailyLimit
			}
		}
		if err := tx.Create(request).Error; err != nil {
			return err
		}
		if saved != nil {
			if saved.UserID != request.UserID {
				return ErrInviteRecordStateConflict
			}
			return tx.Save(saved).Error
		}
		return nil
	})
}

// WithdrawRequestsByUser 用户端提现记录分页。
func (r *Repository) WithdrawRequestsByUser(userID string, limit, offset int) ([]model.WithdrawRequest, int64, error) {
	db := r.db.Model(&model.WithdrawRequest{}).Where("user_id = ?", userID)
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var requests []model.WithdrawRequest
	err := db.Order("created_at desc").Limit(limit).Offset(offset).Find(&requests).Error
	return requests, total, err
}

// WithdrawRequest 按 ID 读取提现申请。
func (r *Repository) WithdrawRequest(id string) (*model.WithdrawRequest, error) {
	var request model.WithdrawRequest
	if err := r.db.Where("id = ?", id).First(&request).Error; err != nil {
		return nil, err
	}
	return &request, nil
}

// AdminWithdrawView 管理端提现记录行。
type AdminWithdrawView struct {
	model.WithdrawRequest
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

// AdminWithdrawQuery 管理端提现筛选。
type AdminWithdrawQuery struct {
	Status  *int
	Method  string
	Keyword string
	From    *time.Time
	Until   *time.Time
	Limit   int
	Offset  int
}

// AdminWithdrawals 管理端提现记录分页。
func (r *Repository) AdminWithdrawals(query AdminWithdrawQuery) ([]AdminWithdrawView, int64, error) {
	db := r.db.Model(&model.WithdrawRequest{})
	if query.Status != nil {
		db = db.Where("status = ?", *query.Status)
	}
	if query.Method != "" {
		db = db.Where("method = ?", query.Method)
	}
	if query.From != nil {
		db = db.Where("created_at >= ?", *query.From)
	}
	if query.Until != nil {
		db = db.Where("created_at < ?", *query.Until)
	}
	if keyword := strings.TrimSpace(query.Keyword); keyword != "" {
		pattern := "%" + keyword + "%"
		var ids []string
		if err := r.db.Model(&model.User{}).Where("username LIKE ? OR display_name LIKE ? OR id = ?", pattern, pattern, keyword).Pluck("id", &ids).Error; err != nil {
			return nil, 0, err
		}
		if len(ids) == 0 {
			return []AdminWithdrawView{}, 0, nil
		}
		db = db.Where("user_id IN ?", ids)
	}
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var requests []model.WithdrawRequest
	if err := db.Order("created_at desc").Limit(query.Limit).Offset(query.Offset).Find(&requests).Error; err != nil {
		return nil, 0, err
	}
	views := make([]AdminWithdrawView, 0, len(requests))
	if len(requests) == 0 {
		return views, total, nil
	}
	userIDs := make([]string, 0, len(requests))
	for _, request := range requests {
		userIDs = append(userIDs, request.UserID)
	}
	userMap, err := r.UsersByIDs(userIDs)
	if err != nil {
		return nil, 0, err
	}
	for _, request := range requests {
		view := AdminWithdrawView{WithdrawRequest: request}
		if user, ok := userMap[request.UserID]; ok {
			view.Username = user.Username
			view.DisplayName = user.DisplayName
		}
		views = append(views, view)
	}
	return views, total, nil
}

// ReviewWithdrawRequest 管理端审核提现：0 → 2 成功（冻结转已使用）或 0 → 1 驳回（冻结退回可用）。
func (r *Repository) ReviewWithdrawRequest(id string, approve bool, reviewerID, reason string, audits ...model.AdminAuditEvent) (*model.WithdrawRequest, error) {
	if !approve && strings.TrimSpace(reason) == "" {
		return nil, kernel.BadAuthRequest("驳回时必须填写原因")
	}
	if len([]rune(strings.TrimSpace(reason))) > 200 {
		return nil, kernel.BadAuthRequest("驳回原因最多 200 个字符")
	}
	var result *model.WithdrawRequest
	err := r.db.Transaction(func(tx *gorm.DB) error {
		result = nil
		var request model.WithdrawRequest
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&request).Error; err != nil {
			return err
		}
		if request.Status != model.WithdrawStatusPending {
			return ErrWithdrawStateConflict
		}
		if approve {
			if err := moveRewardTx(tx, request.UserID, 0, 0, -request.AmountMicroYuan, request.AmountMicroYuan); err != nil {
				return err
			}
		} else {
			if err := moveRewardTx(tx, request.UserID, 0, request.AmountMicroYuan, -request.AmountMicroYuan, 0); err != nil {
				return err
			}
		}
		now := time.Now()
		status := model.WithdrawStatusSuccess
		finalReason := ""
		if !approve {
			status = model.WithdrawStatusRejected
			finalReason = strings.TrimSpace(reason)
		}
		if err := tx.Model(&model.WithdrawRequest{}).Where("id = ?", id).Updates(map[string]any{
			"status": status, "reject_reason": finalReason, "reviewed_by": reviewerID,
			"reviewed_at": &now, "updated_at": now,
		}).Error; err != nil {
			return err
		}
		fresh, err := txWhereWithdrawRequest(tx, id)
		if err != nil {
			return err
		}
		result = fresh
		return appendInviteAuditsTx(tx, audits)
	})
	return result, err
}

func txWhereWithdrawRequest(tx *gorm.DB, id string) (*model.WithdrawRequest, error) {
	var request model.WithdrawRequest
	if err := tx.Where("id = ?", id).First(&request).Error; err != nil {
		return nil, err
	}
	return &request, nil
}

// SaveWithdrawAccount 保存用户常用收款信息（覆盖式）。
func (r *Repository) SaveWithdrawAccount(account *model.WithdrawAccount) error {
	return r.db.Save(account).Error
}

// WithdrawAccount 读取用户常用收款信息；不存在返回 nil。
func (r *Repository) WithdrawAccount(userID string) (*model.WithdrawAccount, error) {
	var account model.WithdrawAccount
	err := r.db.Where("user_id = ?", userID).First(&account).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &account, nil
}

// ===== 划转 =====

// CreateTransfer 奖励余额划转为积分：扣减奖励可用并计入已使用、写划转记录、
// 以幂等流水给积分账户入账，全部在同一事务内。
func (r *Repository) CreateTransfer(userID string, amountMicroYuan, rateMilli, creditsMicrocredits int64) (*model.TransferRecord, *model.CreditAccount, error) {
	if amountMicroYuan <= 0 || creditsMicrocredits <= 0 {
		return nil, nil, errors.New("划转金额或兑换积分必须大于 0")
	}
	var (
		record  *model.TransferRecord
		account *model.CreditAccount
	)
	err := r.db.Transaction(func(tx *gorm.DB) error {
		record = nil
		account = nil
		// 与支付入账一致，先锁积分再锁奖励，避免充值和划转相互等待。
		creditAccount := model.CreditAccount{UserID: userID}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&creditAccount).Error; err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).First(&creditAccount).Error; err != nil {
			return err
		}
		if err := moveRewardTx(tx, userID, 0, -amountMicroYuan, 0, amountMicroYuan); err != nil {
			return err
		}
		record = &model.TransferRecord{
			ID: newRepositoryID(), UserID: userID, AmountMicroYuan: amountMicroYuan,
			RateMilli: rateMilli, CreditsMicrocredit: creditsMicrocredits, CreatedAt: time.Now(),
		}
		if err := tx.Create(record).Error; err != nil {
			return err
		}
		granted, err := grantCreditsTx(tx, userID, model.CreditLedgerInviteTransfer, creditsMicrocredits,
			"invite_transfer:"+record.ID, "邀请奖励划转")
		if err != nil {
			return err
		}
		account = granted
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	return record, account, nil
}

// grantCreditsTx 是 GrantCreditsOnce 的事务内版本：供已在事务中的路径复用同一幂等语义。
func grantCreditsTx(tx *gorm.DB, userID string, entryType model.CreditLedgerType, amount int64, referenceKey, note string) (*model.CreditAccount, error) {
	if userID == "" || amount <= 0 {
		return nil, ErrRewardAmountOverflow
	}
	account := model.CreditAccount{UserID: userID}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
		return nil, err
	}
	entry := model.CreditLedgerEntry{
		ID: newRepositoryID(), UserID: userID, Type: entryType, AmountMicrocredits: amount,
		ReferenceKey: &referenceKey, Note: note,
	}
	created := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "reference_key"}}, DoNothing: true}).Create(&entry)
	if created.Error != nil {
		return nil, created.Error
	}
	if created.RowsAffected == 0 {
		return nil, ErrInviteRecordStateConflict
	}
	updated := tx.Model(&model.CreditAccount{}).Where("user_id = ? AND available_microcredits <= ?", userID, math.MaxInt64-amount).Updates(map[string]any{
		"available_microcredits": gorm.Expr("available_microcredits + ?", amount),
		"version":                gorm.Expr("version + 1"),
		"updated_at":             time.Now(),
	})
	if updated.Error != nil {
		return nil, updated.Error
	}
	if updated.RowsAffected != 1 {
		return nil, ErrRewardAmountOverflow
	}
	if err := tx.Where("user_id = ?", userID).First(&account).Error; err != nil {
		return nil, err
	}
	if err := tx.Model(&entry).Updates(map[string]any{
		"available_delta_microcredits": amount,
		"available_after_microcredits": account.AvailableMicrocredits,
		"reserved_after_microcredits":  account.ReservedMicrocredits,
	}).Error; err != nil {
		return nil, err
	}
	return &account, nil
}

// TransfersByUser 用户端划转记录分页。
func (r *Repository) TransfersByUser(userID string, limit, offset int) ([]model.TransferRecord, int64, error) {
	db := r.db.Model(&model.TransferRecord{}).Where("user_id = ?", userID)
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []model.TransferRecord
	err := db.Order("created_at desc").Limit(limit).Offset(offset).Find(&records).Error
	return records, total, err
}
