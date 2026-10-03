package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// Each prepared item is the exact normal media admission input and quote. The
// set is saved with its plan hash before any billable task is submitted.
type cloudAgentCommerceBatch struct {
	PlanID            string                        `json:"planId"`
	Version           int                           `json:"version"`
	PlanHash          string                        `json:"planHash"`
	QuoteMicrocredits int64                         `json:"quoteMicrocredits"`
	Items             []cloudAgentCommerceBatchItem `json:"items"`
	ReportedFailures  []string                      `json:"reportedFailures,omitempty"`
}

type cloudAgentCommerceBatchItem struct {
	ItemID   string                   `json:"itemId"`
	TaskID   string                   `json:"taskId"`
	Args     cloudAgentMediaArgs      `json:"args"`
	Request  CreateTaskRequest        `json:"request"`
	Prepared *cloudAgentPreparedMedia `json:"prepared"`
}

// An approval covers the ordered item set, exact admitted input/model/resource
// signatures and each quote. A later version or changed quote needs a new vote.
func cloudAgentCommerceBatchHash(batch *cloudAgentCommerceBatch) string {
	if batch == nil {
		return ""
	}
	items := make([]map[string]any, 0, len(batch.Items))
	for _, item := range batch.Items {
		if item.Prepared == nil {
			return ""
		}
		items = append(items, map[string]any{"itemId": item.ItemID, "taskId": item.TaskID, "preparedHash": item.Prepared.Hash, "quote": item.Prepared.Quote, "request": item.Request.Input})
	}
	return creationHash(map[string]any{"planId": batch.PlanID, "version": batch.Version, "planHash": batch.PlanHash, "quoteMicrocredits": batch.QuoteMicrocredits, "items": items})
}

