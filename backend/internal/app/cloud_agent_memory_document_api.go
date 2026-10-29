package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

// AgentMemoryDocumentView 是用户看到的记忆文件。
type AgentMemoryDocumentView struct {
	Mode         string                   `json:"mode"`
	Capacity     int                      `json:"capacity"`
	CharCount    int                      `json:"charCount"`
	Revision     int64                    `json:"revision"`
	Entries      []model.AgentMemoryEntry `json:"entries"`
	PendingCount int64                    `json:"pendingCount"`
	UpdatedAt    time.Time                `json:"updatedAt"`
}

type AgentMemoryDocumentAdminView struct {
	UserID      string `json:"userId"`
	Username    string `json:"username,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
	AgentMemoryDocumentView
}

// AgentMemoryDocRevisionView 是一次修改的记录；changes 由前后快照按条目 ID 计算。
type AgentMemoryDocRevisionView struct {
	ID           string                 `json:"id"`
	Actor        string                 `json:"actor"`
	RunID        string                 `json:"runId,omitempty"`
	Status       string                 `json:"status"`
	Summary      string                 `json:"summary"`
	BaseRevision int64                  `json:"baseRevision"`
	Revision     int64                  `json:"revision"`
	Changes      []AgentMemoryDocChange `json:"changes"`
	CanUndo      bool                   `json:"canUndo"`
	CreatedAt    time.Time              `json:"createdAt"`
	DecidedAt    *time.Time             `json:"decidedAt,omitempty"`
	RestoredAt   *time.Time             `json:"restoredAt,omitempty"`
}

type AgentMemoryEntryInput struct {
	ID      string `json:"id,omitempty"`
	Section string `json:"section"`
	Text    string `json:"text"`
}

type AgentMemoryDocUpdateRequest struct {
	Revision int64                   `json:"revision"`
	Entries  []AgentMemoryEntryInput `json:"entries"`
}

type AgentMemoryDocSettingsRequest struct {
	Mode string `json:"mode"`
}

type AgentMemoryDocDecisionRequest struct {
	Decision string `json:"decision"`
}

func (s *Service) agentMemoryDocumentView(doc *model.AgentMemoryDocument) (AgentMemoryDocumentView, error) {
	entries, err := agentMemoryDocumentEntries(doc)
	if err != nil {
		return AgentMemoryDocumentView{}, err
	}
	pending, err := s.repo.CountAgentMemoryDocumentRevisions(doc.UserID, model.AgentMemoryRevisionPending)
	if err != nil {
		return AgentMemoryDocumentView{}, err
	}
	return AgentMemoryDocumentView{
		Mode: agentMemoryMode(doc.Mode), Capacity: agentMemoryCapacityOf(doc), CharCount: agentMemoryCharCount(entries),
		Revision: doc.Revision, Entries: entries, PendingCount: pending, UpdatedAt: doc.UpdatedAt,
	}, nil
}

// AgentMemoryDocument 返回当前用户的记忆文件，第一次访问时创建并导入旧版经验。
func (s *Service) AgentMemoryDocument(userID string) (AgentMemoryDocumentView, error) {
	doc, err := s.ensureAgentMemoryDocument(userID)
	if err != nil {
		return AgentMemoryDocumentView{}, err
	}
	return s.agentMemoryDocumentView(doc)
}

// UpdateAgentMemoryDocumentSettings 只改记忆模式；关闭后不注入、不暴露写入工具，已有内容保留。
func (s *Service) UpdateAgentMemoryDocumentSettings(userID string, req AgentMemoryDocSettingsRequest) (AgentMemoryDocumentView, error) {
	mode := strings.TrimSpace(req.Mode)
	if mode != model.AgentMemoryDocumentModeAuto && mode != model.AgentMemoryDocumentModeReview && mode != model.AgentMemoryDocumentModeOff {
		return AgentMemoryDocumentView{}, BadAuthRequest("记忆模式只能是 auto（自动生效）、review（需我确认）或 off（关闭）")
	}
	doc, err := s.ensureAgentMemoryDocument(userID)
	if err != nil {
		return AgentMemoryDocumentView{}, err
	}
	if err := s.repo.UpdateAgentMemoryDocumentSettings(userID, mode, agentMemoryCapacityOf(doc), time.Now()); err != nil {
		return AgentMemoryDocumentView{}, err
	}
	return s.AgentMemoryDocument(userID)
}

// UpdateAgentMemoryDocument 用用户编辑后的完整条目列表替换记忆文件（按 revision 做 CAS）。
// 带已有 ID 的条目保留 ID 和来源，其余视为新增；同样经过长度、泄露和容量校验。
func (s *Service) UpdateAgentMemoryDocument(userID string, req AgentMemoryDocUpdateRequest) (AgentMemoryDocumentView, error) {
	doc, err := s.ensureAgentMemoryDocument(userID)
	if err != nil {
		return AgentMemoryDocumentView{}, err
	}
	if req.Revision != doc.Revision {
		return AgentMemoryDocumentView{}, creationConflict("记忆已经变化，请刷新后再保存")
	}
	if len(req.Entries) > agentMemoryEntriesMax {
		return AgentMemoryDocumentView{}, BadAuthRequest(fmt.Sprintf("记忆最多 %d 条", agentMemoryEntriesMax))
	}
	current, err := agentMemoryDocumentEntries(doc)
	if err != nil {
		return AgentMemoryDocumentView{}, err
	}
	byID := make(map[string]model.AgentMemoryEntry, len(current))
	for _, entry := range current {
		byID[entry.ID] = entry
	}
	now := time.Now()
	nextSeq := agentMemoryNextSeq(doc, current)
	next := make([]model.AgentMemoryEntry, 0, len(req.Entries))
	seen := map[string]bool{}
	for index, input := range req.Entries {
		label := fmt.Sprintf("第 %d 条", index+1)
		section, err := agentMemorySection(input.Section, label+"的分区")
		if err != nil {
			return AgentMemoryDocumentView{}, err
		}
		text, err := agentMemoryValidateText(input.Text, label)
		if err != nil {
			return AgentMemoryDocumentView{}, err
		}
		id := strings.TrimSpace(input.ID)
		if old, ok := byID[id]; ok && !seen[id] {
			if old.Text != text || old.Section != section {
				old.Text, old.Section, old.UpdatedAt = text, section, now
			}
			seen[id] = true
			next = append(next, old)
			continue
		}
		id = agentMemoryEntryID(section, nextSeq)
		nextSeq++
		seen[id] = true
		next = append(next, model.AgentMemoryEntry{ID: id, Section: section, Text: text, Source: model.AgentMemoryActorUser, CreatedAt: now, UpdatedAt: now})
	}
	capacity := agentMemoryCapacityOf(doc)
	if used, after := agentMemoryCharCount(current), agentMemoryCharCount(next); after > capacity && after > used {
		return AgentMemoryDocumentView{}, BadAuthRequest(fmt.Sprintf("记忆最多 %d 字，保存后为 %d 字；请删减后再保存", capacity, after))
	}
	changes := agentMemoryDiff(current, next)
	if len(changes) == 0 {
		return s.agentMemoryDocumentView(doc)
	}
	if err := s.writeAgentMemoryRevision(doc, current, next, nextSeq, model.AgentMemoryActorUser, "手动编辑："+agentMemorySummary(changes, ""), "", now); err != nil {
		return AgentMemoryDocumentView{}, err
	}
	return s.AgentMemoryDocument(userID)
}

// writeAgentMemoryRevision 把 next 写成新版本并留一条已生效修订；markRestored 非空时同时标记被撤销的修订。
func (s *Service) writeAgentMemoryRevision(doc *model.AgentMemoryDocument, before, next []model.AgentMemoryEntry, nextSeq int64, actor, summary, markRestored string, now time.Time) error {
	beforeJSON, err := agentMemoryEntriesJSON(before)
	if err != nil {
		return err
	}
	afterJSON, err := agentMemoryEntriesJSON(next)
	if err != nil {
		return err
	}
	_, err = s.repo.WriteAgentMemoryDocument(repository.AgentMemoryDocumentWrite{
		UserID: doc.UserID, ExpectedRevision: doc.Revision, EntriesJSON: afterJSON, NextEntrySeq: nextSeq,
		Hash: agentMemoryHash([]byte(afterJSON)), CharCount: agentMemoryCharCount(next), Now: now,
		Revision: &model.AgentMemoryDocumentRevision{
			ID: newID(), Actor: actor, Summary: truncateRunes(summary, 480), OpsJSON: "[]",
			BeforeJSON: beforeJSON, AfterJSON: afterJSON, CreatedAt: now,
		},
		MarkRestoredID: markRestored, Keep: agentMemoryRevisionKeep,
	})
	if errors.Is(err, repository.ErrTaskStateConflict) {
		return creationConflict("记忆已经变化，请刷新后再试")
	}
	return err
}

func agentMemoryRevisionView(revision model.AgentMemoryDocumentRevision) AgentMemoryDocRevisionView {
	return AgentMemoryDocRevisionView{
		ID: revision.ID, Actor: revision.Actor, RunID: revision.RunID, Status: revision.Status, Summary: revision.Summary,
		BaseRevision: revision.BaseRevision, Revision: revision.Revision,
		Changes:   agentMemoryDiff(agentMemoryEntriesFromJSON(revision.BeforeJSON), agentMemoryEntriesFromJSON(revision.AfterJSON)),
		CanUndo:   revision.Status == model.AgentMemoryRevisionApplied && revision.RestoredAt == nil && revision.Actor != model.AgentMemoryActorRestore,
		CreatedAt: revision.CreatedAt, DecidedAt: revision.DecidedAt, RestoredAt: revision.RestoredAt,
	}
}

func (s *Service) AgentMemoryDocumentRevisions(userID, status string, limit int) ([]AgentMemoryDocRevisionView, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	status = strings.TrimSpace(status)
	if status != "" && status != model.AgentMemoryRevisionApplied && status != model.AgentMemoryRevisionPending && status != model.AgentMemoryRevisionRejected {
		return nil, BadAuthRequest("修订状态无效")
	}
	rows, err := s.repo.AgentMemoryDocumentRevisions(userID, status, limit)
	if err != nil {
		return nil, err
	}
	views := make([]AgentMemoryDocRevisionView, 0, len(rows))
	for _, row := range rows {
		views = append(views, agentMemoryRevisionView(row))
	}
	return views, nil
}

func (s *Service) agentMemoryOwnedRevision(userID, revisionID string) (*model.AgentMemoryDocumentRevision, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	revision, err := s.repo.AgentMemoryDocumentRevision(userID, revisionID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.NotFound("记忆修改记录不存在")
	}
	return revision, err
}

var errAgentMemoryUndoConflict = errors.New("memory changed after revision")

// agentMemoryInverse 只回退这条修订涉及的条目，并要求它们仍是修订后的样子；之后又被改过的条目不覆盖。
func agentMemoryInverse(current, before, after []model.AgentMemoryEntry, now time.Time) ([]model.AgentMemoryEntry, error) {
	previous := make(map[string]model.AgentMemoryEntry, len(before))
	for _, entry := range before {
		previous[entry.ID] = entry
	}
	next := append([]model.AgentMemoryEntry(nil), current...)
	for _, change := range agentMemoryDiff(before, after) {
		at := agentMemoryEntryIndex(next, change.ID)
		switch change.Kind {
		case "add":
			if at < 0 {
				continue
			}
			if next[at].Text != change.After {
				return nil, errAgentMemoryUndoConflict
			}
			next = append(next[:at:at], next[at+1:]...)
		case "replace":
			if at < 0 || next[at].Text != change.After || next[at].Section != change.Section {
				return nil, errAgentMemoryUndoConflict
			}
			old := previous[change.ID]
			next[at].Text, next[at].Section, next[at].UpdatedAt = old.Text, old.Section, now
		case "remove":
			if at >= 0 {
				return nil, errAgentMemoryUndoConflict
			}
			next = append(next, previous[change.ID])
		}
	}
	return next, nil
}

// UndoAgentMemoryRevision 撤销一条已生效的修改，撤销本身也留一条修订。
func (s *Service) UndoAgentMemoryRevision(userID, revisionID string) (AgentMemoryDocumentView, error) {
	revision, err := s.agentMemoryOwnedRevision(userID, revisionID)
	if err != nil {
		return AgentMemoryDocumentView{}, err
	}
	if revision.Status != model.AgentMemoryRevisionApplied || revision.RestoredAt != nil || revision.Actor == model.AgentMemoryActorRestore {
		return AgentMemoryDocumentView{}, BadAuthRequest("这条修改不能撤销（已撤销、未生效或本身就是撤销）")
	}
	doc, err := s.ensureAgentMemoryDocument(userID)
	if err != nil {
		return AgentMemoryDocumentView{}, err
	}
	current, err := agentMemoryDocumentEntries(doc)
	if err != nil {
		return AgentMemoryDocumentView{}, err
	}
	now := time.Now()
	next, err := agentMemoryInverse(current, agentMemoryEntriesFromJSON(revision.BeforeJSON), agentMemoryEntriesFromJSON(revision.AfterJSON), now)
	if err != nil {
		return AgentMemoryDocumentView{}, creationConflict("这条修改之后相关记忆又变化了，无法自动撤销；请在记忆列表里手动调整")
	}
	capacity := agentMemoryCapacityOf(doc)
	if used, after := agentMemoryCharCount(current), agentMemoryCharCount(next); after > capacity && after > used {
		return AgentMemoryDocumentView{}, BadAuthRequest("撤销后会超过记忆容量，请先删除一些条目再撤销")
	}
	if err := s.writeAgentMemoryRevision(doc, current, next, agentMemoryNextSeq(doc, current), model.AgentMemoryActorRestore, "撤销："+revision.Summary, revision.ID, now); err != nil {
		return AgentMemoryDocumentView{}, err
	}
	return s.AgentMemoryDocument(userID)
}

// DecideAgentMemoryRevision 采纳或拒绝需确认模式下的待定修改。采纳时在当前记忆上重放原操作并重新校验。
func (s *Service) DecideAgentMemoryRevision(userID, revisionID string, req AgentMemoryDocDecisionRequest) (AgentMemoryDocumentView, error) {
	revision, err := s.agentMemoryOwnedRevision(userID, revisionID)
	if err != nil {
		return AgentMemoryDocumentView{}, err
	}
	if revision.Status != model.AgentMemoryRevisionPending {
		return AgentMemoryDocumentView{}, BadAuthRequest("这条修改已经处理过")
	}
	switch strings.TrimSpace(req.Decision) {
	case "reject":
		if err := s.repo.RejectAgentMemoryDocumentRevision(userID, revision.ID, time.Now()); err != nil {
			return AgentMemoryDocumentView{}, agentMemoryConflict(err)
		}
		return s.AgentMemoryDocument(userID)
	case "approve":
	default:
		return AgentMemoryDocumentView{}, BadAuthRequest("decision 只能是 approve 或 reject")
	}
	var ops []agentMemoryOperation
	if err := json.Unmarshal([]byte(revision.OpsJSON), &ops); err != nil || len(ops) == 0 {
		return AgentMemoryDocumentView{}, BadAuthRequest("这条修改缺少可执行的操作，只能拒绝")
	}
	for attempt := 0; attempt < agentMemoryWriteAttempts; attempt++ {
		doc, err := s.ensureAgentMemoryDocument(userID)
		if err != nil {
			return AgentMemoryDocumentView{}, err
		}
		entries, err := agentMemoryDocumentEntries(doc)
		if err != nil {
			return AgentMemoryDocumentView{}, err
		}
		now := time.Now()
		edit, err := applyAgentMemoryOperations(entries, agentMemoryNextSeq(doc, entries), ops, agentMemoryCapacityOf(doc), now, model.AgentMemoryActorAgent, revision.RunID)
		var capErr *agentMemoryCapacityError
		if errors.As(err, &capErr) {
			return AgentMemoryDocumentView{}, BadAuthRequest(fmt.Sprintf("采纳后记忆会有 %d 字，超过上限 %d 字；请先删除一些条目再采纳", capErr.After, capErr.Capacity))
		}
		if err != nil {
			return AgentMemoryDocumentView{}, creationConflict("这条修改依赖的记忆已经变化，无法采纳；可以拒绝后让 Agent 重新整理")
		}
		if len(edit.changes) == 0 {
			if err := s.repo.RejectAgentMemoryDocumentRevision(userID, revision.ID, now); err != nil {
				return AgentMemoryDocumentView{}, agentMemoryConflict(err)
			}
			return s.AgentMemoryDocument(userID)
		}
		before, err := agentMemoryEntriesJSON(entries)
		if err != nil {
			return AgentMemoryDocumentView{}, err
		}
		after, err := agentMemoryEntriesJSON(edit.entries)
		if err != nil {
			return AgentMemoryDocumentView{}, err
		}
		_, err = s.repo.WriteAgentMemoryDocument(repository.AgentMemoryDocumentWrite{
			UserID: userID, ExpectedRevision: doc.Revision, EntriesJSON: after, NextEntrySeq: edit.nextSeq,
			Hash: agentMemoryHash([]byte(after)), CharCount: agentMemoryCharCount(edit.entries), Now: now,
			Revision:       &model.AgentMemoryDocumentRevision{Summary: revision.Summary, BeforeJSON: before, AfterJSON: after},
			ApplyPendingID: revision.ID, Keep: agentMemoryRevisionKeep,
		})
		if errors.Is(err, repository.ErrTaskStateConflict) {
			continue
		}
		if err != nil {
			return AgentMemoryDocumentView{}, err
		}
		return s.AgentMemoryDocument(userID)
	}
	return AgentMemoryDocumentView{}, creationConflict("记忆正被同时修改，请稍后再试")
}

func agentMemoryConflict(err error) error {
	if errors.Is(err, repository.ErrTaskStateConflict) {
		return creationConflict("这条修改已经被处理，请刷新")
	}
	return err
}

// AdminAgentMemoryDocuments 供管理员按用户查看记忆文件正文（只读，不替用户创建或修改）。
func (s *Service) AdminAgentMemoryDocuments(userID string, limit int) ([]AgentMemoryDocumentAdminView, error) {
	rows, err := s.repo.AdminAgentMemoryDocuments(userID, limit)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.UserID)
	}
	users, err := s.repo.UsersByIDs(ids)
	if err != nil {
		return nil, err
	}
	views := make([]AgentMemoryDocumentAdminView, 0, len(rows))
	for index := range rows {
		view, err := s.agentMemoryDocumentView(&rows[index])
		if err != nil {
			return nil, err
		}
		admin := AgentMemoryDocumentAdminView{UserID: rows[index].UserID, AgentMemoryDocumentView: view}
		if user, ok := users[rows[index].UserID]; ok {
			admin.Username, admin.DisplayName = user.Username, user.DisplayName
		}
		views = append(views, admin)
	}
	return views, nil
}
