package app

import (
	"time"

	agenttool "yingce/backend/internal/agent/tool"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const cloudAgentMutationSnapshotLimit = 1 << 20

type cloudAgentMutationInput struct {
	RunID              string
	UserID             string
	CanvasID           string
	StepID             string
	Operation          string
	BeforeSnapshotHash string
	AfterSnapshotHash  string
	BeforeJSON         string
	HasSubmittedTask   bool
	Preview            *cloudAgentApprovalPreview
}

func cloudAgentMutationRecorderForRun(runID string) cloudAgentMutationRecorder {
	return func(repo *repository.Repository, input cloudAgentMutationInput) error {
		input.RunID = runID
		return recordCloudAgentCanvasMutation(repo, input)
	}
}

type cloudAgentCanvasUndoReceipt struct {
	RunID                string `json:"runId"`
	CanvasID             string `json:"canvasId"`
	StepID               string `json:"stepId"`
	ExpectedSnapshotHash string `json:"expectedSnapshotHash"`
}

func cloudAgentUndoReceipt(runID string, input cloudAgentMutationInput) *cloudAgentCanvasUndoReceipt {
	policy, known := agenttool.Get(input.Operation)
	if !known || !policy.Write() || policy.Media() || input.HasSubmittedTask ||
		input.BeforeJSON == "" || len(input.BeforeJSON) > cloudAgentMutationSnapshotLimit ||
		input.BeforeSnapshotHash == input.AfterSnapshotHash {
		return nil
	}
	return &cloudAgentCanvasUndoReceipt{RunID: runID, CanvasID: input.CanvasID, StepID: input.StepID, ExpectedSnapshotHash: input.AfterSnapshotHash}
}

type cloudAgentMutationRecorder func(*repository.Repository, cloudAgentMutationInput) error

func recordCloudAgentCanvasMutation(repo *repository.Repository, input cloudAgentMutationInput) error {
	if input.RunID == "" || input.UserID == "" || input.CanvasID == "" || input.StepID == "" || input.Operation == "" {
		return BadAuthRequest("画布变更缺少可追踪的 Agent 操作信息")
	}
	if input.BeforeSnapshotHash == "" || input.AfterSnapshotHash == "" {
		return BadAuthRequest("画布变更缺少有效快照")
	}
	mutation := &model.CloudAgentCanvasMutation{
		ID:                 newID(),
		RunID:              input.RunID,
		UserID:             input.UserID,
		CanvasID:           input.CanvasID,
		StepID:             input.StepID,
		Operation:          input.Operation,
		BeforeSnapshotHash: input.BeforeSnapshotHash,
		AfterSnapshotHash:  input.AfterSnapshotHash,
		HasSubmittedTask:   input.HasSubmittedTask,
		Status:             "applied",
		CreatedAt:          time.Now().UTC(),
	}
	if len(input.BeforeJSON) <= cloudAgentMutationSnapshotLimit {
		mutation.BeforeJSON = input.BeforeJSON
	} else {
		mutation.Status = "not_undoable"
	}
	return repo.CreateCloudAgentCanvasMutation(mutation)
}
