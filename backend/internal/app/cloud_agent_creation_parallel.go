package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// Admit consecutive, already-declared image calls in order without holding
// their tool responses until each image finishes. Canvas and dependency-based
// commerce execution retain their own settlement contracts.
func cloudAgentCreationImageCallGroup(state *cloudAgentRuntime, callID string) (member, deferWait bool) {
	if state.Request.Surface != "creation" || state.CommercePlan != nil {
		return false, false
	}
	calls := state.PiModelCalls
	if len(calls) == 0 {
		calls = state.Calls
	}
	isImage := func(index int) bool {
		if index < 0 || index >= len(calls) || calls[index].Function.Name != "generate_media" {
			return false
		}
		var args cloudAgentMediaArgs
		return json.Unmarshal([]byte(calls[index].Function.Arguments), &args) == nil && args.Mode == "image"
	}
	for index, call := range calls {
		if call.ID == callID && isImage(index) {
			next := isImage(index + 1)
			return isImage(index-1) || next, next
		}
	}
	return false, false
}

func (s *Service) cloudAgentCreationPendingImages(userID, runID string, state *cloudAgentRuntime) ([]*model.Task, bool, error) {
	tasks := make([]*model.Task, 0, len(state.CreationPendingImages))
	ready := true
	for _, id := range state.CreationPendingImages {
		task, err := s.repo.TaskForUser(userID, id)
		if err != nil {
			return nil, false, err
		}
		if task.AgentRunID != runID || task.Type != "canvas_image" {
			return nil, false, fmt.Errorf("待交付图片任务归属不一致")
		}
		tasks = append(tasks, task)
		ready = ready && cloudAgentTaskTerminal(task.Status)
	}
	return tasks, ready, nil
}

func cloudAgentRecordCreationImageGroup(runID string, state *cloudAgentRuntime, tasks []*model.Task) []map[string]any {
	results := make([]map[string]any, 0, len(tasks))
	for _, task := range tasks {
		result := map[string]any{"taskId": task.ID, "status": task.Status}
		if task.Status != model.TaskStatusSucceeded {
			result["generationError"] = truncateRunes(cloudAgentSafeMediaTaskError(task), 90)
		}
		results = append(results, result)
		state.event(runID, "generation_task_completed", map[string]any{"taskId": task.ID, "status": task.Status, "text": "独立图片任务已结束，结果保存在任务中心"})
	}
	state.CreationPendingImages = nil
	return results
}

// If a later call is rejected before submission, settle its already-billed
// siblings at the next model boundary instead of resubmitting or losing them.
func (s *Service) settleCloudAgentCreationImageGroup(ctx context.Context, userID, runID string) error {
	for attempt := 0; attempt < 8; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		run, err := s.ownedCloudAgent(ctx, userID, runID)
		if err != nil {
			return err
		}
		if cloudAgentRunTerminal(run.Status) {
			return fmt.Errorf("Agent 运行已结束，未继续编排图片任务")
		}
		state, err := cloudAgentDecodeForExecution(run)
		if err != nil || len(state.CreationPendingImages) == 0 {
			return err
		}
		tasks, ready, err := s.cloudAgentCreationPendingImages(userID, runID, &state)
		if err != nil {
			return err
		}
		if !ready {
			for _, task := range tasks {
				if _, err := s.waitCloudAgentTask(ctx, task.ID); err != nil && ctx.Err() != nil {
					return ctx.Err()
				}
			}
			continue
		}
		err = s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			cloudAgentRecordCreationImageGroup(runID, &state, tasks)
			return cloudAgentSave(current, &state)
		})
		if errors.Is(err, repository.ErrCreationConflict) {
			continue
		}
		return err
	}
	return repository.ErrCreationConflict
}
