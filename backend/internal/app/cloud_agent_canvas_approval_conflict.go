package app

import (
	"reflect"
	"strings"

	agenttool "yingce/backend/internal/agent/tool"
	"yingce/backend/internal/repository"
)

// 在审批决定和最终写入的事务内共用校验，旧审批缺少快照时保守检查整图哈希。
func validateCloudAgentCanvasApproval(repo *repository.Repository, userID, canvasID string, approval *cloudAgentApproval) error {
	if approval == nil || approval.Call.Function.Name != agenttool.CanvasApplyOps {
		return nil
	}
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return err
	}
	var conflict bool
	if approval.CanvasBeforeJSON == "" {
		args, decodeErr := decodeCloudAgentCanvasArgs(approval.Call.Function.Arguments)
		if decodeErr != nil {
			return decodeErr
		}
		doc, documentErr := creationDocument(canvas.PayloadJSON)
		if documentErr != nil {
			return documentErr
		}
		conflict = cloudAgentCanvasHash(doc) != args.SnapshotHash
	} else {
		conflict, err = cloudAgentCanvasApprovalConflict(approval.CanvasBeforeJSON, canvas.PayloadJSON, approval.Call)
		if err != nil {
			return err
		}
	}
	if conflict {
		return creationConflict("用户已修改 Agent 待写入的画布字段，请重新读取后再申请操作")
	}
	return nil
}

// cloudAgentCanvasApprovalConflict reports only conflicts on fields that the
// pending Agent operation is going to write. Unrelated user edits can still be
// rebased onto the approved operation.
func cloudAgentCanvasApprovalConflict(beforeJSON, currentJSON string, call cloudAgentCall) (bool, error) {
	if call.Function.Name != agenttool.CanvasApplyOps {
		return false, nil
	}
	args, err := decodeCloudAgentCanvasArgs(call.Function.Arguments)
	if err != nil {
		return false, err
	}
	before, err := creationDocument(beforeJSON)
	if err != nil {
		return false, err
	}
	current, err := creationDocument(currentJSON)
	if err != nil {
		return false, err
	}
	beforeNodes := creationMaps(before["nodes"])
	currentNodes := creationMaps(current["nodes"])
	for _, op := range args.Ops {
		switch op.Type {
		case "add_node":
			if cloudAgentNodeIndex(currentNodes, op.ID) >= 0 {
				return true, nil
			}
		case "update_node":
			beforeIndex := cloudAgentNodeIndex(beforeNodes, op.ID)
			currentIndex := cloudAgentNodeIndex(currentNodes, op.ID)
			if beforeIndex < 0 || currentIndex < 0 {
				return true, nil
			}
			beforeNode, currentNode := beforeNodes[beforeIndex], currentNodes[currentIndex]
			if stringValue(beforeNode["type"]) != stringValue(currentNode["type"]) {
				return true, nil
			}
			for field := range op.Patch {
				beforeValue := cloudAgentCanvasPatchValue(beforeNode, field)
				currentValue := cloudAgentCanvasPatchValue(currentNode, field)
				if !reflect.DeepEqual(beforeValue, currentValue) {
					return true, nil
				}
			}
		case "connect_nodes":
			for _, edge := range creationMaps(current["connections"]) {
				if stringValue(edge["id"]) == op.ID {
					return true, nil
				}
			}
		}
	}
	return false, nil
}

func cloudAgentCanvasPatchValue(node map[string]any, field string) any {
	path := field
	if descriptor, ok := cloudAgentNodeCapabilityForNode(node); ok {
		if patchField, exists := descriptor.PatchFields[field]; exists {
			path = patchField.Path
		}
	}
	var value any = node
	for _, part := range strings.Split(path, ".") {
		object, ok := value.(map[string]any)
		if !ok {
			return nil
		}
		value = object[part]
	}
	return value
}
