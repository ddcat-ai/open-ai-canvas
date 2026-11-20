package repository

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"yingce/backend/internal/model"
)

var (
	// ErrArkPortraitSessionClosed 表示认证会话已被回调、轮询或过期清理结束，本次调用不再改动。
	ErrArkPortraitSessionClosed = errors.New("认证会话已结束")
	// ErrArkPortraitGroupTaken 表示同一方舟素材组已登记在其他账号名下。
	ErrArkPortraitGroupTaken = errors.New("该素材组已被其他账号登记")
)

const (
	arkPortraitSessionPending = "pending"
	arkPortraitSessionDone    = "verified"
)

// CreateArkPortraitSessionWithReservation 在同一事务中冻结素材组费用并登记认证会话；余额不足时两者都不写入。
func (r *Repository) CreateArkPortraitSessionWithReservation(session *model.ArkPortraitSession, order *model.BillingOrder) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if order != nil {
			if err := reserveBillingOrder(tx, order); err != nil {
				return err
			}
		}
		return tx.Create(session).Error
	})
}

func (r *Repository) SetArkPortraitSessionToken(id string, cipher string) error {
	return r.db.Model(&model.ArkPortraitSession{}).Where("id = ? AND status = ?", id, arkPortraitSessionPending).Updates(map[string]any{"byted_token_cipher": cipher, "updated_at": time.Now()}).Error
}

func (r *Repository) ArkPortraitSessionByState(state string) (*model.ArkPortraitSession, error) {
	var session model.ArkPortraitSession
	if err := r.db.Where("state = ?", state).First(&session).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *Repository) ArkPortraitSessionForUser(userID, id string) (*model.ArkPortraitSession, error) {
	var session model.ArkPortraitSession
	if err := r.db.Where("id = ? AND user_id = ?", id, userID).First(&session).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

// PendingArkPortraitSessions 返回用户在指定范围内尚未过期的待认证会话，按创建时间倒序。
func (r *Repository) PendingArkPortraitSessions(userID string, scope string, now time.Time, limit int) ([]model.ArkPortraitSession, error) {
	var sessions []model.ArkPortraitSession
	err := r.db.Where("user_id = ? AND scope = ? AND status = ? AND expires_at > ?", userID, scope, arkPortraitSessionPending, now).Order("created_at desc").Limit(limit).Find(&sessions).Error
	return sessions, err
}

func (r *Repository) CountRecentArkPortraitSessions(userID string, since time.Time) (int64, error) {
	var count int64
	err := r.db.Model(&model.ArkPortraitSession{}).Where("user_id = ? AND created_at > ?", userID, since).Count(&count).Error
	return count, err
}

// CountActiveArkPortraitUserSessions 统计用户自建、仍在有效期内的待认证会话；它们占用真人素材组额度。
func (r *Repository) CountActiveArkPortraitUserSessions(userID string, now time.Time) (int64, error) {
	var count int64
	err := r.db.Model(&model.ArkPortraitSession{}).Where("user_id = ? AND scope = ? AND status = ? AND expires_at > ?", userID, "user", arkPortraitSessionPending, now).Count(&count).Error
	return count, err
}

func (r *Repository) ExpiredPendingArkPortraitSessions(now time.Time, limit int) ([]model.ArkPortraitSession, error) {
	var sessions []model.ArkPortraitSession
	err := r.db.Where("status = ? AND expires_at <= ?", arkPortraitSessionPending, now).Order("expires_at asc").Limit(limit).Find(&sessions).Error
	return sessions, err
}

// FinishArkPortraitSession 只结束仍为 pending 的会话，并在同一事务里退回冻结的素材组费用；
// 回调、轮询、取消与过期清理并发时只有一方生效，返回值表示本次调用是否生效。
func (r *Repository) FinishArkPortraitSession(id, status, resultCode, message, refundNote string) (bool, error) {
	finished := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var session model.ArkPortraitSession
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&session, "id = ?", id).Error; err != nil {
			return err
		}
		if session.Status != arkPortraitSessionPending {
			return nil
		}
		result := tx.Model(&model.ArkPortraitSession{}).Where("id = ? AND status = ?", id, arkPortraitSessionPending).Updates(map[string]any{
			"status": status, "result_code": resultCode, "error": message, "updated_at": time.Now(),
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return nil
		}
		finished = true
		if session.BillingOrderID == "" {
			return nil
		}
		return refundArkGroupOrder(tx, session.BillingOrderID, refundNote)
	})
	return finished, err
}

