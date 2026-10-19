package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// Each prepared item is the exact normal media admission input and quote. The
// set is saved with its plan hash before any billable task is submitted.
type cloudAgentCommerceBatch struct {
	Kind               string                        `json:"kind,omitempty"`
	PlanID             string                        `json:"planId"`
	Version            int                           `json:"version"`
	PlanHash           string                        `json:"planHash"`
	QuoteMicrocredits  int64                         `json:"quoteMicrocredits"`
	Items              []cloudAgentCommerceBatchItem `json:"items"`
	ReportedFailures   []string                      `json:"reportedFailures,omitempty"`
	CompletedTaskIDs   []string                      `json:"completedTaskIds,omitempty"`
	PlanItemIDs        []string                      `json:"planItemIds,omitempty"`
	WaitingForCapacity bool                          `json:"waitingForCapacity,omitempty"`
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
	projection := map[string]any{"planId": batch.PlanID, "version": batch.Version, "planHash": batch.PlanHash, "quoteMicrocredits": batch.QuoteMicrocredits, "items": items}
	if batch.Kind != "" {
		projection["kind"] = batch.Kind
	}
	return creationHash(projection)
}

func (s *Service) prepareCloudAgentCommerceBatch(run *model.CloudAgentExecution, state *cloudAgentRuntime, plan *cloudAgentCommercePlan, call cloudAgentCall) (*cloudAgentCommerceBatch, error) {
	if state.CommercePlan != nil && state.CommercePlan.PlanID == plan.PlanID && state.CommercePlan.Version == plan.Version && cloudAgentCommercePlanHash(state.CommercePlan) != cloudAgentCommercePlanHash(plan) {
		return nil, BadAuthRequest("同一电商计划版本的内容已固定；请递增版本后重新提交")
	}
	batch := &cloudAgentCommerceBatch{PlanID: plan.PlanID, Version: plan.Version, PlanHash: cloudAgentCommercePlanHash(plan), PlanItemIDs: cloudAgentBatchActiveStages(state)}
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
		preparation := &creationTaskPreparation{DeferActiveTaskLimit: true}
		request.creationPrepare = preparation
		dryTask, err := s.prepareCloudAgentPreferredMedia(run, &copyState, &request, media, batch.QuoteMicrocredits)
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
	remaining, err := s.cloudAgentRemainingBudget(run.UserID, state)
	if err != nil {
		return nil, err
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
				details := []string{item.Purpose, fmt.Sprintf("预计 %.4f 积分", float64(entry.Prepared.Quote.AmountMicrocredits)/float64(CreditScale))}
				if entry.Request.Model != "" {
					details = append(details, "生成模型："+entry.Request.Model)
				}
				items = append(items, cloudAgentApprovalPreviewItem{Operation: "generate_media", Summary: item.Title, Details: details})
				break
			}
		}
	}
	return cloudAgentApprovalPreview{Kind: "commerce_batch", Title: "确认整套生成", Description: fmt.Sprintf("计划 %s 第 %d 版，共 %d 项；实际模型预计 %.4f 积分，本轮上限 %.4f 积分。批准后逐项走原生成任务与计费链。", plan.PlanID, plan.Version, len(batch.Items), float64(batch.QuoteMicrocredits)/float64(CreditScale), maxCredits), Items: items}
}

func cloudAgentCommerceBatchPlanEvent(state *cloudAgentRuntime, runID string, plan *cloudAgentCommercePlan, batch *cloudAgentCommerceBatch, references CloudAgentRequest) {
	state.CommercePlan = plan
	payload := cloudAgentCommerceReviewPayload(plan, references, state.Skills, state.Events)
	payload["items"] = append([]cloudAgentPlanItem{}, state.Plan...)
	payload["pendingTitles"] = cloudAgentPendingPlanItems(state.Plan)
	if batch != nil {
		payload["estimatedCredits"] = float64(batch.QuoteMicrocredits) / float64(CreditScale)
	}
	state.event(runID, "plan_updated", payload)
}

