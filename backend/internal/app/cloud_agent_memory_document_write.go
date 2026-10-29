package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

// agentMemoryWriteOutcome 是一次记忆写入的结果，同时用于工具返回、运行事件和幂等重放。
type agentMemoryWriteOutcome struct {
	Status     string
	RevisionID string
	Summary    string
	Changes    []AgentMemoryDocChange
	Duplicates int
	CharCount  int
	Capacity   int
}

const (
	agentMemoryOutcomeApplied   = "applied"
	agentMemoryOutcomePending   = "pending_review"
	agentMemoryOutcomeUnchanged = "unchanged"
)

func agentMemoryEntriesJSON(entries []model.AgentMemoryEntry) (string, error) {
	if entries == nil {
		entries = []model.AgentMemoryEntry{}
	}
	raw, err := json.Marshal(entries)
	return string(raw), err
}

func agentMemoryOutcomeFromRevision(revision *model.AgentMemoryDocumentRevision, capacity int) agentMemoryWriteOutcome {
	after := agentMemoryEntriesFromJSON(revision.AfterJSON)
	status := agentMemoryOutcomeApplied
	if revision.Status == model.AgentMemoryRevisionPending {
		status = agentMemoryOutcomePending
	}
	return agentMemoryWriteOutcome{
		Status: status, RevisionID: revision.ID, Summary: revision.Summary,
		Changes:   agentMemoryDiff(agentMemoryEntriesFromJSON(revision.BeforeJSON), after),
		CharCount: agentMemoryCharCount(after), Capacity: capacity,
	}
}

// agentMemoryCapacityDetail 在容量超限时把当前全部条目交还给 Agent，它才能在下一次调用里合并。
func agentMemoryCapacityDetail(entries []model.AgentMemoryEntry, capErr *agentMemoryCapacityError) map[string]any {
	items := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		items = append(items, map[string]any{"id": entry.ID, "section": entry.Section, "text": entry.Text})
	}
	return map[string]any{
		"usage": fmt.Sprintf("%d/%d", capErr.Used, capErr.Capacity), "overBy": capErr.After - capErr.Capacity,
		"entries":  items,
		"guidance": "在同一次 memory_update 里用 replace 合并相近条目、remove 过时条目，再 add 新内容；容量只按整批结果检查",
	}
}

// agentMemoryAgentWrite 执行 Agent 的一次记忆修改。模式以文件当前设置为准（用户可能在运行中改过）：
// auto 直接生效并留可撤销修订，review 只生成待确认修订，off 拒绝。同一 callID 重放时返回原结果。
func (s *Service) agentMemoryAgentWrite(userID, runID, callID string, ops []agentMemoryOperation, reason string) (agentMemoryWriteOutcome, map[string]any, error) {
	if strings.TrimSpace(callID) != "" {
		if prior, err := s.repo.AgentMemoryDocumentRevisionByCall(userID, callID); err == nil {
			return agentMemoryOutcomeFromRevision(prior, agentMemoryDefaultCapacity), nil, nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return agentMemoryWriteOutcome{}, nil, err
		}
	}
	for attempt := 0; attempt < agentMemoryWriteAttempts; attempt++ {
		doc, err := s.ensureAgentMemoryDocument(userID)
		if err != nil {
			return agentMemoryWriteOutcome{}, nil, err
		}
		mode := agentMemoryMode(doc.Mode)
		if mode == model.AgentMemoryDocumentModeOff {
			return agentMemoryWriteOutcome{}, nil, BadAuthRequest("用户已关闭长期记忆，不能修改；不要再尝试记录")
		}
		entries, err := agentMemoryDocumentEntries(doc)
		if err != nil {
			return agentMemoryWriteOutcome{}, nil, err
		}
		capacity := agentMemoryCapacityOf(doc)
		now := time.Now()
		edit, err := applyAgentMemoryOperations(entries, agentMemoryNextSeq(doc, entries), ops, capacity, now, model.AgentMemoryActorAgent, runID)
		var capErr *agentMemoryCapacityError
		if errors.As(err, &capErr) {
			return agentMemoryWriteOutcome{}, agentMemoryCapacityDetail(entries, capErr), BadAuthRequest(capErr.Error())
		}
		if err != nil {
			return agentMemoryWriteOutcome{}, nil, err
		}
		outcome := agentMemoryWriteOutcome{Changes: edit.changes, Duplicates: edit.duplicates, Capacity: capacity, CharCount: agentMemoryCharCount(entries)}
		if len(edit.changes) == 0 {
			outcome.Status = agentMemoryOutcomeUnchanged
			return outcome, nil, nil
		}
		before, err := agentMemoryEntriesJSON(entries)
		if err != nil {
			return agentMemoryWriteOutcome{}, nil, err
		}
		after, err := agentMemoryEntriesJSON(edit.entries)
		if err != nil {
			return agentMemoryWriteOutcome{}, nil, err
		}
		opsJSON, err := json.Marshal(ops)
		if err != nil {
			return agentMemoryWriteOutcome{}, nil, err
		}
		outcome.Summary = agentMemorySummary(edit.changes, reason)
		revision := &model.AgentMemoryDocumentRevision{
			ID: newID(), UserID: userID, Actor: model.AgentMemoryActorAgent, RunID: runID, CallID: strings.TrimSpace(callID),
			Summary: outcome.Summary, OpsJSON: string(opsJSON), BeforeJSON: before, AfterJSON: after, CreatedAt: now,
		}
		outcome.RevisionID = revision.ID
		if mode == model.AgentMemoryDocumentModeReview {
			pending, err := s.repo.CountAgentMemoryDocumentRevisions(userID, model.AgentMemoryRevisionPending)
			if err != nil {
				return agentMemoryWriteOutcome{}, nil, err
			}
			if pending >= agentMemoryPendingMax {
				return agentMemoryWriteOutcome{}, nil, BadAuthRequest(fmt.Sprintf("已有 %d 条记忆修改等待用户确认，先不要再提交新的修改", pending))
			}
			revision.BaseRevision, revision.Revision, revision.Status = doc.Revision, doc.Revision, model.AgentMemoryRevisionPending
			if err := s.repo.CreateAgentMemoryDocumentRevision(revision); err != nil {
				return agentMemoryWriteOutcome{}, nil, err
			}
			outcome.Status = agentMemoryOutcomePending
			return outcome, nil, nil
		}
		_, err = s.repo.WriteAgentMemoryDocument(repository.AgentMemoryDocumentWrite{
			UserID: userID, ExpectedRevision: doc.Revision, EntriesJSON: after, NextEntrySeq: edit.nextSeq,
			Hash: agentMemoryHash([]byte(after)), CharCount: agentMemoryCharCount(edit.entries), Now: now,
			Revision: revision, Keep: agentMemoryRevisionKeep,
		})
		if errors.Is(err, repository.ErrTaskStateConflict) {
			continue
		}
		if err != nil {
			return agentMemoryWriteOutcome{}, nil, err
		}
		outcome.Status = agentMemoryOutcomeApplied
		outcome.CharCount = agentMemoryCharCount(edit.entries)
		return outcome, nil, nil
	}
	return agentMemoryWriteOutcome{}, nil, creationConflict("记忆正被同时修改，请稍后再试")
}
