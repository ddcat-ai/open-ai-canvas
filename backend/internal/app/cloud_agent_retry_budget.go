package app

import (
	"encoding/json"
	"math"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// Only immutable retry lineage and billed task identities are needed here; the
// historical tool state is not being resumed or granted a new authorization.
type cloudAgentBudgetRecord struct {
	Request          CloudAgentRequest `json:"request"`
	TaskIDs          []string          `json:"taskIds"`
	RetryBudgetRunID string            `json:"retryBudgetRunId,omitempty"`
}

func (s *Service) cloudAgentRemainingBudget(userID string, state *cloudAgentRuntime) (int64, error) {
	return cloudAgentRemainingBudget(s.repo, userID, state)
}

func cloudAgentBudgetSource(request CloudAgentRequest, source string) string {
	if request.Retry != nil {
		return request.Retry.RunID
	}
	return source
}

func cloudAgentBudgetLineage(repo *repository.Repository, userID, sessionID string) (map[string]cloudAgentBudgetRecord, map[string]string, error) {
	if sessionID == "" {
		return nil, nil, BadAuthRequest("无法确认重试所属会话和原始预算")
	}
	records := map[string]cloudAgentBudgetRecord{}
	cursor := ""
	for {
		runs, err := repo.CloudAgentBudgetRecordsBySession(userID, sessionID, 500, cursor)
		if err != nil {
			return nil, nil, err
		}
		for _, run := range runs {
			var record cloudAgentBudgetRecord
			if err := json.Unmarshal([]byte(run.StateJSON), &record); err != nil {
				return nil, nil, err
			}
			if record.Request.Surface != "creation" || record.Request.SessionID != sessionID {
				return nil, nil, creationConflict("原会话预算记录与运行归属不一致")
			}
			records[run.ID] = record
		}
		if len(runs) < 500 {
			break
		}
		cursor = runs[len(runs)-1].ID
	}
	roots := map[string]string{}
	for start := range records {
		id, root := start, ""
		seen := map[string]bool{}
		trail := []string{}
		for {
			if known := roots[id]; known != "" {
				root = known
				break
			}
			record, ok := records[id]
			if !ok || seen[id] {
				return nil, nil, creationConflict("原始重试预算记录缺失或重试链无效，不能重新授予预算")
			}
			seen[id], trail = true, append(trail, id)
			source := cloudAgentBudgetSource(record.Request, record.RetryBudgetRunID)
			if source == "" {
				root = id
				break
			}
			id = source
		}
		for _, id := range trail {
			roots[id] = root
		}
	}
	return records, roots, nil
}

// A model-supplied retry ID can only bind the existing source allowance after
// ownership and failure admission have been checked. It never edits the request.
func (s *Service) bindCloudAgentRetryBudget(userID string, state *cloudAgentRuntime, task *model.Task) error {
	if task == nil || task.UserID != userID || state.Request.Surface != "creation" || state.Request.SessionID == "" {
		return BadAuthRequest("失败任务缺少有效的原始预算来源")
	}
	var input struct {
		Metadata struct {
			RunID string `json:"agentRunId"`
		} `json:"metadata"`
	}
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return err
	}
	source := firstNonEmpty(task.AgentRunID, input.Metadata.RunID)
	if source == "" || task.AgentRunID != "" && input.Metadata.RunID != "" && task.AgentRunID != input.Metadata.RunID {
		return BadAuthRequest("失败任务的预算来源不一致")
	}
	if source == state.RuntimeRunID {
		return nil
	}
	_, roots, err := cloudAgentBudgetLineage(s.repo, userID, state.Request.SessionID)
	if err != nil {
		return err
	}
	if roots[source] == "" {
		return creationConflict("失败任务不属于当前会话的原始预算")
	}
	if existing := cloudAgentBudgetSource(state.Request, state.RetryBudgetRunID); existing != "" && roots[existing] != roots[source] {
		return creationConflict("本轮重试不能切换到另一份原始预算")
	}
	state.RetryBudgetRunID = source
	return nil
}

func cloudAgentRemainingBudget(repo *repository.Repository, userID string, state *cloudAgentRuntime) (int64, error) {
	if state == nil || userID == "" {
		return 0, BadAuthRequest("缺少有效的 Agent 预算记录")
	}
	limit := state.Request.Budget.MaxCredits
	tasks := map[string]bool{}
	addTasks := func(ids []string) {
		for _, id := range ids {
			if id != "" {
				tasks[id] = true
			}
		}
	}
	addTasks(state.TaskIDs)
	if source := cloudAgentBudgetSource(state.Request, state.RetryBudgetRunID); source != "" || state.Request.Retry != nil {
		if state.Request.Surface != "creation" || state.Request.SessionID == "" || source == "" {
			return 0, BadAuthRequest("无法确认重试所属会话和原始预算")
		}
		records, roots, err := cloudAgentBudgetLineage(repo, userID, state.Request.SessionID)
		if err != nil {
			return 0, err
		}
		original := roots[source]
		if original == "" {
			return 0, creationConflict("原始重试预算记录缺失，不能重新授予预算")
		}
		limit = math.Min(limit, records[original].Request.Budget.MaxCredits)
		for id, record := range records {
			if roots[id] == original {
				addTasks(record.TaskIDs)
			}
		}
	}
	amount := math.Floor(limit * float64(CreditScale))
	if math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 || amount >= float64(math.MaxInt64) {
		return 0, BadAuthRequest("Agent 预算金额无效")
	}
	remaining := int64(amount)
	ids := make([]string, 0, len(tasks))
	for id := range tasks {
		ids = append(ids, id)
	}
	for offset := 0; offset < len(ids); offset += 500 {
		orders, err := repo.BillingOrdersByTaskIDs(userID, ids[offset:min(offset+500, len(ids))])
		if err != nil {
			return 0, err
		}
		for _, order := range orders {
			cost := max(order.AmountMicrocredits, order.ReservedAmountMicrocredits, order.ActualAmountMicrocredits)
			switch order.Status {
			case model.BillingStatusRefunded:
				cost = 0
			case model.BillingStatusSettled:
				cost = order.ActualAmountMicrocredits
			}
			if cost < 0 {
				return 0, creationConflict("原任务账单金额无效，不能重新授予预算")
			}
			if cost > remaining {
				return -1, nil
			}
			remaining -= cost
		}
	}
	return remaining, nil
}
