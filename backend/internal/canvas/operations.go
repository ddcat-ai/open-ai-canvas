package canvas

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"time"
	"yingce/backend/internal/model"
)

var canvasOperationFields = []string{"title", "projectId", "chatSessions", "activeChatId", "starterMode", "appearance", "backgroundMode", "showImageInfo", "previsScenes", "timeline"}
var canvasOptionalOperationFields = map[string]struct{}{"projectId": {}, "starterMode": {}, "appearance": {}, "timeline": {}}

// CanvasOperationsRequest is the durable write envelope shared by the editor,
// Agent and media callbacks. MutationID is the retry identity: a lost response
// must be replayed with the same ID and payload.
type CanvasOperationsRequest struct {
	MutationID            string                  `json:"mutationId"`
	BaseRevision          *int64                  `json:"baseRevision,omitempty"`
	Operations            []CanvasOperation       `json:"operations"`
	EditProofs            []model.CanvasEditProof `json:"editProofs,omitempty"`
	TrustedServerMutation bool                    `json:"-"`
}

var (
	ErrCanvasOperationConflict = errors.New("画布操作冲突")
	ErrCanvasObjectMissing     = errors.New("画布对象不存在")
)

type CanvasOperation struct {
	Type        string                     `json:"type"`
	ID          string                     `json:"id,omitempty"`
	Node        json.RawMessage            `json:"node,omitempty"`
	Connection  json.RawMessage            `json:"connection,omitempty"`
	Field       string                     `json:"field,omitempty"`
	Value       json.RawMessage            `json:"value,omitempty"`
	Patch       map[string]json.RawMessage `json:"patch,omitempty"`
	Before      map[string]json.RawMessage `json:"before,omitempty"`
	BeforeValue json.RawMessage            `json:"beforeValue,omitempty"`
	Expected    json.RawMessage            `json:"expected,omitempty"`
}

