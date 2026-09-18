package app

import (
	"reflect"

	"infinite-canvas/backend/internal/repository"
)

// Persist the delta in the same transaction as the canvas and run checkpoint.
// Clients can project it without fetching the entire canvas for every task.
func cloudAgentCanvasEventRecorder(runID string, state *cloudAgentRuntime) cloudAgentMutationRecorder {
	return func(repo *repository.Repository, input cloudAgentMutationInput) error {
		if err := cloudAgentMutationRecorderForRun(runID)(repo, input); err != nil {
			return err
		}
		return emitCloudAgentCanvasChange(repo, runID, state, input)
	}
}

func cloudAgentObjectChanges(before, after any) []map[string]any {
	previous := map[string]map[string]any{}
	for _, item := range creationMaps(before) {
		previous[stringValue(item["id"])] = item
	}
	changes := []map[string]any{}
	for _, item := range creationMaps(after) {
		old := previous[stringValue(item["id"])]
		if !reflect.DeepEqual(old, item) {
			changes = append(changes, map[string]any{"before": old, "after": item})
		}
	}
	return changes
}

func emitCloudAgentCanvasChange(repo *repository.Repository, runID string, state *cloudAgentRuntime, input cloudAgentMutationInput) error {
	before, err := creationDocument(input.BeforeJSON)
	if err != nil {
		return err
	}
	canvas, err := repo.CanvasProjectForUser(input.UserID, input.CanvasID)
	if err != nil {
		return err
	}
	after, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return err
	}
	nodes := cloudAgentObjectChanges(before["nodes"], after["nodes"])
	edges := cloudAgentObjectChanges(before["connections"], after["connections"])
	if !cloudAgentPatchCoversDocument(before, after) {
		// A partial delta must never acknowledge a revision containing omitted edits.
		state.event(runID, "canvas_updated", map[string]any{"canvasId": input.CanvasID, "operation": input.Operation, "requiresRefresh": true})
		return nil
	}
	actions := []map[string]any{}
	previewByOperationAndNode := map[string]cloudAgentApprovalPreviewItem{}
	previewByUniqueNode := map[string]cloudAgentApprovalPreviewItem{}
	ambiguousPreviewNode := map[string]bool{}
	if inputPreview := input.Preview; inputPreview != nil {
		for _, item := range inputPreview.Items {
			if item.NodeID == "" {
				continue
			}
			previewByOperationAndNode[item.Operation+"\x00"+item.NodeID] = item
			if _, exists := previewByUniqueNode[item.NodeID]; exists {
				ambiguousPreviewNode[item.NodeID] = true
			} else {
				previewByUniqueNode[item.NodeID] = item
			}
		}
	}
	findPreview := func(operation, nodeID string) (cloudAgentApprovalPreviewItem, bool) {
		if item, ok := previewByOperationAndNode[operation+"\x00"+nodeID]; ok {
			return item, true
		}
		if !ambiguousPreviewNode[nodeID] {
			item, ok := previewByUniqueNode[nodeID]
			return item, ok
		}
		return cloudAgentApprovalPreviewItem{}, false
	}
	for _, change := range nodes {
		node := change["after"].(map[string]any)
		action := "updated"
		if old, _ := change["before"].(map[string]any); old == nil {
			action = "created"
		}
		entry := map[string]any{"action": action, "nodeId": node["id"], "title": node["title"], "nodeType": node["type"]}
		previewOperation := "update_node"
		if action == "created" {
			previewOperation = "add_node"
		}
		if preview, ok := findPreview(previewOperation, stringValue(node["id"])); ok {
			if preview.NodeTitle != "" {
				entry["title"] = preview.NodeTitle
			}
			if len(preview.Fields) > 0 {
				entry["fields"] = preview.Fields
			}
			if preview.ResultTitle != "" {
				entry["resultTitle"] = preview.ResultTitle
			}
			if preview.Summary != "" {
				entry["summary"] = preview.Summary
			}
		}
		actions = append(actions, entry)
	}
	byID, err := creationObjects(after["nodes"])
	if err != nil {
		return err
	}
	for _, change := range edges {
		edge := change["after"].(map[string]any)
		if node := byID[stringValue(edge["fromNodeId"])]; node != nil {
			entry := map[string]any{"action": "referenced", "nodeId": node["id"], "title": node["title"], "nodeType": node["type"], "targetNodeId": edge["toNodeId"]}
			if target := byID[stringValue(edge["toNodeId"])]; target != nil {
				entry["targetTitle"], entry["targetNodeType"] = target["title"], target["type"]
			}
			if preview, ok := findPreview("connect_nodes", stringValue(edge["fromNodeId"])); ok && preview.TargetNodeTitle != "" {
				entry["targetTitle"], entry["targetNodeType"] = preview.TargetNodeTitle, preview.TargetNodeType
				if preview.Summary != "" {
					entry["summary"] = preview.Summary
				}
			}
			actions = append(actions, entry)
		}
	}
	payload := map[string]any{
		"canvasId": input.CanvasID, "operation": input.Operation, "actions": actions,
		"canvasPatch": map[string]any{"canvasId": input.CanvasID, "baseRevision": canvas.Revision - 1, "revision": canvas.Revision, "updatedAt": after["updatedAt"], "nodes": nodes, "connections": edges},
	}
	if input.Preview != nil {
		payload["preview"] = input.Preview
		payload["text"] = input.Preview.Description
	}
	if state.CallIndex >= 0 && state.CallIndex < len(state.Calls) {
		payload["callId"] = state.Calls[state.CallIndex].ID
	}
	state.event(runID, "canvas_updated", payload)
	return nil
}

func cloudAgentPatchCoversDocument(before, after map[string]any) bool {
	for _, key := range []string{"nodes", "connections"} {
		old, next := creationMaps(before[key]), creationMaps(after[key])
		if len(next) < len(old) {
			return false
		}
		// The delta merger updates existing items in place and appends new items.
		for i, item := range old {
			if item["id"] != next[i]["id"] {
				return false
			}
		}
	}
	content := func(doc map[string]any) map[string]any {
		result := map[string]any{}
		for key, value := range doc {
			if key != "nodes" && key != "connections" && key != "updatedAt" && key != "viewport" {
				result[key] = value
			}
		}
		return result
	}
	return reflect.DeepEqual(content(before), content(after))
}
