package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"math"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// Only the server can select this path. An unchanged retry reuses admitted
// per-item inputs; it does not ask a planner to reconstruct the user's request.
func (s *Service) cloudAgentCreationReplayTargets(userID string, req CloudAgentRequest) ([]string, error) {
	if req.Retry == nil || req.Surface != "creation" || req.PermissionMode == "read_only" {
		return nil, nil
	}
	targets := append([]string(nil), req.Retry.TaskIDs...)
	if req.Retry.TaskID != "" {
		targets = []string{req.Retry.TaskID}
	}
	if len(targets) == 0 {
		return nil, nil
	}
	source, err := s.repo.CloudAgent(userID, req.Retry.RunID)
	if err != nil {
		return nil, err
	}
	previous, err := cloudAgentDecode(source)
	if err != nil {
		return nil, err
	}
	if !cloudAgentReplaySettingsEqual(previous.Request.MediaSettings, req.MediaSettings) {
		return nil, nil
	}
	for _, id := range targets {
		task, err := s.repo.TaskForUser(userID, id)
		if err != nil {
			return nil, err
		}
		policy, err := s.cloudAgentMediaRetryPolicy(userID, task)
		if err != nil {
			return nil, err
		}
		if policy.RequiresPromptChange {
			return nil, nil
		}
		var input map[string]any
		if json.Unmarshal([]byte(task.InputJSON), &input) != nil {
			return nil, BadAuthRequest("原任务输入无法恢复")
		}
		mode := stringValue(input["mode"])
		config, _ := input["config"].(map[string]any)
		if (mode != "image" && mode != "video") || strings.TrimSpace(task.Prompt) == "" || config == nil {
			return nil, nil
		}
		// A single original failure has one retry identity across tabs and runs.
		// Retrying that new task, if it fails, is a separate explicit action.
		if existing, err := s.repo.TaskForUser(userID, cloudAgentCommerceRetryTaskID(userID, id)); err == nil {
			return nil, creationConflict("该失败项已有重试任务，请查看原重试结果：" + existing.ID)
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}
	return targets, nil
}

func cloudAgentReplaySettingsEqual(a, b *CloudAgentCreationMedia) bool {
	normalize := func(settings *CloudAgentCreationMedia) *CloudAgentCreationMedia {
		if settings == nil {
			return nil
		}
		copy := *settings
		if copy.Image != nil {
			choice := *copy.Image
			choice.SelectionMode = ""
			copy.Image = &choice
		}
		if copy.Video != nil {
			choice := *copy.Video
			choice.SelectionMode = ""
			copy.Video = &choice
		}
		return &copy
	}
	// The routing preference affects admission authorization, not the frozen
	// creative prompt. Adding its default must not re-plan historical retries.
	return mustMarshal(normalize(a)) == mustMarshal(normalize(b))
}

func (s *Service) prepareCloudAgentReplayBatch(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) (*cloudAgentCommerceBatch, error) {
	if len(state.RetryReplay) == 0 || len(state.RetryReplay) > 20 || state.Request.Surface != "creation" || state.Request.PermissionMode == "read_only" {
		return nil, BadAuthRequest("重试缺少已授权的失败任务")
	}
	if limit := state.Request.Budget.MaxGenerationTasks; limit > 0 && state.Generations+len(state.RetryReplay) > limit {
		return nil, BadAuthRequest("重试任务数量超过剩余任务上限")
	}
	remaining, err := s.cloudAgentRemainingBudget(run.UserID, state)
	if err != nil {
		return nil, err
	}
	batch := &cloudAgentCommerceBatch{Kind: "images", PlanID: cloudAgentID(run.UserID, run.ID+":image-batch:"+call.ID), Version: 1, PlanHash: cloudAgentApprovalCallHash(call)}
	seconds := state.VideoSeconds
	for _, id := range state.RetryReplay {
		original, err := s.repo.TaskForUser(run.UserID, id)
		if err != nil {
			return nil, err
		}
		policy, err := s.cloudAgentMediaRetryPolicy(run.UserID, original)
		if err != nil {
			return nil, err
		}
		if policy.RequiresPromptChange {
			return nil, BadAuthRequest("内容审核拒绝需要先调整提示词")
		}
		raw, err := s.decryptTaskInputJSON(original.InputJSON)
		if err != nil {
			return nil, err
		}
		var saved map[string]any
		if err := json.Unmarshal([]byte(raw), &saved); err != nil {
			return nil, err
		}
		mode := stringValue(saved["mode"])
		if mode != "image" && mode != "video" {
			return nil, BadAuthRequest("原媒体类型无法直接重试")
		}
		// Keep only intent and references. Credentials, protocols and prices are
		// resolved again by ordinary task admission from the current catalog.
		input := map[string]any{"mode": mode, "prompt": original.Prompt, "config": saved["config"]}
		for _, field := range []string{"referenceImages", "referenceVideos", "referenceAudios", "capabilityOptions"} {
			if saved[field] != nil {
				input[field] = saved[field]
			}
		}
		metadata, _ := saved["metadata"].(map[string]any)
		if metadata == nil {
			metadata = map[string]any{}
		}
		metadata["source"], metadata["agentRunId"] = "cloud_agent_creation", run.ID
		metadata["imageBatchId"], metadata["imageBatchTotal"], metadata["imageBatchItemId"] = batch.PlanID, len(state.RetryReplay), id
		metadata["retryOf"] = id
		if state.CommercePlan != nil && cloudAgentCommerceTaskMatches(original, state.CommercePlan, stringValue(metadata["commerceItemId"])) {
			metadata["commerceRetryFailedTaskId"] = id
			metadata["commerceRootTaskId"] = cloudAgentCommerceTaskID(run.UserID, state.CommercePlan, stringValue(metadata["commerceItemId"]), state.Request.SessionID)
			metadata["commerceRetryPromptHash"] = ""
		}
		input["metadata"] = metadata
		config, _ := input["config"].(map[string]any)
		if config == nil {
			return nil, BadAuthRequest("原生成参数无法恢复")
		}
		config = maps.Clone(config)
		if original.LogicalModelID != "" {
			cloudAgentReplayLogicalIntent(input)
		}
		media := &cloudAgentMediaPlan{Args: cloudAgentMediaArgs{Mode: mode, Prompt: original.Prompt, Title: firstNonEmpty(stringValue(metadata["title"]), "重试生成"), Size: stringValue(config["size"])}, CallID: call.ID, TaskID: cloudAgentCommerceRetryTaskID(run.UserID, id)}
		if mode == "image" {
			media.Args.Quality = stringValue(config["quality"])
			media.Args.ImageResolution = stringValue(config["imageResolution"])
		}
		request := CreateTaskRequest{Type: original.Type, Operation: original.Operation, Prompt: original.Prompt, Model: original.Model, LogicalModelID: original.LogicalModelID, Input: input}
		var choice *CloudAgentCreationMediaChoice
		if state.Request.MediaSettings != nil {
			choice = state.Request.MediaSettings.Image
			if mode == "video" {
				choice = state.Request.MediaSettings.Video
			}
		}
		request, err = s.chooseCloudAgentReplayModel(run.UserID, original, request, choice, remaining-batch.QuoteMicrocredits)
		if err != nil {
			return nil, err
		}
		preparation := &creationTaskPreparation{DeferActiveTaskLimit: true}
		request.creationPrepare = preparation
		dryTask, err := s.CreateTask(run.UserID, request)
		if err != nil {
			return nil, err
		}
		var resolved map[string]any
		if err := json.Unmarshal([]byte(dryTask.InputJSON), &resolved); err != nil {
			return nil, err
		}
		if err := validateCloudAgentResolvedMediaOptions(config, resolved); err != nil {
			return nil, err
		}
		if err := applyCloudAgentResolvedMediaDefaults(&request, media, dryTask); err != nil {
			return nil, err
		}
		if original.LogicalModelID != "" {
			cloudAgentReplayLogicalIntent(request.Input)
		}
		prepared, err := prepareCloudAgentMediaApproval(s.repo, run.UserID, cloudAgentCreationMediaDocument(), media, request, dryTask, preparation.Order)
		if err != nil {
			return nil, err
		}
		if batch.QuoteMicrocredits > math.MaxInt64-prepared.Quote.AmountMicrocredits {
			return nil, BadAuthRequest("重试报价超出可计算范围")
		}
		batch.QuoteMicrocredits += prepared.Quote.AmountMicrocredits
		seconds += media.Args.Duration
		if remaining < 0 || batch.QuoteMicrocredits > remaining {
			return nil, BadAuthRequest("重试报价超过原任务剩余预算，未提交任务")
		}
		if limit := state.Request.Budget.MaxVideoSeconds; limit > 0 && seconds > limit {
			return nil, BadAuthRequest("重试超过视频时长预算，未提交任务")
		}
		request.creationPrepare = nil
		batch.Items = append(batch.Items, cloudAgentCommerceBatchItem{ItemID: id, TaskID: media.TaskID, Args: media.Args, Request: request, Prepared: prepared})
	}
	return batch, nil
}

// Both quote preparation and final admission resolve a logical model afresh.
// Persist its options, not the previous admission's provider route or credentials.
func cloudAgentReplayLogicalIntent(input map[string]any) {
	config, _ := input["config"].(map[string]any)
	for _, key := range []string{"channelId", "channelModelKey", "priceTierId", "providerModelKey", "apiFormat", "interfaceType", "baseUrl", "apiKey", "secretKey", "headers", "model", "capabilityConfig"} {
		delete(config, key)
	}
}

func (s *Service) advanceCloudAgentCreationReplay(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
	if run.Status != "running" && run.Status != "queued" {
		return nil
	}
	if state.CallIndex < len(state.Calls) {
		if err := s.advanceCloudAgentImageBatch(run, state, state.Calls[state.CallIndex]); err != nil {
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
		run, state = latest, &fresh
	}
	if cloudAgentRunTerminal(run.Status) || run.Status == "waiting_approval" || state.CallIndex < len(state.Calls) || cloudAgentMediaPending(state) || state.CommerceBatch != nil {
		return nil
	}
	succeeded, failed, cancelled := 0, 0, 0
	for _, id := range state.RetryReplay {
		task, err := s.repo.TaskForUser(run.UserID, cloudAgentCommerceRetryTaskID(run.UserID, id))
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return s.failCloudAgent(run, state, "重试未能提交，请检查本轮生成错误")
		}
		if err != nil {
			return err
		}
		switch task.Status {
		case model.TaskStatusSucceeded:
			succeeded++
		case model.TaskStatusFailed:
			failed++
		case model.TaskStatusCancelled:
			cancelled++
		default:
			return nil
		}
	}
	return s.mutateCloudAgentTool(run, state, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		current.Status = "completed"
		state.event(run.ID, "assistant_message", map[string]any{"messageId": run.ID + ":retry-result", "text": fmt.Sprintf("重试已结束：%d 项成功，%d 项失败，%d 项已取消。", succeeded, failed, cancelled)})
		state.event(run.ID, "run_completed", map[string]any{"text": "重试已结束", "timestamp": time.Now().Unix()})
		return cloudAgentSave(current, state)
	})
}

func (s *Service) runCloudAgentCreationReplay(ctx context.Context, userID, runID string) error {
	for {
		run, err := s.ownedCloudAgent(ctx, userID, runID)
		if err != nil {
			return err
		}
		if run.Status != "running" && run.Status != "queued" {
			return nil
		}
		state, err := cloudAgentDecodeForExecution(run)
		if err != nil {
			return err
		}
		if err := s.advanceCloudAgentCreationReplay(run, &state); err != nil {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}
