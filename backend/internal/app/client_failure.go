package app

import (
	"encoding/json"
	"errors"
	"regexp"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

type ClientFailureFrame struct {
	File   string `json:"file"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
}

type ClientFailureInput struct {
	EventID     string               `json:"eventId"`
	RunID       string               `json:"runId,omitempty"`
	StepID      string               `json:"stepId,omitempty"`
	Code        string               `json:"code"`
	Phase       string               `json:"phase"`
	BuildCommit string               `json:"buildCommit"`
	HTTPStatus  int                  `json:"httpStatus,omitempty"`
	Epoch       int64                `json:"epoch,omitempty"`
	OccurredAt  time.Time            `json:"occurredAt"`
	Frames      []ClientFailureFrame `json:"frames"`
}

var clientFailureFile = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,160}\.(js|mjs|ts|tsx)$`)
var clientFailureBuild = regexp.MustCompile(`^(unknown|dev|[a-fA-F0-9]{7,64})$`)

func (s *Service) ReportClientFailures(userID string, input []ClientFailureInput) ([]string, error) {
	if userID == "" {
		return nil, BadAuthRequest("需要用户身份")
	}
	if len(input) == 0 || len(input) > 20 {
		return nil, BadAuthRequest("失败日志每批需为 1–20 条")
	}
	events := make([]model.ClientFailure, 0, len(input))
	for _, event := range input {
		if err := validateCloudAgentID(event.EventID, "事件 ID", 96); err != nil {
			return nil, err
		}
		if event.RunID != "" {
			if _, err := s.repo.CloudAgent(userID, event.RunID); err != nil {
				// A deleted or foreign run is never attributed; valid events in this batch still persist.
				if errors.Is(err, gorm.ErrRecordNotFound) {
					continue
				}
				return nil, err
			}
		}
		if event.StepID != "" {
			if err := validateCloudAgentID(event.StepID, "步骤 ID", 160); err != nil {
				return nil, err
			}
		}
		switch event.Code {
		case "worker_load_failed", "worker_crashed", "worker_message_failed", "worker_unhandled", "runtime_request_failed", "runtime_protocol_mismatch":
		default:
			return nil, BadAuthRequest("客户端失败代码无效")
		}
		switch event.Phase {
		case "startup", "claim", "state", "step", "heartbeat", "worker":
		default:
			return nil, BadAuthRequest("客户端失败阶段无效")
		}
		if !clientFailureBuild.MatchString(event.BuildCommit) || event.HTTPStatus < 0 || event.HTTPStatus > 599 || event.Epoch < 0 || len(event.Frames) > 8 || event.OccurredAt.Before(time.Now().Add(-24*time.Hour)) || event.OccurredAt.After(time.Now().Add(5*time.Minute)) {
			return nil, BadAuthRequest("客户端失败元数据无效")
		}
		for _, frame := range event.Frames {
			if !clientFailureFile.MatchString(frame.File) || frame.Line < 0 || frame.Line > 10000000 || frame.Column < 0 || frame.Column > 10000000 {
				return nil, BadAuthRequest("客户端失败堆栈无效")
			}
		}
		frames, _ := json.Marshal(event.Frames)
		events = append(events, model.ClientFailure{UserID: userID, EventID: event.EventID, RunID: event.RunID, StepID: event.StepID, Code: event.Code, Phase: event.Phase, BuildCommit: event.BuildCommit, HTTPStatus: event.HTTPStatus, Epoch: event.Epoch, OccurredAt: event.OccurredAt.UTC().Truncate(time.Millisecond), FramesJSON: string(frames)})
	}
	return s.repo.SaveClientFailures(userID, events)
}

func (s *Service) OwnClientFailures(userID, runID string) ([]model.ClientFailure, error) {
	if userID == "" {
		return nil, BadAuthRequest("需要用户身份")
	}
	return s.repo.ClientFailures(userID, runID)
}

func (s *Service) AdminClientFailures(actor *model.User, userID, runID string) ([]model.ClientFailure, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.repo.ClientFailures(userID, runID)
}
