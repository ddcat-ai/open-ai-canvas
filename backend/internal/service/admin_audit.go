package service

import (
	"encoding/json"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

type AdminUserDetail struct {
	User    model.User                 `json:"user"`
	Account model.CreditAccount        `json:"account"`
	Counts  repository.AdminUserCounts `json:"counts"`
}

type AdminTaskPage struct {
	Tasks []model.Task `json:"tasks"`
	Total int64        `json:"total"`
	Page  int          `json:"page"`
	Limit int          `json:"limit"`
}

type AdminAuditPage struct {
	Events []model.AdminAuditEvent `json:"events"`
	Total  int64                   `json:"total"`
	Page   int                     `json:"page"`
	Limit  int                     `json:"limit"`
}

func (s *Service) appendAdminAudit(actor *model.User, action string, targetType string, targetID string, summary string, metadata any) error {
	if actor == nil {
		return Unauthorized("请先登录")
	}
	encoded := ""
	if metadata != nil {
		data, err := json.Marshal(metadata)
		if err != nil {
			return err
		}
		encoded = string(data)
	}
	return s.repo.AppendAdminAudit(&model.AdminAuditEvent{
		ID: newID(), ActorUserID: actor.ID, Action: strings.TrimSpace(action), TargetType: strings.TrimSpace(targetType),
		TargetID: strings.TrimSpace(targetID), Summary: truncateRunes(strings.TrimSpace(summary), 500), MetadataJSON: encoded, CreatedAt: time.Now(),
	})
}

func (s *Service) AdminUserDetail(actor *model.User, userID string) (*AdminUserDetail, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	user, err := s.repo.User(strings.TrimSpace(userID))
	if err != nil {
		return nil, err
	}
	account, err := s.repo.CreditAccount(user.ID)
	if err != nil {
		return nil, err
	}
	counts, err := s.repo.AdminUserCounts(user.ID)
	if err != nil {
		return nil, err
	}
	return &AdminUserDetail{User: *user, Account: *account, Counts: counts}, nil
}

func (s *Service) AdminUserLedger(actor *model.User, userID string, entryType string, page int, limit int) (*WalletSummary, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if _, err := s.repo.User(userID); err != nil {
		return nil, err
	}
	page, limit = normalizeAdminPage(page, limit)
	account, err := s.repo.CreditAccount(userID)
	if err != nil {
		return nil, err
	}
	entries, total, err := s.repo.CreditLedger(userID, entryType, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	return &WalletSummary{Account: *account, Entries: entries, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) AdminUserTasks(actor *model.User, userID string, page int, limit int) (*AdminTaskPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if _, err := s.repo.User(userID); err != nil {
		return nil, err
	}
	page, limit = normalizeAdminPage(page, limit)
	tasks, total, err := s.repo.AdminUserTasks(userID, limit, (page-1)*limit)
	return &AdminTaskPage{Tasks: tasks, Total: total, Page: page, Limit: limit}, err
}

func (s *Service) AdminUserAuditEvents(actor *model.User, userID string, page int, limit int) (*AdminAuditPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if _, err := s.repo.User(userID); err != nil {
		return nil, err
	}
	page, limit = normalizeAdminPage(page, limit)
	events, total, err := s.repo.AdminAuditEvents("user", userID, limit, (page-1)*limit)
	return &AdminAuditPage{Events: events, Total: total, Page: page, Limit: limit}, err
}
