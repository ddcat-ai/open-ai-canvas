package app

import (
	"errors"
	"strings"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// Delivery is a read projection, separate from the immutable turn lifecycle.
// A completed model turn does not prove that its media reached the canvas.
type CloudAgentDelivery struct {
	Status        string                   `json:"status"`
	PendingTitles []string                 `json:"pendingTitles"`
	Items         []CloudAgentDeliveryItem `json:"items"`
}

type CloudAgentDeliveryItem struct {
	TaskID string `json:"taskId"`
	NodeID string `json:"nodeId,omitempty"`
	Kind   string `json:"kind"`
	Status string `json:"status"`
}

func cloudAgentDeliveredNode(doc map[string]any, taskID, resourceID string) string {
	for _, node := range creationMaps(doc["nodes"]) {
		meta, _ := node["metadata"].(map[string]any)
		if stringValue(meta["taskId"]) == taskID && stringValue(meta["storageKey"]) == "resource:"+resourceID && stringValue(meta["status"]) == "success" {
			return stringValue(node["id"])
		}
	}
	return ""
}

func (s *Service) cloudAgentDelivery(run *model.CloudAgentExecution, state *cloudAgentRuntime) (*CloudAgentDelivery, error) {
	delivery := &CloudAgentDelivery{Status: "finished", PendingTitles: cloudAgentPendingPlanItems(state.Plan), Items: []CloudAgentDeliveryItem{}}
	canvas, err := s.repo.CanvasProjectForUser(run.UserID, state.Request.CanvasID)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	doc := map[string]any{}
	if err == nil {
		doc, err = creationDocument(canvas.PayloadJSON)
		if err != nil {
			return nil, err
		}
	}
	delivered, outstanding, failed := 0, 0, 0
	restored := map[string]bool{}
	for _, event := range state.Events {
		if event.Type == "result_restored" {
			restored[stringValue(event.Payload["taskId"])] = true
		}
	}
	seen := map[string]bool{}
	for _, id := range state.TaskIDs {
		if seen[id] {
			continue
		}
		seen[id] = true
		task, err := s.repo.TaskForUser(run.UserID, id)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		kind := strings.TrimPrefix(task.Type, "canvas_")
		if task.ProjectID != state.Request.CanvasID || (kind != "image" && kind != "video" && kind != "audio") {
			continue
		}
		item := CloudAgentDeliveryItem{TaskID: id, Kind: kind, Status: "failed"}
		switch task.Status {
		case model.TaskStatusQueued, model.TaskStatusRunning:
			item.Status = "pending"
		case model.TaskStatusSucceeded:
			item.Status = "unavailable"
			resourceID, _ := taskOutputResource(task.ResultJSON, task.Type)
			if resourceID != "" {
				resource, err := s.repo.ResourceForUser(run.UserID, resourceID)
				if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
					return nil, err
				}
				if err == nil && resource.Status == "ready" && strings.HasPrefix(resource.MimeType, kind+"/") {
					item.NodeID = cloudAgentDeliveredNode(doc, id, resourceID)
					if item.NodeID != "" {
						item.Status = "delivered"
					} else if restored[id] {
						item.Status = "restored_then_changed"
					} else if canvas != nil && canvas.ID != "" {
						item.Status = "restore_available"
					}
				}
			}
		}
		if item.Status == "delivered" {
			delivered++
		} else if item.Status == "failed" {
			failed++
		} else {
			outstanding++
		}
		delivery.Items = append(delivery.Items, item)
	}
	if outstanding > 0 || len(delivery.PendingTitles) > 0 {
		delivery.Status = "needs_attention"
		if delivered > 0 {
			delivery.Status = "partial"
		}
	} else if delivered > 0 {
		delivery.Status = "delivered"
		// A failed attempt may have been superseded by an approved retry. Do
		// not turn its immutable history into an unfulfilled creative goal.
		if failed > 0 {
			delivery.Status = "has_failures"
		}
	} else if failed > 0 {
		delivery.Status = "needs_attention"
	}
	if run.Status == "completed" {
		for _, event := range state.Events {
			if event.Type == "user_question" {
				delivery.Status = "awaiting_input"
			}
		}
	} else if !cloudAgentRunTerminal(run.Status) || run.CleanupPending {
		delivery.Status = "running"
	}
	return delivery, nil
}

