package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

type cloudAgentModelReceiptKey struct{}

func cloudAgentModelReceipt(userID, runID, key string, messages []map[string]any, thinking string) (*model.CloudAgentReceipt, error) {
	stable := make([]map[string]any, len(messages))
	for i, message := range messages {
		stable[i] = make(map[string]any, len(message))
		for k, v := range message {
			if k != "timestamp" {
				stable[i][k] = v
			}
		}
	}
	raw, err := json.Marshal(map[string]any{"messages": stable, "thinking": thinking})
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(raw)
	return &model.CloudAgentReceipt{RunID: runID, UserID: userID, Kind: "model_step", OperationKey: key, Name: cloudAgentStepOperation, InputSHA256: hex.EncodeToString(hash[:]), Status: "pending"}, nil
}

var errCloudAgentReceiptReplay = errors.New("Agent operation already committed")

func cloudAgentCallDigest(call cloudAgentCall) (string, error) {
	var args any
	decoder := json.NewDecoder(strings.NewReader(call.Function.Arguments))
	decoder.UseNumber()
	if err := decoder.Decode(&args); err != nil {
		return "", err
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return "", BadAuthRequest("工具参数必须是单个 JSON 值")
	}
	raw, err := json.Marshal(args)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(append([]byte(call.Function.Name+"\x00"), raw...))
	return hex.EncodeToString(hash[:]), nil
}

func (s *Service) prepareCloudAgentWriteReceipt(run *model.CloudAgentExecution, call cloudAgentCall) (*model.CloudAgentReceipt, error) {
	digest, err := cloudAgentCallDigest(call)
	if err != nil {
		return nil, err
	}
	if call.ID == "" || len(call.ID) > 160 {
		return nil, BadAuthRequest("工具调用缺少有效的固定标识")
	}
	var receipt *model.CloudAgentReceipt
	err = s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		var lookupErr error
		receipt, lookupErr = repo.CloudAgentReceipt(run.UserID, run.ID, "tool", call.ID)
		if lookupErr == nil {
			if receipt.Name != call.Function.Name || receipt.InputSHA256 != digest {
				return NewAppError(409, "同一工具调用标识不能用于不同参数")
			}
			return nil
		}
		if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			return lookupErr
		}
		state, err := cloudAgentDecode(current)
		if err != nil {
			return err
		}
		if cloudAgentRunTerminal(current.Status) || state.Approval != nil || state.MediaTaskID != "" {
			return NewAppError(409, "Agent 仍有待处理操作")
		}
		if state.CallIndex < len(state.Calls) {
			return NewAppError(409, "上一工具调用尚未完成")
		}
		// Old in-flight writes have no durable receipt. Do not silently execute them again.
		for _, pending := range state.Calls {
			if pending.ID == call.ID {
				return NewAppError(409, "旧工具调用缺少执行回执，需要核对后再继续")
			}
		}
		if _, ok := cloudAgentToolMessage(&state, call.ID); ok {
			return NewAppError(409, "旧工具调用缺少执行回执，需要核对后再继续")
		}
		state.Calls, state.CallIndex = []cloudAgentCall{call}, 0
		receipt = &model.CloudAgentReceipt{RunID: run.ID, UserID: run.UserID, Kind: "tool", OperationKey: call.ID, Name: call.Function.Name, InputSHA256: digest, Status: "pending"}
		if err := repo.SaveCloudAgentReceipt(receipt); err != nil {
			return err
		}
		return cloudAgentSave(current, &state)
	})
	return receipt, err
}

