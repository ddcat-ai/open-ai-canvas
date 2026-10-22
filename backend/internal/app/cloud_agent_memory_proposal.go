package app

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

type AgentMemoryProposalDecision struct {
	Decision string `json:"decision"`
	Version  int64  `json:"version"`
}

type AgentMemoryRevisionRestore struct {
	Version int64 `json:"version"`
}

type AgentMemoryChangeView struct {
	Kind   string            `json:"kind"`
	Before []AgentLessonView `json:"before"`
	After  AgentLessonView   `json:"after"`
}

type AgentMemoryProposalView struct {
	ID        string                    `json:"id"`
	Status    string                    `json:"status"`
	Version   int64                     `json:"version"`
	TaskID    string                    `json:"taskId,omitempty"`
	Summary   AgentMemoryCompactSummary `json:"summary"`
	Changes   []AgentMemoryChangeView   `json:"changes"`
	CreatedAt time.Time                 `json:"createdAt"`
	DecidedAt *time.Time                `json:"decidedAt,omitempty"`
}

type AgentMemoryRevisionView struct {
	ID         string            `json:"id"`
	ProposalID string            `json:"proposalId"`
	Version    int64             `json:"version"`
	Before     []AgentLessonView `json:"before"`
	After      []AgentLessonView `json:"after"`
	CreatedAt  time.Time         `json:"createdAt"`
	RestoredAt *time.Time        `json:"restoredAt,omitempty"`
}

func agentMemoryProposalError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return kernel.NotFound("记忆提案或版本不存在")
	}
	if errors.Is(err, repository.ErrCreationConflict) {
		return creationConflict("记忆或提案已变化，请刷新后检查；不会覆盖新的修改")
	}
	return err
}

func (s *Service) UserAgentMemoryProposals(userID string, limit int) ([]AgentMemoryProposalView, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	rows, err := s.repo.UserAgentMemoryProposals(userID, limit)
	if err != nil {
		return nil, err
	}
	views := make([]AgentMemoryProposalView, 0, len(rows))
	for _, row := range rows {
		view, err := agentMemoryProposalViewOf(row)
		if err != nil {
			return nil, err
		}
		views = append(views, view)
	}
	return views, nil
}

func (s *Service) DecideUserAgentMemoryProposal(userID, id string, req AgentMemoryProposalDecision) (AgentMemoryProposalView, error) {
	if strings.TrimSpace(userID) == "" {
		return AgentMemoryProposalView{}, kernel.Unauthorized("请先登录")
	}
	decision := ""
	switch req.Decision {
	case "approve":
		decision = model.AgentMemoryProposalApproved
	case "reject":
		decision = model.AgentMemoryProposalRejected
	default:
		return AgentMemoryProposalView{}, BadAuthRequest("无效的提案决定")
	}
	if strings.TrimSpace(id) == "" || req.Version <= 0 {
		return AgentMemoryProposalView{}, BadAuthRequest("提案 ID 和 version 必须有效")
	}
	if err := s.repo.DecideAgentMemoryProposal(userID, id, decision, newID(), req.Version, time.Now().UTC()); err != nil {
		return AgentMemoryProposalView{}, agentMemoryProposalError(err)
	}
	row, err := s.repo.AgentMemoryProposalForUser(userID, id)
	if err != nil {
		return AgentMemoryProposalView{}, agentMemoryProposalError(err)
	}
	return agentMemoryProposalViewOf(*row)
}

func (s *Service) UserAgentMemoryRevisions(userID string, limit int) ([]AgentMemoryRevisionView, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	rows, err := s.repo.UserAgentMemoryRevisions(userID, limit)
	if err != nil {
		return nil, err
	}
	views := make([]AgentMemoryRevisionView, 0, len(rows))
	for _, row := range rows {
		view, err := agentMemoryRevisionViewOf(row)
		if err != nil {
			return nil, err
		}
		views = append(views, view)
	}
	return views, nil
}

func (s *Service) RestoreUserAgentMemoryRevision(userID, id string, req AgentMemoryRevisionRestore) (AgentMemoryRevisionView, error) {
	if strings.TrimSpace(userID) == "" {
		return AgentMemoryRevisionView{}, kernel.Unauthorized("请先登录")
	}
	if strings.TrimSpace(id) == "" || req.Version <= 0 {
		return AgentMemoryRevisionView{}, BadAuthRequest("版本 ID 和 version 必须有效")
	}
	if err := s.repo.RestoreAgentMemoryRevision(userID, id, req.Version, time.Now().UTC()); err != nil {
		return AgentMemoryRevisionView{}, agentMemoryProposalError(err)
	}
	row, err := s.repo.AgentMemoryRevisionForUser(userID, id)
	if err != nil {
		return AgentMemoryRevisionView{}, agentMemoryProposalError(err)
	}
	return agentMemoryRevisionViewOf(*row)
}

func memorySnapshotViews(snapshots []model.AgentMemorySnapshot) []AgentLessonView {
	views := make([]AgentLessonView, 0, len(snapshots))
	for _, snapshot := range snapshots {
		views = append(views, agentLessonViewOf(snapshot.LessonForUser("")))
	}
	return views
}

func agentMemoryProposalViewOf(row model.AgentMemoryProposal) (AgentMemoryProposalView, error) {
	view := AgentMemoryProposalView{
		ID: row.ID, Status: row.Status, Version: row.Version, TaskID: row.TaskID,
		CreatedAt: row.CreatedAt, DecidedAt: row.DecidedAt, Changes: []AgentMemoryChangeView{},
	}
	var changes []model.AgentMemoryChange
	if err := json.Unmarshal([]byte(row.ChangesJSON), &changes); err != nil {
		return view, err
	}
	if err := json.Unmarshal([]byte(row.SummaryJSON), &view.Summary); err != nil {
		return view, err
	}
	for _, change := range changes {
		view.Changes = append(view.Changes, AgentMemoryChangeView{
			Kind: change.Kind, Before: memorySnapshotViews(change.Before),
			After: agentLessonViewOf(change.After.LessonForUser("")),
		})
	}
	return view, nil
}

func agentMemoryRevisionViewOf(row model.AgentMemoryRevision) (AgentMemoryRevisionView, error) {
	view := AgentMemoryRevisionView{
		ID: row.ID, ProposalID: row.ProposalID, Version: row.Version,
		CreatedAt: row.CreatedAt, RestoredAt: row.RestoredAt,
	}
	var before, after []model.AgentMemorySnapshot
	if err := json.Unmarshal([]byte(row.BeforeJSON), &before); err != nil {
		return view, err
	}
	if err := json.Unmarshal([]byte(row.AfterJSON), &after); err != nil {
		return view, err
	}
	view.Before, view.After = memorySnapshotViews(before), memorySnapshotViews(after)
	return view, nil
}
