package app

import (
	"encoding/json"
	"reflect"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

type CreationCanvasOp struct {
	Type         string         `json:"type"`
	ID           string         `json:"id,omitempty"`
	NodeType     string         `json:"nodeType,omitempty"`
	Title        string         `json:"title,omitempty"`
	Position     map[string]any `json:"position,omitempty"`
	X            *float64       `json:"x,omitempty"`
	Y            *float64       `json:"y,omitempty"`
	Width        *float64       `json:"width,omitempty"`
	Height       *float64       `json:"height,omitempty"`
	Metadata     map[string]any `json:"metadata,omitempty"`
	Patch        map[string]any `json:"patch,omitempty"`
	FromNodeID   string         `json:"fromNodeId,omitempty"`
	ToNodeID     string         `json:"toNodeId,omitempty"`
	FromHandleID string         `json:"fromHandleId,omitempty"`
	ToHandleID   string         `json:"toHandleId,omitempty"`
	IDs          []string       `json:"ids,omitempty"`
}

func validateCreationOps(ops []CreationCanvasOp) error {
	if len(ops) == 0 || len(ops) > 100 {
		return BadAuthRequest("方案必须包含 1 到 100 项明确画布操作")
	}
	if err := validateCreationJSON(ops); err != nil {
		return err
	}
	ids := map[string]bool{}
	for _, op := range ops {
		switch op.Type {
		case "add_node":
			if op.ID == "" || ids[op.ID] {
				return BadAuthRequest("新增节点必须使用不重复的稳定 ID")
			}
			ids[op.ID] = true
			switch op.NodeType {
			case "image", "video", "text", "markdown", "frame", "script":
			default:
				return BadAuthRequest("该节点类型不在本期创作范围")
			}
		case "update_node":
			if op.ID == "" {
				return BadAuthRequest("更新节点缺少 ID")
			}
			for key := range op.Patch {
				switch key {
				case "title", "position", "width", "height", "metadata":
				default:
					return BadAuthRequest("方案包含不支持的节点更新字段")
				}
			}
		case "connect_nodes":
			if op.ID == "" || op.FromNodeID == "" || op.ToNodeID == "" {
				return BadAuthRequest("连线必须有稳定 ID 和两个端点")
			}
		case "select_nodes":
		default:
			return BadAuthRequest("创作方案仅允许新增、连线、更新和选择节点")
		}
	}
	return nil
}
func mergeCreationMaps(left, right map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range left {
		out[k] = v
	}
	for k, v := range right {
		out[k] = v
	}
	return out
}
func creationDocument(raw string) (map[string]any, error) {
	var doc map[string]any
	err := json.Unmarshal([]byte(raw), &doc)
	if doc == nil && err == nil {
		return nil, BadAuthRequest("画布文档格式无效")
	}
	return doc, err
}

func creationApprovalBaseline(raw string, ops []CreationCanvasOp) (string, error) {
	doc, err := creationDocument(raw)
	if err != nil {
		return "", err
	}
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return "", err
	}
	selected := []any{}
	for _, op := range ops {
		if op.Type != "update_node" {
			continue
		}
		node := nodes[op.ID]
		if node == nil {
			return "", creationConflict("待修改节点不存在")
		}
		baseline := map[string]any{"id": op.ID}
		for key := range op.Patch {
			if key != "metadata" {
				baseline[key] = node[key]
			}
		}
		metadata, _ := node["metadata"].(map[string]any)
		patch, _ := op.Patch["metadata"].(map[string]any)
		saved := map[string]any{}
		for key := range mergeCreationMaps(patch, op.Metadata) {
			saved[key] = metadata[key]
		}
		baseline["metadata"] = saved
		selected = append(selected, baseline)
	}
	value := map[string]any{"nodes": selected}
	if err = validateCreationJSON(value); err != nil {
		return "", err
	}
	b, err := json.Marshal(value)
	return string(b), err
}
func (s *Service) CreationCanvasSnapshot(userID, id string) (map[string]any, error) {
	run, err := s.repo.CreationRun(userID, id)
	if err != nil {
		return nil, creationError(err)
	}
	canvas, err := s.repo.CanvasProjectForUser(userID, run.CanvasID)
	if err != nil {
		return nil, creationError(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	return map[string]any{"document": doc, "snapshotHash": creationHash(doc)}, err
}
func (s *Service) CreateRunCanvas(userID, id string, req CreationRequest) (map[string]any, error) {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	var out map[string]any
	err := s.repo.MutateCreationRun(userID, id, func(run *model.CreationRun, repo *repository.Repository) error {
		if err := validateCreationGuard(run, req.CreationGuard); err != nil {
			return err
		}
		if run.Status == "paused" || run.Status == "cancelled" {
			return creationConflict("请先恢复创作任务")
		}
		if run.ApprovedAt == nil {
			return creationConflict("请先确认方案")
		}
		if run.CanvasID != "" {
			if _, err := repo.CanvasProjectForUser(userID, run.CanvasID); err != nil {
				return creationConflict("已关联画布失效，请核对后继续")
			}
			out = map[string]any{"run": creationRunOutput(*run), "canvasId": run.CanvasID}
			return nil
		}
		now := time.Now()
		cid := newID()
		doc := map[string]any{"id": cid, "title": "智能创作", "createdAt": now.Format(time.RFC3339Nano), "updatedAt": now.Format(time.RFC3339Nano), "nodes": []any{}, "connections": []any{}, "chatSessions": []any{}, "activeChatId": nil, "backgroundMode": "dots", "showImageInfo": true, "viewport": map[string]any{"x": 0, "y": 0, "k": 1}, "directorScenes": []any{}}
		raw, _ := json.Marshal(doc)
		canvas := model.CanvasProject{ID: cid, UserID: userID, Title: "智能创作", PayloadJSON: string(raw), CreatedAt: now, UpdatedAt: now}
		policy, err := s.RuntimePolicy()
		if err != nil {
			return err
		}
		usage, err := repo.UserStorageUsage(userID)
		if err != nil {
			return err
		}
		if err = validateStructuredStorageQuotaWithPolicy(usage, "canvas", true, int64(len(raw)), policy.Resource); err != nil {
			return err
		}
		if err = repo.CreateCreationCanvas(&canvas); err != nil {
			return err
		}
		run.CanvasID = cid
		run.Revision++
		run.Status = "waiting_canvas"
		out = map[string]any{"run": creationRunOutput(*run), "canvasId": cid}
		return nil
	})
	return out, creationError(err)
}
func (s *Service) CommitCreationCanvas(userID, id string, req CreationRequest) (map[string]any, error) {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	if err := validateSyncedPayload(req.Document, "画布"); err != nil {
		return nil, err
	}
	if err := validateCreationJSON(req.Document); err != nil {
		return nil, err
	}
	if err := s.validateCanvasMediaAssets(userID, req.Document); err != nil {
		return nil, err
	}
	doc, err := creationDocument(string(req.Document))
	if err != nil {
		return nil, err
	}
	var out map[string]any
	err = s.repo.MutateCreationRun(userID, id, func(run *model.CreationRun, repo *repository.Repository) error {
		if err := validateCreationGuard(run, req.CreationGuard); err != nil {
			return err
		}
		if run.Status == "paused" || run.Status == "cancelled" {
			return creationConflict("请先恢复创作任务")
		}
		if run.ApprovedAt == nil {
			return creationConflict("当前方案尚未批准")
		}
		canvas, err := repo.CanvasProjectForUser(userID, run.CanvasID)
		if err != nil {
			return err
		}
		before, err := creationDocument(canvas.PayloadJSON)
		if err != nil {
			return err
		}
		if creationHash(before) != req.ExpectedSnapshotHash {
			return creationConflict("画布已变化，请重新读取后核对")
		}
		var ops []CreationCanvasOp
		if err = json.Unmarshal([]byte(run.ApprovedOperationsJSON), &ops); err != nil {
			return err
		}
		if err = validateCreationCanvasDiff(repo, userID, run, before, doc, ops); err != nil {
			return err
		}
		previous := canvas.PayloadJSON
		canvas.PayloadJSON = string(req.Document)
		policy, err := s.RuntimePolicy()
		if err != nil {
			return err
		}
		usage, err := repo.UserStorageUsage(userID)
		if err != nil {
			return err
		}
		if err = validateStructuredStorageQuotaWithPolicy(usage, "canvas", false, int64(len(req.Document)-len(previous)), policy.Resource); err != nil {
			return err
		}
		if err = repo.CompareSaveCreationCanvas(canvas, previous); err != nil {
			return err
		}
		out = map[string]any{"snapshotHash": creationHash(doc)}
		return nil
	})
	return out, creationError(err)
}
func creationObjects(value any) (map[string]map[string]any, error) {
	list, ok := value.([]any)
	if !ok {
		return nil, BadAuthRequest("画布节点或连线格式无效")
	}
	out := map[string]map[string]any{}
	for _, raw := range list {
		item, ok := raw.(map[string]any)
		if !ok {
			return nil, BadAuthRequest("画布对象格式无效")
		}
		id := stringValue(item["id"])
		if id == "" || out[id] != nil {
			return nil, BadAuthRequest("画布对象 ID 缺失或重复")
		}
		out[id] = item
	}
	return out, nil
}
func validateCreationCanvasDiff(repo *repository.Repository, userID string, run *model.CreationRun, before, after map[string]any, ops []CreationCanvasOp) error {
	baselineNodes := map[string]map[string]any{}
	if run.ApprovedCanvasJSON != "" {
		baseline, e := creationDocument(run.ApprovedCanvasJSON)
		if e != nil {
			return e
		}
		baselineNodes, e = creationObjects(baseline["nodes"])
		if e != nil {
			return e
		}
	}
	for key, value := range before {
		if key == "nodes" || key == "connections" || key == "updatedAt" {
			continue
		}
		if !reflect.DeepEqual(value, after[key]) {
			return creationConflict("画布提交修改了方案外内容")
		}
	}
	for key := range after {
		if _, ok := before[key]; !ok && key != "updatedAt" {
			return creationConflict("画布提交包含方案外字段")
		}
	}
	oldNodes, err := creationObjects(before["nodes"])
	if err != nil {
		return err
	}
	newNodes, err := creationObjects(after["nodes"])
	if err != nil {
		return err
	}
	oldEdges, err := creationObjects(before["connections"])
	if err != nil {
		return err
	}
	newEdges, err := creationObjects(after["connections"])
	if err != nil {
		return err
	}
	add := map[string]CreationCanvasOp{}
	updates := map[string][]CreationCanvasOp{}
	edges := map[string]CreationCanvasOp{}
	approved := map[string]bool{}
	for _, op := range ops {
		switch op.Type {
		case "add_node":
			add[op.ID] = op
			approved[op.ID] = true
		case "update_node":
			updates[op.ID] = append(updates[op.ID], op)
			approved[op.ID] = true
		case "connect_nodes":
			edges[op.ID] = op
		}
	}
	for id, old := range oldNodes {
		next := newNodes[id]
		if next == nil {
			return creationConflict("不允许删除已有节点")
		}
		if reflect.DeepEqual(old, next) {
			continue
		}
		expected := mergeCreationMaps(old, nil)
		metadata, _ := old["metadata"].(map[string]any)
		metadata = mergeCreationMaps(metadata, nil)
		for _, op := range updates[id] {
			if baseline := baselineNodes[id]; baseline != nil {
				for key, want := range op.Patch {
					if key == "metadata" {
						continue
					}
					if !reflect.DeepEqual(old[key], baseline[key]) && !reflect.DeepEqual(old[key], want) {
						return creationConflict("节点已被手工编辑，请重新确认修改范围")
					}
				}
				baselineMeta, _ := baseline["metadata"].(map[string]any)
				patchMeta, _ := op.Patch["metadata"].(map[string]any)
				for key, want := range mergeCreationMaps(patchMeta, op.Metadata) {
					if !reflect.DeepEqual(metadata[key], baselineMeta[key]) && !reflect.DeepEqual(metadata[key], want) {
						return creationConflict("节点内容已被手工编辑，请重新确认")
					}
				}
			}
			for key, value := range op.Patch {
				if key == "metadata" {
					m, _ := value.(map[string]any)
					metadata = mergeCreationMaps(metadata, m)
				} else {
					expected[key] = value
				}
			}
			metadata = mergeCreationMaps(metadata, op.Metadata)
		}
		expected["metadata"] = metadata
		if reflect.DeepEqual(expected, next) {
			continue
		}
		if !approved[id] {
			return creationConflict("不能修改方案外节点")
		}
		actualMeta, _ := next["metadata"].(map[string]any)
		withoutMeta := mergeCreationMaps(next, nil)
		withoutMeta["metadata"] = metadata
		if !reflect.DeepEqual(expected, withoutMeta) {
			return creationConflict("节点字段超出批准范围")
		}
		if err := validateCreationResultMetadata(repo, userID, run.ID, id, metadata, actualMeta); err != nil {
			return err
		}
	}
	for id, node := range newNodes {
		if oldNodes[id] != nil {
			continue
		}
		op, ok := add[id]
		if !ok {
			return creationConflict("节点未获方案批准")
		}
		expected := creationAddedNode(op)
		if !reflect.DeepEqual(expected, node) {
			return creationConflict("新增节点参数与批准方案不同")
		}
	}
	for id, edge := range oldEdges {
		if !reflect.DeepEqual(edge, newEdges[id]) {
			return creationConflict("不允许修改或删除已有连线")
		}
	}
	for id, edge := range newEdges {
		if oldEdges[id] != nil {
			continue
		}
		op, ok := edges[id]
		if !ok {
			return creationConflict("连线未获批准")
		}
		expected := map[string]any{"id": id, "fromNodeId": op.FromNodeID, "toNodeId": op.ToNodeID}
		if op.FromHandleID != "" {
			expected["fromHandleId"] = op.FromHandleID
		}
		if op.ToHandleID != "" {
			expected["toHandleId"] = op.ToHandleID
		}
		if !reflect.DeepEqual(expected, edge) || newNodes[op.FromNodeID] == nil || newNodes[op.ToNodeID] == nil {
			return creationConflict("连线参数与批准范围不同")
		}
	}
	return nil
}
func creationAddedNode(op CreationCanvasOp) map[string]any {
	width, height, title := 340.0, 240.0, "Note"
	metadata := map[string]any{"content": "", "status": "idle"}
	switch op.NodeType {
	case "image":
		width, height, title = 720, 405, "图片"
	case "video":
		width, height, title = 720, 405, "视频"
	case "markdown":
		width, height, title = 420, 320, "Markdown"
	case "frame":
		width, height, title = 760, 520, "未命名背板"
		metadata = map[string]any{"frame": map[string]any{"collapsed": false, "expandedWidth": float64(760), "expandedHeight": float64(520)}}
	case "script":
		width, height, title = 920, 360, "分镜脚本"
		metadata = map[string]any{"status": "idle", "workflowKind": "script", "storyboard": map[string]any{"rows": []any{}, "visibleColumns": []any{"shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"}, "referenceNodeIds": []any{}}}
	case "text":
		metadata["fontSize"] = float64(14)
	}
	if op.Width != nil {
		width = *op.Width
	}
	if op.Height != nil {
		height = *op.Height
	}
	if op.Title != "" {
		title = op.Title
	}
	position := op.Position
	if position == nil {
		position = map[string]any{"x": float64(0), "y": float64(0)}
		if op.X != nil {
			position["x"] = *op.X
		}
		if op.Y != nil {
			position["y"] = *op.Y
		}
	}
	return map[string]any{"id": op.ID, "type": op.NodeType, "title": title, "position": position, "width": width, "height": height, "metadata": mergeCreationMaps(metadata, op.Metadata)}
}
func validateCreationResultMetadata(repo *repository.Repository, userID, runID, nodeID string, before, after map[string]any) error {
	taskID := stringValue(after["taskId"])
	if taskID == "" {
		taskID = stringValue(after["generationTaskId"])
	}
	if taskID == "" {
		return creationConflict("结果回写缺少真实任务")
	}
	items, err := repo.CreationSubmissions(userID, runID)
	if err != nil {
		return err
	}
	found := false
	for _, item := range items {
		if item.TaskID == nil || *item.TaskID != taskID {
			continue
		}
		var request CreateTaskRequest
		_ = json.Unmarshal([]byte(item.RequestJSON), &request)
		if stringValue(request.Input["nodeId"]) == nodeID {
			found = true
			break
		}
	}
	if !found {
		return creationConflict("任务不属于当前创作节点")
	}
	task, err := repo.TaskForUser(userID, taskID)
	if err != nil {
		return err
	}
	if task.Status != model.TaskStatusSucceeded {
		return creationConflict("生成任务尚未成功")
	}
	var result any
	if err = json.Unmarshal([]byte(task.ResultJSON), &result); err != nil {
		return err
	}
	storageKey := stringValue(after["storageKey"])
	if !strings.HasPrefix(storageKey, "resource:") || !creationResultContains(result, []string{"storageKey"}, storageKey) {
		return creationConflict("回写素材不是任务生成资源")
	}
	resource, err := repo.ResourceForUser(userID, strings.TrimPrefix(storageKey, "resource:"))
	if err != nil {
		return err
	}
	if resource.Status != model.ResourceStatusReady {
		return creationConflict("任务资源尚未就绪")
	}
	for key := range before {
		if _, ok := after[key]; !ok {
			return creationConflict("结果回写不能移除已有字段")
		}
	}
	for key, value := range after {
		if reflect.DeepEqual(value, before[key]) {
			continue
		}
		switch key {
		case "taskId", "generationTaskId":
			if value != taskID {
				return creationConflict("任务引用不匹配")
			}
		case "status":
			if value != "success" {
				return creationConflict("结果状态不匹配")
			}
		case "assetId":
			assets, e := repo.AssetsForUserIDs(userID, []string{stringValue(value)})
			if e != nil {
				return e
			}
			if len(assets) != 1 || !documentReferencesResources(assets[0].PayloadJSON, map[string]struct{}{resource.ID: {}}) {
				return creationConflict("素材记录不属于任务结果资源")
			}
		case "content", "storageKey", "naturalWidth", "naturalHeight", "durationMs", "bytes", "mimeType":
			resourceValue := map[string]any{"content": "/api/resources/" + resource.ID + "/file", "storageKey": storageKey, "naturalWidth": float64(resource.Width), "naturalHeight": float64(resource.Height), "durationMs": float64(resource.DurationMs), "bytes": float64(resource.Size), "mimeType": resource.MimeType}
			if reflect.DeepEqual(value, resourceValue[key]) {
				continue
			}
			keys := map[string][]string{"content": {"url", "imageUrl", "videoUrl", "content"}, "storageKey": {"storageKey"}, "naturalWidth": {"width", "naturalWidth"}, "naturalHeight": {"height", "naturalHeight"}, "durationMs": {"durationMs"}, "bytes": {"bytes", "size"}, "mimeType": {"mimeType"}}
			if !creationResultContains(result, keys[key], value) {
				return creationConflict("回写资源字段不属于真实任务结果")
			}
		default:
			return creationConflict("结果回写试图修改手工字段")
		}
	}
	return nil
}
func creationResultContains(value any, keys []string, want any) bool {
	switch v := value.(type) {
	case map[string]any:
		for key, child := range v {
			for _, allowed := range keys {
				if key == allowed && reflect.DeepEqual(child, want) {
					return true
				}
			}
			if creationResultContains(child, keys, want) {
				return true
			}
		}
	case []any:
		for _, child := range v {
			if creationResultContains(child, keys, want) {
				return true
			}
		}
	}
	return false
}
