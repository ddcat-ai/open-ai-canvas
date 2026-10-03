package app

import (
	"encoding/json"
	"errors"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func cloudAgentCommerceQuoteNeedsRefresh(batch *cloudAgentCommerceBatch) bool {
	if batch == nil {
		return false
	}
	for _, item := range batch.Items {
		if item.Prepared != nil && !item.Prepared.Quote.ExpiresAt.After(time.Now().Add(30*time.Second)) {
			return true
		}
	}
	return false
}

func leaseCloudAgentCommerceBatch(repo *repository.Repository, userID, runID, approvalID string, batch *cloudAgentCommerceBatch) error {
	resources := map[string]bool{}
	var expires time.Time
	for _, item := range batch.Items {
		if item.Prepared == nil {
			return BadAuthRequest("整套审批准备态不完整")
		}
		for id := range item.Prepared.ResourceSignatures {
			resources[id] = true
		}
		if item.Prepared.Quote.ExpiresAt.After(expires) {
			expires = item.Prepared.Quote.ExpiresAt
		}
	}
	ids := make([]string, 0, len(resources))
	for id := range resources {
		ids = append(ids, id)
	}
	return repo.UpsertCloudAgentResourceLeases(userID, runID, approvalID, ids, expires)
}

// Requote the same frozen plan without a model call, generation or charge.
// Rotating the vote ID makes a stale browser unable to approve a new price.
func (s *Service) refreshCloudAgentCommerceApproval(userID, id, approvalID string) error {
	for attempt := 0; attempt < 3; attempt++ {
		run, err := s.repo.CloudAgent(userID, id)
		if err != nil {
			return err
		}
		state, err := cloudAgentDecodeForExecution(run)
		if err != nil {
			return err
		}
		approval, plan := state.Approval, state.CommercePlan
		if state.Request.Surface != "creation" || run.Status != "waiting_approval" || approval == nil || approval.ID != approvalID || approval.Batch == nil || plan == nil {
			return creationConflict("待审批的整套方案已变化，请重新打开方案")
		}
		if approval.Batch.PlanID != plan.PlanID || approval.Batch.Version != plan.Version || approval.Batch.PlanHash != cloudAgentCommercePlanHash(plan) {
			return creationConflict("方案内容与待审批版本不一致，请修改方案后重新审批")
		}
		batch, err := s.prepareCloudAgentCommerceBatch(run, &state, plan, approval.Call)
		if err != nil {
			return err
		}
		renewed := *approval
		renewed.ID = id + "-quote-" + newID()
		renewed.Batch, renewed.Preview = batch, cloudAgentCommerceBatchPreview(plan, batch, state.Request.Budget.MaxCredits)
		s.storageMu.Lock()
		err = s.repo.MutateCloudAgent(userID, id, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			if current.Status != "waiting_approval" {
				return creationConflict("审批状态已变化，请重新打开方案")
			}
			if err := repo.ReleaseCloudAgentResourceLeases(userID, approvalID); err != nil {
				return err
			}
			if err := leaseCloudAgentCommerceBatch(repo, userID, id, renewed.ID, batch); err != nil {
				return err
			}
			state.Approval = &renewed
			cloudAgentCommerceBatchPlanEvent(&state, id, plan, batch)
			state.event(id, "approval_requested", map[string]any{"approvalId": renewed.ID, "previousApprovalId": approvalID, "toolName": renewed.Call.Function.Name, "arguments": json.RawMessage(renewed.Call.Function.Arguments), "preview": renewed.Preview, "planHash": batch.PlanHash, "text": renewed.Preview.Description})
			return cloudAgentSave(current, &state)
		})
		s.storageMu.Unlock()
		if !errors.Is(err, repository.ErrCreationConflict) {
			return err
		}
	}
	return creationConflict("审批状态正在更新，请重新打开方案后重试")
}
