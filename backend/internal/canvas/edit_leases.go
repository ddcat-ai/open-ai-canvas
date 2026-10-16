package canvas

import (
	"errors"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type CanvasEditLeaseRequest struct {
	model.CanvasEditProof
	Action string `json:"action"`
}

type CanvasSyncStatus struct {
	Revision   int64                           `json:"revision"`
	ServerTime time.Time                       `json:"serverTime"`
	Leases     []model.CanvasEditLease         `json:"leases"`
	Agent      *repository.CanvasAgentActivity `json:"agent"`
}

func (s *Service) UserCanvasSyncStatus(userID, canvasID string) (CanvasSyncStatus, error) {
	project, err := s.repo.CanvasProjectMetadata(userID, canvasID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return CanvasSyncStatus{}, kernel.NotFound("画布不存在")
	}
	if err != nil {
		return CanvasSyncStatus{}, err
	}
	now := time.Now().UTC()
	leases, err := s.repo.CanvasEditLeases(userID, canvasID, now)
	if err != nil {
		return CanvasSyncStatus{}, err
	}
	agent, err := s.repo.CanvasAgentActivity(userID, canvasID)
	return CanvasSyncStatus{Revision: project.Revision, ServerTime: now, Leases: leases, Agent: agent}, err
}

func (s *Service) ChangeUserCanvasEditLease(userID, canvasID string, req CanvasEditLeaseRequest) (map[string]any, error) {
	if req.NodeID == "" || len(req.NodeID) > 160 || req.SessionID == "" || len(req.SessionID) > 160 || len(req.Token) > 80 {
		return nil, kernel.BadAuthRequest("节点或浏览器标识无效")
	}
	if req.Action != "acquire" && req.Action != "renew" && req.Action != "release" {
		return nil, kernel.BadAuthRequest("编辑租约操作无效")
	}
	var lease *model.CanvasEditLease
	var now time.Time
	err := s.repo.Transaction(func(tx *repository.Repository) error {
		if err := tx.LockCanvasMutation(userID, canvasID); err != nil {
			return err
		}
		_, err := tx.CanvasProjectMetadata(userID, canvasID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return kernel.NotFound("画布不存在")
		}
		if err != nil {
			return err
		}
		// A locally created node may not have been saved yet. The parent canvas
		// establishes ownership; the lease also protects its first publication.
		now = time.Now().UTC()
		lease, err = tx.ChangeCanvasEditLease(userID, canvasID, req.CanvasEditProof, req.Action, kernel.NewID(), now)
		return err
	})
	if errors.Is(err, repository.ErrCanvasEditLease) {
		return nil, canvasMutationError("canvas_edit_lease_conflict", err.Error())
	}
	if err != nil {
		return nil, err
	}
	result := map[string]any{"serverTime": now}
	if lease != nil {
		result["lease"], result["token"] = lease, lease.Token
	}
	return result, nil
}
