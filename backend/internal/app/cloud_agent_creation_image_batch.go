package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type cloudAgentImageBatchItem struct {
	ID                    string                        `json:"id"`
	Title                 string                        `json:"title"`
	Prompt                string                        `json:"prompt"`
	AttachmentResourceIDs []string                      `json:"attachmentResourceIds,omitempty"`
	References            []cloudAgentCreationReference `json:"references,omitempty"`
	Size                  string                        `json:"size,omitempty"`
	Quality               string                        `json:"quality,omitempty"`
	RequirePreferredModel bool                          `json:"requirePreferredModel,omitempty"`
}

func cloudAgentImageBatchProperties() map[string]any {
	str := func(description string) map[string]any {
		return map[string]any{"type": "string", "description": description}
	}
	return map[string]any{"items": map[string]any{"type": "array", "minItems": 2, "maxItems": 20, "items": map[string]any{
		"type": "object", "additionalProperties": false, "required": []string{"id", "title", "prompt"},
		"properties": map[string]any{
			"id": str("本批唯一图片交付项 ID，与阶段计划 ID 分开"), "title": str("这张图的标题"), "prompt": str("该图完整提示词；编辑时明确只改什么、保留什么"),
			"attachmentResourceIds": map[string]any{"type": "array", "maxItems": 16, "items": str("仅此项需要的已授权素材或精读原图 ID；不同项各自映射，不混入其他原图")},
			"references":            cloudAgentCreationReferenceSchema(), "size": str("自动参数模式下按已选模型能力选择画幅"), "quality": str("自动参数模式下按已选模型能力选择质量"),
			"requirePreferredModel": map[string]any{"type": "boolean", "description": "仅当用户明确要求必须使用已选型号时设为 true；只收紧该项模型范围，不能扩大授权或预算"},
		},
	}}}
}

