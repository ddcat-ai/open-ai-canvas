package canvas

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

const canvasHistoryLimit = 20
const canvasHistoryInterval = 5 * time.Minute

// 浏览器、云端 Agent 和创作任务共用此入口；外层事务仍负责任务和画布的一致性。
func SaveDocumentWithHistory(repo *repository.Repository, before *model.CanvasProject, after *model.CanvasProject, reason string) error {
	snapshot, resourceIDs, err := buildCanvasSnapshot(before, *after, reason)
	if err != nil {
		return err
	}
	var restoredIDs []string
	if reason == "before_restore" {
		refs := map[string]struct{}{}
		if err := assets.CollectOwnedDocumentReferences(after.PayloadJSON, refs); err != nil {
			return err
		}
		restoredIDs = assets.SortedIDs(refs)
	}
	return repo.WithTransaction(func(txRepo *repository.Repository) error {
		if err := grantCanvasDocumentMedia(txRepo, after.UserID, after.ID, after.PayloadJSON); err != nil {
			return err
		}
		return txRepo.SaveCanvasWithSnapshot(after, snapshot, resourceIDs, restoredIDs, after.UpdatedAt.Add(-canvasHistoryInterval), canvasHistoryLimit, reason == "before_restore")
	})
}

func canvasRevisionConflict() error {
	return kernel.NewAppError(http.StatusConflict, "云端画布已有更新，已停止覆盖；请保留本地草稿并加载最新版本")
}

type CanvasHistoryList struct {
	Snapshots       []model.CanvasSnapshot `json:"snapshots"`
	CurrentRevision int64                  `json:"currentRevision"`
}

func (s *Service) scopedCanvasHistoryProject(userID string, canvasID string) (*model.CanvasProject, error) {
	project, err := s.scopedCanvasProject(&model.User{ID: userID}, strings.TrimSpace(canvasID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.NewAppError(http.StatusNotFound, "画布不存在或无权访问")
	}
	if err != nil {
		return nil, err
	}
	return project, nil
}

func (s *Service) CanvasHistory(userID string, canvasID string) (CanvasHistoryList, error) {
	project, err := s.scopedCanvasHistoryProject(userID, canvasID)
	if err != nil {
		return CanvasHistoryList{}, err
	}
	items, err := s.repo.CanvasSnapshots(project.UserID, project.ID, canvasHistoryLimit)
	return CanvasHistoryList{Snapshots: items, CurrentRevision: project.Revision}, err
}

func (s *Service) CanvasHistorySnapshot(userID string, canvasID, snapshotID string) (*model.CanvasSnapshot, error) {
	project, err := s.scopedCanvasHistoryProject(userID, canvasID)
	if err != nil {
		return nil, err
	}
	item, err := s.repo.CanvasSnapshot(project.UserID, project.ID, snapshotID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.NewAppError(http.StatusNotFound, "历史版本不存在或已过期，请刷新历史列表")
	}
	return item, err
}

func (s *Service) RestoreCanvasHistory(userID string, canvasID, snapshotID string, revision *int64) (UserDataSummary, error) {
	if revision == nil {
		return UserDataSummary{}, kernel.NewAppError(http.StatusPreconditionRequired, "请先刷新画布版本再恢复")
	}
	current, err := s.scopedCanvasHistoryProject(userID, canvasID)
	if err != nil {
		return UserDataSummary{}, err
	}
	if current.Revision != *revision {
		return UserDataSummary{}, canvasRevisionConflict()
	}
	if current.CollaborationEnabled {
		result, err := s.ApplyCanvasCollaborationOperation(&model.User{ID: userID}, canvasID, CanvasCollaborationOperationRequest{OpID: kernel.NewID(), Kind: "restore_snapshot", BaseRevision: *revision, SnapshotID: snapshotID})
		if err != nil {
			return UserDataSummary{}, err
		}
		return UserDataSummary{ID: current.ID, Title: current.Title, Revision: result.Revision, CollaborationEnabled: true}, nil
	}
	item, err := s.CanvasHistorySnapshot(userID, canvasID, snapshotID)
	if err != nil {
		return UserDataSummary{}, err
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal([]byte(item.PayloadJSON), &payload); err != nil {
		return UserDataSummary{}, err
	}
	// Restore document content while retaining its present ownership and business association.
	for key, value := range map[string]any{
		"id": current.ID, "revision": *revision, "createdAt": current.CreatedAt,
		"projectId": current.ProjectID,
	} {
		payload[key], _ = json.Marshal(value)
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return UserDataSummary{}, err
	}
	return s.upsertUserCanvasProjectWithHistory(userID, raw, "before_restore")
}

func canvasHistoryContent(project model.CanvasProject) ([]byte, error) {
	raw, err := canvasProjectPayload(project)
	if err != nil {
		return nil, err
	}
	var payload map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		return nil, err
	}
	for _, key := range []string{"revision", "updatedAt", "createdAt", "viewport", "remoteContentHash"} {
		delete(payload, key)
	}
	return json.Marshal(payload)
}

func buildCanvasSnapshot(before *model.CanvasProject, after model.CanvasProject, reason string) (*model.CanvasSnapshot, []string, error) {
	if before == nil {
		return nil, nil, nil
	}
	oldContent, err := canvasHistoryContent(*before)
	if err != nil {
		return nil, nil, err
	}
	newContent, err := canvasHistoryContent(after)
	if err != nil {
		return nil, nil, err
	}
	if reason != "before_restore" && bytes.Equal(oldContent, newContent) {
		return nil, nil, nil
	}
	raw, err := canvasProjectPayload(*before)
	if err != nil {
		return nil, nil, err
	}
	var counts struct {
		Nodes       []json.RawMessage
		Connections []json.RawMessage
	}
	if err := json.Unmarshal(raw, &counts); err != nil {
		return nil, nil, err
	}
	resources := map[string]struct{}{}
	if err := assets.CollectOwnedDocumentReferences(string(raw), resources); err != nil {
		return nil, nil, err
	}
	return &model.CanvasSnapshot{
		ID: kernel.NewID(), CanvasID: before.ID, UserID: before.UserID, Revision: before.Revision,
		Title: before.Title, NodeCount: len(counts.Nodes), ConnectionCount: len(counts.Connections),
		PayloadJSON: string(raw), PayloadBytes: len(raw), Reason: reason,
		ContentUpdatedAt: before.UpdatedAt, CreatedAt: after.UpdatedAt,
	}, assets.SortedIDs(resources), nil
}

// Row metadata is authoritative, including changes made by project association operations.
func canvasProjectPayload(project model.CanvasProject) (json.RawMessage, error) {
	var payload map[string]json.RawMessage
	if err := json.Unmarshal([]byte(project.PayloadJSON), &payload); err != nil {
		return nil, err
	}
	if payload == nil {
		return nil, kernel.BadAuthRequest("画布数据格式错误")
	}
	for key, value := range map[string]any{"id": project.ID, "title": project.Title, "projectId": project.ProjectID, "revision": project.Revision, "collaborationEnabled": project.CollaborationEnabled, "createdAt": project.CreatedAt, "updatedAt": project.UpdatedAt} {
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		payload[key] = encoded
	}
	return json.Marshal(payload)
}
