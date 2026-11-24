package repository

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

var (
	ErrTeamWalletForbidden = errors.New("无权操作团队积分")
	ErrTeamWalletConflict  = errors.New("幂等键已用于不同的积分操作")
	ErrTeamWalletAmount    = errors.New("划拨金额无效或超过账户上限")
)

type TeamCreditTransferResult struct {
	Transfer model.CreditTransfer `json:"transfer"`
	Source   model.CreditAccount  `json:"source"`
	Target   model.CreditAccount  `json:"target"`
}

type TeamMemberCreditAccount struct {
	MembershipID string              `json:"membershipId"`
	UserID       string              `json:"userId"`
	Account      model.CreditAccount `json:"account"`
}

type TeamWalletView struct {
	PoolAvailableMicrocredits int64                     `json:"poolAvailableMicrocredits"`
	Pool                      *model.CreditAccount      `json:"pool,omitempty"`
	MyAccount                 model.CreditAccount       `json:"myAccount"`
	Members                   []TeamMemberCreditAccount `json:"members,omitempty"`
}

func (r *Repository) OpenTeamWallets(teamID, membershipID string, pool bool) error {
	if pool {
		if err := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.CreditAccount{Kind: model.CreditAccountTeamPool, TeamID: teamID}).Error; err != nil {
			return err
		}
	}
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.CreditAccount{Kind: model.CreditAccountTeamMember, TeamID: teamID, MembershipID: membershipID}).Error
}

