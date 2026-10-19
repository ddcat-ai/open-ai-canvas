package app

import "yingce/backend/internal/model"

// Bind the model's current stages once. Image titles and retry item IDs are
// delivery details, not a replacement for the user's creative plan.
func cloudAgentBatchActiveStages(state *cloudAgentRuntime) []string {
	var ids []string
	for _, item := range state.Plan {
		if item.Status == "doing" {
			if len(ids) != 0 {
				// Multiple active stages may own different batches; the model must
				// reconcile those explicitly rather than completing unrelated work.
				return nil
			}
			ids = append(ids, item.ID)
		}
	}
	return ids
}

func cloudAgentBatchRecordCompleted(state *cloudAgentRuntime, runID string, batch *cloudAgentCommerceBatch, results []map[string]any) {
	for _, result := range results {
		id := stringValue(result["taskId"])
		status := model.TaskStatus(stringValue(result["status"]))
		if !cloudAgentTaskTerminal(status) || cloudAgentContainsString(batch.CompletedTaskIDs, id) {
			continue
		}
		batch.CompletedTaskIDs = append(batch.CompletedTaskIDs, id)
		state.event(runID, "generation_task_completed", result)
	}
}

func cloudAgentBatchFinishStages(state *cloudAgentRuntime, runID string, batch *cloudAgentCommerceBatch, allSucceeded bool) {
	status := "pending"
	if allSucceeded {
		status = "done"
	}
	changed := false
	for i := range state.Plan {
		if cloudAgentContainsString(batch.PlanItemIDs, state.Plan[i].ID) && state.Plan[i].Status != status {
			state.Plan[i].Status = status
			changed = true
		}
	}
	if changed {
		state.event(runID, "plan_updated", map[string]any{"items": state.Plan, "pendingTitles": cloudAgentPendingPlanItems(state.Plan)})
	}
}
