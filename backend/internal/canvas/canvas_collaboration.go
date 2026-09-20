package canvas

import (
	"encoding/json"
	"errors"
	"fmt"
	"infinite-canvas/backend/internal/kernel"
	"net/http"
	"sort"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

const (
	CanvasCollaboratorRoleEditor = "editor"
	CanvasCollaboratorRoleViewer = "viewer"
	canvasCollabNodeActive       = "active"
	canvasCollabNodeDeleted      = "deleted"
	canvasCollabApplied          = "applied"
	canvasCollabAlreadyApplied   = "already_applied"
)

// CanvasCollaborationOperationRequest is deliberately operation-shaped. A
// client never submits an old full canvas as the write payload for a shared
// canvas. Before contains the fields the client actually edited; the server
// compares those fields while keeping unrelated remote changes.
type CanvasCollaborationOperationRequest struct {
	OpID                  string                       `json:"opId"`
	BaseRevision          int64                        `json:"baseRevision"`
	Kind                  string                       `json:"kind"`
	NodeID                string                       `json:"nodeId,omitempty"`
	Incarnation           int64                        `json:"incarnation,omitempty"`
	FieldGroup            string                       `json:"fieldGroup,omitempty"`
	Before                map[string]json.RawMessage   `json:"before,omitempty"`
	Patch                 map[string]json.RawMessage   `json:"patch,omitempty"`
	Node                  map[string]json.RawMessage   `json:"node,omitempty"`
	Nodes                 []map[string]json.RawMessage `json:"nodes,omitempty"`
	Connections           []map[string]json.RawMessage `json:"connections,omitempty"`
	RootBefore            map[string]json.RawMessage   `json:"rootBefore,omitempty"`
	RootPatch             map[string]json.RawMessage   `json:"rootPatch,omitempty"`
	ExpectedConnectionIDs []string                     `json:"expectedConnectionIds,omitempty"`
	// A non-nil slice is an explicit connection baseline. This lets a batch
	// create detect a concurrent relation change while keeping older clients
	// (which omit the field) mergeable.
	ExpectedConnections  []map[string]json.RawMessage `json:"expectedConnections,omitempty"`
	DeletionID           string                       `json:"deletionId,omitempty"`
	RestoreConnectionIDs []string                     `json:"restoreConnectionIds,omitempty"`
	SnapshotID           string                       `json:"snapshotId,omitempty"`
}

type CanvasCollaborationOperationResult struct {
	Status           string                        `json:"status"`
	OperationID      string                        `json:"operationId"`
	Revision         int64                         `json:"revision"`
	CanvasID         string                        `json:"canvasId"`
	DeletionID       string                        `json:"deletionId,omitempty"`
	Document         json.RawMessage               `json:"document,omitempty"`
	deletionSnapshot *canvasCollabDeletionSnapshot `json:"-"`
	previousDocument json.RawMessage               `json:"-"`
}

type canvasCollabDeletionSnapshot struct {
	Node                 map[string]json.RawMessage   `json:"node"`
	Connections          []map[string]json.RawMessage `json:"connections"`
	EndpointIncarnations map[string]int64             `json:"endpointIncarnations,omitempty"`
}

type CanvasCollaborationMember struct {
	ID          string    `json:"id"`
	CanvasID    string    `json:"canvasId"`
	UserID      string    `json:"userId"`
	Username    string    `json:"username"`
	DisplayName string    `json:"displayName"`
	Role        string    `json:"role"`
	CreatedBy   string    `json:"createdBy"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type CanvasCollaborationUser struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

type CanvasCollaborationEvents struct {
	Events          []CanvasCollaborationEvent `json:"events"`
	CurrentRevision int64                      `json:"currentRevision"`
}

// CanvasCollaborationOperationDelta is the small, authenticated payload that
// clients can apply to their confirmed canvas. It deliberately contains only
// fields needed to project the committed operation; the original request and
// deletion snapshot remain private in the operation receipt.
type CanvasCollaborationOperationDelta struct {
	OpID         string                       `json:"opId"`
	Kind         string                       `json:"kind"`
	NodeID       string                       `json:"nodeId,omitempty"`
	Incarnation  int64                        `json:"incarnation,omitempty"`
	Patch        map[string]json.RawMessage   `json:"patch,omitempty"`
	RootPatch    map[string]json.RawMessage   `json:"rootPatch,omitempty"`
	Nodes        []map[string]json.RawMessage `json:"nodes,omitempty"`
	Connections  []map[string]json.RawMessage `json:"connections,omitempty"`
	Revision     int64                        `json:"revision"`
	UpdatedAt    json.RawMessage              `json:"updatedAt,omitempty"`
	RequiresSync bool                         `json:"requiresSync,omitempty"`
}

func (s *Service) CanvasCollaborationRevisionForUser(actor *model.User, canvasID string) (int64, error) {
	if err := s.requireCanvasCollaborationAccess(actor, canvasID, false); err != nil {
		return 0, err
	}
	project, err := s.repo.CanvasProject(canvasID)
	if err != nil {
		return 0, mapCanvasCollaborationTransactionError(err)
	}
	return project.Revision, nil
}

// Only authorized canvas readers can receive events. Before values and private
// deletion snapshots remain server-side; deltas contain committed content.
type CanvasCollaborationEvent struct {
	ID                string                             `json:"id"`
	CanvasID          string                             `json:"canvasId"`
	ActorID           string                             `json:"actorId"`
	OpID              string                             `json:"opId"`
	Kind              string                             `json:"kind"`
	TargetNodeID      string                             `json:"targetNodeId,omitempty"`
	TargetIncarnation int64                              `json:"targetIncarnation,omitempty"`
	BaseRevision      int64                              `json:"baseRevision"`
	Revision          int64                              `json:"revision"`
	ResultStatus      string                             `json:"resultStatus"`
	CreatedAt         time.Time                          `json:"createdAt"`
	Operation         *CanvasCollaborationOperationDelta `json:"operation,omitempty"`
}

func canvasCollaborationOperationDelta(req CanvasCollaborationOperationRequest, revision int64, document json.RawMessage) CanvasCollaborationOperationDelta {
	delta := CanvasCollaborationOperationDelta{
		OpID: req.OpID, Kind: strings.TrimSpace(req.Kind), NodeID: req.NodeID,
		Incarnation: req.Incarnation, Revision: revision,
	}
	root, nodes, connections, err := decodeCanvasCollaborationDocument(string(document))
	if err != nil {
		delta.RequiresSync = true
		return delta
	}
	delta.UpdatedAt = root["updatedAt"]
	switch delta.Kind {
	case "update_node":
		index := canvasNodeIndex(nodes, req.NodeID)
		if index < 0 {
			delta.RequiresSync = true
			break
		}
		delta.Patch = make(map[string]json.RawMessage, len(req.Patch))
		for key := range req.Patch {
			delta.Patch[key] = nodes[index][key]
		}
	case "update_canvas":
		delta.RootPatch = make(map[string]json.RawMessage)
		for key := range req.RootPatch {
			delta.RootPatch[key] = root[key]
		}
		// The server may normalize or inherit these values during validation.
		for _, key := range []string{"title", "projectId"} {
			delta.RootPatch[key] = root[key]
		}
	case "create_nodes":
		for _, node := range req.Nodes {
			index := canvasNodeIndex(nodes, rawString(node["id"]))
			if index < 0 {
				delta.RequiresSync = true
				return delta
			}
			delta.Nodes = append(delta.Nodes, nodes[index])
		}
		for _, requested := range req.Connections {
			id := rawString(requested["id"])
			if id == "" {
				// Older receipts may predate server-generated edge IDs.
				delta.RequiresSync = true
				return delta
			}
			for _, connection := range connections {
				if rawString(connection["id"]) == id {
					delta.Connections = append(delta.Connections, connection)
					break
				}
			}
		}
	case "update_connections":
		delta.Connections = connections
	case "delete_node":
		// The client removes the node and all incident connections by ID.
	case "restore_delete", "restore_snapshot":
		// Restores can replace many objects and their lifecycle identities.
		// Resynchronize the committed document through the authenticated API.
		delta.RequiresSync = true
	default:
		delta.RequiresSync = true
	}
	return delta
}

func (s *Service) EnableCanvasCollaboration(actor *model.User, canvasID, memberUserID, role string) (CanvasCollaborationMember, error) {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return CanvasCollaborationMember{}, kernel.Unauthorized("请先登录")
	}
	if role == "" {
		role = CanvasCollaboratorRoleEditor
	}
	if role != CanvasCollaboratorRoleEditor && role != CanvasCollaboratorRoleViewer {
		return CanvasCollaborationMember{}, kernel.BadAuthRequest("协作成员角色无效")
	}
	memberUserID = strings.TrimSpace(memberUserID)
	if memberUserID == "" || memberUserID == actor.ID {
		return CanvasCollaboratorMemberError("协作成员必须是另一个已登录用户")
	}
	member, err := s.repo.User(memberUserID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// Accept an exact username as well as an internal ID. This keeps member
		// sharing usable without exposing a broad user-search endpoint.
		member, err = s.repo.UserByUsername(memberUserID)
	}
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return CanvasCollaboratorMemberError("协作成员不存在")
		}
		return CanvasCollaborationMember{}, err
	}
	memberUserID = member.ID
	var result CanvasCollaborationMember
	err = s.repo.WithCanvasCollaborationTransaction(canvasID, func(tx *gorm.DB, project *model.CanvasProject) error {
		if project.UserID != actor.ID {
			return kernel.Forbidden("只有画布所有者可以管理协作成员")
		}
		txRepo := repository.New(tx)
		if err := grantCanvasDocumentMedia(txRepo, actor.ID, project.ID, project.PayloadJSON); err != nil {
			return err
		}
		now := time.Now().UTC()
		var item model.CanvasCollaborator
		queryErr := tx.Where("canvas_id = ? AND user_id = ?", canvasID, memberUserID).First(&item).Error
		if errors.Is(queryErr, gorm.ErrRecordNotFound) {
			item = model.CanvasCollaborator{ID: kernel.NewID(), CanvasID: canvasID, UserID: memberUserID, Role: role, CreatedBy: actor.ID, CreatedAt: now, UpdatedAt: now}
			if err := tx.Create(&item).Error; err != nil {
				return err
			}
		} else if queryErr != nil {
			return queryErr
		} else {
			if err := tx.Model(&item).Updates(map[string]any{"role": role, "updated_at": now}).Error; err != nil {
				return err
			}
			item.Role = role
			item.UpdatedAt = now
		}
		if err := tx.Model(&model.CanvasProject{}).Where("id = ?", project.ID).Update("collaboration_enabled", true).Error; err != nil {
			return err
		}
		result = CanvasCollaborationMember{ID: item.ID, CanvasID: item.CanvasID, UserID: item.UserID, Username: member.Username, DisplayName: normalizeDisplayName(member.DisplayName, member.Username), Role: item.Role, CreatedBy: item.CreatedBy, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
		return nil
	})
	if err != nil {
		return CanvasCollaborationMember{}, mapCanvasCollaborationTransactionError(err)
	}
	return result, nil
}

func CanvasCollaboratorMemberError(message string) (CanvasCollaborationMember, error) {
	return CanvasCollaborationMember{}, kernel.BadAuthRequest(message)
}

func (s *Service) RemoveCanvasCollaborator(actor *model.User, canvasID, memberUserID string) error {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return kernel.Unauthorized("请先登录")
	}
	memberUserID = strings.TrimSpace(memberUserID)
	err := s.repo.WithCanvasCollaborationTransaction(canvasID, func(tx *gorm.DB, project *model.CanvasProject) error {
		if project.UserID != actor.ID {
			return kernel.Forbidden("只有画布所有者可以移除协作成员")
		}
		return tx.Where("canvas_id = ? AND user_id = ?", canvasID, memberUserID).Delete(&model.CanvasCollaborator{}).Error
	})
	if err = mapCanvasCollaborationTransactionError(err); err != nil {
		return err
	}
	// A removed member must disappear from cursors immediately. Otherwise the
	// old in-memory/Redis heartbeat can remain visible until its TTL expires.
	s.removeCanvasPresenceForUser(canvasID, memberUserID)
	return nil
}

func (s *Service) CanvasCollaborationMembers(actor *model.User, canvasID string) ([]CanvasCollaborationMember, error) {
	if err := s.requireCanvasCollaborationAccess(actor, canvasID, false); err != nil {
		return nil, err
	}
	items, err := s.repo.CanvasCollaborators(canvasID)
	if err != nil {
		return nil, err
	}
	project, err := s.repo.CanvasProject(canvasID)
	if err != nil {
		return nil, err
	}
	ids := []string{project.UserID}
	for _, item := range items {
		ids = append(ids, item.UserID)
	}
	users, err := s.repo.UsersByIDs(ids)
	if err != nil {
		return nil, err
	}
	owner := users[project.UserID]
	result := []CanvasCollaborationMember{{ID: "owner:" + canvasID, CanvasID: canvasID, UserID: project.UserID, Username: owner.Username, DisplayName: normalizeDisplayName(owner.DisplayName, owner.Username), Role: "owner", CreatedAt: project.CreatedAt, UpdatedAt: project.UpdatedAt}}
	for _, item := range items {
		if item.UserID == project.UserID {
			continue
		}
		user := users[item.UserID]
		result = append(result, CanvasCollaborationMember{ID: item.ID, CanvasID: item.CanvasID, UserID: item.UserID, Username: user.Username, DisplayName: normalizeDisplayName(user.DisplayName, user.Username), Role: item.Role, CreatedBy: item.CreatedBy, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt})
	}
	return result, nil
}

// SearchCanvasCollaborationUsers is owner-only to avoid turning a shared
// canvas endpoint into a global user directory. It returns only the fields
// needed to choose a collaborator in the share dialog.
func (s *Service) SearchCanvasCollaborationUsers(actor *model.User, canvasID, keyword string) ([]CanvasCollaborationUser, error) {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	project, err := s.repo.CanvasProject(canvasID)
	if err != nil {
		return nil, mapCanvasCollaborationTransactionError(err)
	}
	if project.UserID != actor.ID {
		return nil, kernel.Forbidden("只有画布所有者可以搜索协作成员")
	}
	if strings.TrimSpace(keyword) == "" {
		return []CanvasCollaborationUser{}, nil
	}
	users, err := s.repo.SearchUsers(keyword, actor.ID, 10)
	if err != nil {
		return nil, err
	}
	result := make([]CanvasCollaborationUser, 0, len(users))
	for _, user := range users {
		result = append(result, CanvasCollaborationUser{ID: user.ID, Username: user.Username, DisplayName: user.DisplayName})
	}
	return result, nil
}

func (s *Service) CanvasCollaborationEventsForUser(actor *model.User, canvasID string, afterRevision int64, limit int) (CanvasCollaborationEvents, error) {
	if err := s.requireCanvasCollaborationAccess(actor, canvasID, false); err != nil {
		return CanvasCollaborationEvents{}, err
	}
	project, err := s.repo.CanvasProject(canvasID)
	if err != nil {
		return CanvasCollaborationEvents{}, err
	}
	items, err := s.repo.CanvasCollaborationOperations(canvasID, afterRevision, limit)
	if err != nil {
		return CanvasCollaborationEvents{}, err
	}
	events := make([]CanvasCollaborationEvent, 0, len(items))
	for _, item := range items {
		var req CanvasCollaborationOperationRequest
		var receipt CanvasCollaborationOperationResult
		var operation *CanvasCollaborationOperationDelta
		if json.Unmarshal([]byte(item.RequestJSON), &req) == nil && json.Unmarshal([]byte(item.ResultJSON), &receipt) == nil {
			delta := canvasCollaborationOperationDelta(req, item.Revision, receipt.Document)
			operation = &delta
		}
		events = append(events, CanvasCollaborationEvent{
			ID: item.ID, CanvasID: item.CanvasID, ActorID: item.ActorID, OpID: item.OpID, Kind: item.Kind,
			TargetNodeID: item.TargetNodeID, TargetIncarnation: item.TargetIncarnation, BaseRevision: item.BaseRevision,
			Revision: item.Revision, ResultStatus: item.ResultStatus, CreatedAt: item.CreatedAt, Operation: operation,
		})
	}
	return CanvasCollaborationEvents{Events: events, CurrentRevision: project.Revision}, nil
}

func (s *Service) ApplyCanvasCollaborationOperation(actor *model.User, canvasID string, req CanvasCollaborationOperationRequest) (CanvasCollaborationOperationResult, error) {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return CanvasCollaborationOperationResult{}, kernel.Unauthorized("请先登录")
	}
	if strings.TrimSpace(req.OpID) == "" || len(req.OpID) > 120 {
		return CanvasCollaborationOperationResult{}, kernel.BadAuthRequest("协作操作缺少有效的操作 ID")
	}
	if req.BaseRevision < 0 {
		return CanvasCollaborationOperationResult{}, kernel.BadAuthRequest("协作操作版本无效")
	}
	requestJSONBytes, err := json.Marshal(req)
	if err != nil {
		return CanvasCollaborationOperationResult{}, kernel.BadAuthRequest("协作操作格式错误")
	}
	requestJSON := string(requestJSONBytes)
	var result CanvasCollaborationOperationResult
	err = s.repo.WithCanvasCollaborationTransaction(canvasID, func(tx *gorm.DB, project *model.CanvasProject) error {
		role, err := canvasCollaborationRole(tx, project, actor.ID)
		if err != nil {
			return err
		}
		if role != "owner" && role != CanvasCollaboratorRoleEditor {
			return kernel.Forbidden("当前成员只有查看权限，不能修改画布")
		}
		if !project.CollaborationEnabled {
			return kernel.NewAppError(http.StatusConflict, "画布尚未开启多人协作")
		}
		var previous model.CanvasCollaborationOperation
		previousErr := tx.Where("canvas_id = ? AND actor_id = ? AND op_id = ?", project.ID, actor.ID, req.OpID).First(&previous).Error
		if previousErr == nil {
			if previous.RequestJSON != requestJSON {
				return kernel.NewAppError(http.StatusConflict, "操作 ID 已被另一份请求使用，请生成新的操作 ID")
			}
			if err := json.Unmarshal([]byte(previous.ResultJSON), &result); err != nil {
				return err
			}
			result.Status = canvasCollabAlreadyApplied
			return nil
		}
		if !errors.Is(previousErr, gorm.ErrRecordNotFound) {
			return previousErr
		}
		if req.BaseRevision > project.Revision {
			return kernel.NewAppError(http.StatusConflict, "操作基于不存在的未来画布版本，请重新加载")
		}
		if strings.TrimSpace(req.Kind) == "restore_snapshot" && req.BaseRevision != project.Revision {
			return kernel.NewAppError(http.StatusConflict, "恢复历史版本前画布已有新修改，请重新加载历史列表")
		}
		root, nodes, connections, err := decodeCanvasCollaborationDocument(project.PayloadJSON)
		if err != nil {
			return err
		}
		if err := ensureCanvasCollaborationNodes(tx, project.ID, nodes); err != nil {
			return err
		}
		if err := s.applyCanvasCollaborationRequest(tx, project, &root, &nodes, &connections, actor.ID, req, &result); err != nil {
			return err
		}
		project.Revision++
		project.UpdatedAt = time.Now().UTC()
		root["id"], _ = json.Marshal(project.ID)
		root["title"], _ = json.Marshal(project.Title)
		root["projectId"], _ = json.Marshal(project.ProjectID)
		root["revision"], _ = json.Marshal(project.Revision)
		root["collaborationEnabled"], _ = json.Marshal(project.CollaborationEnabled)
		root["createdAt"], _ = json.Marshal(project.CreatedAt)
		root["updatedAt"], _ = json.Marshal(project.UpdatedAt)
		encodedNodes, _ := json.Marshal(nodes)
		encodedConnections, _ := json.Marshal(connections)
		root["nodes"] = encodedNodes
		root["connections"] = encodedConnections
		encodedRoot, err := json.Marshal(root)
		if err != nil {
			return err
		}
		if err := grantCanvasDocumentMedia(repository.New(tx), actor.ID, project.ID, string(encodedRoot)); err != nil {
			return err
		}
		project.PayloadJSON = string(encodedRoot)
		update := tx.Model(&model.CanvasProject{}).Where("id = ? AND revision = ?", project.ID, project.Revision-1).Updates(map[string]any{
			"title": project.Title, "payload_json": project.PayloadJSON, "updated_at": project.UpdatedAt, "revision": project.Revision,
		})
		if update.Error != nil {
			return update.Error
		}
		if update.RowsAffected != 1 {
			return kernel.NewAppError(http.StatusConflict, "画布版本已变化，请重新同步")
		}
		result.Status = canvasCollabApplied
		result.Revision = project.Revision
		result.CanvasID = project.ID
		result.OperationID = req.OpID
		document, err := canvasProjectPayload(*project)
		if err != nil {
			return err
		}
		result.Document = document
		resultJSON, err := json.Marshal(result)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		snapshotJSON := ""
		if result.deletionSnapshot != nil {
			snapshotJSON = mustJSON(result.deletionSnapshot)
		} else if len(result.previousDocument) > 0 {
			snapshotJSON = string(result.previousDocument)
		}
		op := model.CanvasCollaborationOperation{ID: kernel.NewID(), CanvasID: project.ID, ActorID: actor.ID, OpID: req.OpID, Kind: req.Kind, TargetNodeID: req.NodeID, TargetIncarnation: req.Incarnation, BaseRevision: req.BaseRevision, Revision: project.Revision, ResultStatus: canvasCollabApplied, RequestJSON: requestJSON, ResultJSON: string(resultJSON), SnapshotJSON: snapshotJSON, CreatedAt: now, UpdatedAt: now}
		if err := tx.Create(&op).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return CanvasCollaborationOperationResult{}, mapCanvasCollaborationTransactionError(err)
	}
	if result.Status == canvasCollabApplied {
		delta := canvasCollaborationOperationDelta(req, result.Revision, result.Document)
		s.publishCanvasCollaborationRealtime(CanvasCollaborationRealtimeMessage{
			Type:              "operation_applied",
			CanvasID:          canvasID,
			ActorID:           actor.ID,
			OperationID:       result.OperationID,
			Kind:              req.Kind,
			TargetNodeID:      req.NodeID,
			TargetIncarnation: req.Incarnation,
			Revision:          result.Revision,
			Operation:         &delta,
		})
	}
	return result, nil
}

func (s *Service) requireCanvasCollaborationAccess(actor *model.User, canvasID string, write bool) error {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return kernel.Unauthorized("请先登录")
	}
	project, err := s.repo.CanvasProject(canvasID)
	if err != nil {
		return err
	}
	if project.UserID == actor.ID {
		return nil
	}
	item, err := s.repo.CanvasCollaboratorForUser(canvasID, actor.ID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return kernel.NewAppError(http.StatusNotFound, "画布不存在或无权访问")
		}
		return err
	}
	if write && item.Role != CanvasCollaboratorRoleEditor {
		return kernel.Forbidden("当前成员只有查看权限")
	}
	return nil
}

func canvasCollaborationRole(tx *gorm.DB, project *model.CanvasProject, actorID string) (string, error) {
	if project.UserID == actorID {
		return "owner", nil
	}
	var item model.CanvasCollaborator
	if err := tx.Where("canvas_id = ? AND user_id = ?", project.ID, actorID).First(&item).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", kernel.NewAppError(http.StatusNotFound, "画布不存在或无权访问")
		}
		return "", err
	}
	return item.Role, nil
}

func mapCanvasCollaborationTransactionError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return kernel.NewAppError(http.StatusNotFound, "画布不存在或无权访问")
	}
	return err
}

func decodeCanvasCollaborationDocument(payload string) (map[string]json.RawMessage, []map[string]json.RawMessage, []map[string]json.RawMessage, error) {
	var root map[string]json.RawMessage
	if err := json.Unmarshal([]byte(payload), &root); err != nil || root == nil {
		return nil, nil, nil, kernel.BadAuthRequest("画布内容格式错误")
	}
	var rawNodes []map[string]json.RawMessage
	if value := root["nodes"]; value != nil && string(value) != "null" {
		if err := json.Unmarshal(value, &rawNodes); err != nil {
			return nil, nil, nil, kernel.BadAuthRequest("画布节点格式错误")
		}
	}
	var rawConnections []map[string]json.RawMessage
	if value := root["connections"]; value != nil && string(value) != "null" {
		if err := json.Unmarshal(value, &rawConnections); err != nil {
			return nil, nil, nil, kernel.BadAuthRequest("画布连线格式错误")
		}
	}
	return root, rawNodes, rawConnections, nil
}

func ensureCanvasCollaborationNodes(tx *gorm.DB, canvasID string, nodes []map[string]json.RawMessage) error {
	now := time.Now().UTC()
	for _, node := range nodes {
		nodeID := rawString(node["id"])
		if nodeID == "" {
			return kernel.BadAuthRequest("画布节点缺少 ID")
		}
		var state model.CanvasCollaborationNode
		err := tx.Where("canvas_id = ? AND node_id = ?", canvasID, nodeID).First(&state).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			encoded, _ := json.Marshal(node)
			state = model.CanvasCollaborationNode{ID: canvasNodeStateID(canvasID, nodeID), CanvasID: canvasID, NodeID: nodeID, Incarnation: 1, Status: canvasCollabNodeActive, NodeJSON: string(encoded), CreatedAt: now, UpdatedAt: now}
			if err := tx.Create(&state).Error; err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		if state.Status == canvasCollabNodeActive {
			encoded, _ := json.Marshal(node)
			if err := tx.Model(&state).Updates(map[string]any{"node_json": string(encoded), "updated_at": now}).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func canvasNodeStateID(canvasID, nodeID string) string {
	return "canvas-node:" + canvasID + ":" + nodeID
}

func canvasCollaborationActorLabel(tx *gorm.DB, actorID string) string {
	var user model.User
	if err := tx.Select("display_name, username").Where("id = ?", actorID).First(&user).Error; err == nil {
		if label := strings.TrimSpace(user.DisplayName); label != "" {
			return label
		}
		if label := strings.TrimSpace(user.Username); label != "" {
			return label
		}
	}
	return "其他成员"
}

func canvasCollaborationRecentActorLabel(tx *gorm.DB, canvasID, nodeID, currentActorID string) string {
	var operation model.CanvasCollaborationOperation
	if err := tx.Where("canvas_id = ? AND target_node_id = ? AND result_status = ?", canvasID, nodeID, canvasCollabApplied).Order("revision DESC").First(&operation).Error; err == nil && operation.ActorID != "" && operation.ActorID != currentActorID {
		return canvasCollaborationActorLabel(tx, operation.ActorID)
	}
	return "其他成员"
}

func (s *Service) applyCanvasCollaborationRequest(tx *gorm.DB, project *model.CanvasProject, root *map[string]json.RawMessage, nodes *[]map[string]json.RawMessage, connections *[]map[string]json.RawMessage, actorID string, req CanvasCollaborationOperationRequest, result *CanvasCollaborationOperationResult) error {
	switch strings.TrimSpace(req.Kind) {
	case "update_node":
		return applyCanvasCollaborationNodeUpdate(tx, project, nodes, actorID, req)
	case "update_canvas":
		return s.applyCanvasCollaborationRootUpdate(tx, project, root, actorID, req)
	case "delete_node":
		return applyCanvasCollaborationNodeDelete(tx, project, nodes, connections, actorID, req, result)
	case "create_nodes":
		return applyCanvasCollaborationNodeCreate(tx, project, nodes, connections, req)
	case "update_connections":
		return applyCanvasCollaborationConnections(tx, project, nodes, connections, req)
	case "restore_delete":
		return applyCanvasCollaborationNodeRestore(tx, project, nodes, connections, actorID, req, result)
	case "restore_snapshot":
		return applyCanvasCollaborationSnapshotRestore(tx, project, root, nodes, connections, actorID, req, result)
	default:
		return kernel.BadAuthRequest("不支持的协作操作类型")
	}
}

var canvasCollaborationRootFields = map[string]bool{
	"title":          true,
	"projectId":      true,
	"chatSessions":   true,
	"activeChatId":   true,
	"starterMode":    true,
	"appearance":     true,
	"backgroundMode": true,
	"showImageInfo":  true,
	"directorScenes": true,
	"timeline":       true,
}

func (s *Service) applyCanvasCollaborationRootUpdate(tx *gorm.DB, project *model.CanvasProject, root *map[string]json.RawMessage, actorID string, req CanvasCollaborationOperationRequest) error {
	if len(req.RootBefore) == 0 || len(req.RootPatch) == 0 {
		return kernel.BadAuthRequest("画布修改需要修改前内容和修改内容")
	}
	role, err := canvasCollaborationRole(tx, project, actorID)
	if err != nil {
		return err
	}
	for key := range req.RootPatch {
		if !canvasCollaborationRootFields[key] {
			return kernel.BadAuthRequest("画布修改包含不允许的字段：" + key)
		}
		if _, ok := req.RootBefore[key]; !ok {
			return kernel.BadAuthRequest("画布修改缺少对应字段的基线：" + key)
		}
		if (key == "projectId") && role != "owner" {
			return kernel.Forbidden("只有画布所有者可以修改业务项目归属")
		}
	}
	for key, before := range req.RootBefore {
		current := (*root)[key]
		patchValue, changedByRequest := req.RootPatch[key]
		if rawEqual(current, before) || (!changedByRequest || rawEqual(current, patchValue)) {
			continue
		}
		return kernel.NewAppError(http.StatusConflict, "画布字段已被其他成员修改："+key)
	}
	for key, value := range req.RootPatch {
		(*root)[key] = value
	}
	if value, ok := req.RootPatch["title"]; ok {
		var title string
		if string(value) != "null" && json.Unmarshal(value, &title) != nil {
			return kernel.BadAuthRequest("画布标题格式错误")
		}
		project.Title = strings.TrimSpace(title)
	}
	if value, ok := req.RootPatch["projectId"]; ok {
		var projectID string
		if string(value) != "null" && json.Unmarshal(value, &projectID) != nil {
			return kernel.BadAuthRequest("业务项目 ID 格式错误")
		}
		project.ProjectID = strings.TrimSpace(projectID)
	}
	if req.RootPatch["projectId"] != nil && project.ProjectID != "" {
		var linked model.Project
		if err := tx.Where("id = ? AND user_id = ?", project.ProjectID, project.UserID).First(&linked).Error; err != nil {
			return kernel.BadAuthRequest("业务项目不存在或无权访问")
		}
	}
	_ = tx
	return nil
}

func optionalCanvasProjectID(value json.RawMessage) (*int64, error) {
	if string(value) == "null" || len(value) == 0 {
		return nil, nil
	}
	var id int64
	if err := json.Unmarshal(value, &id); err != nil || id <= 0 {
		return nil, errors.New("invalid project ID")
	}
	return &id, nil
}

func applyCanvasCollaborationConnections(tx *gorm.DB, project *model.CanvasProject, nodes *[]map[string]json.RawMessage, connections *[]map[string]json.RawMessage, req CanvasCollaborationOperationRequest) error {
	if len(req.ExpectedConnections) > 0 {
		if !connectionMapsEqual(*connections, req.ExpectedConnections) {
			return kernel.NewAppError(http.StatusConflict, "画布连线内容已被其他成员修改，请重新同步")
		}
	} else if len(req.ExpectedConnectionIDs) == 0 && len(*connections) > 0 {
		return kernel.BadAuthRequest("连线修改需要完整的当前连线基线")
	} else {
		actual := make([]string, 0, len(*connections))
		for _, connection := range *connections {
			actual = append(actual, rawString(connection["id"]))
		}
		expected := append([]string(nil), req.ExpectedConnectionIDs...)
		sort.Strings(actual)
		sort.Strings(expected)
		if !slicesEqual(actual, expected) {
			return kernel.NewAppError(http.StatusConflict, "画布连线已被其他成员修改，请重新同步")
		}
	}
	knownNodes := make(map[string]bool, len(*nodes))
	for _, node := range *nodes {
		knownNodes[rawString(node["id"])] = true
	}
	seen := make(map[string]bool, len(req.Connections))
	for _, connection := range req.Connections {
		id := rawString(connection["id"])
		fromID, toID := rawString(connection["fromNodeId"]), rawString(connection["toNodeId"])
		if id == "" || seen[id] || !knownNodes[fromID] || !knownNodes[toID] || fromID == toID {
			return kernel.NewAppError(http.StatusConflict, "连线端点或身份已失效")
		}
		seen[id] = true
	}
	*connections = req.Connections
	_ = tx
	return nil
}

func applyCanvasCollaborationNodeUpdate(tx *gorm.DB, project *model.CanvasProject, nodes *[]map[string]json.RawMessage, actorID string, req CanvasCollaborationOperationRequest) error {
	if req.NodeID == "" || req.Incarnation <= 0 || len(req.Patch) == 0 || len(req.Before) == 0 {
		return kernel.BadAuthRequest("节点修改需要目标、存续代次、修改前内容和修改内容")
	}
	index := canvasNodeIndex(*nodes, req.NodeID)
	if index < 0 {
		return kernel.NewAppError(http.StatusConflict, "目标节点已被删除，修改已保留为待处理草稿")
	}
	state, err := canvasCollaborationNode(tx, project.ID, req.NodeID)
	if err != nil {
		return err
	}
	if state.Status != canvasCollabNodeActive || state.Incarnation != req.Incarnation {
		if state.DeletedBy != "" {
			return kernel.NewAppError(http.StatusConflict, fmt.Sprintf("成员“%s”删除了节点“%s”，你的修改已保留为待处理草稿", canvasCollaborationActorLabel(tx, state.DeletedBy), rawString((*nodes)[index]["title"])))
		}
		return kernel.NewAppError(http.StatusConflict, "目标节点已经删除或恢复为新的存续版本，旧修改不能写入")
	}
	current := (*nodes)[index]
	for key := range req.Patch {
		if key == "id" || key == "createdAt" || key == "updatedAt" {
			return kernel.BadAuthRequest("节点修改包含只读字段：" + key)
		}
		if _, ok := req.Before[key]; !ok {
			return kernel.BadAuthRequest("节点修改缺少对应字段的基线：" + key)
		}
	}
	conflicts := make([]string, 0)
	for key, before := range req.Before {
		currentValue := current[key]
		patchValue, changedByRequest := req.Patch[key]
		if rawEqual(currentValue, before) || (!changedByRequest || rawEqual(currentValue, patchValue)) {
			continue
		}
		conflicts = append(conflicts, key)
	}
	if len(conflicts) > 0 {
		sort.Strings(conflicts)
		return kernel.NewAppError(http.StatusConflict, fmt.Sprintf("成员“%s”修改了节点“%s”的字段：%s", canvasCollaborationRecentActorLabel(tx, project.ID, req.NodeID, actorID), rawString((*nodes)[index]["title"]), strings.Join(conflicts, ",")))
	}
	for key, value := range req.Patch {
		current[key] = value
	}
	// Lifecycle identity belongs to the server even when metadata is replaced.
	setNodeIncarnation(&current, state.Incarnation)
	encoded, _ := json.Marshal(current)
	if err := tx.Model(&model.CanvasCollaborationNode{}).Where("canvas_id = ? AND node_id = ?", project.ID, req.NodeID).Updates(map[string]any{"node_json": string(encoded), "updated_at": time.Now().UTC()}).Error; err != nil {
		return err
	}
	_ = actorID
	return nil
}

func applyCanvasCollaborationNodeDelete(tx *gorm.DB, project *model.CanvasProject, nodes *[]map[string]json.RawMessage, connections *[]map[string]json.RawMessage, actorID string, req CanvasCollaborationOperationRequest, result *CanvasCollaborationOperationResult) error {
	if req.NodeID == "" || req.Incarnation <= 0 || len(req.Before) == 0 {
		return kernel.BadAuthRequest("节点删除需要目标、存续代次和删除前内容")
	}
	index := canvasNodeIndex(*nodes, req.NodeID)
	if index < 0 {
		if state, stateErr := canvasCollaborationNode(tx, project.ID, req.NodeID); stateErr == nil && state.DeletedBy != "" {
			return kernel.NewAppError(http.StatusConflict, fmt.Sprintf("成员“%s”删除了目标节点，你的修改已保留为待处理草稿", canvasCollaborationActorLabel(tx, state.DeletedBy)))
		}
		return kernel.NewAppError(http.StatusConflict, "目标节点已经被删除")
	}
	state, err := canvasCollaborationNode(tx, project.ID, req.NodeID)
	if err != nil {
		return err
	}
	if state.Status != canvasCollabNodeActive || state.Incarnation != req.Incarnation {
		if state.DeletedBy != "" {
			return kernel.NewAppError(http.StatusConflict, fmt.Sprintf("成员“%s”删除了节点“%s”，请查看最新状态后再确认", canvasCollaborationActorLabel(tx, state.DeletedBy), rawString((*nodes)[index]["title"])))
		}
		return kernel.NewAppError(http.StatusConflict, "目标节点已经删除或恢复为新的存续版本")
	}
	if !rawMapMatches((*nodes)[index], req.Before) {
		return kernel.NewAppError(http.StatusConflict, fmt.Sprintf("成员“%s”修改了节点“%s”，请查看最新状态后确认删除", canvasCollaborationRecentActorLabel(tx, project.ID, req.NodeID, actorID), rawString((*nodes)[index]["title"])))
	}
	incident := incidentConnections(*connections, req.NodeID)
	if len(req.ExpectedConnections) > 0 && !connectionMapsEqual(incident, req.ExpectedConnections) {
		return kernel.NewAppError(http.StatusConflict, fmt.Sprintf("成员“%s”修改了节点“%s”的连线，请查看最新关系后确认删除", canvasCollaborationRecentActorLabel(tx, project.ID, req.NodeID, actorID), rawString((*nodes)[index]["title"])))
	}
	expected := append([]string(nil), req.ExpectedConnectionIDs...)
	if len(req.ExpectedConnections) == 0 {
		sort.Strings(expected)
		actual := make([]string, 0, len(incident))
		for _, connection := range incident {
			actual = append(actual, rawString(connection["id"]))
		}
		sort.Strings(actual)
		if !slicesEqual(expected, actual) {
			return kernel.NewAppError(http.StatusConflict, fmt.Sprintf("成员“%s”修改了节点“%s”的连线，请查看最新关系后确认删除", canvasCollaborationRecentActorLabel(tx, project.ID, req.NodeID, actorID), rawString((*nodes)[index]["title"])))
		}
	}
	deletedNode := (*nodes)[index]
	deletedConnections := append([]map[string]json.RawMessage(nil), incident...)
	endpointIncarnations := make(map[string]int64)
	for _, connection := range incident {
		for _, endpointID := range []string{rawString(connection["fromNodeId"]), rawString(connection["toNodeId"])} {
			if endpointID == "" || endpointIncarnations[endpointID] > 0 {
				continue
			}
			endpointState, stateErr := canvasCollaborationNode(tx, project.ID, endpointID)
			if stateErr != nil {
				return kernel.NewAppError(http.StatusConflict, "删除关系的端点状态已变化，请重新同步")
			}
			endpointIncarnations[endpointID] = endpointState.Incarnation
		}
	}
	*nodes = append((*nodes)[:index], (*nodes)[index+1:]...)
	filtered := make([]map[string]json.RawMessage, 0, len(*connections)-len(incident))
	incidentIDs := map[string]bool{}
	for _, connection := range incident {
		incidentIDs[rawString(connection["id"])] = true
	}
	for _, connection := range *connections {
		if !incidentIDs[rawString(connection["id"])] {
			filtered = append(filtered, connection)
		}
	}
	*connections = filtered
	now := time.Now().UTC()
	if err := tx.Model(&model.CanvasCollaborationNode{}).Where("canvas_id = ? AND node_id = ?", project.ID, req.NodeID).Updates(map[string]any{"status": canvasCollabNodeDeleted, "node_json": mustJSON(deletedNode), "deleted_at": now, "deleted_by": actorID, "updated_at": now}).Error; err != nil {
		return err
	}
	result.DeletionID = req.OpID
	result.deletionSnapshot = &canvasCollabDeletionSnapshot{Node: cloneJSONMap(deletedNode), Connections: deletedConnections, EndpointIncarnations: endpointIncarnations}
	// Store the inverse data on the operation record after the document update.
	result.Status = canvasCollabApplied
	return nil
}

func applyCanvasCollaborationNodeCreate(tx *gorm.DB, project *model.CanvasProject, nodes *[]map[string]json.RawMessage, connections *[]map[string]json.RawMessage, req CanvasCollaborationOperationRequest) error {
	if len(req.Nodes) == 0 {
		return kernel.BadAuthRequest("批量创建至少需要一个节点")
	}
	if req.ExpectedConnections != nil && !connectionMapsEqual(*connections, req.ExpectedConnections) {
		return kernel.NewAppError(http.StatusConflict, "画布连线刚刚有变化，新增节点组已保留为待处理草稿")
	}
	known := make(map[string]bool, len(*nodes)+len(req.Nodes))
	for _, item := range *nodes {
		known[rawString(item["id"])] = true
	}
	for _, node := range req.Nodes {
		nodeID := rawString(node["id"])
		if nodeID == "" || known[nodeID] {
			return kernel.NewAppError(http.StatusConflict, "新增节点 ID 已存在，不能复用已删除节点身份")
		}
		var state model.CanvasCollaborationNode
		stateErr := tx.Where("canvas_id = ? AND node_id = ?", project.ID, nodeID).First(&state).Error
		if stateErr == nil {
			return kernel.NewAppError(http.StatusConflict, "新增节点 ID 已存在，不能复用已删除节点身份")
		}
		if !errors.Is(stateErr, gorm.ErrRecordNotFound) {
			return stateErr
		}
		known[nodeID] = true
	}
	connectionIDs := map[string]bool{}
	for _, connection := range *connections {
		connectionIDs[rawString(connection["id"])] = true
	}
	for _, connection := range req.Connections {
		connectionID := rawString(connection["id"])
		if connectionID == "" {
			connectionID = kernel.NewID()
			connection["id"], _ = json.Marshal(connectionID)
		}
		if connectionIDs[connectionID] {
			return kernel.NewAppError(http.StatusConflict, "新增连线 ID 已存在")
		}
		fromID, toID := rawString(connection["fromNodeId"]), rawString(connection["toNodeId"])
		if !known[fromID] || !known[toID] || fromID == toID {
			return kernel.NewAppError(http.StatusConflict, "新增连线的端点已失效")
		}
		connectionIDs[connectionID] = true
	}
	for _, node := range req.Nodes {
		setNodeIncarnation(&node, 1)
		*nodes = append(*nodes, node)
		encoded, _ := json.Marshal(node)
		now := time.Now().UTC()
		if err := tx.Create(&model.CanvasCollaborationNode{ID: canvasNodeStateID(project.ID, rawString(node["id"])), CanvasID: project.ID, NodeID: rawString(node["id"]), Incarnation: 1, Status: canvasCollabNodeActive, NodeJSON: string(encoded), CreatedAt: now, UpdatedAt: now}).Error; err != nil {
			return err
		}
	}
	*connections = append(*connections, req.Connections...)
	return nil
}

func applyCanvasCollaborationNodeRestore(tx *gorm.DB, project *model.CanvasProject, nodes *[]map[string]json.RawMessage, connections *[]map[string]json.RawMessage, actorID string, req CanvasCollaborationOperationRequest, result *CanvasCollaborationOperationResult) error {
	if strings.TrimSpace(req.DeletionID) == "" {
		return kernel.BadAuthRequest("恢复节点需要明确的删除记录")
	}
	var deletion model.CanvasCollaborationOperation
	if err := tx.Where("canvas_id = ? AND op_id = ? AND kind = ? AND result_status = ?", project.ID, req.DeletionID, "delete_node", canvasCollabApplied).First(&deletion).Error; err != nil {
		return kernel.NewAppError(http.StatusConflict, "删除记录不存在、已过期或已经无法恢复")
	}
	var deleted canvasCollabDeletionSnapshot
	if err := json.Unmarshal([]byte(deletion.SnapshotJSON), &deleted); err != nil || deleted.Node == nil {
		return kernel.NewAppError(http.StatusConflict, "删除记录不完整，无法恢复")
	}
	if project.UserID != actorID && deletion.ActorID != actorID {
		return kernel.Forbidden("只有所有者或删除该节点的成员可以恢复")
	}
	nodeID := rawString(deleted.Node["id"])
	var state model.CanvasCollaborationNode
	if err := tx.Where("canvas_id = ? AND node_id = ?", project.ID, nodeID).First(&state).Error; err != nil {
		return err
	}
	if state.Status != canvasCollabNodeDeleted || state.Incarnation != deletion.TargetIncarnation {
		return kernel.NewAppError(http.StatusConflict, "该删除已经被恢复或目标状态已变化")
	}
	var selected = map[string]bool{}
	for _, id := range req.RestoreConnectionIDs {
		if selected[id] {
			return kernel.NewAppError(http.StatusBadRequest, "恢复连线列表包含重复 ID")
		}
		selected[id] = true
	}
	deletedConnectionsByID := make(map[string]map[string]json.RawMessage, len(deleted.Connections))
	for _, connection := range deleted.Connections {
		deletedConnectionsByID[rawString(connection["id"])] = connection
	}
	for connectionID := range selected {
		if deletedConnectionsByID[connectionID] == nil {
			return kernel.NewAppError(http.StatusConflict, "选择恢复的连线已经不属于该删除记录")
		}
		for _, current := range *connections {
			if rawString(current["id"]) == connectionID {
				return kernel.NewAppError(http.StatusConflict, "选择恢复的连线身份已被重新使用")
			}
		}
	}
	for _, connection := range deleted.Connections {
		if !selected[rawString(connection["id"])] {
			continue
		}
		fromID, toID := rawString(connection["fromNodeId"]), rawString(connection["toNodeId"])
		if canvasNodeIndex(*nodes, fromID) < 0 || canvasNodeIndex(*nodes, toID) < 0 {
			return kernel.NewAppError(http.StatusConflict, "选择恢复的连线端点已变化")
		}
		for _, endpointID := range []string{fromID, toID} {
			if endpointID == nodeID {
				continue
			}
			endpointState, stateErr := canvasCollaborationNode(tx, project.ID, endpointID)
			if stateErr != nil || endpointState.Status != canvasCollabNodeActive {
				return kernel.NewAppError(http.StatusConflict, "选择恢复的连线端点已经删除或不可用")
			}
			if expected, ok := deleted.EndpointIncarnations[endpointID]; ok && expected > 0 && endpointState.Incarnation != expected {
				return kernel.NewAppError(http.StatusConflict, "选择恢复的连线端点已经恢复为新的存续版本")
			}
		}
		cloned := cloneJSONMap(connection)
		newConnectionID := kernel.NewID()
		cloned["id"], _ = json.Marshal(newConnectionID)
		*connections = append(*connections, cloned)
	}
	newIncarnation := state.Incarnation + 1
	now := time.Now().UTC()
	restoredNode := cloneJSONMap(deleted.Node)
	var metadata map[string]json.RawMessage
	if rawMetadata := restoredNode["metadata"]; rawMetadata != nil {
		_ = json.Unmarshal(rawMetadata, &metadata)
	}
	if metadata == nil {
		metadata = map[string]json.RawMessage{}
	}
	metadata["collaborationIncarnation"], _ = json.Marshal(newIncarnation)
	restoredNode["metadata"], _ = json.Marshal(metadata)
	encodedNode, _ := json.Marshal(restoredNode)
	*nodes = append(*nodes, restoredNode)
	if err := tx.Model(&state).Updates(map[string]any{"status": canvasCollabNodeActive, "incarnation": newIncarnation, "node_json": string(encodedNode), "deleted_at": nil, "deleted_by": "", "updated_at": now}).Error; err != nil {
		return err
	}
	result.DeletionID = req.DeletionID
	return nil
}

// applyCanvasCollaborationSnapshotRestore restores a historical document as a
// new collaboration operation. Node lifecycles are reconciled while the
// canvas row is locked, so an old edit cannot write through a restored node.
func applyCanvasCollaborationSnapshotRestore(tx *gorm.DB, project *model.CanvasProject, root *map[string]json.RawMessage, nodes *[]map[string]json.RawMessage, connections *[]map[string]json.RawMessage, actorID string, req CanvasCollaborationOperationRequest, result *CanvasCollaborationOperationResult) error {
	if strings.TrimSpace(req.SnapshotID) == "" {
		return kernel.BadAuthRequest("恢复历史版本需要明确的历史记录")
	}
	var snapshot model.CanvasSnapshot
	if err := tx.Where("id = ? AND canvas_id = ? AND user_id = ?", req.SnapshotID, project.ID, project.UserID).First(&snapshot).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return kernel.NewAppError(http.StatusNotFound, "历史版本不存在或已过期，请刷新历史列表")
		}
		return err
	}
	restoredRoot, restoredNodes, restoredConnections, err := decodeCanvasCollaborationDocument(snapshot.PayloadJSON)
	if err != nil {
		return err
	}
	if err := validateCanvasCollaborationGraph(restoredNodes, restoredConnections); err != nil {
		return err
	}
	previous, err := canvasProjectPayload(*project)
	if err != nil {
		return err
	}
	result.previousDocument = append(json.RawMessage(nil), previous...)

	var states []model.CanvasCollaborationNode
	if err := tx.Where("canvas_id = ?", project.ID).Find(&states).Error; err != nil {
		return err
	}
	stateByNodeID := make(map[string]*model.CanvasCollaborationNode, len(states))
	for index := range states {
		stateByNodeID[states[index].NodeID] = &states[index]
	}
	seen := make(map[string]bool, len(restoredNodes))
	now := time.Now().UTC()
	for index, node := range restoredNodes {
		nodeID := rawString(node["id"])
		state := stateByNodeID[nodeID]
		incarnation := int64(1)
		if state != nil {
			// A snapshot restore replaces node content even if the logical node
			// is currently active. Advance the lifecycle in both cases so an
			// operation prepared before the restore cannot write through it.
			incarnation = state.Incarnation + 1
		}
		setNodeIncarnation(&node, incarnation)
		restoredNodes[index] = node
		encoded, _ := json.Marshal(node)
		if state == nil {
			item := model.CanvasCollaborationNode{ID: canvasNodeStateID(project.ID, nodeID), CanvasID: project.ID, NodeID: nodeID, Incarnation: incarnation, Status: canvasCollabNodeActive, NodeJSON: string(encoded), CreatedAt: now, UpdatedAt: now}
			if err := tx.Create(&item).Error; err != nil {
				return err
			}
		} else if err := tx.Model(state).Updates(map[string]any{"status": canvasCollabNodeActive, "incarnation": incarnation, "node_json": string(encoded), "deleted_at": nil, "deleted_by": "", "updated_at": now}).Error; err != nil {
			return err
		}
		seen[nodeID] = true
	}
	for _, state := range states {
		if seen[state.NodeID] || state.Status != canvasCollabNodeActive {
			continue
		}
		if err := tx.Model(&state).Updates(map[string]any{"status": canvasCollabNodeDeleted, "deleted_at": now, "deleted_by": actorID, "updated_at": now}).Error; err != nil {
			return err
		}
	}

	// Keep current ownership and collaboration metadata authoritative. The
	// historical title remains part of the restored document when present.
	if title := rawString(restoredRoot["title"]); title != "" {
		project.Title = title
	}
	for key, value := range restoredRoot {
		(*root)[key] = value
	}
	*nodes = restoredNodes
	*connections = restoredConnections
	return nil
}

func validateCanvasCollaborationGraph(nodes []map[string]json.RawMessage, connections []map[string]json.RawMessage) error {
	knownNodes := make(map[string]bool, len(nodes))
	for _, node := range nodes {
		id := rawString(node["id"])
		if id == "" || knownNodes[id] {
			return kernel.BadAuthRequest("历史版本包含重复或缺失的节点 ID")
		}
		knownNodes[id] = true
	}
	knownConnections := make(map[string]bool, len(connections))
	for _, connection := range connections {
		id := rawString(connection["id"])
		fromID := rawString(connection["fromNodeId"])
		toID := rawString(connection["toNodeId"])
		if id == "" || knownConnections[id] || fromID == "" || toID == "" || fromID == toID || !knownNodes[fromID] || !knownNodes[toID] {
			return kernel.BadAuthRequest("历史版本包含无效的连线关系")
		}
		knownConnections[id] = true
	}
	return nil
}

func setNodeIncarnation(node *map[string]json.RawMessage, incarnation int64) {
	if node == nil {
		return
	}
	var metadata map[string]json.RawMessage
	if rawMetadata := (*node)["metadata"]; len(rawMetadata) > 0 {
		_ = json.Unmarshal(rawMetadata, &metadata)
	}
	if metadata == nil {
		metadata = map[string]json.RawMessage{}
	}
	metadata["collaborationIncarnation"], _ = json.Marshal(incarnation)
	(*node)["metadata"], _ = json.Marshal(metadata)
}

func canvasCollaborationNode(tx *gorm.DB, canvasID, nodeID string) (*model.CanvasCollaborationNode, error) {
	var state model.CanvasCollaborationNode
	if err := tx.Where("canvas_id = ? AND node_id = ?", canvasID, nodeID).First(&state).Error; err != nil {
		return nil, err
	}
	return &state, nil
}

func canvasNodeIndex(nodes []map[string]json.RawMessage, nodeID string) int {
	for index, node := range nodes {
		if rawString(node["id"]) == nodeID {
			return index
		}
	}
	return -1
}

func incidentConnections(connections []map[string]json.RawMessage, nodeID string) []map[string]json.RawMessage {
	result := make([]map[string]json.RawMessage, 0)
	for _, connection := range connections {
		if rawString(connection["fromNodeId"]) == nodeID || rawString(connection["toNodeId"]) == nodeID {
			result = append(result, connection)
		}
	}
	return result
}

func rawString(value json.RawMessage) string {
	var result string
	_ = json.Unmarshal(value, &result)
	return strings.TrimSpace(result)
}

func rawEqual(left, right json.RawMessage) bool {
	if len(left) == 0 && len(right) == 0 {
		return true
	}
	if len(left) == 0 {
		return string(right) == "null"
	}
	if len(right) == 0 {
		return string(left) == "null"
	}
	var leftValue, rightValue any
	if json.Unmarshal(left, &leftValue) != nil || json.Unmarshal(right, &rightValue) != nil {
		return string(left) == string(right)
	}
	return fmt.Sprintf("%v", leftValue) == fmt.Sprintf("%v", rightValue) || mustJSON(leftValue) == mustJSON(rightValue)
}

func rawMapMatches(current, expected map[string]json.RawMessage) bool {
	for key, value := range expected {
		if !rawEqual(current[key], value) {
			return false
		}
	}
	return true
}

func cloneJSONMap(value map[string]json.RawMessage) map[string]json.RawMessage {
	result := make(map[string]json.RawMessage, len(value))
	for key, item := range value {
		result[key] = append(json.RawMessage(nil), item...)
	}
	return result
}

func slicesEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func connectionMapsEqual(left, right []map[string]json.RawMessage) bool {
	if len(left) != len(right) {
		return false
	}
	leftByID := make(map[string]map[string]json.RawMessage, len(left))
	rightByID := make(map[string]map[string]json.RawMessage, len(right))
	for _, connection := range left {
		id := rawString(connection["id"])
		if id == "" || leftByID[id] != nil {
			return false
		}
		leftByID[id] = connection
	}
	for _, connection := range right {
		id := rawString(connection["id"])
		if id == "" || rightByID[id] != nil {
			return false
		}
		rightByID[id] = connection
	}
	for id, connection := range leftByID {
		other, ok := rightByID[id]
		if !ok || !rawMapMatches(connection, other) || !rawMapMatches(other, connection) {
			return false
		}
	}
	return true
}
