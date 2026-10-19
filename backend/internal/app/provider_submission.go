package app

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

type providerSubmissionKeyContext struct{}

func withProviderSubmissionKey(ctx context.Context, attempt *model.RouteAttempt) context.Context {
	if attempt == nil {
		return ctx
	}
	// Stable for this persisted attempt across worker/process recovery; an
	// explicitly new user retry or a safely rejected route gets a new attempt.
	key := uuid.NewSHA1(uuid.NameSpaceOID, []byte(attempt.TaskID+":"+attempt.ID)).String()
	return context.WithValue(ctx, providerSubmissionKeyContext{}, key)
}

func (s *Service) createDirectTaskAttempt(task *model.Task) (*model.RouteAttempt, error) {
	attempts, err := s.repo.RouteAttempts(task.ID, task.RouteRun)
	if err != nil {
		return nil, err
	}
	if task.Attempts > 1 && task.ProviderRequestID == "" && (len(attempts) == 0 || attempts[len(attempts)-1].DispatchState != "rejected_no_job") {
		return nil, routeDispatchUncertainError{"旧任务已尝试执行但缺少提交记录，为避免重复扣费已停止自动重发"}
	}
	id, err := s.repo.NextPrefixedID("ATTEMPT")
	if err != nil {
		return nil, err
	}
	attempt := &model.RouteAttempt{ID: id, TaskID: task.ID, RouteRun: task.RouteRun, AttemptNumber: len(attempts) + 1, ChannelModelID: task.ChannelModelID, Status: "selected", DispatchState: "not_sent", StartedAt: time.Now()}
	attempt.RouteID = task.RouteID
	if task.InputJSON != "" {
		raw, err := s.decryptTaskInputJSON(task.InputJSON)
		if err != nil {
			return nil, err
		}
		var input map[string]any
		if err := json.Unmarshal([]byte(raw), &input); err != nil {
			return nil, err
		}
		config, _ := input["config"].(map[string]any)
		attempt.ChannelID = stringValue(config["channelId"])
		if attempt.ChannelModelID == "" && attempt.ChannelID != "" {
			selected, err := s.repo.ChannelModelByKeyIncludingDisabled(attempt.ChannelID, firstNonEmpty(stringValue(config["channelModelKey"]), stringValue(config["model"])))
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, err
			}
			if selected != nil {
				attempt.ChannelModelID = selected.ID
			}
		}
	}
	if task.ProviderRequestID != "" {
		attempt.ProviderRequestID, attempt.DispatchState = task.ProviderRequestID, "accepted"
	}
	if err := s.repo.CreateRouteAttempt(attempt); err != nil {
		return nil, err
	}
	return attempt, nil
}
