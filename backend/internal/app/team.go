package app

import (
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func teamError(status int, reason ErrorReason, message string) *AppError {
	err := NewAppError(status, message)
	err.Reason = reason
	return err
}

func teamNotFound(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return NotFound("团队内容不存在或不可访问")
	}
	return err
}

func teamMemberAccess(repo *repository.Repository, userID, teamID string, ownerOnly bool) (*model.TeamMembership, error) {
	member, err := repo.TeamMembershipForUser(teamID, userID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, teamError(http.StatusForbidden, "team_access_denied", "你没有访问该团队的权限")
	}
	if err != nil {
		return nil, err
	}
	if ownerOnly && member.Role != model.TeamOwner {
		return nil, teamError(http.StatusForbidden, "team_owner_required", "仅团队所有者可以执行此操作")
	}
	return member, nil
}

func (s *Service) requireTeamMember(userID, teamID string, ownerOnly bool) (*model.TeamMembership, error) {
	return teamMemberAccess(s.repo, userID, teamID, ownerOnly)
}

func (s *Service) WorkspaceContentKey(actorID, teamID string) (string, error) {
	if teamID == "" {
		return actorID, nil
	}
	if _, err := s.requireTeamMember(actorID, teamID, false); err != nil {
		return "", err
	}
	return model.TeamContentKey(teamID), nil
}

func (s *Service) withTeamWrite(userID, teamID string, ownerOnly bool, write func(*repository.Repository, *model.TeamMembership) error) error {
	return s.repo.Transaction(func(tx *repository.Repository) error {
		if _, err := tx.LockTeam(teamID); err != nil {
			return teamNotFound(err)
		}
		member, err := teamMemberAccess(tx, userID, teamID, ownerOnly)
		if err != nil {
			return err
		}
		return write(tx, member)
	})
}

func (s *Service) ListMyTeams(userID string) ([]repository.TeamSummary, error) {
	return s.repo.TeamsForUser(userID)
}

func (s *Service) GetTeam(userID, teamID string) (*repository.TeamSummary, error) {
	team, err := s.repo.TeamForUser(teamID, userID)
	return team, teamNotFound(err)
}

func (s *Service) CreateTeam(userID, name string) (*repository.TeamSummary, error) {
	return s.createTeamSpace(userID, "", name)
}

func (s *Service) CreateTeamGroup(userID, companyID, name string) (*repository.TeamSummary, error) {
	if companyID == "" {
		return nil, BadAuthRequest("请选择所属公司")
	}
	return s.createTeamSpace(userID, companyID, name)
}

func (s *Service) createTeamSpace(userID, companyID, name string) (*repository.TeamSummary, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 80 {
		return nil, BadAuthRequest("团队名称须为 1–80 个字符")
	}
	team := model.Team{ID: newID(), Name: name, OwnerUserID: userID, ParentID: companyID, Status: model.TeamActive}
	member := model.TeamMembership{ID: newID(), TeamID: team.ID, UserID: userID, Role: model.TeamOwner, Status: model.TeamActive}
	var parentName string
	err := s.repo.Transaction(func(tx *repository.Repository) error {
		if companyID != "" {
			parent, err := tx.LockTeam(companyID)
			if err != nil {
				return teamNotFound(err)
			}
			if _, err = teamMemberAccess(tx, userID, companyID, true); err != nil {
				return err
			}
			if parent.ParentID != "" {
				return BadAuthRequest("请在公司空间下创建小组")
			}
			parentName = parent.Name
		}
		user, err := tx.User(userID)
		if err != nil {
			return teamNotFound(err)
		}
		if user.Status != model.UserStatusActive {
			return Forbidden("账号状态不允许创建团队")
		}
		if err = tx.AddTeam(&team); err != nil {
			return err
		}
		if err = tx.AddTeamMembership(&member); err != nil {
			return err
		}
		return tx.OpenTeamWallets(team.ID, member.ID, true)
	})
	if err != nil {
		return nil, err
	}
	return &repository.TeamSummary{Team: team, ParentName: parentName, MembershipID: member.ID, Role: member.Role}, nil
}

func (s *Service) TeamMembers(userID, teamID string) ([]repository.TeamMemberView, error) {
	if _, err := s.requireTeamMember(userID, teamID, false); err != nil {
		return nil, err
	}
	return s.repo.ListTeamMembers(teamID)
}

func (s *Service) SearchTeamCandidates(userID, teamID, query string) ([]repository.TeamInviteCandidate, error) {
	if _, err := s.requireTeamMember(userID, teamID, true); err != nil {
		return nil, err
	}
	query = strings.TrimSpace(query)
	if query == "" || utf8.RuneCountInString(query) > 80 {
		return nil, BadAuthRequest("请输入账号或名称（最多 80 个字符）")
	}
	return s.repo.TeamCandidates(teamID, userID, query, time.Now())
}