func (s *Service) prepareCloudAgentCommerceBatch(run *model.CloudAgentExecution, state *cloudAgentRuntime, plan *cloudAgentCommercePlan, call cloudAgentCall) (*cloudAgentCommerceBatch, error) {
	if state.CommercePlan != nil && state.CommercePlan.PlanID == plan.PlanID && state.CommercePlan.Version == plan.Version && cloudAgentCommercePlanHash(state.CommercePlan) != cloudAgentCommercePlanHash(plan) {
		return nil, BadAuthRequest("同一电商计划版本的内容已固定；请递增版本后重新提交")
	}
	batch := &cloudAgentCommerceBatch{PlanID: plan.PlanID, Version: plan.Version, PlanHash: cloudAgentCommercePlanHash(plan)}
	copyState := *state
	copyState.CommercePlan = plan
	var duration int
	for _, item := range plan.Items {
		if item.Type == "text" {
			continue
		}
		arguments, _ := json.Marshal(map[string]any{"mode": item.Type, "commercePlanId": plan.PlanID, "commerceItemId": item.ID})
		mediaCall := cloudAgentCall{ID: call.ID + ":" + item.ID}
		mediaCall.Function.Name, mediaCall.Function.Arguments = "generate_media", string(arguments)
		resolved, identity, err := s.cloudAgentResolvedMediaCall(run.UserID, &copyState, mediaCall)
		if err != nil {
			return nil, err
		}
		if _, err := s.repo.TaskForUser(run.UserID, identity.TaskID); err == nil {
			return nil, BadAuthRequest("此计划版本已有生成任务；新方案请递增版本，失败项请单独重试")
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		request, media, err := s.prepareCloudAgentMedia(run, &copyState, resolved)
		if err != nil {
			return nil, err
		}
		media.CommerceKey, media.CommerceItemID = identity.TaskID, identity.ItemID
		preparation := &creationTaskPreparation{}
		request.creationPrepare = preparation
		dryTask, err := s.CreateTask(run.UserID, request)
		if err != nil {
			return nil, err
		}
		if err := applyCloudAgentResolvedMediaDefaults(&request, media, dryTask); err != nil {
			return nil, err
		}
		prepared, err := prepareCloudAgentMediaApproval(s.repo, run.UserID, cloudAgentCreationMediaDocument(), media, request, dryTask, preparation.Order)
		if err != nil {
			return nil, err
		}
		media.Prepared = prepared
		if batch.QuoteMicrocredits > math.MaxInt64-prepared.Quote.AmountMicrocredits {
			return nil, BadAuthRequest("整套报价超出可计算范围")
		}
		batch.QuoteMicrocredits += prepared.Quote.AmountMicrocredits
		duration += media.Args.Duration
		request.creationPrepare = nil
		batch.Items = append(batch.Items, cloudAgentCommerceBatchItem{ItemID: item.ID, TaskID: identity.TaskID, Args: media.Args, Request: request, Prepared: prepared})
	}
	if len(batch.Items) == 0 {
		return nil, BadAuthRequest("整套方案缺少可执行的图片或视频交付项")
	}
	if limit := state.Request.Budget.MaxGenerationTasks; limit > 0 && state.Generations+len(batch.Items) > limit {
		return batch, BadAuthRequest("整套交付数量超过本轮媒体任务上限；请修改方案")
	}
	if limit := state.Request.Budget.MaxVideoSeconds; limit > 0 && state.VideoSeconds+duration > limit {
		return batch, BadAuthRequest("整套视频时长超过本轮预算；请修改方案")
	}
	orders, err := s.repo.BillingOrdersByTaskIDs(run.UserID, state.TaskIDs)
	if err != nil {
		return nil, err
	}
	remaining := int64(math.Floor(state.Request.Budget.MaxCredits * float64(CreditScale)))
	for _, order := range orders {
		remaining -= order.AmountMicrocredits
	}
	if remaining < 0 || batch.QuoteMicrocredits > remaining {
		return batch, BadAuthRequest("整套真实报价超过本轮剩余积分预算；请修改方案或预算")
	}
	return batch, nil
}

func cloudAgentCommerceBatchPreview(plan *cloudAgentCommercePlan, batch *cloudAgentCommerceBatch, maxCredits float64) cloudAgentApprovalPreview {
	items := make([]cloudAgentApprovalPreviewItem, 0, len(batch.Items))
	for _, entry := range batch.Items {
		for _, item := range plan.Items {
			if item.ID == entry.ItemID {
				items = append(items, cloudAgentApprovalPreviewItem{Operation: "generate_media", Summary: item.Title, Details: []string{item.Purpose, fmt.Sprintf("预计 %.4f 积分", float64(entry.Prepared.Quote.AmountMicrocredits)/float64(CreditScale))}})
				break
			}
		}
	}
	return cloudAgentApprovalPreview{Kind: "commerce_batch", Title: "确认整套生成", Description: fmt.Sprintf("计划 %s 第 %d 版，共 %d 项；实际模型预计 %.4f 积分，本轮上限 %.4f 积分。批准后逐项走原生成任务与计费链。", plan.PlanID, plan.Version, len(batch.Items), float64(batch.QuoteMicrocredits)/float64(CreditScale), maxCredits), Items: items}
}

func cloudAgentCommerceBatchPlanEvent(state *cloudAgentRuntime, runID string, plan *cloudAgentCommercePlan, batch *cloudAgentCommerceBatch) {
	state.CommercePlan = plan
	state.Plan = make([]cloudAgentPlanItem, 0, len(plan.Items))
	for _, item := range plan.Items {
		state.Plan = append(state.Plan, cloudAgentPlanItem{ID: item.ID, Title: item.Title, Status: "pending"})
	}
	payload := cloudAgentCommerceReviewPayload(plan, state.Request, state.Skills, state.Events)
	payload["pendingTitles"] = cloudAgentPendingPlanItems(state.Plan)
	if batch != nil {
		payload["estimatedCredits"] = float64(batch.QuoteMicrocredits) / float64(CreditScale)
	}
	state.event(runID, "plan_updated", payload)
}

func (s *Service) advanceCloudAgentCommercePlan(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) error {
	if call.Function.Name == "commerce_plan_wait" {
		var args struct {
			PlanID string `json:"commercePlanId"`
		}
		if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil || state.CommercePlan == nil || args.PlanID != state.CommercePlan.PlanID {
			return s.cloudAgentMediaError(run, state, "admission", false, false, BadAuthRequest("等待须指定本轮已提交的电商计划"))
		}
		if state.CommerceBatch == nil {
			return s.mutateCloudAgentTool(run, state, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				cloudAgentToolResult(run.ID, state, call, map[string]any{"planId": args.PlanID, "complete": true}, nil)
				return cloudAgentSave(current, state)
			})
		}
		return s.advanceCloudAgentCommerceBatch(run, state, call, state.CommerceBatch)
	}
	if state.Approval != nil && state.Approval.Decision == "approve" {
		if state.Approval.Batch == nil {
			return s.terminateCloudAgent(run, "整套审批准备态缺失，未提交任务")
		}
		return s.advanceCloudAgentCommerceBatch(run, state, call, state.Approval.Batch)
	}
	if state.CommerceBatch != nil {
		return s.advanceCloudAgentCommerceBatch(run, state, call, state.CommerceBatch)
	}
	plan, err := cloudAgentParseCommercePlan(state.Request, call)
	if err != nil {
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	batch, err := s.prepareCloudAgentCommerceBatch(run, state, plan, call)
	if err != nil {
		// Keep a valid plan visible when model quoting or admission fails.
		// No approval or billable task is created from this failed attempt.
		cloudAgentCommerceBatchPlanEvent(state, run.ID, plan, batch)
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	s.storageMu.Lock()
	err = s.mutateCloudAgentTool(run, state, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		cloudAgentCommerceBatchPlanEvent(state, run.ID, plan, batch)
		if state.Request.PermissionMode == "auto" {
			state.CommerceBatch = batch
		} else {
			preview := cloudAgentCommerceBatchPreview(plan, batch, state.Request.Budget.MaxCredits)
			state.Approval = &cloudAgentApproval{ID: fmt.Sprintf("%s-%d-%d", run.ID, state.Step, state.CallIndex), Call: call, CallHash: cloudAgentApprovalCallHash(call), Preview: preview, Batch: batch}
			if err := leaseCloudAgentCommerceBatch(repo, run.UserID, run.ID, state.Approval.ID, batch); err != nil {
				return err
			}
			current.Status = "waiting_approval"
			state.event(run.ID, "approval_requested", map[string]any{"approvalId": state.Approval.ID, "toolName": call.Function.Name, "arguments": json.RawMessage(call.Function.Arguments), "preview": preview, "planHash": batch.PlanHash, "text": preview.Description})
		}
		return cloudAgentSave(current, state)
	})
	s.storageMu.Unlock()
	if err != nil || state.Request.PermissionMode != "auto" {
		return err
	}
	latest, err := s.reloadCloudAgent(run)
	if err != nil {
		return err
	}
	fresh, err := cloudAgentDecode(latest)
	if err != nil {
		return err
	}
	return s.advanceCloudAgentCommerceBatch(latest, &fresh, call, fresh.CommerceBatch)
}

func (s *Service) advanceCloudAgentCommerceBatch(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall, batch *cloudAgentCommerceBatch) error {
	if batch == nil || state.CommercePlan == nil || batch.PlanID != state.CommercePlan.PlanID || batch.Version != state.CommercePlan.Version || batch.PlanHash != cloudAgentCommercePlanHash(state.CommercePlan) {
		return s.terminateCloudAgent(run, "计划版本与整套授权不一致，未提交新任务")
	}
	if state.Approval != nil && state.Approval.Decision == "approve" && (state.DecisionPreparedHashes[state.Approval.ID] == "" || state.DecisionPreparedHashes[state.Approval.ID] != cloudAgentCommerceBatchHash(batch)) {
		return s.terminateCloudAgent(run, "整套交付项、报价或素材与已批准版本不一致，未提交新任务")
	}
	state.CommerceBatch = batch
	// A crash after an individual task commit is recovered through its stable
	// plan/item task ID. Never admit the same item a second time.
	var waiting string
	statuses := make(map[string]string, len(batch.Items))
	failedItems := []map[string]any{}
	repairs := []map[string]any{}
	progress := false
	for _, entry := range batch.Items {
		task, _, err := cloudAgentCommerceLatestTask(s.repo, run.UserID, state, entry.ItemID)
		if err != nil {
			return err
		}
		if task != nil {
			statuses[entry.ItemID] = string(task.Status)
			if waiting == "" && (task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning) {
				waiting = task.ID
			}
			if task.Status == model.TaskStatusFailed {
				repair, err := s.cloudAgentCommerceImageCanRepair(run, state, task)
				if err != nil {
					return err
				}
				failure := map[string]any{"commerceItemId": entry.ItemID, "retryFailedTaskId": task.ID, "title": entry.Args.Title, "generationError": cloudAgentSafeMediaTaskError(task), "action": "report_at_end"}
				if repair {
					failure["action"], failure["originalPrompt"], failure["failedPrompt"] = "rewrite_prompt", entry.Args.Prompt, task.Prompt
					repairs = append(repairs, failure)
				}
				failedItems = append(failedItems, failure)
			}
			continue
		}
		if err := cloudAgentCommerceDependenciesReady(s.repo, run.UserID, state, entry.ItemID); err != nil {
			continue
		}
		var input map[string]any
		raw, _ := json.Marshal(entry.Request.Input)
		if err := json.Unmarshal(raw, &input); err != nil {
			return err
		}
		request := entry.Request
		request.Input = input
		media := &cloudAgentMediaPlan{Args: entry.Args, CommerceKey: entry.TaskID, CommerceItemID: entry.ItemID, Prepared: entry.Prepared}
		if err := s.enqueueCloudAgentTask(run, state, request, media); err != nil {
			return err
		}
		progress = true
		latest, err := s.reloadCloudAgent(run)
		if err != nil {
			return err
		}
		run = latest
		fresh, err := cloudAgentDecode(latest)
		if err != nil {
			return err
		}
		*state = fresh
		statuses[entry.ItemID] = string(model.TaskStatusQueued)
		if waiting == "" {
			waiting = entry.TaskID
		}
	}
	readyRepairs := []map[string]any{}
	for _, failure := range repairs {
		if waiting == "" || !cloudAgentContainsString(batch.ReportedFailures, stringValue(failure["retryFailedTaskId"])) {
			readyRepairs = append(readyRepairs, failure)
		}
	}
	if len(readyRepairs) > 0 {
		return s.mutateCloudAgentTool(run, state, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			for _, failure := range readyRepairs {
				id := stringValue(failure["retryFailedTaskId"])
				if !cloudAgentContainsString(batch.ReportedFailures, id) {
					batch.ReportedFailures = append(batch.ReportedFailures, id)
				}
			}
			state.MediaTaskID = ""
			state.CommerceBatch = batch
			if state.Approval != nil {
				if err := repo.ReleaseCloudAgentResourceLeases(run.UserID, state.Approval.ID); err != nil {
					return err
				}
			}
			cloudAgentToolResult(run.ID, state, call, map[string]any{"planId": batch.PlanID, "complete": false, "taskStatuses": statuses, "failedItems": readyRepairs, "taskSubmitted": true, "instruction": cloudAgentCommerceRecoveryInstruction}, nil)
			return cloudAgentSave(current, state)
		})
	}
	if waiting != "" {
		if state.MediaTaskID == waiting {
			return nil
		}
		return s.mutateCloudAgentTool(run, state, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			state.MediaTaskID = waiting
			return cloudAgentSave(current, state)
		})
	}
	if !progress {
		for _, entry := range batch.Items {
			if statuses[entry.ItemID] == "" {
				statuses[entry.ItemID] = "skipped_dependency"
			}
		}
	}
	return s.mutateCloudAgentTool(run, state, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		state.MediaTaskID = ""
		state.CommerceBatch = nil
		if state.Approval != nil {
			if err := repo.ReleaseCloudAgentResourceLeases(run.UserID, state.Approval.ID); err != nil {
				return err
			}
		}
		cloudAgentToolResult(run.ID, state, call, map[string]any{"planId": batch.PlanID, "version": batch.Version, "planHash": batch.PlanHash, "taskStatuses": statuses, "failedItems": failedItems, "complete": true, "taskSubmitted": true}, nil)
		return cloudAgentSave(current, state)
	})
}