func CanvasOperationsDigest(req CanvasOperationsRequest) string {
	// A committed mutation remains replayable after its transient lease expires.
	req.EditProofs = nil
	raw, _ := json.Marshal(req)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// DiffCanvasDocuments turns a full document into object-scoped operations.
// Existing nodes are patched by leaf path so concurrent writers can merge
// unrelated fields without replacing an entire node.
func DiffCanvasDocuments(before, after map[string]any) []CanvasOperation {
	operations := make([]CanvasOperation, 0)
	beforeNodes := indexedCanvasObjects(before["nodes"])
	afterNodes := indexedCanvasObjects(after["nodes"])
	for _, node := range orderedCanvasObjects(after["nodes"]) {
		id := canvasString(node["id"])
		previous, exists := beforeNodes[id]
		if !exists {
			operations = append(operations, CanvasOperation{Type: "create_node", Node: jsonRawValue(node)})
			continue
		}
		patch, previousValues := diffCanvasObject(previous, node, "")
		if len(patch) > 0 {
			operations = append(operations, CanvasOperation{Type: "patch_node", ID: id, Patch: patch, Before: previousValues})
		}
	}
	for _, node := range orderedCanvasObjects(before["nodes"]) {
		id := canvasString(node["id"])
		if _, exists := afterNodes[id]; !exists {
			operations = append(operations, CanvasOperation{Type: "remove_node", ID: id, Expected: jsonRawValue(node)})
		}
	}
	beforeEdges := indexedCanvasObjects(before["connections"])
	afterEdges := indexedCanvasObjects(after["connections"])
	for _, edge := range orderedCanvasObjects(after["connections"]) {
		id := canvasString(edge["id"])
		if previous, exists := beforeEdges[id]; !exists {
			operations = append(operations, CanvasOperation{Type: "create_connection", Connection: jsonRawValue(edge)})
		} else if !jsonEqual(previous, edge) {
			operations = append(operations, CanvasOperation{Type: "update_connection", ID: id, Connection: jsonRawValue(edge), Expected: jsonRawValue(previous)})
		}
	}
	for _, edge := range orderedCanvasObjects(before["connections"]) {
		id := canvasString(edge["id"])
		if _, exists := afterEdges[id]; !exists {
			operations = append(operations, CanvasOperation{Type: "remove_connection", ID: id, Expected: jsonRawValue(edge)})
		}
	}
	for _, field := range canvasOperationFields {
		if !jsonEqual(before[field], after[field]) {
			operations = append(operations, CanvasOperation{Type: "set_field", Field: field, Value: jsonRawValue(after[field]), BeforeValue: jsonRawValue(before[field])})
		}
	}
	return operations
}

func orderedCanvasObjects(value any) []map[string]any {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var values []map[string]any
	if json.Unmarshal(raw, &values) != nil {
		return nil
	}
	return values
}

func indexedCanvasObjects(value any) map[string]map[string]any {
	result := map[string]map[string]any{}
	for _, item := range orderedCanvasObjects(value) {
		if id := canvasString(item["id"]); id != "" {
			result[id] = item
		}
	}
	return result
}

func canvasString(value any) string {
	text, _ := value.(string)
	return text
}

func diffCanvasObject(before, after map[string]any, prefix string) (map[string]json.RawMessage, map[string]json.RawMessage) {
	patch, previous := map[string]json.RawMessage{}, map[string]json.RawMessage{}
	keys := map[string]bool{}
	for key := range before {
		keys[key] = true
	}
	for key := range after {
		keys[key] = true
	}
	ordered := make([]string, 0, len(keys))
	for key := range keys {
		ordered = append(ordered, key)
	}
	sort.Strings(ordered)
	for _, key := range ordered {
		path := key
		if prefix != "" {
			path = prefix + "." + key
		}
		oldValue, oldExists := before[key]
		newValue, newExists := after[key]
		if oldExists && newExists {
			oldObject, oldOK := oldValue.(map[string]any)
			newObject, newOK := newValue.(map[string]any)
			if oldOK && newOK {
				nested, nestedBefore := diffCanvasObject(oldObject, newObject, path)
				for k, v := range nested {
					patch[k] = v
				}
				for k, v := range nestedBefore {
					previous[k] = v
				}
				continue
			}
			if jsonEqual(oldValue, newValue) {
				continue
			}
		}
		if oldExists {
			previous[path] = jsonRawValue(oldValue)
		} else {
			previous[path] = json.RawMessage("null")
		}
		if newExists {
			patch[path] = jsonRawValue(newValue)
		} else {
			patch[path] = json.RawMessage("null")
		}
	}
	return patch, previous
}

func setCanvasPath(target map[string]any, path string, raw json.RawMessage) error {
	parts := strings.Split(path, ".")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		return errors.New("节点字段路径无效")
	}
	current := target
	for _, part := range parts[:len(parts)-1] {
		next, ok := current[part].(map[string]any)
		if !ok {
			next = map[string]any{}
			current[part] = next
		}
		current = next
	}
	key := parts[len(parts)-1]
	if string(raw) == "null" {
		delete(current, key)
		return nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	current[key] = value
	return nil
}

// canvasNodeBookkeepingFields 是节点顶层的写入簿记字段，补丁按后写覆盖，不参与冲突基线校验。
var canvasNodeBookkeepingFields = map[string]struct{}{"updatedAt": {}}

func canvasOperationConflict(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrCanvasOperationConflict, fmt.Sprintf(format, args...))
}

func canvasObjectMissing(id string) error {
	return fmt.Errorf("%w: 节点 %q 已删除，迟到更新未应用", ErrCanvasObjectMissing, id)
}

func canvasPathValue(target map[string]any, path string) (any, bool) {
	parts := strings.Split(path, ".")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		return nil, false
	}
	var current any = target
	for _, part := range parts {
		object, ok := current.(map[string]any)
		if !ok {
			return nil, false
		}
		value, exists := object[part]
		if !exists {
			return nil, false
		}
		current = value
	}
	return current, true
}