func (s *Service) InviteTeamUser(userID, teamID, inviteeID string) (*repository.TeamInvitationView, error) {
	inviteeID = strings.TrimSpace(inviteeID)
	if inviteeID == "" || len(inviteeID) > 36 || userID == inviteeID {
		return nil, BadAuthRequest("请选择其他平台账号")
	}
	var result *repository.TeamInvitationView
	err := s.withTeamWrite(userID, teamID, true, func(tx *repository.Repository, _ *model.TeamMembership) error {
		eligible, err := tx.TeamInviteeEligible(teamID, inviteeID)
		if err != nil {
			return err
		}
		if !eligible {
			return teamError(409, "team_invitee_ineligible", "请选择可用账号。邀请加入小组前，对方需先加入所属公司。")
		}
		if _, err = tx.TeamMembershipForUser(teamID, inviteeID); err == nil {
			return teamError(409, "team_already_member", "该用户已是团队成员")
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		now := time.Now()
		if err = tx.ExpireTeamInvites(teamID, inviteeID, now); err != nil {
			return err
		}
		result, err = tx.PendingTeamInvitation(teamID, inviteeID)
		if err == nil {
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		invite := model.TeamInvitation{ID: newID(), TeamID: teamID, InviterUserID: userID, InviteeUserID: inviteeID, Status: model.InvitationPending, ExpiresAt: now.Add(7 * 24 * time.Hour)}
		if err = tx.AddTeamInvitation(&invite); err != nil {
			return err
		}
		result, err = tx.InvitationForTeam(teamID, invite.ID)
		return err
	})
	return result, err
}

func (s *Service) TeamInvitations(userID, teamID string) ([]repository.TeamInvitationView, error) {
	if _, err := s.requireTeamMember(userID, teamID, true); err != nil {
		return nil, err
	}
	rows, err := s.repo.InvitationsForTeam(teamID)
	now := time.Now()
	for i := range rows {
		if rows[i].Status == model.InvitationPending && !rows[i].ExpiresAt.After(now) {
			rows[i].Status = model.InvitationExpired
		}
	}
	return rows, err
}

func (s *Service) MyTeamInvitations(userID string) ([]repository.TeamInvitationView, error) {
	return s.repo.InvitationsForRecipient(userID, time.Now())
}

func (s *Service) ResolveTeamInvitation(userID, teamID, invitationID, decision string) (*repository.TeamInvitationView, error) {
	switch decision {
	case model.InvitationAccepted, model.InvitationRejected:
		invite, err := s.repo.InvitationForRecipient(invitationID, userID)
		if err != nil {
			return nil, teamNotFound(err)
		}
		teamID = invite.TeamID
	case model.InvitationRevoked:
	default:
		return nil, BadAuthRequest("邀请操作无效")
	}
	var result *repository.TeamInvitationView
	err := s.repo.Transaction(func(tx *repository.Repository) error {
		team, err := tx.LockTeam(teamID)
		if err != nil {
			return teamNotFound(err)
		}
		if decision == model.InvitationRevoked {
			if _, err = teamMemberAccess(tx, userID, teamID, true); err != nil {
				return err
			}
		}
		result, err = tx.InvitationForTeam(teamID, invitationID)
		if err != nil {
			return teamNotFound(err)
		}
		if decision != model.InvitationRevoked && result.InviteeUserID != userID {
			return NotFound("邀请不存在")
		}
		if result.Status == decision {
			return nil
		}
		now := time.Now()
		if result.Status == model.InvitationExpired || (result.Status == model.InvitationPending && !result.ExpiresAt.After(now)) {
			return teamError(409, "team_invitation_expired", "邀请已过期")
		}
		if result.Status != model.InvitationPending {
			return teamError(409, "team_invitation_resolved", "邀请已处理或已撤回")
		}
		if decision == model.InvitationAccepted {
			if team.Status != model.TeamActive {
				return Forbidden("该团队已停止接收成员")
			}
			if _, err = teamMemberAccess(tx, team.OwnerUserID, teamID, true); err != nil {
				return err
			}
			eligible, err := tx.TeamInviteeEligible(teamID, userID)
			if err != nil {
				return err
			}
			if !eligible {
				return Forbidden("账号或所属公司成员资格已失效")
			}
			member := model.TeamMembership{ID: newID(), TeamID: teamID, UserID: userID, Role: model.TeamMember, Status: model.TeamActive}
			if err = tx.AddTeamMembership(&member); err != nil {
				return err
			}
			if err = tx.OpenTeamWallets(teamID, member.ID, false); err != nil {
				return err
			}
		}
		if err = tx.ResolveTeamInvitation(invitationID, decision, now); err != nil {
			return err
		}
		result.Status = decision
		result.RespondedAt = &now
		return nil
	})
	return result, err
}

func (s *Service) EndTeamMembership(userID, teamID, targetID string, self bool) error {
	return s.withTeamWrite(userID, teamID, !self, func(tx *repository.Repository, actor *model.TeamMembership) error {
		target := actor
		if !self {
			var err error
			target, err = tx.ActiveTeamMemberByID(teamID, targetID)
			if err != nil {
				return teamNotFound(err)
			}
		}
		if target.Role == model.TeamOwner {
			return teamError(409, "team_owner_cannot_leave", "团队所有者不能退出或被移除")
		}
		groups, err := tx.GroupsForDepartingMember(teamID, target.UserID)
		if err != nil {
			return err
		}
		now := time.Now()
		if err := tx.RevokeGroupInvitations(teamID, target.UserID, now); err != nil {
			return err
		}
		for _, membership := range append(groups, *target) {
			if err := tx.ReclaimDepartingTeamMember(membership.TeamID, membership.ID, userID); err != nil {
				return err
			}
			if err := tx.EndTeamMembership(membership.TeamID, membership.ID, now); err != nil {
				return err
			}
		}
		return nil
	})
}
