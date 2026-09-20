package app

import (
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func cloudAgentOutputViolation(text string, callCount int) string {
	if len(text) > cloudAgentMaxOutputBytes {
		return fmt.Sprintf("正文 %d 字节，超过单步 %d 字节上限", len(text), cloudAgentMaxOutputBytes)
	}
	if callCount > cloudAgentMaxToolCalls {
		return fmt.Sprintf("一次发起了 %d 个工具调用，超过单步 %d 个上限", callCount, cloudAgentMaxToolCalls)
	}
	return ""
}

func (s *Service) correctCloudAgentOutput(run *model.CloudAgentExecution, state *cloudAgentRuntime, violation string) error {
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		state.Canonical.Messages = append(state.Canonical.Messages, cloudAgentRuntimeMessage(cloudAgentRuntimeContext{
			Kind: cloudAgentContextInvalidOutput, Detail: violation,
			MaxOutputBytes: cloudAgentMaxOutputBytes, MaxToolCalls: cloudAgentMaxToolCalls,
		}))
		state.ActiveTaskID = ""
		state.Calls = nil
		state.CallIndex = 0
		return cloudAgentSave(current, state)
	})
}

func cloudAgentTruncatedToolArguments(task *model.Task) bool {
	if task == nil {
		return false
	}
	return strings.Contains(task.Error, "工具参数不是完整 JSON")
}

func (s *Service) correctCloudAgentTruncatedCalls(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		state.Canonical.Messages = append(state.Canonical.Messages, cloudAgentRuntimeMessage(cloudAgentRuntimeContext{Kind: cloudAgentContextTruncatedArguments}))
		state.ActiveTaskID = ""
		state.Calls = nil
		state.CallIndex = 0
		return cloudAgentSave(current, state)
	})
}
