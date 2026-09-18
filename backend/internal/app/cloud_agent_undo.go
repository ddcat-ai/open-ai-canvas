package app

import (
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// UndoCloudAgentCanvas restores only the latest Agent canvas mutation. It is
// deliberately optimistic: the caller must prove that the canvas still has
// the snapshot produced by that mutation. Submitted generation tasks are never
// undone, cancelled, or refunded by this method.
func (s *Service) UndoCloudAgentCanvas(userID, runID, stepID, expectedSnapshotHash, reason string) (map[string]any, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(runID) == "" {
		return nil, Unauthorized("请先登录")
	}
	expectedSnapshotHash = strings.TrimSpace(expectedSnapshotHash)
	if len(expectedSnapshotHash) != 64 {
		return nil, BadAuthRequest("需要有效的画布快照哈希")
	}
	if _, err := hex.DecodeString(expectedSnapshotHash); err != nil {
		return nil, BadAuthRequest("需要有效的画布快照哈希")
	}
	stepID = strings.TrimSpace(stepID)
	if len(stepID) > 160 {
		return nil, BadAuthRequest("Agent 操作 ID 过长")
	}
	if len([]rune(reason)) > 2000 {
		return nil, BadAuthRequest("撤销理由过长")
	}

	s.storageMu.Lock()
	defer s.storageMu.Unlock()

	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("Agent 运行不存在")
		}
		return nil, err
	}
	result := map[string]any{"accepted": false}
	err = s.repo.MutateCloudAgent(userID, runID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		mutation, err := repo.LatestCloudAgentCanvasMutation(userID, runID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return NotFound("当前 Agent 运行没有可撤销的画布变更")
			}
			return err
		}
		if stepID != "" && mutation.StepID != stepID {
			return creationConflict("待撤销的 Agent 操作已不是当前运行的最新变更")
		}

		canvas, err := repo.CanvasProjectForUser(userID, mutation.CanvasID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return NotFound("画布不存在或无权访问")
			}
			return err
		}
		currentDoc, err := creationDocument(canvas.PayloadJSON)
		if err != nil {
			return err
		}
		currentHash := cloudAgentCanvasHash(currentDoc)
		if mutation.Status == "undone" {
			if currentHash == mutation.BeforeSnapshotHash && expectedSnapshotHash == currentHash {
				result = map[string]any{"accepted": true, "snapshotHash": currentHash}
				return nil
			}
			return creationConflict("该 Agent 变更已经撤销，但画布之后又发生了变化")
		}
		if mutation.Status == "not_undoable" {
			return BadAuthRequest("该 Agent 画布变更未保留完整快照，无法撤销")
		}
		if mutation.Status != "applied" {
			return creationConflict("该 Agent 变更当前不可撤销")
		}
		if mutation.HasSubmittedTask {
			return BadAuthRequest("已提交的生成任务不能撤销；任务不会取消或退款")
		}
		if expectedSnapshotHash != currentHash || mutation.AfterSnapshotHash != currentHash {
			return creationConflict("画布已发生后续变化，未执行撤销")
		}
		if mutation.BeforeJSON == "" {
			return BadAuthRequest("该 Agent 画布变更未保留可撤销快照")
		}
		beforeDoc, err := creationDocument(mutation.BeforeJSON)
		if err != nil {
			return BadAuthRequest("该 Agent 画布变更的撤销快照无效")
		}
		if cloudAgentCanvasHash(beforeDoc) != mutation.BeforeSnapshotHash {
			return BadAuthRequest("该 Agent 画布变更的撤销快照校验失败")
		}
		previous := canvas.PayloadJSON
		canvas.PayloadJSON = mutation.BeforeJSON
		if err := saveCreationCanvasWithHistory(repo, canvas, previous); err != nil {
			if errors.Is(err, repository.ErrCreationConflict) {
				return creationConflict("画布已发生后续变化，未执行撤销")
			}
			return err
		}
		if err := repo.MarkCloudAgentCanvasMutationUndone(userID, runID, mutation.ID, time.Now().UTC()); err != nil {
			if errors.Is(err, repository.ErrCreationConflict) {
				return creationConflict("该 Agent 变更已经被处理，请重新读取画布")
			}
			return err
		}
		state, err := cloudAgentDecode(current)
		if err != nil {
			return err
		}
		state.event(runID, "canvas_undone", map[string]any{
			"canvasId":     mutation.CanvasID,
			"stepId":       mutation.StepID,
			"snapshotHash": mutation.BeforeSnapshotHash,
			"reason":       strings.TrimSpace(reason),
		})
		if err := cloudAgentSave(current, &state); err != nil {
			return err
		}
		result = map[string]any{"accepted": true, "snapshotHash": mutation.BeforeSnapshotHash}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}
