package canvas

import (
	"encoding/json"
	"net/http"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

// Undo/redo of a local deletion restores only that actor's recorded deletion
// at the expected lifecycle. Content comes from the durable inverse, never a
// client snapshot. All nodes and their selected relations restore atomically.
func applyCanvasCollaborationHistoryRestore(tx *gorm.DB, project *model.CanvasProject, nodes, connections *[]map[string]json.RawMessage, actorID string, req CanvasCollaborationOperationRequest) error {
	if len(req.Nodes) == 0 {
		return kernel.BadAuthRequest("撤销删除缺少节点")
	}
	allowedEdges := map[string]map[string]json.RawMessage{}
	edgeLifecycles := map[string]map[string]int64{}
	restoredIDs := map[string]bool{}
	expected := make(map[string]int64, len(req.EndpointIncarnations))
	for id, incarnation := range req.EndpointIncarnations {
		expected[id] = incarnation
	}
	for _, node := range req.Nodes {
		id := rawString(node["id"])
		var metadata map[string]json.RawMessage
		_ = json.Unmarshal(node["metadata"], &metadata)
		var incarnation int64
		_ = json.Unmarshal(metadata["collaborationRestoreIncarnation"], &incarnation)
		if id == "" || incarnation <= 0 {
			return kernel.BadAuthRequest("撤销删除缺少存续代次")
		}
		var deletion model.CanvasCollaborationOperation
		if err := tx.Where("canvas_id = ? AND target_node_id = ? AND target_incarnation = ? AND actor_id = ? AND kind = ? AND result_status = ?", project.ID, id, incarnation, actorID, "delete_node", canvasCollabApplied).Order("revision DESC").First(&deletion).Error; err != nil {
			return kernel.NewAppError(http.StatusConflict, "无法撤销：没有本人在该存续代次的删除记录")
		}
		var snapshot canvasCollabDeletionSnapshot
		if json.Unmarshal([]byte(deletion.SnapshotJSON), &snapshot) != nil {
			return kernel.NewAppError(http.StatusConflict, "删除记录无法恢复")
		}
		for _, edge := range snapshot.Connections {
			edgeID := rawString(edge["id"])
			allowedEdges[edgeID] = edge
			edgeLifecycles[edgeID] = snapshot.EndpointIncarnations
		}
		if err := applyCanvasCollaborationNodeRestore(tx, project, nodes, connections, actorID, CanvasCollaborationOperationRequest{DeletionID: deletion.OpID}, &CanvasCollaborationOperationResult{}); err != nil {
			return err
		}
		expected[id] = incarnation + 1
		restoredIDs[id] = true
	}
	ids := map[string]bool{}
	for _, edge := range *connections {
		ids[rawString(edge["id"])] = true
	}
	for _, edge := range req.Connections {
		id := rawString(edge["id"])
		stored := allowedEdges[id]
		requestedJSON, _ := json.Marshal(edge)
		storedJSON, _ := json.Marshal(stored)
		if stored == nil || ids[id] || !rawEqual(requestedJSON, storedJSON) {
			return kernel.NewAppError(http.StatusConflict, "撤销删除的连线已改变")
		}
		lifecycles := map[string]int64{}
		for endpoint, incarnation := range edgeLifecycles[id] {
			lifecycles[endpoint] = incarnation
		}
		for endpoint := range restoredIDs {
			lifecycles[endpoint] = expected[endpoint]
		}
		if err := validateCanvasConnectionLifecycles(tx, project.ID, stored, lifecycles); err != nil {
			return err
		}
		*connections = append(*connections, cloneJSONMap(stored))
		ids[id] = true
	}
	return nil
}