func hasTaskIdentityFence(node map[string]any, before map[string]json.RawMessage) bool {
	raw, ok := before["metadata.taskId"]
	if !ok {
		return false
	}
	var taskID string
	if json.Unmarshal(raw, &taskID) != nil || strings.TrimSpace(taskID) == "" {
		return false
	}
	actual, exists := canvasPathValue(node, "metadata.taskId")
	currentTaskID, ok := actual.(string)
	return exists && ok && currentTaskID == taskID
}

func taskTimestampPatchIsMergeable(patch map[string]json.RawMessage, before map[string]json.RawMessage) bool {
	raw, ok := patch["metadata.taskUpdatedAt"]
	if !ok || string(raw) == "null" {
		return false
	}
	var timestamp string
	if json.Unmarshal(raw, &timestamp) != nil || strings.TrimSpace(timestamp) == "" {
		return false
	}
	if _, hasTaskIDPatch := patch["metadata.taskId"]; hasTaskIDPatch {
		return false
	}
	if _, hasWholeMetadataPatch := patch["metadata"]; hasWholeMetadataPatch {
		return false
	}
	_, hasTaskIDBefore := before["metadata.taskId"]
	return hasTaskIDBefore
}

func taskPatchAlreadyApplied(node map[string]any, patch map[string]json.RawMessage, path string) bool {
	desired, ok := patch[path]
	if !ok {
		return false
	}
	actual, exists := canvasPathValue(node, path)
	return canvasExpectedValueMatches(actual, exists, desired)
}

func mergeTaskUpdatedAtMonotonically(node map[string]any, raw json.RawMessage) error {
	var incoming string
	if err := json.Unmarshal(raw, &incoming); err != nil || strings.TrimSpace(incoming) == "" {
		return errors.New("任务更新时间无效")
	}
	incomingTime, err := time.Parse(time.RFC3339Nano, incoming)
	if err != nil {
		return errors.New("任务更新时间无效")
	}
	current, exists := canvasPathValue(node, "metadata.taskUpdatedAt")
	if exists {
		currentText, ok := current.(string)
		if !ok {
			return errors.New("当前任务更新时间无效")
		}
		currentTime, err := time.Parse(time.RFC3339Nano, currentText)
		if err != nil {
			return errors.New("当前任务更新时间无效")
		}
		if !incomingTime.After(currentTime) {
			return nil
		}
	}
	return setCanvasPath(node, "metadata.taskUpdatedAt", raw)
}

func canvasExpectedValueMatches(actual any, exists bool, expected json.RawMessage) bool {
	if len(expected) == 0 {
		return true
	}
	if string(expected) == "null" {
		return !exists || actual == nil
	}
	if !exists {
		return false
	}
	var expectedValue any
	if json.Unmarshal(expected, &expectedValue) != nil {
		return false
	}
	return jsonEqual(actual, expectedValue)
}

func canvasObjectExpectedMatches(actual map[string]any, expected json.RawMessage) bool {
	if len(expected) == 0 {
		return true
	}
	var expectedValue map[string]any
	if json.Unmarshal(expected, &expectedValue) != nil {
		return false
	}
	return jsonEqual(actual, expectedValue)
}

