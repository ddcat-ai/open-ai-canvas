package app

import (
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// cloudAgentStepTimeoutError 是一次画布 Agent 模型调用被单步墙钟掐断时写进任务错误的标记。
// 秒级超时（策略 AgentStepTimeoutSeconds）与文本任务超时都会走到这里，运行期按这个标记
// 把它当成"可恢复失败"处理，而不是整轮判死。
const cloudAgentStepTimeoutError = "画布 Agent 单步模型调用超时"

// cloudAgentMaxStepTimeoutEscalations 是单步超时的重试次数：超时几乎总是思考阶段在长时间
// 无输出，因此重试的手段是关掉思考（更省时的路径），只给一次机会。
const cloudAgentMaxStepTimeoutEscalations = 1

// cloudAgentModelOperation 判断任务是不是"画布 Agent 的一次模型调用"：根任务（第一步）、
// 后续每一步、以及上下文压缩调用都属于同一类，都要按单步口径计时（压缩调用同样可能
// 卡在长时间无输出上，不能没有墙钟）。
func cloudAgentModelOperation(task *model.Task) bool {
	if task == nil {
		return false
	}
	switch task.Operation {
	case cloudAgentOperation, cloudAgentStepOperation, cloudAgentContextCompactionOperation:
		return true
	default:
		return false
	}
}

// cloudAgentStepTimedOut 判断这一步是不是被单步墙钟中止的。
func cloudAgentStepTimedOut(task *model.Task) bool {
	if task == nil || task.Status == model.TaskStatusSucceeded {
		return false
	}
	return strings.Contains(task.Error, cloudAgentStepTimeoutError)
}

// correctCloudAgentStepTimeout 是单步超时的兜底：关掉上游思考并重发同一步。
// 超时不改输出预算——墙钟是这一档的约束，放大预算只会让重试更容易再次撞上墙钟。
func (s *Service) correctCloudAgentStepTimeout(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		state.StepTimeoutEscalated++
		state.ForceThinkingOff = true
		state.BoostStepOutputBudget = false
		state.ActiveTaskID = ""
		state.Calls = nil
		state.CallIndex = 0
		state.event(run.ID, "model_failure_recovered", map[string]any{
			"reason": "step_timeout_retried",
			"text":   "上一步模型调用超时；已关闭思考重试同一步",
		})
		return cloudAgentSave(current, state)
	})
}