// The run CAS serializes the effect and its receipt, including approval and media settlement.
func (s *Service) mutateCloudAgentTool(run *model.CloudAgentExecution, state *cloudAgentRuntime, fn func(*model.CloudAgentExecution, *repository.Repository) error) error {
	var call cloudAgentCall
	if state.CallIndex >= 0 && state.CallIndex < len(state.Calls) {
		call = state.Calls[state.CallIndex]
	}
	return s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		if state.ModelReceipt != nil {
			_, err := repo.CloudAgentReceipt(run.UserID, run.ID, "model_step", state.ModelReceipt.OperationKey)
			if err == nil {
				return repository.ErrCreationConflict
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
		var receipt *model.CloudAgentReceipt
		if cloudAgentWrite(call.Function.Name) {
			var err error
			receipt, err = repo.CloudAgentReceipt(run.UserID, run.ID, "tool", call.ID)
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if errors.Is(err, gorm.ErrRecordNotFound) {
				receipt = nil
				if run.ExecutionFence != nil && state.MediaTaskID == "" {
					return NewAppError(409, "旧写入缺少执行回执，需要核对后再继续")
				}
			}
			if receipt != nil && receipt.Status == "committed" {
				return errCloudAgentReceiptReplay
			}
			if receipt != nil && (receipt.Status != "pending" || receipt.Name != call.Function.Name) {
				return NewAppError(409, "工具执行状态需要核对")
			}
		}
		if err := fn(current, repo); err != nil {
			return err
		}
		if state.ModelReceipt != nil {
			state.ModelReceipt.TaskID = state.ActiveTaskID
			if state.ModelReceipt.TaskID == "" {
				return fmt.Errorf("model admission has no task")
			}
			if err := repo.SaveCloudAgentReceipt(state.ModelReceipt); err != nil {
				return err
			}
		}
		if receipt == nil {
			return nil
		}
		if content, ok := cloudAgentToolMessage(state, call.ID); ok {
			receipt.Content, receipt.IsError, receipt.Status = content, cloudAgentToolContentIsError(content), "committed"
		} else if state.MediaTaskID != "" {
			receipt.TaskID = state.MediaTaskID
		}
		if receipt.TaskID != "" {
			unknown, err := cloudAgentTaskSubmissionUnknown(repo, receipt.TaskID)
			if err != nil {
				return err
			}
			if unknown {
				receipt.Status = "unknown"
			}
		}
		return repo.SaveCloudAgentReceipt(receipt)
	})
}

func cloudAgentReceiptResponse(receipt *model.CloudAgentReceipt) (any, error) {
	if receipt.Status != "committed" {
		return nil, fmt.Errorf("Agent operation has no committed receipt")
	}
	return map[string]any{"content": receipt.Content, "isError": receipt.IsError}, nil
}

func cloudAgentTaskSubmissionUnknown(repo *repository.Repository, taskID string) (bool, error) {
	task, err := repo.Task(taskID)
	if err != nil {
		return false, err
	}
	if task.Status != model.TaskStatusFailed || task.ProviderRequestID != "" {
		return false, nil
	}
	attempt, err := repo.LatestRouteAttempt(taskID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return attempt.DispatchState == "submission_unknown" && attempt.ProviderRequestID == "", nil
}

func (s *Service) markCloudAgentModelReceiptUnknown(ctx context.Context, userID, runID string, receipt *model.CloudAgentReceipt) error {
	if receipt == nil {
		return nil
	}
	for i := 0; i < 8; i++ {
		run, err := s.ownedCloudAgent(ctx, userID, runID)
		if err != nil {
			return err
		}
		err = s.repo.MutateCloudAgentRun(run, func(_ *model.CloudAgentExecution, repo *repository.Repository) error {
			stored, err := repo.CloudAgentReceipt(userID, runID, "model_step", receipt.OperationKey)
			if err != nil {
				return err
			}
			unknown, err := cloudAgentTaskSubmissionUnknown(repo, stored.TaskID)
			if err != nil {
				return err
			}
			if unknown {
				stored.Status = "unknown"
				return repo.SaveCloudAgentReceipt(stored)
			}
			return nil
		})
		if !errors.Is(err, repository.ErrCreationConflict) {
			return err
		}
	}
	return repository.ErrCreationConflict
}