// CompleteArkPortraitSession 把认证成功的会话登记为素材组并结算冻结费用，三者在同一事务里完成。
// 会话已由并发调用完成时返回已登记的素材组；已失败、过期或取消时返回 ErrArkPortraitSessionClosed。
func (r *Repository) CompleteArkPortraitSession(sessionID string, group *model.ArkPortraitGroup, settleNote string) (*model.ArkPortraitGroup, error) {
	var registered *model.ArkPortraitGroup
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var session model.ArkPortraitSession
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&session, "id = ?", sessionID).Error; err != nil {
			return err
		}
		if session.Status == arkPortraitSessionDone {
			var existing model.ArkPortraitGroup
			if err := tx.Where("project_name = ? AND group_id = ?", session.ProjectName, session.GroupID).First(&existing).Error; err != nil {
				return err
			}
			registered = &existing
			return nil
		}
		if session.Status != arkPortraitSessionPending {
			return ErrArkPortraitSessionClosed
		}
		created, err := createArkPortraitGroup(tx, group)
		if err != nil {
			return err
		}
		registered = created
		if err := tx.Model(&model.ArkPortraitSession{}).Where("id = ?", sessionID).Updates(map[string]any{
			"status": arkPortraitSessionDone, "result_code": "10000", "group_id": group.GroupID, "error": "", "updated_at": time.Now(),
		}).Error; err != nil {
			return err
		}
		if session.BillingOrderID == "" {
			return nil
		}
		return settleArkGroupOrder(tx, session.BillingOrderID, settleNote)
	})
	return registered, err
}

// CreateArkPortraitGroupWithCharge 登记已在方舟创建的素材组，并结算创建前冻结的费用。
func (r *Repository) CreateArkPortraitGroupWithCharge(group *model.ArkPortraitGroup, settleNote string) (*model.ArkPortraitGroup, error) {
	var registered *model.ArkPortraitGroup
	err := r.db.Transaction(func(tx *gorm.DB) error {
		created, err := createArkPortraitGroup(tx, group)
		if err != nil {
			return err
		}
		registered = created
		if group.BillingOrderID == "" {
			return nil
		}
		return settleArkGroupOrder(tx, group.BillingOrderID, settleNote)
	})
	return registered, err
}

// createArkPortraitGroup 以 (ProjectName, GroupID) 去重；同一账号重复登记返回已有记录，其他账号已登记时拒绝。
func createArkPortraitGroup(tx *gorm.DB, group *model.ArkPortraitGroup) (*model.ArkPortraitGroup, error) {
	result := tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "project_name"}, {Name: "group_id"}},
		DoNothing: true,
	}).Create(group)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 1 {
		return group, nil
	}
	var existing model.ArkPortraitGroup
	if err := tx.Where("project_name = ? AND group_id = ?", group.ProjectName, group.GroupID).First(&existing).Error; err != nil {
		return nil, err
	}
	if existing.UserID != group.UserID || existing.Scope != group.Scope {
		return nil, ErrArkPortraitGroupTaken
	}
	return &existing, nil
}

// RefundArkGroupBillingOrder 退回未完成的素材组费用；订单已结算或已退回时不重复处理。
func (r *Repository) RefundArkGroupBillingOrder(orderID string, note string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		return refundArkGroupOrder(tx, orderID, note)
	})
}

// StaleArkGroupBillingOrders 返回长时间仍处于冻结状态、且没有待认证会话引用的素材组订单
// （例如创建虚拟组时进程中断）。真人认证会话由过期清理负责退回，不在这里重复处理。
func (r *Repository) StaleArkGroupBillingOrders(before time.Time, limit int) ([]model.BillingOrder, error) {
	var orders []model.BillingOrder
	pending := r.db.Model(&model.ArkPortraitSession{}).Select("billing_order_id").Where("status = ? AND billing_order_id <> ''", arkPortraitSessionPending)
	err := r.db.Where("scene = ? AND status = ? AND created_at < ? AND id NOT IN (?)", model.BillingSceneArkAssetGroup, model.BillingStatusReserved, before, pending).
		Order("created_at asc").Limit(limit).Find(&orders).Error
	return orders, err
}