func (r *Repository) CreditAccountByID(id string) (*model.CreditAccount, error) {
	var account model.CreditAccount
	if err := r.db.First(&account, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &account, nil
}

func (r *Repository) TeamWallet(member *model.TeamMembership, owner bool) (*TeamWalletView, error) {
	mine, err := r.CreditAccountByID(model.TeamMemberCreditAccountID(member.ID))
	if err != nil {
		return nil, err
	}
	pool, err := r.CreditAccountByID(model.TeamPoolCreditAccountID(member.TeamID))
	if err != nil {
		return nil, err
	}
	result := &TeamWalletView{MyAccount: *mine, PoolAvailableMicrocredits: pool.AvailableMicrocredits}
	if !owner {
		return result, nil
	}
	result.Pool = pool
	var members []model.TeamMembership
	if err := r.db.Where("team_id = ? AND status = ?", member.TeamID, "active").Order("created_at,id").Find(&members).Error; err != nil {
		return nil, err
	}
	var accounts []model.CreditAccount
	if err := r.db.Where("team_id = ? AND kind = ?", member.TeamID, model.CreditAccountTeamMember).Find(&accounts).Error; err != nil {
		return nil, err
	}
	byMember := make(map[string]model.CreditAccount, len(accounts))
	for _, account := range accounts {
		byMember[account.MembershipID] = account
	}
	for _, item := range members {
		account, ok := byMember[item.ID]
		if !ok {
			return nil, errors.New("团队成员积分账户缺失")
		}
		result.Members = append(result.Members, TeamMemberCreditAccount{MembershipID: item.ID, UserID: item.UserID, Account: account})
	}
	return result, nil
}

func (r *Repository) TeamCreditLedger(teamID, membershipID string, limit, offset int) ([]model.CreditLedgerEntry, int64, error) {
	query := r.db.Model(&model.CreditLedgerEntry{}).Where("team_id = ?", teamID)
	if membershipID != "" {
		query = query.Where("membership_id = ?", membershipID)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := make([]model.CreditLedgerEntry, 0)
	err := query.Order("created_at DESC,id DESC").Limit(limit).Offset(offset).Find(&items).Error
	return items, total, err
}

func (r *Repository) TransferTeamCredits(actorID, teamID, membershipID, operation string, amount int64, key string) (*TeamCreditTransferResult, error) {
	if amount <= 0 || key == "" {
		return nil, ErrTeamWalletAmount
	}
	hash := sha256.Sum256([]byte(fmt.Sprintf("%s\x00%s\x00%d", operation, membershipID, amount)))
	requestHash := hex.EncodeToString(hash[:])
	var result *TeamCreditTransferResult
	err := r.Transaction(func(tx *Repository) error {
		team, err := tx.LockTeam(teamID)
		if err != nil {
			return err
		}
		if team.Status != "active" || team.OwnerUserID != actorID {
			return ErrTeamWalletForbidden
		}
		member, err := tx.TeamMembershipForUser(teamID, actorID)
		if err != nil {
			return err
		}
		if member.Status != "active" || member.Role != "owner" {
			return ErrTeamWalletForbidden
		}
		var actor model.User
		if err := tx.db.First(&actor, "id = ? AND status = ?", actorID, model.UserStatusActive).Error; err != nil {
			return ErrTeamWalletForbidden
		}
		var existing model.CreditTransfer
		err = tx.db.Where("team_id = ? AND actor_user_id = ? AND idempotency_key = ?", teamID, actorID, key).First(&existing).Error
		if err == nil {
			if existing.RequestHash != requestHash {
				return ErrTeamWalletConflict
			}
			result, err = tx.teamTransferResult(existing)
			return err
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		poolID := model.TeamPoolCreditAccountID(teamID)
		var sourceID, targetID string
		switch operation {
		case "fund", "withdraw":
			if team.ParentID != "" {
				parentMember, err := tx.TeamMembershipForUser(team.ParentID, actorID)
				if err != nil {
					return err
				}
				if parentMember.Role != model.TeamOwner {
					return ErrTeamWalletForbidden
				}
				sourceID = model.TeamPoolCreditAccountID(team.ParentID)
			} else {
				if _, err := tx.CreditAccount(actorID); err != nil {
					return err
				}
				sourceID = model.PersonalCreditAccountID(actorID)
			}
			targetID = poolID
			if operation == "withdraw" {
				sourceID, targetID = targetID, sourceID
			}
		case "allocate", "reclaim":
			var target model.TeamMembership
			if err := tx.db.First(&target, "id = ? AND team_id = ? AND status = ?", membershipID, teamID, "active").Error; err != nil {
				return ErrTeamWalletForbidden
			}
			sourceID, targetID = poolID, model.TeamMemberCreditAccountID(membershipID)
			if operation == "reclaim" {
				sourceID, targetID = targetID, sourceID
			}
		default:
			return ErrTeamWalletForbidden
		}
		transfer := model.CreditTransfer{ID: newRepositoryID(), TeamID: teamID, ActorUserID: actorID, Operation: operation, SourceAccountID: sourceID, TargetAccountID: targetID, AmountMicrocredits: amount, IdempotencyKey: key, RequestHash: requestHash}
		if team.ParentID != "" && (operation == "fund" || operation == "withdraw") {
			transfer.Operation = "group_" + operation
		}
		result, err = tx.transferTeamCredits(transfer)
		return err
	})
	return result, err
}

func (r *Repository) transferTeamCredits(transfer model.CreditTransfer) (*TeamCreditTransferResult, error) {
	ids := []string{transfer.SourceAccountID, transfer.TargetAccountID}
	sort.Strings(ids)
	for _, id := range ids {
		var account model.CreditAccount
		if err := r.db.Clauses(clause.Locking{Strength: "UPDATE"}).First(&account, "id = ?", id).Error; err != nil {
			return nil, err
		}
	}
	if err := r.db.Create(&transfer).Error; err != nil {
		return nil, err
	}
	updated := r.db.Model(&model.CreditAccount{}).Where("id = ? AND available_microcredits >= ?", transfer.SourceAccountID, transfer.AmountMicrocredits).
		Updates(map[string]any{"available_microcredits": gorm.Expr("available_microcredits - ?", transfer.AmountMicrocredits), "version": gorm.Expr("version + 1"), "updated_at": time.Now()})
	if updated.Error != nil {
		return nil, updated.Error
	}
	if updated.RowsAffected != 1 {
		return nil, ErrInsufficientCredits
	}
	updated = r.db.Model(&model.CreditAccount{}).Where("id = ? AND available_microcredits <= ?", transfer.TargetAccountID, int64(math.MaxInt64)-transfer.AmountMicrocredits).
		Updates(map[string]any{"available_microcredits": gorm.Expr("available_microcredits + ?", transfer.AmountMicrocredits), "version": gorm.Expr("version + 1"), "updated_at": time.Now()})
	if updated.Error != nil {
		return nil, updated.Error
	}
	if updated.RowsAffected != 1 {
		return nil, ErrTeamWalletAmount
	}
	result, err := r.teamTransferResult(transfer)
	if err != nil {
		return nil, err
	}
	for _, leg := range []struct {
		account model.CreditAccount
		delta   int64
		side    string
	}{{result.Source, -transfer.AmountMicrocredits, "out"}, {result.Target, transfer.AmountMicrocredits, "in"}} {
		key := "team-transfer:" + transfer.ID + ":" + leg.side
		entry := model.CreditLedgerEntry{ID: newRepositoryID(), AccountID: leg.account.ID, UserID: transfer.ActorUserID, TeamID: transfer.TeamID, MembershipID: leg.account.MembershipID, TransferID: transfer.ID, Type: model.CreditLedgerTeamTransfer, AmountMicrocredits: leg.delta, AvailableDeltaMicrocredits: leg.delta, AvailableAfterMicrocredits: leg.account.AvailableMicrocredits, ReservedAfterMicrocredits: leg.account.ReservedMicrocredits, ActorUserID: transfer.ActorUserID, ReferenceKey: &key, Note: transfer.Operation}
		if leg.account.TeamID != "" {
			entry.TeamID = leg.account.TeamID
		}
		if err := r.db.Create(&entry).Error; err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (r *Repository) teamTransferResult(transfer model.CreditTransfer) (*TeamCreditTransferResult, error) {
	source, err := r.CreditAccountByID(transfer.SourceAccountID)
	if err != nil {
		return nil, err
	}
	target, err := r.CreditAccountByID(transfer.TargetAccountID)
	if err != nil {
		return nil, err
	}
	return &TeamCreditTransferResult{Transfer: transfer, Source: *source, Target: *target}, nil
}

// Called inside the membership-change transaction while the team row is locked.
func (r *Repository) ReclaimDepartingTeamMember(teamID, membershipID, actorID string) error {
	return r.reclaimTeamMemberAvailable(teamID, membershipID, actorID, "member_leave", "")
}

func (r *Repository) reclaimTeamMemberAvailable(teamID, membershipID, actorID, operation, billingOrderID string) error {
	account, err := r.CreditAccountByID(model.TeamMemberCreditAccountID(membershipID))
	if err != nil {
		return err
	}
	if account.TeamID != teamID {
		return ErrTeamWalletForbidden
	}
	if account.AvailableMicrocredits <= 0 {
		return nil
	}
	id := newRepositoryID()
	_, err = r.transferTeamCredits(model.CreditTransfer{ID: id, TeamID: teamID, ActorUserID: actorID, Operation: operation, SourceAccountID: account.ID, TargetAccountID: model.TeamPoolCreditAccountID(teamID), AmountMicrocredits: account.AvailableMicrocredits, IdempotencyKey: "system:" + id, RequestHash: id, BillingOrderID: billingOrderID})
	return err
}

func billingAccountQuery(tx *gorm.DB, order model.BillingOrder) *gorm.DB {
	query := tx.Model(&model.CreditAccount{})
	if order.BillingAccountID != "" {
		return query.Where("id = ?", order.BillingAccountID)
	}
	return query.Where("user_id = ?", order.UserID)
}

func validateTeamBillingReservation(tx *gorm.DB, order *model.BillingOrder) error {
	if order.Capability != "text" || (order.BillingMode != "fixed_request" && order.BillingMode != "token") || order.Scene != "team_text" || !order.ChargeLimitSet || order.ChargeLimitMicrocredits != order.AmountMicrocredits || order.BillingAccountID != model.TeamMemberCreditAccountID(order.MembershipID) {
		return ErrTeamWalletForbidden
	}
	repo := New(tx)
	if _, err := repo.LockTeam(order.TeamID); err != nil {
		return err
	}
	member, err := repo.TeamMembershipForUser(order.TeamID, order.UserID)
	if err != nil {
		return err
	}
	if member.ID != order.MembershipID {
		return ErrTeamWalletForbidden
	}
	return nil
}

func lockTeamForBilling(tx *gorm.DB, orderID string) error {
	var order model.BillingOrder
	if err := tx.Select("team_id").First(&order, "id = ?", orderID).Error; err != nil {
		return err
	}
	if order.TeamID == "" {
		return nil
	}
	_, err := New(tx).LockTeam(order.TeamID)
	return err
}

func reclaimDepartedBillingAccount(tx *gorm.DB, order model.BillingOrder) error {
	if order.TeamID == "" {
		return nil
	}
	var member model.TeamMembership
	if err := tx.First(&member, "id = ? AND team_id = ?", order.MembershipID, order.TeamID).Error; err != nil {
		return err
	}
	if member.Status == "active" {
		return nil
	}
	return New(tx).reclaimTeamMemberAvailable(order.TeamID, member.ID, "", "billing_release", order.ID)
}
