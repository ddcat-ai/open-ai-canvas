package app

import (
	"encoding/json"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

// Turn model output into a frozen proposal, restricted to the exact input batch.
// Ownership and content versions are checked again inside the approval transaction.
func (s *Service) buildAgentMemoryProposalChanges(userID string, input []model.AgentMemorySnapshot, plan agentMemoryCompactPlan) ([]model.AgentMemoryChange, AgentMemoryCompactSummary) {
	byID := make(map[string]model.AgentMemorySnapshot, len(input))
	for _, snapshot := range input {
		byID[snapshot.ID] = snapshot
	}
	used := map[string]bool{}
	changes := make([]model.AgentMemoryChange, 0)
	summary := AgentMemoryCompactSummary{}
	appendChange := func(kind string, ids []string, req AgentMemoryRequest) bool {
		if len(ids) == 0 || kind == "merge" && len(ids) < 2 {
			return false
		}
		sources := make([]model.AgentMemorySnapshot, 0, len(ids))
		seen := map[string]bool{}
		for _, id := range ids {
			current, exists := byID[id]
			if strings.TrimSpace(id) == "" || !exists || used[id] || seen[id] || current.Status != model.AgentLessonStatusApproved {
				return false
			}
			seen[id] = true
			sources = append(sources, current)
		}
		next, err := s.buildUserAgentMemory(userID, req, model.AgentLessonStatusApproved)
		if err != nil {
			return false
		}
		after := sources[0]
		after.Topic, after.Category, after.Situation = next.Topic, next.Category, next.Situation
		after.Lesson, after.StepsJSON = next.Lesson, next.StepsJSON
		// Source and LastVerifiedAt are evidence, never model-owned edits.
		if kind == "rewrite" && after.ContentVersion() == sources[0].ContentVersion() {
			return false
		}
		for _, id := range ids {
			used[id] = true
		}
		changes = append(changes, model.AgentMemoryChange{Kind: kind, Before: sources, After: after})
		return true
	}
	for _, merge := range plan.Merges {
		if appendChange("merge", merge.IDs, AgentMemoryRequest{
			Topic: merge.Topic, Category: merge.Category, Situation: merge.Situation,
			Lesson: merge.Lesson, Steps: merge.Steps,
		}) {
			summary.Merged++
			summary.Removed += len(merge.IDs) - 1
		} else {
			summary.Skipped++
		}
	}
	for _, rewrite := range plan.Rewrites {
		if appendChange("rewrite", []string{rewrite.ID}, AgentMemoryRequest{
			Topic: rewrite.Topic, Category: rewrite.Category, Situation: rewrite.Situation,
			Lesson: rewrite.Lesson, Steps: rewrite.Steps,
		}) {
			summary.Rewritten++
		} else {
			summary.Skipped++
		}
	}
	return changes, summary
}

func agentMemoryProposalIDFromTask(task model.Task) string {
	var input struct {
		Metadata struct {
			ProposalID string `json:"memoryProposalId"`
		} `json:"metadata"`
	}
	if json.Unmarshal([]byte(task.InputJSON), &input) != nil {
		return ""
	}
	return strings.TrimSpace(input.Metadata.ProposalID)
}

func (s *Service) finishAgentMemoryProposal(task model.Task, text string, taskErr error) error {
	proposalID := agentMemoryProposalIDFromTask(task)
	if proposalID == "" {
		return BadAuthRequest("压缩任务缺少提案绑定，请重新生成")
	}
	row, err := s.repo.AgentMemoryProposalForUser(task.UserID, proposalID)
	if err != nil {
		return err
	}
	if row.Status != model.AgentMemoryProposalGenerating {
		return nil // callback replay cannot replace a pending or decided proposal
	}
	lastStatus, lastError := model.AgentMemoryCompactStatusFailed, ""
	if taskErr == nil {
		plan, parseErr := parseAgentMemoryCompactPlan(text)
		taskErr = parseErr
		if taskErr == nil {
			var input []model.AgentMemorySnapshot
			if taskErr = json.Unmarshal([]byte(row.InputJSON), &input); taskErr == nil {
				changes, summary := s.buildAgentMemoryProposalChanges(task.UserID, input, plan)
				raw, marshalErr := json.Marshal(changes)
				taskErr = marshalErr
				if taskErr == nil {
					row.ChangesJSON = string(raw)
					raw, taskErr = json.Marshal(summary)
					row.SummaryJSON = string(raw)
					row.Status, lastStatus = model.AgentMemoryProposalPending, model.AgentMemoryCompactStatusReview
					if len(changes) == 0 {
						row.Status, lastStatus = model.AgentMemoryProposalNoChanges, model.AgentMemoryCompactStatusSucceeded
					}
				}
			}
		}
	}
	if taskErr != nil {
		row.Status = model.AgentMemoryProposalFailed
		lastStatus = model.AgentMemoryCompactStatusFailed
		lastError = truncateRunes(cloudAgentSafeToolError(taskErr), 500)
	}
	return s.repo.FinishAgentMemoryProposal(row, task.ID, lastStatus, lastError, time.Now().UTC())
}