func settleArkGroupOrder(tx *gorm.DB, orderID string, note string) error {
	var order model.BillingOrder
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, "id = ?", orderID).Error; err != nil {
		return err
	}
	if order.Status == model.BillingStatusSettled {
		return nil
	}
	if order.Scene != model.BillingSceneArkAssetGroup || (order.Status != model.BillingStatusReserved && order.Status != model.BillingStatusRunning) {
		return ErrBillingStateConflict
	}
	updated := tx.Model(&model.CreditAccount{}).
		Where("user_id = ? AND reserved_microcredits >= ?", order.UserID, order.AmountMicrocredits).
		Updates(map[string]any{
			"reserved_microcredits": gorm.Expr("reserved_microcredits - ?", order.AmountMicrocredits),
			"version":               gorm.Expr("version + 1"),
			"updated_at":            time.Now(),
		})
	if updated.Error != nil {
		return updated.Error
	}
	if updated.RowsAffected != 1 {
		return errors.New("reserved credit balance is inconsistent")
	}
	var account model.CreditAccount
	if err := tx.First(&account, "user_id = ?", order.UserID).Error; err != nil {
		return err
	}
	now := time.Now()
	if err := tx.Model(&model.BillingOrder{}).Where("id = ?", order.ID).Updates(map[string]any{
		"status": model.BillingStatusSettled, "actual_amount_microcredits": order.AmountMicrocredits, "settled_at": &now, "updated_at": now,
	}).Error; err != nil {
		return err
	}
	return tx.Create(&model.CreditLedgerEntry{
		ID:                         newRepositoryID(),
		UserID:                     order.UserID,
		Type:                       model.CreditLedgerConsume,
		AmountMicrocredits:         -order.AmountMicrocredits,
		ReservedDeltaMicrocredits:  -order.AmountMicrocredits,
		AvailableAfterMicrocredits: account.AvailableMicrocredits,
		ReservedAfterMicrocredits:  account.ReservedMicrocredits,
		BillingOrderID:             order.ID,
		Model:                      order.Model,
		Scene:                      order.Scene,
		Note:                       truncateArkNote(note),
	}).Error
}

func refundArkGroupOrder(tx *gorm.DB, orderID string, note string) error {
	var order model.BillingOrder
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, "id = ?", orderID).Error; err != nil {
		return err
	}
	if order.Status == model.BillingStatusRefunded || order.Status == model.BillingStatusSettled {
		return nil
	}
	if order.Scene != model.BillingSceneArkAssetGroup {
		return ErrBillingStateConflict
	}
	updated := tx.Model(&model.CreditAccount{}).
		Where("user_id = ? AND reserved_microcredits >= ?", order.UserID, order.AmountMicrocredits).
		Updates(map[string]any{
			"available_microcredits": gorm.Expr("available_microcredits + ?", order.AmountMicrocredits),
			"reserved_microcredits":  gorm.Expr("reserved_microcredits - ?", order.AmountMicrocredits),
			"version":                gorm.Expr("version + 1"),
			"updated_at":             time.Now(),
		})
	if updated.Error != nil {
		return updated.Error
	}
	if updated.RowsAffected != 1 {
		return errors.New("reserved credit balance is inconsistent")
	}
	var account model.CreditAccount
	if err := tx.First(&account, "user_id = ?", order.UserID).Error; err != nil {
		return err
	}
	now := time.Now()
	note = truncateArkNote(note)
	if err := tx.Model(&model.BillingOrder{}).Where("id = ?", order.ID).Updates(map[string]any{
		"status": model.BillingStatusRefunded, "error": note, "refunded_amount_microcredits": order.AmountMicrocredits, "refunded_at": &now, "updated_at": now,
	}).Error; err != nil {
		return err
	}
	return tx.Create(&model.CreditLedgerEntry{
		ID:                         newRepositoryID(),
		UserID:                     order.UserID,
		Type:                       model.CreditLedgerRefund,
		AmountMicrocredits:         order.AmountMicrocredits,
		AvailableDeltaMicrocredits: order.AmountMicrocredits,
		ReservedDeltaMicrocredits:  -order.AmountMicrocredits,
		AvailableAfterMicrocredits: account.AvailableMicrocredits,
		ReservedAfterMicrocredits:  account.ReservedMicrocredits,
		BillingOrderID:             order.ID,
		Model:                      order.Model,
		Scene:                      order.Scene,
		Note:                       note,
	}).Error
}

