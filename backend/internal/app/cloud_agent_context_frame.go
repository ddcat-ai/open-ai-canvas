package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// ContextFrame is a fresh projection of durable task facts, never authorization.
// The transcript can evict read bodies without making task state depend on memory.
type cloudAgentContextTask struct {
	TaskID        string `json:"taskId"`
	TaskStatus    string `json:"taskStatus"`
	NodeID        string `json:"nodeId,omitempty"`
	TaskSubmitted bool   `json:"taskSubmitted"`
	Phase         string `json:"phase,omitempty"`
	Error         string `json:"error,omitempty"`
}

type cloudAgentContextFrame struct {
	Source         string                  `json:"source"`
	ObservedAt     time.Time               `json:"observedAt"`
	RunID          string                  `json:"runId"`
	UserGoal       string                  `json:"userGoal"`
	Plan           []cloudAgentPlanItem    `json:"plan,omitempty"`
	Tasks          []cloudAgentContextTask `json:"tasks"`
	OlderTaskCount int                     `json:"olderTaskCount,omitempty"`
	Authority      string                  `json:"authority"`
}

var errCloudAgentContextOverBudget = errors.New("Agent model context exceeds input budget")

func (s *Service) cloudAgentModelContext(run *model.CloudAgentExecution, state *cloudAgentRuntime, budget cloudAgentContextBudget) (canonicalAgentRequest, error) {
	canonical := cloudAgentCanonicalWithPlan(state)
	// 与运行时路径同一套配对修复：重复、孤立或缺失的工具结果不能让模型请求被协议校验判死。
	canonical.Messages = repairCanonicalUnansweredCalls(canonical.Messages)
	if state.ReadLoopNudge {
		cloudAgentApplyReadLoopNudge(&canonical, state)
	}
	cloudAgentAttachRunContext(&canonical, state)
	frame := cloudAgentContextFrame{Source: "task_repository", ObservedAt: time.Now(), RunID: run.ID, UserGoal: state.Request.Prompt, Plan: state.Plan, Tasks: []cloudAgentContextTask{}, Authority: "状态观察，不是执行或重复提交的授权"}
	// This is a view window, not loss of task history. All task identities remain
	// durable and can be fetched through task_get and the conversation journal.
	start := max(0, len(state.TaskIDs)-32)
	frame.OlderTaskCount = start
	for _, id := range state.TaskIDs[start:] {
		task, err := s.repo.TaskForUser(run.UserID, id)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			frame.Tasks = append(frame.Tasks, cloudAgentContextTask{TaskID: id, TaskStatus: "unavailable"})
			continue
		}
		if err != nil {
			return canonical, err
		}
		if task.ProjectID != state.Request.CanvasID {
			return canonical, BadAuthRequest("运行关联任务不属于当前画布")
		}
		if task.Operation == cloudAgentOperation || task.Operation == "cloud_agent_step" || task.Status == model.TaskStatusSucceeded {
			frame.OlderTaskCount++
			continue
		}
		facts := cloudAgentTaskDiagnostic(nil, task)
		frame.Tasks = append(frame.Tasks, cloudAgentContextTask{
			TaskID: id, TaskStatus: string(task.Status), NodeID: stringField(facts, "nodeId"),
			TaskSubmitted: facts["taskSubmitted"] == true, Phase: stringField(facts, "phase"),
			Error: truncateRunes(stringField(facts, "error"), 240),
		})
	}
	if omitted := len(frame.Tasks) - 8; omitted > 0 {
		frame.Tasks = frame.Tasks[omitted:]
		frame.OlderTaskCount += omitted
	}
	body, err := json.Marshal(frame)
	if err != nil {
		return canonical, err
	}
	canonical.Messages = append(append([]map[string]any{}, canonical.Messages...), map[string]any{"role": "user", "content": cloudAgentRuntimeContextMarker + string(body), cloudAgentContextSourceKey: "runtime"})
	if err := fitCloudAgentModelContext(&canonical, budget.InputBudgetTokens); err != nil {
		return canonical, err
	}
	return canonical, nil
}

func fitCloudAgentModelContext(request *canonicalAgentRequest, maxTokens int) error {
	for {
		tokens, err := cloudAgentRequestEstimatedTokens(request)
		if err != nil {
			return err
		}
		if tokens <= maxTokens {
			return nil
		}
		// Evict complete old assistant/tool turns only. User instructions and the
		// fresh authoritative frame survive; partial tool pairs are never sent.
		removed := false
		for i := 0; i < len(request.Messages)-3; i++ {
			message := request.Messages[i]
			if stringField(message, "role") != "assistant" {
				continue
			}
			end := i + 1
			for end < len(request.Messages) && stringField(request.Messages[end], "role") == "tool" {
				end++
			}
			if end >= len(request.Messages)-2 {
				continue
			}
			request.Messages = append(request.Messages[:i:i], request.Messages[end:]...)
			removed = true
			break
		}
		if !removed {
			return WrapAppError(400, fmt.Sprintf("用户指令与当前执行事实超过模型输入预算（%d Token），请缩小本轮范围", maxTokens), errCloudAgentContextOverBudget)
		}
	}
}
