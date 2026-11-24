package repository

import (
	"errors"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

type SpaceCreditBalance struct {
	AvailableMicrocredits int64 `json:"availableMicrocredits"`
	ReservedMicrocredits  int64 `json:"reservedMicrocredits"`
}

type TeamSpaceCredit struct {
	TeamID     string `json:"teamId"`
	Name       string `json:"name"`
	ParentID   string `json:"parentId,omitempty"`
	ParentName string `json:"parentName,omitempty"`
	Role       string `json:"role"`
	SpaceCreditBalance
	PoolAvailableMicrocredits int64 `json:"poolAvailableMicrocredits"`
}

type SpaceCreditOverview struct {
	Personal SpaceCreditBalance `json:"personal"`
	Spaces   []TeamSpaceCredit  `json:"spaces"`
}

func (r *Repository) MySpaceCredits(userID string) (*SpaceCreditOverview, error) {
	spaces := r.activeTeamMemberships(userID).Select("teams.id AS team_id, teams.name, teams.parent_id, company.name AS parent_name, team_memberships.role, team_memberships.id AS membership_id")
	var rows []struct {
		TeamSpaceCredit
		PersonalAvailable int64
		PersonalReserved  int64
		AccountsReady     bool
	}
	// One statement keeps the two sides of an inter-space transfer in the same snapshot.
	// A fresh user's personal wallet starts at zero and is normally opened on its first write.
	err := r.db.Table("users AS current_account").Select(`s.team_id, s.name, s.parent_id, s.parent_name, s.role,
		own.available_microcredits, own.reserved_microcredits, pool.available_microcredits AS pool_available_microcredits,
		(own.id IS NOT NULL AND pool.id IS NOT NULL) AS accounts_ready,
		COALESCE(p.available_microcredits, 0) AS personal_available, COALESCE(p.reserved_microcredits, 0) AS personal_reserved`).
		Joins("LEFT JOIN credit_accounts p ON p.id = ? AND p.kind = ?", model.PersonalCreditAccountID(userID), model.CreditAccountPersonal).
		Joins("LEFT JOIN (?) s ON 1 = 1", spaces).
		Joins("LEFT JOIN credit_accounts own ON own.id = (? || s.membership_id) AND own.team_id = s.team_id", model.TeamMemberCreditAccountID("")).
		Joins("LEFT JOIN credit_accounts pool ON pool.id = (? || s.team_id) AND pool.team_id = s.team_id", model.TeamPoolCreditAccountID("")).
		Where("current_account.id = ? AND current_account.status = ?", userID, model.UserStatusActive).
		Order("COALESCE(s.parent_name, s.name), s.parent_id, s.name, s.team_id").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	result := &SpaceCreditOverview{Personal: SpaceCreditBalance{AvailableMicrocredits: rows[0].PersonalAvailable, ReservedMicrocredits: rows[0].PersonalReserved}, Spaces: []TeamSpaceCredit{}}
	for _, row := range rows {
		if row.TeamID == "" {
			continue
		}
		if !row.AccountsReady {
			return nil, errors.New("团队积分账户缺失，请联系管理员核对")
		}
		result.Spaces = append(result.Spaces, row.TeamSpaceCredit)
	}
	return result, nil
}