func truncateArkNote(note string) string {
	runes := []rune(strings.TrimSpace(note))
	if len(runes) > 200 {
		return string(runes[:200])
	}
	return string(runes)
}

// ArkPortraitUserGroups 返回用户自建的素材组。
func (r *Repository) ArkPortraitUserGroups(userID string) ([]model.ArkPortraitGroup, error) {
	var groups []model.ArkPortraitGroup
	err := r.db.Where("user_id = ? AND scope = ?", userID, "user").Order("created_at asc").Find(&groups).Error
	return groups, err
}

// ArkPortraitGrantedGroups 返回授权给用户的平台素材组（全部用户或逐个授权）。
func (r *Repository) ArkPortraitGrantedGroups(userID string) ([]model.ArkPortraitGroup, error) {
	var groups []model.ArkPortraitGroup
	granted := r.db.Model(&model.ArkPortraitGroupGrant{}).Select("group_id").Where("user_id = ?", userID)
	err := r.db.Where("scope = ? AND (grant_all = ? OR id IN (?))", "platform", true, granted).Order("created_at asc").Find(&groups).Error
	return groups, err
}

func (r *Repository) CountArkPortraitUserGroups(userID string, kind string) (int64, error) {
	var count int64
	err := r.db.Model(&model.ArkPortraitGroup{}).Where("user_id = ? AND scope = ? AND kind = ?", userID, "user", kind).Count(&count).Error
	return count, err
}

