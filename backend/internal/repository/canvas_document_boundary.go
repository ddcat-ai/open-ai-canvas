package repository

import (
	"encoding/json"
	"errors"

	canvasdoc "yingce/backend/internal/canvas/document"
	"yingce/backend/internal/model"
)

func canonicalizeCreationCanvasBaseline(run *model.CreationRun) error {
	canonical, changed, err := canvasdoc.Canonicalize([]byte(run.ApprovedCanvasJSON))
	if err != nil {
		return err
	}
	if changed {
		run.ApprovedCanvasJSON = string(canonical)
	}
	return nil
}

func canonicalizeCanvasUndoSnapshot(mutation *model.CloudAgentCanvasMutation) error {
	canonical, changed, err := canvasdoc.Canonicalize([]byte(mutation.BeforeJSON))
	if err != nil || !changed {
		return err
	}
	var before, after map[string]any
	if err := json.Unmarshal([]byte(mutation.BeforeJSON), &before); err != nil {
		return err
	}
	if canvasdoc.SnapshotHash(before) != mutation.BeforeSnapshotHash {
		return errors.New("Agent 撤销快照哈希不匹配")
	}
	if err := json.Unmarshal(canonical, &after); err != nil {
		return err
	}
	mutation.BeforeJSON = string(canonical)
	mutation.BeforeSnapshotHash = canvasdoc.SnapshotHash(after)
	// New writes must originate from canonical documents. An incoming old
	// preimage alone cannot prove the canonical postimage's undo hash.
	if mutation.Status == "applied" {
		mutation.Status = "not_undoable"
	}
	return nil
}
