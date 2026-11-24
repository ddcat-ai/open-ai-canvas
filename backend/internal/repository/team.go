package repository

import (
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

type TeamSummary struct {
	model.Team
	ParentName   string `json:"parentName,omitempty"`
	MembershipID string `json:"membershipId"`
	Role         string `json:"role"`
}

type TeamMemberView struct {
	model.TeamMembership
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

type TeamInviteCandidate struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Status      string `json:"status"`
}

type TeamInvitationView struct {
	model.TeamInvitation
	TeamName    string `json:"teamName"`
	ParentName  string `json:"parentName,omitempty"`
	InviterName string `json:"inviterName"`
	InviteeName string `json:"inviteeName"`
}

func (r *Repository) LockTeam(teamID string) (*model.Team, error) {
	// SQLite ignores FOR UPDATE; acquire its writer lock before reading authorization state.
	if r.Dialect() == "sqlite" {
		if err := r.db.Exec("UPDATE teams SET status = status WHERE id = ?", teamID).Error; err != nil {
			return nil, err
		}
	}
	if r.Dialect() == "postgres" {
		// Membership changes in a company and in its groups take the company lock first.
		var parent struct{ ParentID string }
		if err := r.db.Model(&model.Team{}).Select("parent_id").Where("id = ?", teamID).Take(&parent).Error; err != nil {
			return nil, err
		}
		if parent.ParentID != "" {
			if err := r.db.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").First(&model.Team{}, "id = ?", parent.ParentID).Error; err != nil {
				return nil, err
			}
		}
	}
	var team model.Team
	err := r.db.Clauses(clause.Locking{Strength: "UPDATE"}).First(&team, "id = ?", teamID).Error
	return &team, err
}

func (r *Repository) activeTeamMemberships(userID string) *gorm.DB {
	return r.db.Model(&model.TeamMembership{}).
		Joins("JOIN teams ON teams.id = team_memberships.team_id AND teams.status = ?", model.TeamActive).
		Joins("LEFT JOIN teams AS company ON company.id = teams.parent_id").
		Where("teams.parent_id = '' OR (company.status = ? AND EXISTS (SELECT 1 FROM team_memberships pm WHERE pm.team_id = company.id AND pm.user_id = team_memberships.user_id AND pm.status = ?))", model.TeamActive, model.TeamActive).
		Joins("JOIN users AS owner_account ON owner_account.id = teams.owner_user_id AND owner_account.status = ?", model.UserStatusActive).
		Joins("JOIN users AS actor ON actor.id = team_memberships.user_id AND actor.status = ?", model.UserStatusActive).
		Where("team_memberships.user_id = ? AND team_memberships.status = ?", userID, model.TeamActive)
}

func (r *Repository) TeamMembershipForUser(teamID, userID string) (*model.TeamMembership, error) {
	var member model.TeamMembership
	err := r.activeTeamMemberships(userID).Select("team_memberships.*").Where("teams.id = ?", teamID).Take(&member).Error
	return &member, err
}

func (r *Repository) TeamsForUser(userID string) ([]TeamSummary, error) {
	rows := []TeamSummary{}
	err := r.activeTeamMemberships(userID).Select("teams.*, company.name AS parent_name, team_memberships.id AS membership_id, team_memberships.role").Order("teams.created_at, teams.id").Scan(&rows).Error
	return rows, err
}

func (r *Repository) TeamForUser(teamID, userID string) (*TeamSummary, error) {
	var summary TeamSummary
	err := r.activeTeamMemberships(userID).Select("teams.*, company.name AS parent_name, team_memberships.id AS membership_id, team_memberships.role").Where("teams.id = ?", teamID).Take(&summary).Error
	return &summary, err
}

func (r *Repository) AddTeam(team *model.Team) error { return r.db.Create(team).Error }

func (r *Repository) GroupsForDepartingMember(parentID, userID string) ([]model.TeamMembership, error) {
	var rows []model.TeamMembership
	err := r.db.Model(&model.TeamMembership{}).Joins("JOIN teams t ON t.id = team_memberships.team_id").Where("t.parent_id = ? AND team_memberships.user_id = ? AND team_memberships.status = ?", parentID, userID, model.TeamActive).Order("t.id").Find(&rows).Error
	return rows, err
}

func (r *Repository) RevokeGroupInvitations(parentID, userID string, now time.Time) error {
	groups := r.db.Model(&model.Team{}).Select("id").Where("parent_id = ?", parentID)
	return r.db.Model(&model.TeamInvitation{}).Where("team_id IN (?) AND invitee_user_id = ? AND status = ?", groups, userID, model.InvitationPending).Updates(map[string]any{"status": model.InvitationRevoked, "responded_at": now}).Error
}

const teamInviteEligibility = `EXISTS (SELECT 1 FROM teams dest WHERE dest.id = ? AND (dest.parent_id = '' OR EXISTS (SELECT 1 FROM team_memberships pm WHERE pm.team_id = dest.parent_id AND pm.user_id = u.id AND pm.status = 'active')))`

func (r *Repository) TeamInviteeEligible(teamID, userID string) (bool, error) {
	var count int64
	err := r.db.Table("users AS u").Where("u.id = ? AND u.status = ?", userID, model.UserStatusActive).Where(teamInviteEligibility, teamID).Count(&count).Error
	return count != 0, err
}
func (r *Repository) AddTeamMembership(member *model.TeamMembership) error {
	return r.db.Create(member).Error
}

func (r *Repository) ActiveTeamMemberByID(teamID, id string) (*model.TeamMembership, error) {
	var member model.TeamMembership
	err := r.db.Where("id = ? AND team_id = ? AND status = ?", id, teamID, model.TeamActive).Take(&member).Error
	return &member, err
}