func (s *Service) prepareCloudAgentImageBatch(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) (*cloudAgentCommerceBatch, error) {
	var args struct {
		Items []cloudAgentImageBatchItem `json:"items"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if state.Request.Surface != "creation" || state.Request.MediaSettings == nil || state.Request.MediaSettings.Image == nil || len(args.Items) < 2 || len(args.Items) > 20 {
		return nil, &cloudAgentArgumentError{BadAuthRequest("图片批次须包含 2–20 个独立交付项，并使用本轮已选图片模型")}
	}
	if limit := state.Request.Budget.MaxGenerationTasks; limit > 0 && state.Generations+len(args.Items) > limit {
		return nil, BadAuthRequest("图片批次数量超过本轮剩余媒体任务上限，未提交任务")
	}
	batch := &cloudAgentCommerceBatch{Kind: "images", PlanID: cloudAgentID(run.UserID, run.ID+":image-batch:"+call.ID), Version: 1, PlanHash: cloudAgentApprovalCallHash(call), PlanItemIDs: cloudAgentBatchActiveStages(state)}
	copyState := *state
	settings, choice := *state.Request.MediaSettings, *state.Request.MediaSettings.Image
	choice.Count, settings.Image = 1, &choice
	copyState.Request.MediaSettings = &settings
	seen := map[string]bool{}
	for _, item := range args.Items {
		if validateCloudAgentID(item.ID, "图片交付项 ID", 80) != nil || seen[item.ID] || strings.TrimSpace(item.Title) == "" || strings.TrimSpace(item.Prompt) == "" {
			return nil, &cloudAgentArgumentError{BadAuthRequest("图片交付项必须具有唯一有效 ID、标题和完整提示词")}
		}
		seen[item.ID] = true
		mediaArgs := cloudAgentMediaArgs{Mode: "image", Title: item.Title, Prompt: item.Prompt, AttachmentResourceIDs: item.AttachmentResourceIDs, References: item.References, Size: item.Size, Quality: item.Quality, RequirePreferredModel: item.RequirePreferredModel}
		mediaCall := cloudAgentCall{ID: cloudAgentID(run.UserID, batch.PlanID+":"+item.ID)}
		mediaCall.Function.Name, mediaCall.Function.Arguments = "generate_media", mustMarshal(mediaArgs)
		request, media, err := s.prepareCloudAgentMedia(run, &copyState, mediaCall)
		if err != nil {
			return nil, err
		}
		metadata := request.Input["metadata"].(map[string]any)
		metadata["imageBatchId"], metadata["imageBatchTotal"], metadata["imageBatchItemId"] = batch.PlanID, len(args.Items), item.ID
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
		if batch.QuoteMicrocredits > math.MaxInt64-prepared.Quote.AmountMicrocredits {
			return nil, BadAuthRequest("图片批次报价超出可计算范围")
		}
		batch.QuoteMicrocredits += prepared.Quote.AmountMicrocredits
		request.creationPrepare = nil
		batch.Items = append(batch.Items, cloudAgentCommerceBatchItem{ItemID: item.ID, TaskID: mediaCall.ID, Args: media.Args, Request: request, Prepared: prepared})
	}
	remaining, err := s.cloudAgentRemainingBudget(run.UserID, state)
	if err != nil {
		return nil, err
	}
	if remaining < 0 || batch.QuoteMicrocredits > remaining {
		return nil, BadAuthRequest("图片批次真实报价超过本轮剩余积分预算，未提交任务")
	}
	return batch, nil
}

func cloudAgentImageBatchPreview(batch *cloudAgentCommerceBatch) cloudAgentApprovalPreview {
	items := make([]cloudAgentApprovalPreviewItem, 0, len(batch.Items))
	hasVideo := false
	for _, item := range batch.Items {
		details := []string{fmt.Sprintf("预计 %.4f 积分", float64(item.Prepared.Quote.AmountMicrocredits)/float64(CreditScale))}
		if item.Request.Model != "" {
			details = append(details, "生成模型："+item.Request.Model)
		}
		hasVideo = hasVideo || item.Args.Mode == "video"
		items = append(items, cloudAgentApprovalPreviewItem{Operation: "generate_media", Summary: item.Args.Title, Details: details})
	}
	if hasVideo {
		return cloudAgentApprovalPreview{Kind: "image_batch", Title: "确认重试生成", Description: fmt.Sprintf("共 %d 项媒体，预计 %.4f 积分；批准后各自入队。", len(items), float64(batch.QuoteMicrocredits)/float64(CreditScale)), Items: items}
	}
	return cloudAgentApprovalPreview{Kind: "image_batch", Title: "确认批量生成", Description: fmt.Sprintf("共 %d 张独立图片，预计 %.4f 积分；批准后各自入队，不逐张等待。", len(items), float64(batch.QuoteMicrocredits)/float64(CreditScale)), Items: items}
}

func cloudAgentImageBatchPlanEvent(state *cloudAgentRuntime, runID string, batch *cloudAgentCommerceBatch) {
	state.event(runID, "plan_updated", map[string]any{"items": state.Plan, "imageBatchId": batch.PlanID, "imageBatchTotal": len(batch.Items)})
}

// Reuse the frozen per-item admissions and approval ledger, without inventing
// commerce facts or depending on a skill being re-read during a follow-up turn.
func (s *Service) advanceCloudAgentImageBatch(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) error {
	batch := state.CommerceBatch
	if batch == nil && state.Approval != nil && state.Approval.Decision == "approve" {
		batch = state.Approval.Batch
	}
	if batch == nil {
		var err error
		if len(state.RetryReplay) > 0 {
			batch, err = s.prepareCloudAgentReplayBatch(run, state, call)
		} else {
			batch, err = s.prepareCloudAgentImageBatch(run, state, call)
		}
		if err != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
		s.storageMu.Lock()
		err = s.mutateCloudAgentTool(run, state, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			cloudAgentImageBatchPlanEvent(state, run.ID, batch)
			if state.Request.PermissionMode == "auto" {
				state.CommerceBatch = batch
			} else {
				preview := cloudAgentImageBatchPreview(batch)
				state.Approval = &cloudAgentApproval{ID: fmt.Sprintf("%s-%d-%d", run.ID, state.Step, state.CallIndex), Call: call, CallHash: cloudAgentApprovalCallHash(call), Preview: preview, Batch: batch}
				if err := leaseCloudAgentCommerceBatch(repo, run.UserID, run.ID, state.Approval.ID, batch); err != nil {
					return err
				}
				current.Status = "waiting_approval"
				state.event(run.ID, "approval_requested", map[string]any{"approvalId": state.Approval.ID, "toolName": call.Function.Name, "arguments": json.RawMessage(call.Function.Arguments), "preview": preview, "text": preview.Description})
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
		return s.advanceCloudAgentImageBatch(latest, &fresh, call)
	}
	minimum := 2
	if len(state.RetryReplay) > 0 {
		minimum = 1
	}
	if batch.Kind != "images" || batch.PlanID != cloudAgentID(run.UserID, run.ID+":image-batch:"+call.ID) || batch.PlanHash != cloudAgentApprovalCallHash(call) || len(batch.Items) < minimum || len(batch.Items) > 20 {
		return s.terminateCloudAgent(run, "图片批次与已提交调用不一致，未继续提交任务")
	}
	if state.Approval != nil && (state.Approval.Decision != "approve" || state.DecisionPreparedHashes[state.Approval.ID] != cloudAgentCommerceBatchHash(batch)) {
		return s.terminateCloudAgent(run, "图片批次、报价或素材与已批准版本不一致，未提交任务")
	}
	state.CommerceBatch = batch
	var waiting string
	capacityBlocked := false
	results := make([]map[string]any, 0, len(batch.Items))
	for _, item := range batch.Items {
		task, err := s.repo.TaskForUser(run.UserID, item.TaskID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if capacityBlocked {
				continue
			}
			if len(state.RetryReplay) > 0 {
				original, lookupErr := s.repo.TaskForUser(run.UserID, item.ItemID)
				if lookupErr != nil {
					return lookupErr
				}
				if _, retryErr := s.cloudAgentMediaRetryPolicy(run.UserID, original); retryErr != nil {
					return s.cloudAgentMediaError(run, state, "admission", false, false, retryErr)
				}
			}
			var input map[string]any
			if err := json.Unmarshal([]byte(mustMarshal(item.Request.Input)), &input); err != nil {
				return err
			}
			request := item.Request
			request.Input = input
			media := &cloudAgentMediaPlan{Args: item.Args, CallID: call.ID, TaskID: item.TaskID, Prepared: item.Prepared}
			if err := s.enqueueCloudAgentTask(run, state, request, media); err != nil {
				if errors.Is(err, repository.ErrActiveTaskLimit) {
					capacityBlocked = true
					continue
				}
				return err
			}
			latest, reloadErr := s.reloadCloudAgent(run)
			if reloadErr != nil {
				return reloadErr
			}
			run = latest
			fresh, decodeErr := cloudAgentDecode(latest)
			if decodeErr != nil {
				return decodeErr
			}
			*state = fresh
			if cloudAgentRunTerminal(run.Status) || state.CallIndex >= len(state.Calls) {
				return nil
			}
			task, err = s.repo.TaskForUser(run.UserID, item.TaskID)
		}
		if err != nil {
			return err
		}
		var input struct {
			Metadata struct {
				BatchID string `json:"imageBatchId"`
				ItemID  string `json:"imageBatchItemId"`
			} `json:"metadata"`
		}
		if json.Unmarshal([]byte(task.InputJSON), &input) != nil || task.AgentRunID != run.ID || task.Type != "canvas_"+item.Args.Mode || input.Metadata.BatchID != batch.PlanID || input.Metadata.ItemID != item.ItemID {
			return s.terminateCloudAgent(run, "图片批次任务归属不一致，未重复提交")
		}
		result := map[string]any{"taskId": task.ID, "itemId": item.ItemID, "status": task.Status}
		if !cloudAgentTaskTerminal(task.Status) && waiting == "" {
			waiting = task.ID
		}
		if cloudAgentTaskTerminal(task.Status) && task.Status != model.TaskStatusSucceeded {
			result["generationError"] = truncateRunes(cloudAgentSafeMediaTaskError(task), 90)
		}
		results = append(results, result)
	}
	return s.mutateCloudAgentTool(run, state, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		cloudAgentBatchRecordCompleted(state, run.ID, batch, results)
		batch.WaitingForCapacity = capacityBlocked
		state.CommerceBatch = batch
		state.MediaTaskID = waiting
		if waiting == "" && !capacityBlocked {
			allSucceeded := true
			for _, result := range results {
				allSucceeded = allSucceeded && result["status"] == model.TaskStatusSucceeded
			}
			cloudAgentBatchFinishStages(state, run.ID, batch, allSucceeded)
			state.CommerceBatch = nil
			if state.Approval != nil {
				if err := repo.ReleaseCloudAgentResourceLeases(run.UserID, state.Approval.ID); err != nil {
					return err
				}
			}
			cloudAgentToolResult(run.ID, state, call, map[string]any{"batchId": batch.PlanID, "total": len(batch.Items), "complete": true, "taskSubmitted": true, "batchResults": results}, nil)
		}
		return cloudAgentSave(current, state)
	})
}