func (s *Service) advanceCloudAgentCommercePlan(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) error {
	if call.Function.Name == "generate_image_batch" {
		return s.advanceCloudAgentImageBatch(run, state, call)
	}
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
	if state.CommerceBatch != nil {
		return s.advanceCloudAgentCommerceBatch(run, state, call, state.CommerceBatch)
	}
	if state.Approval != nil && state.Approval.Decision == "approve" {
		if state.Approval.Batch == nil {
			return s.terminateCloudAgent(run, "整套审批准备态缺失，未提交任务")
		}
		return s.advanceCloudAgentCommerceBatch(run, state, call, state.Approval.Batch)
	}
	references, err := cloudAgentCreationRequestWithOutputs(s.repo, run.UserID, state)
	if err != nil {
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	plan, err := cloudAgentParseCommercePlan(references, call)
	if err != nil {
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	batch, err := s.prepareCloudAgentCommerceBatch(run, state, plan, call)
	if err != nil {
		// Keep a valid plan visible when model quoting or admission fails.
		// No approval or billable task is created from this failed attempt.
		cloudAgentCommerceBatchPlanEvent(state, run.ID, plan, batch, references)
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	s.storageMu.Lock()
	err = s.mutateCloudAgentTool(run, state, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		cloudAgentCommerceBatchPlanEvent(state, run.ID, plan, batch, references)
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
	if batch != nil && batch.Kind == "images" {
		return s.advanceCloudAgentImageBatch(run, state, call)
	}
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
	completed := []map[string]any{}
	capacityBlocked := false
	dependencyErrors := map[string]error{}
	for _, entry := range batch.Items {
		task, _, err := cloudAgentCommerceLatestTask(s.repo, run.UserID, state, entry.ItemID)
		if err != nil {
			return err
		}
		if task != nil {
			statuses[entry.ItemID] = string(task.Status)
			if cloudAgentTaskTerminal(task.Status) && !cloudAgentContainsString(batch.CompletedTaskIDs, task.ID) {
				completed = append(completed, map[string]any{"taskId": task.ID, "commerceItemId": entry.ItemID, "status": task.Status})
			}
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
			var appErr *AppError
			if !errors.As(err, &appErr) {
				return err
			}
			dependencyErrors[entry.ItemID] = err
			continue
		}
		if capacityBlocked {
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
			if errors.Is(err, repository.ErrActiveTaskLimit) {
				capacityBlocked = true
				continue
			}
			return err
		}
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
		if cloudAgentRunTerminal(run.Status) || state.CallIndex >= len(state.Calls) {
			return nil
		}
		statuses[entry.ItemID] = string(model.TaskStatusQueued)
		if waiting == "" {
			waiting = entry.TaskID
		}
	}
	batch.WaitingForCapacity = capacityBlocked
	readyRepairs := []map[string]any{}
	for _, failure := range repairs {
		if waiting == "" || !cloudAgentContainsString(batch.ReportedFailures, stringValue(failure["retryFailedTaskId"])) {
			readyRepairs = append(readyRepairs, failure)
		}
	}
	if len(readyRepairs) > 0 {
		return s.mutateCloudAgentTool(run, state, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			cloudAgentBatchRecordCompleted(state, run.ID, batch, completed)
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
	if waiting != "" || capacityBlocked {
		return s.mutateCloudAgentTool(run, state, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			cloudAgentBatchRecordCompleted(state, run.ID, batch, completed)
			state.CommerceBatch = batch
			state.MediaTaskID = waiting
			return cloudAgentSave(current, state)
		})
	}
	for _, entry := range batch.Items {
		if statuses[entry.ItemID] == "" {
			err := dependencyErrors[entry.ItemID]
			if err == nil {
				err = BadAuthRequest("交付项“" + entry.Args.Title + "”的前置内容尚未完成，未提交生成任务")
			}
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
	}
	return s.mutateCloudAgentTool(run, state, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		cloudAgentBatchRecordCompleted(state, run.ID, batch, completed)
		allSucceeded := true
		for _, status := range statuses {
			allSucceeded = allSucceeded && status == string(model.TaskStatusSucceeded)
		}
		cloudAgentBatchFinishStages(state, run.ID, batch, allSucceeded)
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