func (r *Repository) ArkPortraitGroup(id string) (*model.ArkPortraitGroup, error) {
	var group model.ArkPortraitGroup
	if err := r.db.First(&group, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &group, nil
}

func (r *Repository) ArkPortraitGroupsByIDs(ids []string) (map[string]model.ArkPortraitGroup, error) {
	result := make(map[string]model.ArkPortraitGroup, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var groups []model.ArkPortraitGroup
	if err := r.db.Where("id IN ?", ids).Find(&groups).Error; err != nil {
		return nil, err
	}
	for _, group := range groups {
		result[group.ID] = group
	}
	return result, nil
}

// ArkPortraitUserGroupForUser 只返回用户自建的素材组；平台素材组的写操作走管理员接口。
func (r *Repository) ArkPortraitUserGroupForUser(userID, id string) (*model.ArkPortraitGroup, error) {
	var group model.ArkPortraitGroup
	if err := r.db.Where("id = ? AND user_id = ? AND scope = ?", id, userID, "user").First(&group).Error; err != nil {
		return nil, err
	}
	return &group, nil
}

func (r *Repository) SaveArkPortraitGroup(group *model.ArkPortraitGroup) error {
	return r.db.Save(group).Error
}

// DeleteArkPortraitGroupCascade 删除组及其素材记录和授权；调用方须已在方舟侧删除成功。
func (r *Repository) DeleteArkPortraitGroupCascade(id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("group_id = ?", id).Delete(&model.ArkPortraitAsset{}).Error; err != nil {
			return err
		}
		if err := tx.Where("group_id = ?", id).Delete(&model.ArkPortraitGroupGrant{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", id).Delete(&model.ArkPortraitGroup{}).Error
	})
}

// ArkPortraitGroupGranted 判断平台素材组是否授权给用户。
func (r *Repository) ArkPortraitGroupGranted(groupID string, userID string) (bool, error) {
	var count int64
	err := r.db.Model(&model.ArkPortraitGroupGrant{}).Where("group_id = ? AND user_id = ?", groupID, userID).Count(&count).Error
	return count > 0, err
}

// ArkPortraitGrantedGroupIDs 返回 groupIDs 中逐个授权给用户的组。
func (r *Repository) ArkPortraitGrantedGroupIDs(userID string, groupIDs []string) (map[string]bool, error) {
	result := make(map[string]bool, len(groupIDs))
	if len(groupIDs) == 0 {
		return result, nil
	}
	var ids []string
	if err := r.db.Model(&model.ArkPortraitGroupGrant{}).Where("user_id = ? AND group_id IN ?", userID, groupIDs).Pluck("group_id", &ids).Error; err != nil {
		return nil, err
	}
	for _, id := range ids {
		result[id] = true
	}
	return result, nil
}

// ArkPortraitGroupGrantUsers 返回各平台素材组逐个授权的用户 ID。
func (r *Repository) ArkPortraitGroupGrantUsers(groupIDs []string) (map[string][]string, error) {
	result := make(map[string][]string, len(groupIDs))
	if len(groupIDs) == 0 {
		return result, nil
	}
	var grants []model.ArkPortraitGroupGrant
	if err := r.db.Where("group_id IN ?", groupIDs).Order("created_at asc").Find(&grants).Error; err != nil {
		return nil, err
	}
	for _, grant := range grants {
		result[grant.GroupID] = append(result[grant.GroupID], grant.UserID)
	}
	return result, nil
}

// ReplaceArkPortraitGroupGrants 以完整列表替换平台素材组的授权范围。
func (r *Repository) ReplaceArkPortraitGroupGrants(groupID string, grantAll bool, userIDs []string, actorID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.ArkPortraitGroup{}).Where("id = ? AND scope = ?", groupID, "platform").Updates(map[string]any{"grant_all": grantAll, "updated_at": time.Now()}).Error; err != nil {
			return err
		}
		if err := tx.Where("group_id = ?", groupID).Delete(&model.ArkPortraitGroupGrant{}).Error; err != nil {
			return err
		}
		now := time.Now()
		for _, userID := range userIDs {
			if err := tx.Create(&model.ArkPortraitGroupGrant{ID: newRepositoryID(), GroupID: groupID, UserID: userID, CreatedBy: actorID, CreatedAt: now}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

type AdminArkPortraitGroupFilter struct {
	Kind    string
	Scope   string
	Expiry  string
	Keyword string
	Now     time.Time
	Limit   int
	Offset  int
}

const arkPortraitExpiringWindow = 30 * 24 * time.Hour

func (r *Repository) AdminArkPortraitGroups(filter AdminArkPortraitGroupFilter) ([]model.ArkPortraitGroup, int64, error) {
	query := r.db.Model(&model.ArkPortraitGroup{})
	if filter.Kind != "" {
		query = query.Where("ark_portrait_groups.kind = ?", filter.Kind)
	}
	if filter.Scope != "" {
		query = query.Where("ark_portrait_groups.scope = ?", filter.Scope)
	}
	query = arkPortraitExpiryFilter(query, filter.Expiry, filter.Now)
	if keyword := strings.ToLower(strings.TrimSpace(filter.Keyword)); keyword != "" {
		pattern := "%" + keyword + "%"
		users := r.db.Model(&model.User{}).Select("id").Where("lower(username) LIKE ? OR lower(display_name) LIKE ? OR lower(email) LIKE ?", pattern, pattern, pattern)
		query = query.Where("lower(ark_portrait_groups.name) LIKE ? OR lower(ark_portrait_groups.group_id) LIKE ? OR ark_portrait_groups.user_id IN (?)", pattern, pattern, users)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var groups []model.ArkPortraitGroup
	err := query.Order("ark_portrait_groups.created_at desc, ark_portrait_groups.id desc").Limit(filter.Limit).Offset(filter.Offset).Find(&groups).Error
	return groups, total, err
}

func arkPortraitExpiryFilter(query *gorm.DB, expiry string, now time.Time) *gorm.DB {
	soon := now.Add(arkPortraitExpiringWindow)
	switch expiry {
	case "valid":
		return query.Where("ark_portrait_groups.expires_at IS NULL OR ark_portrait_groups.expires_at > ?", soon)
	case "expiring":
		return query.Where("ark_portrait_groups.expires_at > ? AND ark_portrait_groups.expires_at <= ?", now, soon)
	case "expired":
		return query.Where("ark_portrait_groups.expires_at <= ?", now)
	default:
		return query
	}
}

type ArkPortraitGroupStats struct {
	Real     int64 `json:"real"`
	Virtual  int64 `json:"virtual"`
	IP       int64 `json:"ip"`
	Expiring int64 `json:"expiring"`
	Expired  int64 `json:"expired"`
}

func (r *Repository) ArkPortraitGroupStats(now time.Time) (ArkPortraitGroupStats, error) {
	var stats ArkPortraitGroupStats
	var rows []struct {
		Kind  string
		Count int64
	}
	if err := r.db.Model(&model.ArkPortraitGroup{}).Select("kind, COUNT(*) AS count").Group("kind").Scan(&rows).Error; err != nil {
		return stats, err
	}
	for _, row := range rows {
		switch row.Kind {
		case "real":
			stats.Real = row.Count
		case "virtual":
			stats.Virtual = row.Count
		case "ip":
			stats.IP = row.Count
		}
	}
	if err := arkPortraitExpiryFilter(r.db.Model(&model.ArkPortraitGroup{}), "expiring", now).Count(&stats.Expiring).Error; err != nil {
		return stats, err
	}
	if err := arkPortraitExpiryFilter(r.db.Model(&model.ArkPortraitGroup{}), "expired", now).Count(&stats.Expired).Error; err != nil {
		return stats, err
	}
	return stats, nil
}

// ArkPortraitAssetStatusCounts 按素材组统计各状态的素材数。
func (r *Repository) ArkPortraitAssetStatusCounts(groupIDs []string) (map[string]map[string]int64, error) {
	result := make(map[string]map[string]int64, len(groupIDs))
	if len(groupIDs) == 0 {
		return result, nil
	}
	var rows []struct {
		GroupID string
		Status  string
		Count   int64
	}
	if err := r.db.Model(&model.ArkPortraitAsset{}).Select("group_id, status, COUNT(*) AS count").Where("group_id IN ?", groupIDs).Group("group_id, status").Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		if result[row.GroupID] == nil {
			result[row.GroupID] = map[string]int64{}
		}
		result[row.GroupID][row.Status] = row.Count
	}
	return result, nil
}

func (r *Repository) CreateArkPortraitAsset(asset *model.ArkPortraitAsset) error {
	return r.db.Create(asset).Error
}

func (r *Repository) SaveArkPortraitAsset(asset *model.ArkPortraitAsset) error {
	return r.db.Save(asset).Error
}

func (r *Repository) ArkPortraitAsset(id string) (*model.ArkPortraitAsset, error) {
	var asset model.ArkPortraitAsset
	if err := r.db.First(&asset, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &asset, nil
}

// ArkPortraitAssetsForGroups 返回素材组内的素材；statuses 为空时不过滤状态。
func (r *Repository) ArkPortraitAssetsForGroups(groupIDs []string, statuses []string) ([]model.ArkPortraitAsset, error) {
	if len(groupIDs) == 0 {
		return nil, nil
	}
	query := r.db.Where("group_id IN ?", groupIDs)
	if len(statuses) > 0 {
		query = query.Where("status IN ?", statuses)
	}
	var assets []model.ArkPortraitAsset
	err := query.Order("created_at asc").Find(&assets).Error
	return assets, err
}

func (r *Repository) CountArkPortraitGroupAssets(groupID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.ArkPortraitAsset{}).Where("group_id = ?", groupID).Count(&count).Error
	return count, err
}

func (r *Repository) DeleteArkPortraitAsset(id string) error {
	return r.db.Where("id = ?", id).Delete(&model.ArkPortraitAsset{}).Error
}

// ArkPortraitSubmissionForLibraryAsset 返回素材库素材仍在审核、处理中或已通过的认证记录。
func (r *Repository) ArkPortraitSubmissionForLibraryAsset(userID string, libraryAssetID string) (*model.ArkPortraitAsset, error) {
	var asset model.ArkPortraitAsset
	err := r.db.Where("user_id = ? AND library_asset_id = ? AND status IN ?", userID, libraryAssetID, []string{"pending_review", "processing", "active"}).Order("created_at desc").First(&asset).Error
	if err != nil {
		return nil, err
	}
	return &asset, nil
}

func (r *Repository) SetArkPortraitAssetLibraryAsset(id string, libraryAssetID string) error {
	return r.db.Model(&model.ArkPortraitAsset{}).Where("id = ?", id).Updates(map[string]any{"library_asset_id": libraryAssetID, "updated_at": time.Now()}).Error
}

// ProcessingArkPortraitAssets 返回已提交方舟、等待审核结果的素材，最久未检查的排在前面。
func (r *Repository) ProcessingArkPortraitAssets(limit int) ([]model.ArkPortraitAsset, error) {
	var assets []model.ArkPortraitAsset
	err := r.db.Where("status = ? AND ark_asset_id <> ''", "processing").Order("updated_at asc").Limit(limit).Find(&assets).Error
	return assets, err
}

// TouchArkPortraitAsset 记录一次状态检查，让后台轮询轮转到其他素材。
func (r *Repository) TouchArkPortraitAsset(id string) error {
	return r.db.Model(&model.ArkPortraitAsset{}).Where("id = ?", id).Update("updated_at", time.Now()).Error
}

func (r *Repository) ArkPortraitReviewQueue(status string, limit int, offset int) ([]model.ArkPortraitAsset, int64, error) {
	query := r.db.Model(&model.ArkPortraitAsset{}).Where("status = ?", status)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	order := "created_at asc"
	if status != "pending_review" {
		order = "updated_at desc"
	}
	var assets []model.ArkPortraitAsset
	err := query.Order(order).Limit(limit).Offset(offset).Find(&assets).Error
	return assets, total, err
}

func (r *Repository) CountArkPortraitAssetsByStatus(status string) (int64, error) {
	var count int64
	err := r.db.Model(&model.ArkPortraitAsset{}).Where("status = ?", status).Count(&count).Error
	return count, err
}

func (r *Repository) ArkPortraitAssetsByIDs(ids []string) ([]model.ArkPortraitAsset, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var assets []model.ArkPortraitAsset
	err := r.db.Where("id IN ?", ids).Find(&assets).Error
	return assets, err
}

// ArkPortraitAssetAccess 是生成前校验方舟素材 ID 所需的归属与授权字段。
type ArkPortraitAssetAccess struct {
	ArkAssetID  string
	GroupID     string
	GroupUserID string
	Scope       string
	GrantAll    bool
	ExpiresAt   *time.Time
}

// ArkPortraitAssetAccessRows 返回已登记方舟素材 ID 所在素材组的归属与授权。未登记的 ID（例如方舟
// 公共虚拟人像）不在结果中。可信素材同步的绑定按共享资源建立，不参与这里的判断。
func (r *Repository) ArkPortraitAssetAccessRows(arkAssetIDs []string) ([]ArkPortraitAssetAccess, error) {
	if len(arkAssetIDs) == 0 {
		return nil, nil
	}
	var rows []ArkPortraitAssetAccess
	err := r.db.Table("ark_portrait_assets").
		Select("ark_portrait_assets.ark_asset_id AS ark_asset_id, ark_portrait_groups.id AS group_id, ark_portrait_groups.user_id AS group_user_id, ark_portrait_groups.scope AS scope, ark_portrait_groups.grant_all AS grant_all, ark_portrait_groups.expires_at AS expires_at").
		Joins("JOIN ark_portrait_groups ON ark_portrait_groups.id = ark_portrait_assets.group_id").
		Where("ark_portrait_assets.ark_asset_id IN ?", arkAssetIDs).
		Scan(&rows).Error
	return rows, err
}

// UpdateUserAssetPayload 在事务中读取并改写用户素材的 payload，同步分类列与 updatedAt，
// 供服务端写入方舟认证结果。mutate 返回 false 表示无需修改；素材不存在时返回 false。
func (r *Repository) UpdateUserAssetPayload(userID string, assetID string, mutate func(asset *model.Asset, payload map[string]any) (bool, error)) (bool, error) {
	changed := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var asset model.Asset
		if err := tx.First(&asset, "id = ? AND user_id = ?", assetID, userID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(asset.PayloadJSON), &payload); err != nil || payload == nil {
			return nil
		}
		ok, err := mutate(&asset, payload)
		if err != nil || !ok {
			return err
		}
		now := time.Now().UTC()
		payload["category"] = string(asset.Category)
		if asset.Status != "" {
			payload["status"] = string(asset.Status)
		}
		payload["updatedAt"] = now.Format(time.RFC3339Nano)
		encoded, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		if err := tx.Model(&model.Asset{}).Where("id = ? AND user_id = ?", asset.ID, userID).Updates(map[string]any{
			"category": asset.Category, "status": asset.Status, "payload_json": string(encoded), "updated_at": now,
		}).Error; err != nil {
			return err
		}
		changed = true
		return nil
	})
	return changed, err
}

// AssetRefsByIDPrefix 返回 ID 以 prefix 开头的素材（跨用户），用于找到平台素材加入各用户素材库的副本。
func (r *Repository) AssetRefsByIDPrefix(prefix string) ([]model.Asset, error) {
	var assets []model.Asset
	escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(prefix)
	err := r.db.Select("id", "user_id").Where("id LIKE ? ESCAPE '\\'", escaped+"%").Find(&assets).Error
	return assets, err
}