func applyCanvasOperations(payload map[string]json.RawMessage, operations []CanvasOperation) error {
	nodes := orderedCanvasObjects(rawJSON(payload["nodes"]))
	connections := orderedCanvasObjects(rawJSON(payload["connections"]))
	for _, op := range operations {
		switch op.Type {
		case "create_node":
			var node map[string]any
			if err := json.Unmarshal(op.Node, &node); err != nil || canvasString(node["id"]) == "" {
				return fmt.Errorf("节点操作缺少有效节点")
			}
			id := canvasString(node["id"])
			if indexOfCanvasObject(nodes, id) >= 0 {
				return canvasOperationConflict("节点 %q 已存在，显式新增不能覆盖已有节点", id)
			}
			nodes = append(nodes, node)
		case "patch_node":
			if strings.TrimSpace(op.ID) == "" {
				return fmt.Errorf("节点补丁缺少 ID")
			}
			if len(op.Patch) == 0 || len(op.Before) == 0 {
				return fmt.Errorf("节点补丁缺少字段基线")
			}
			index := indexOfCanvasObject(nodes, op.ID)
			if index < 0 {
				return canvasObjectMissing(op.ID)
			}
			mergeTaskTimestamp := hasTaskIdentityFence(nodes[index], op.Before) && taskTimestampPatchIsMergeable(op.Patch, op.Before)
			for path, expected := range op.Before {
				if path == "id" {
					return fmt.Errorf("节点 ID 不可修改")
				}
				// updatedAt 只是写入簿记，服务端（Agent/生成回写）会随时刷新它；
				// 用它做基线会让任何被服务端触碰过的节点永久拒绝用户保存。
				if _, bookkeeping := canvasNodeBookkeepingFields[path]; bookkeeping {
					continue
				}
				// Task timestamps are produced by independent task observers. When the
				// task identity is fenced by the same operation's before map, merge the
				// timestamp monotonically instead of treating observer order as content.
				if path == "metadata.taskUpdatedAt" && mergeTaskTimestamp {
					continue
				}
				actual, exists := canvasPathValue(nodes[index], path)
				if !canvasExpectedValueMatches(actual, exists, expected) {
					if mergeTaskTimestamp && taskPatchAlreadyApplied(nodes[index], op.Patch, path) {
						continue
					}
					return canvasOperationConflict("节点 %q 的字段 %q 已被其他写入修改", op.ID, path)
				}
			}
			keys := make([]string, 0, len(op.Patch))
			for key := range op.Patch {
				if key == "id" {
					return fmt.Errorf("节点 ID 不可修改")
				}
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, path := range keys {
				if path == "metadata.taskUpdatedAt" && mergeTaskTimestamp {
					if err := mergeTaskUpdatedAtMonotonically(nodes[index], op.Patch[path]); err != nil {
						return err
					}
					continue
				}
				if err := setCanvasPath(nodes[index], path, op.Patch[path]); err != nil {
					return err
				}
			}
		case "remove_node":
			if strings.TrimSpace(op.ID) == "" {
				return fmt.Errorf("删除节点缺少 ID")
			}
			if len(op.Expected) == 0 {
				return fmt.Errorf("删除节点缺少对象基线")
			}
			index := indexOfCanvasObject(nodes, op.ID)
			if index < 0 {
				continue
			}
			if !canvasObjectExpectedMatches(nodes[index], op.Expected) {
				return canvasOperationConflict("节点 %q 已被其他写入修改，拒绝删除", op.ID)
			}
			nodes = append(nodes[:index], nodes[index+1:]...)
			next := connections[:0]
			for _, edge := range connections {
				if canvasString(edge["fromNodeId"]) != op.ID && canvasString(edge["toNodeId"]) != op.ID {
					next = append(next, edge)
				}
			}
			connections = next
		case "create_connection":
			var edge map[string]any
			if err := json.Unmarshal(op.Connection, &edge); err != nil || canvasString(edge["id"]) == "" {
				return fmt.Errorf("连线操作缺少有效连线")
			}
			fromID := canvasString(edge["fromNodeId"])
			toID := canvasString(edge["toNodeId"])
			if fromID == "" || toID == "" || indexOfCanvasObject(nodes, fromID) < 0 || indexOfCanvasObject(nodes, toID) < 0 {
				return fmt.Errorf("连线端点节点不存在")
			}
			id := canvasString(edge["id"])
			if indexOfCanvasObject(connections, id) >= 0 {
				return canvasOperationConflict("连线 %q 已存在，显式新增不能覆盖已有连线", id)
			}
			connections = append(connections, edge)
		case "update_connection":
			var edge map[string]any
			if err := json.Unmarshal(op.Connection, &edge); err != nil || canvasString(edge["id"]) == "" {
				return fmt.Errorf("连线更新操作缺少有效连线")
			}
			if strings.TrimSpace(op.ID) == "" || op.ID != canvasString(edge["id"]) {
				return fmt.Errorf("连线操作 ID 与对象 ID 不一致")
			}
			if len(op.Expected) == 0 {
				return fmt.Errorf("连线更新缺少对象基线")
			}
			fromID := canvasString(edge["fromNodeId"])
			toID := canvasString(edge["toNodeId"])
			if fromID == "" || toID == "" || indexOfCanvasObject(nodes, fromID) < 0 || indexOfCanvasObject(nodes, toID) < 0 {
				return fmt.Errorf("连线端点节点不存在")
			}
			index := indexOfCanvasObject(connections, op.ID)
			if index < 0 {
				return canvasObjectMissing("连线 " + op.ID)
			}
			if !canvasObjectExpectedMatches(connections[index], op.Expected) {
				return canvasOperationConflict("连线 %q 已被其他写入修改，拒绝覆盖", op.ID)
			}
			connections[index] = edge
		case "remove_connection":
			if strings.TrimSpace(op.ID) == "" {
				return fmt.Errorf("删除连线缺少 ID")
			}
			if len(op.Expected) == 0 {
				return fmt.Errorf("删除连线缺少对象基线")
			}
			index := indexOfCanvasObject(connections, op.ID)
			if index < 0 {
				continue
			}
			if !canvasObjectExpectedMatches(connections[index], op.Expected) {
				return canvasOperationConflict("连线 %q 已被其他写入修改，拒绝删除", op.ID)
			}
			connections = append(connections[:index], connections[index+1:]...)
		case "set_field":
			if !allowedCanvasOperationField(op.Field) {
				return fmt.Errorf("不支持的画布字段操作: 字段 %q", op.Field)
			}
			// Older clients serialized an undefined optional field by omitting the
			// property entirely. Treat that wire form as JSON null so the original
			// mutation ID and payload can be replayed safely after an upgrade. The
			// expected-value check below still rejects the write when the server
			// field is present, so this compatibility path cannot overwrite a value.
			value := op.Value
			if len(value) == 0 {
				if _, optional := canvasOptionalOperationFields[op.Field]; !optional {
					return fmt.Errorf("画布字段操作缺少 value: 字段 %q", op.Field)
				}
				value = json.RawMessage("null")
			}
			beforeValue := op.BeforeValue
			if len(beforeValue) == 0 {
				if _, optional := canvasOptionalOperationFields[op.Field]; !optional {
					return fmt.Errorf("画布字段操作缺少 beforeValue: 字段 %q", op.Field)
				}
				beforeValue = json.RawMessage("null")
			}
			if !canvasExpectedValueMatches(rawJSON(payload[op.Field]), payload[op.Field] != nil, beforeValue) {
				return canvasOperationConflict("画布字段 %q 已被其他写入修改", op.Field)
			}
			if string(value) == "null" {
				delete(payload, op.Field)
			} else {
				payload[op.Field] = append(json.RawMessage(nil), value...)
			}
		default:
			return fmt.Errorf("不支持的画布操作")
		}
	}
	payload["nodes"], _ = json.Marshal(nodes)
	payload["connections"], _ = json.Marshal(connections)
	return nil
}

func rawJSON(raw json.RawMessage) any {
	if len(raw) == 0 {
		return []any{}
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return []any{}
	}
	return value
}

func jsonRawValue(value any) json.RawMessage {
	raw, _ := json.Marshal(value)
	return raw
}

func jsonEqual(left, right any) bool { return reflect.DeepEqual(left, right) }

func indexOfCanvasObject(items []map[string]any, id string) int {
	for i, item := range items {
		if canvasString(item["id"]) == id {
			return i
		}
	}
	return -1
}

func allowedCanvasOperationField(field string) bool {
	for _, allowed := range canvasOperationFields {
		if field == allowed {
			return true
		}
	}
	return false
}
