package repository

import (
	"encoding/json"
	"strings"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *Repository) DecideAgentMemoryProposal(userID, id, decision, revisionID string, version int64, now time.Time) error {
	if strings.TrimSpace(userID) == "" || id == "" || version <= 0 {
		return gorm.ErrRecordNotFound
	}
	if decision != model.AgentMemoryProposalApproved && decision != model.AgentMemoryProposalRejected {
		return ErrCreationConflict
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		var proposal model.AgentMemoryProposal
		if err := tx.Where("id = ? AND user_id = ?", id, userID).First(&proposal).Error; err != nil {
			return err
		}
		result := tx.Model(&model.AgentMemoryProposal{}).
			Where("id = ? AND user_id = ? AND version = ? AND status = ?", id, userID, version, model.AgentMemoryProposalPending).
			Updates(map[string]any{"status": decision, "version": version + 1, "decided_at": now, "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrCreationConflict
		}
		if decision == model.AgentMemoryProposalRejected {
			return setAgentMemoryDecisionStatus(tx, userID, id, model.AgentMemoryCompactStatusRejected, now)
		}
		var changes []model.AgentMemoryChange
		if err := json.Unmarshal([]byte(proposal.ChangesJSON), &changes); err != nil {
			return err
		}
		before, afterIDs, err := memoryChangeSnapshots(changes)
		if err != nil {
			return err
		}
		current, err := lockedMemorySnapshots(tx, userID, snapshotIDs(before))
		if err != nil {
			return err
		}
		if !sameMemorySnapshots(before, current) {
			return ErrCreationConflict
		}
		for _, change := range changes {
			head := change.Before[0]
			result := memorySnapshotQuery(tx, userID, head).Updates(map[string]any{
				"topic": change.After.Topic, "category": change.After.Category,
				"situation": change.After.Situation, "lesson": change.After.Lesson,
				"steps_json": change.After.StepsJSON, "updated_at": now,
			})
			if err := memorySingleWrite(result); err != nil {
				return err
			}
			for _, removed := range change.Before[1:] {
				if err := memorySingleWrite(memorySnapshotQuery(tx, userID, removed).Delete(&model.AgentLesson{})); err != nil {
					return err
				}
			}
		}
		after, err := lockedMemorySnapshots(tx, userID, afterIDs)
		if err != nil {
			return err
		}
		beforeJSON, err := json.Marshal(before)
		if err != nil {
			return err
		}
		afterJSON, err := json.Marshal(after)
		if err != nil {
			return err
		}
		if err := tx.Create(&model.AgentMemoryRevision{
			ID: revisionID, UserID: userID, ProposalID: id, Version: 1,
			BeforeJSON: string(beforeJSON), AfterJSON: string(afterJSON), CreatedAt: now,
		}).Error; err != nil {
			return err
		}
		return setAgentMemoryDecisionStatus(tx, userID, id, model.AgentMemoryCompactStatusApplied, now)
	})
}

func setAgentMemoryDecisionStatus(tx *gorm.DB, userID, proposalID, status string, now time.Time) error {
	return tx.Model(&model.AgentMemorySetting{}).Where("user_id = ? AND compact_proposal_id = ?", userID, proposalID).
		Updates(map[string]any{"last_status": status, "updated_at": now}).Error
}

// Every affected source appears once. Only input rows may be updated/removed;
// a malformed persisted change cannot create rows or redirect another source.
func memoryChangeSnapshots(changes []model.AgentMemoryChange) ([]model.AgentMemorySnapshot, []string, error) {
	if len(changes) == 0 || len(changes) > 80 {
		return nil, nil, ErrCreationConflict
	}
	seen := map[string]bool{}
	before := make([]model.AgentMemorySnapshot, 0)
	afterIDs := make([]string, 0, len(changes))
	for _, change := range changes {
		if len(change.Before) == 0 || change.After.ID != change.Before[0].ID || change.After.Status != model.AgentLessonStatusApproved {
			return nil, nil, ErrCreationConflict
		}
		if change.Kind != "rewrite" && change.Kind != "merge" {
			return nil, nil, ErrCreationConflict
		}
		for _, snapshot := range change.Before {
			if snapshot.ID == "" || seen[snapshot.ID] || snapshot.Status != model.AgentLessonStatusApproved {
				return nil, nil, ErrCreationConflict
			}
			seen[snapshot.ID] = true
			before = append(before, snapshot)
		}
		afterIDs = append(afterIDs, change.After.ID)
	}
	return before, afterIDs, nil
}

func snapshotIDs(rows []model.AgentMemorySnapshot) []string {
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	return ids
}

func lockedMemorySnapshots(tx *gorm.DB, userID string, ids []string) ([]model.AgentMemorySnapshot, error) {
	var rows []model.AgentLesson
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("author_user_id = ? AND id IN ?", userID, ids).Order("id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	snapshots := make([]model.AgentMemorySnapshot, 0, len(rows))
	for _, row := range rows {
		snapshots = append(snapshots, model.SnapshotAgentMemory(row))
	}
	return snapshots, nil
}

func sameMemorySnapshots(expected, actual []model.AgentMemorySnapshot) bool {
	if len(expected) != len(actual) {
		return false
	}
	byID := make(map[string]string, len(actual))
	for _, snapshot := range actual {
		byID[snapshot.ID] = snapshot.ContentVersion()
	}
	for _, snapshot := range expected {
		if byID[snapshot.ID] != snapshot.ContentVersion() {
			return false
		}
	}
	return true
}

func memorySnapshotQuery(tx *gorm.DB, userID string, expected model.AgentMemorySnapshot) *gorm.DB {
	// All affected rows were locked and compared by ContentVersion before any
	// write. SQLite serializes the transaction from the proposal CAS write;
	// comparing SQL timestamp strings here would reject equivalent time zones.
	return tx.Model(&model.AgentLesson{}).Where("id = ? AND author_user_id = ? AND status = ?", expected.ID, userID, expected.Status)
}

func memorySingleWrite(result *gorm.DB) error {
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrCreationConflict
	}
	return nil
}