func (r *Repository) EndTeamMembership(teamID, id string, now time.Time) error {
	updated := r.db.Model(&model.TeamMembership{}).Where("id = ? AND team_id = ? AND role = ? AND status = ?", id, teamID, model.TeamMember, model.TeamActive).Updates(map[string]any{"status": model.TeamLeft, "ended_at": now})
	if updated.Error != nil {
		return updated.Error
	}
	if updated.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) ListTeamMembers(teamID string) ([]TeamMemberView, error) {
	rows := []TeamMemberView{}
	err := r.db.Table("team_memberships AS m").Select("m.*, users.username, users.display_name").Joins("JOIN users ON users.id = m.user_id").Where("m.team_id = ? AND m.status = ?", teamID, model.TeamActive).Order("m.created_at, m.id").Scan(&rows).Error
	return rows, err
}

func (r *Repository) TeamCandidates(teamID, actorID, query string, now time.Time) ([]TeamInviteCandidate, error) {
	rows := []TeamInviteCandidate{}
	pattern := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(strings.ToLower(query)) + "%"
	err := r.db.Table("users AS u").Select("u.id, u.username, u.display_name, CASE WHEN m.id IS NOT NULL THEN 'member' WHEN i.id IS NOT NULL THEN 'pending' ELSE 'available' END AS status").
		Joins("LEFT JOIN team_memberships AS m ON m.team_id = ? AND m.user_id = u.id AND m.status = ?", teamID, model.TeamActive).
		Joins("LEFT JOIN team_invitations AS i ON i.team_id = ? AND i.invitee_user_id = u.id AND i.status = ? AND i.expires_at > ?", teamID, model.InvitationPending, now).
		Where(teamInviteEligibility, teamID).
		Where("u.status = ? AND u.id <> ? AND (LOWER(u.username) = ? OR LOWER(u.display_name) LIKE ? ESCAPE '!')", model.UserStatusActive, actorID, strings.ToLower(query), pattern).
		Clauses(clause.OrderBy{Expression: clause.Expr{SQL: "CASE WHEN LOWER(u.username) = ? THEN 0 ELSE 1 END, u.username, u.id", Vars: []any{strings.ToLower(query)}}}).Limit(20).Scan(&rows).Error
	return rows, err
}

func (r *Repository) ExpireTeamInvites(teamID, inviteeID string, now time.Time) error {
	return r.db.Model(&model.TeamInvitation{}).Where("team_id = ? AND invitee_user_id = ? AND status = ? AND expires_at <= ?", teamID, inviteeID, model.InvitationPending, now).Update("status", model.InvitationExpired).Error
}

func (r *Repository) AddTeamInvitation(invite *model.TeamInvitation) error {
	return r.db.Create(invite).Error
}

func (r *Repository) invitationViews() *gorm.DB {
	return r.db.Model(&model.TeamInvitation{}).Select("team_invitations.*, t.name AS team_name, company.name AS parent_name, COALESCE(NULLIF(sender.display_name, ''),sender.username) AS inviter_name, COALESCE(NULLIF(recipient.display_name, ''),recipient.username) AS invitee_name").
		Joins("JOIN teams AS t ON t.id = team_invitations.team_id").Joins("LEFT JOIN teams AS company ON company.id = t.parent_id").Joins("JOIN users AS sender ON sender.id = team_invitations.inviter_user_id").Joins("JOIN users AS recipient ON recipient.id = team_invitations.invitee_user_id")
}

func (r *Repository) InvitationsForTeam(teamID string) ([]TeamInvitationView, error) {
	rows := []TeamInvitationView{}
	err := r.invitationViews().Where("team_invitations.team_id = ?", teamID).Order("team_invitations.created_at DESC, team_invitations.id").Limit(200).Scan(&rows).Error
	return rows, err
}

func (r *Repository) InvitationsForRecipient(userID string, now time.Time) ([]TeamInvitationView, error) {
	rows := []TeamInvitationView{}
	err := r.invitationViews().Joins("JOIN users AS own ON own.id = t.owner_user_id AND own.status = ?", model.UserStatusActive).Where("recipient.id = ? AND recipient.status = ? AND t.status = ? AND team_invitations.status = ? AND team_invitations.expires_at > ?", userID, model.UserStatusActive, model.TeamActive, model.InvitationPending, now).Order("team_invitations.created_at DESC, team_invitations.id").Scan(&rows).Error
	return rows, err
}

func (r *Repository) InvitationForRecipient(id, userID string) (*TeamInvitationView, error) {
	var row TeamInvitationView
	err := r.invitationViews().Where("team_invitations.id = ? AND recipient.id = ?", id, userID).Take(&row).Error
	return &row, err
}

func (r *Repository) InvitationForTeam(teamID, id string) (*TeamInvitationView, error) {
	var row TeamInvitationView
	err := r.invitationViews().Where("team_invitations.id = ? AND t.id = ?", id, teamID).Take(&row).Error
	return &row, err
}

func (r *Repository) PendingTeamInvitation(teamID, userID string) (*TeamInvitationView, error) {
	var row TeamInvitationView
	err := r.invitationViews().Where("t.id = ? AND recipient.id = ? AND team_invitations.status = ?", teamID, userID, model.InvitationPending).Take(&row).Error
	return &row, err
}

func (r *Repository) ResolveTeamInvitation(id, status string, now time.Time) error {
	updated := r.db.Model(&model.TeamInvitation{}).Where("id = ? AND status = ?", id, model.InvitationPending).Updates(map[string]any{"status": status, "responded_at": now})
	if updated.Error != nil {
		return updated.Error
	}
	if updated.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