// Explicit user action only: copy an existing owned output into a new node.
// This path never creates tasks or billing orders, nor overwrites a user's node.
func (s *Service) RestoreCloudAgentResult(userID, runID, taskID string) (map[string]any, error) {
	if err := validateCloudAgentID(taskID, "任务ID", 80); err != nil {
		return nil, err
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, err
	}
	result := map[string]any{}
	err = s.repo.MutateCloudAgent(userID, runID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		if !cloudAgentRunTerminal(current.Status) || current.CleanupPending {
			return creationConflict("请等待本轮停止后再恢复已有结果")
		}
		state, err := cloudAgentDecode(current)
		if err != nil {
			return err
		}
		if state.Request.PermissionMode == "read_only" || !cloudAgentContainsString(state.TaskIDs, taskID) {
			return BadAuthRequest("该任务不是本轮可恢复的生成结果")
		}
		task, err := repo.TaskForUser(userID, taskID)
		if err != nil {
			return err
		}
		kind := strings.TrimPrefix(task.Type, "canvas_")
		if task.ProjectID != state.Request.CanvasID || task.Status != model.TaskStatusSucceeded || (kind != "image" && kind != "video" && kind != "audio") {
			return BadAuthRequest("只有当前画布中已成功的媒体任务可以恢复")
		}
		resourceID, _ := taskOutputResource(task.ResultJSON, task.Type)
		resource, err := repo.ResourceForUser(userID, resourceID)
		if err != nil {
			return err
		}
		if resource.Status != "ready" || !strings.HasPrefix(resource.MimeType, kind+"/") {
			return BadAuthRequest("任务结果资源尚不可用")
		}
		canvas, err := repo.CanvasProjectForUser(userID, state.Request.CanvasID)
		if err != nil {
			return err
		}
		doc, err := creationDocument(canvas.PayloadJSON)
		if err != nil {
			return err
		}
		if id := cloudAgentDeliveredNode(doc, taskID, resourceID); id != "" {
			result = map[string]any{"nodeId": id, "restored": true}
			return nil
		}
		for _, event := range state.Events {
			if event.Type == "result_restored" && stringValue(event.Payload["taskId"]) == taskID {
				return creationConflict("该结果已恢复过，节点随后被修改或移除；未重复添加，请从素材库重新添加")
			}
		}
		x, y := 80.0, 80.0
		nodes := creationMaps(doc["nodes"])
		for _, node := range nodes {
			position, _ := node["position"].(map[string]any)
			nx, _ := position["x"].(float64)
			width, _ := node["width"].(float64)
			if nx+width+80 > x {
				x = nx + width + 80
			}
		}
		nodeID := "agent-restored-" + newID()
		meta := map[string]any{"content": resourceFileURL(resourceID), "storageKey": "resource:" + resourceID, "status": "success", "taskId": taskID, "taskStatus": string(task.Status), "naturalWidth": resource.Width, "naturalHeight": resource.Height}
		node := creationAddedNode(CreationCanvasOp{Type: "add_node", ID: nodeID, NodeType: kind, Title: "恢复的生成结果", X: &x, Y: &y, Metadata: meta})
		if resource.Width > 0 && resource.Height > 0 {
			node["width"] = float64(360)
			node["height"] = 360 * float64(resource.Height) / float64(resource.Width)
		}
		beforeJSON, beforeHash := canvas.PayloadJSON, cloudAgentCanvasHash(doc)
		doc["nodes"] = append(nodes, node)
		if err := saveCloudAgentDocument(repo, canvas, doc, policy); err != nil {
			return err
		}
		if err := cloudAgentCanvasEventRecorder(runID, &state)(repo, cloudAgentMutationInput{UserID: userID, CanvasID: canvas.ID, StepID: "restore:" + taskID, Operation: "restore_result", BeforeJSON: beforeJSON, BeforeSnapshotHash: beforeHash, AfterSnapshotHash: cloudAgentCanvasHash(doc)}); err != nil {
			return err
		}
		state.event(runID, "result_restored", map[string]any{"taskId": taskID, "nodeId": nodeID, "text": "已有结果已添加到画布，未重新生成或扣费"})
		if err := cloudAgentSave(current, &state); err != nil {
			return err
		}
		result = map[string]any{"nodeId": nodeID, "restored": true}
		return nil
	})
	return result, err
}
