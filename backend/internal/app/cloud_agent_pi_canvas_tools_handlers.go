package app

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"infinite-canvas/backend/internal/model"
)

// Canvas Tool Handlers - 工具处理器实现

// handleNodeCreate 处理创建节点
func (r *CanvasToolRegistry) handleNodeCreate(ctx context.Context, userID, runID string, args map[string]any) (any, error) {
	// 解析参数
	nodeType, _ := args["type"].(string)
	content, _ := args["content"].(string)

	var position *model.CanvasPosition
	if pos, ok := args["position"].(map[string]any); ok {
		x, _ := pos["x"].(float64)
		y, _ := pos["y"].(float64)
		position = &model.CanvasPosition{X: x, Y: y}
	}

	var size *model.CanvasSize
	if sz, ok := args["size"].(map[string]any); ok {
		width, _ := sz["width"].(float64)
		height, _ := sz["height"].(float64)
		size = &model.CanvasSize{Width: width, Height: height}
	}

	var parentID *string
	if pid, ok := args["parentId"].(string); ok && pid != "" {
		parentID = &pid
	}

	metadata, _ := args["metadata"].(map[string]interface{})

	// 获取画布ID
	run, err := r.service.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, fmt.Errorf("get run: %w", err)
	}

	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, fmt.Errorf("decode state: %w", err)
	}

	// 创建节点
	node := model.CanvasNode{
		Type:     nodeType,
		Content:  content,
		Position: position,
		Size:     size,
		ParentID: parentID,
		Metadata: metadata,
	}

	created, err := r.service.repo.CreateCanvasNode(userID, state.Request.CanvasID, node)
	if err != nil {
		return nil, fmt.Errorf("create node: %w", err)
	}

	return map[string]any{
		"success": true,
		"nodeId":  created.ID,
		"node":    created,
		"message": fmt.Sprintf("✅ 已创建 %s 节点：%s", nodeType, created.ID),
	}, nil
}

// handleNodeRead 处理读取节点
func (r *CanvasToolRegistry) handleNodeRead(ctx context.Context, userID, runID string, args map[string]any) (any, error) {
	nodeID, _ := args["nodeId"].(string)
	includeChildren, _ := args["includeChildren"].(bool)

	run, err := r.service.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, fmt.Errorf("get run: %w", err)
	}

	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, fmt.Errorf("decode state: %w", err)
	}

	node, err := r.service.repo.CanvasNode(userID, state.Request.CanvasID, nodeID)
	if err != nil {
		return nil, fmt.Errorf("get node: %w", err)
	}

	result := map[string]any{
		"success": true,
		"node":    node,
	}

	if includeChildren && len(node.Children) > 0 {
		children := make([]model.CanvasNode, 0, len(node.Children))
		for _, childID := range node.Children {
			child, err := r.service.repo.CanvasNode(userID, state.Request.CanvasID, childID)
			if err == nil {
				children = append(children, child)
			}
		}
		result["children"] = children
	}

	return result, nil
}

// handleNodeUpdate 处理更新节点
func (r *CanvasToolRegistry) handleNodeUpdate(ctx context.Context, userID, runID string, args map[string]any) (any, error) {
	nodeID, _ := args["nodeId"].(string)

	run, err := r.service.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, fmt.Errorf("get run: %w", err)
	}

	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, fmt.Errorf("decode state: %w", err)
	}

	// 构建更新对象
	update := model.CanvasNodeUpdate{}

	if content, ok := args["content"].(string); ok {
		update.Content = &content
	}

	if pos, ok := args["position"].(map[string]any); ok {
		x, _ := pos["x"].(float64)
		y, _ := pos["y"].(float64)
		update.Position = &model.CanvasPosition{X: x, Y: y}
	}

	if sz, ok := args["size"].(map[string]any); ok {
		width, _ := sz["width"].(float64)
		height, _ := sz["height"].(float64)
		update.Size = &model.CanvasSize{Width: width, Height: height}
	}

	if metadata, ok := args["metadata"].(map[string]interface{}); ok {
		update.Metadata = metadata
	}

	updated, err := r.service.repo.UpdateCanvasNode(userID, state.Request.CanvasID, nodeID, update)
	if err != nil {
		return nil, fmt.Errorf("update node: %w", err)
	}

	return map[string]any{
		"success": true,
		"node":    updated,
		"message": fmt.Sprintf("✅ 已更新节点：%s", nodeID),
	}, nil
}

// handleNodeDelete 处理删除节点
func (r *CanvasToolRegistry) handleNodeDelete(ctx context.Context, userID, runID string, args map[string]any) (any, error) {
	nodeID, _ := args["nodeId"].(string)
	reason, _ := args["reason"].(string)
	recursive, _ := args["recursive"].(bool)

	run, err := r.service.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, fmt.Errorf("get run: %w", err)
	}

	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, fmt.Errorf("decode state: %w", err)
	}

	// 删除节点
	if err := r.service.repo.DeleteCanvasNode(userID, state.Request.CanvasID, nodeID, recursive); err != nil {
		return nil, fmt.Errorf("delete node: %w", err)
	}

	return map[string]any{
		"success": true,
		"message": fmt.Sprintf("✅ 已删除节点：%s（原因：%s）", nodeID, reason),
	}, nil
}

// handleNodeMove 处理移动节点
func (r *CanvasToolRegistry) handleNodeMove(ctx context.Context, userID, runID string, args map[string]any) (any, error) {
	nodeID, _ := args["nodeId"].(string)

	run, err := r.service.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, fmt.Errorf("get run: %w", err)
	}

	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, fmt.Errorf("decode state: %w", err)
	}

	update := model.CanvasNodeUpdate{}

	// 更新位置
	if pos, ok := args["position"].(map[string]any); ok {
		x, _ := pos["x"].(float64)
		y, _ := pos["y"].(float64)
		update.Position = &model.CanvasPosition{X: x, Y: y}
	}

	// 更新父节点
	if newParentID, ok := args["newParentId"].(string); ok {
		if newParentID == "" {
			emptyParentID := ""
			update.ParentID = &emptyParentID
		} else {
			update.ParentID = &newParentID
		}
	}

	updated, err := r.service.repo.UpdateCanvasNode(userID, state.Request.CanvasID, nodeID, update)
	if err != nil {
		return nil, fmt.Errorf("move node: %w", err)
	}

	return map[string]any{
		"success": true,
		"node":    updated,
		"message": fmt.Sprintf("✅ 已移动节点：%s", nodeID),
	}, nil
}

// handleNodeDuplicate 处理复制节点
func (r *CanvasToolRegistry) handleNodeDuplicate(ctx context.Context, userID, runID string, args map[string]any) (any, error) {
	nodeID, _ := args["nodeId"].(string)
	includeChildren, _ := args["includeChildren"].(bool)

	run, err := r.service.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, fmt.Errorf("get run: %w", err)
	}

	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, fmt.Errorf("decode state: %w", err)
	}

	// 读取原节点
	original, err := r.service.repo.CanvasNode(userID, state.Request.CanvasID, nodeID)
	if err != nil {
		return nil, fmt.Errorf("get original node: %w", err)
	}

	// 创建副本
	duplicate := model.CanvasNode{
		Type:     original.Type,
		Content:  original.Content + " (副本)",
		Position: original.Position,
		Size:     original.Size,
		ParentID: original.ParentID,
		Metadata: original.Metadata,
	}

	// 调整位置（偏移）
	if duplicate.Position != nil {
		duplicate.Position.X += 50
		duplicate.Position.Y += 50
	}

	// 如果指定了新位置
	if pos, ok := args["position"].(map[string]any); ok {
		x, _ := pos["x"].(float64)
		y, _ := pos["y"].(float64)
		duplicate.Position = &model.CanvasPosition{X: x, Y: y}
	}

	created, err := r.service.repo.CreateCanvasNode(userID, state.Request.CanvasID, duplicate)
	if err != nil {
		return nil, fmt.Errorf("create duplicate: %w", err)
	}

	// 递归复制子节点
	if includeChildren {
		if err := r.duplicateChildrenRecursive(userID, state.Request.CanvasID, nodeID, created.ID); err != nil {
			log.Printf("[Agent] failed to duplicate children: %v", err)
			// 不中断，继续返回主节点的复制结果
		}
	}

	return map[string]any{
		"success":        true,
		"originalId":     nodeID,
		"duplicateId":    created.ID,
		"node":           created,
		"childrenCopied": includeChildren,
		"message":        fmt.Sprintf("✅ 已复制节点：%s -> %s", nodeID, created.ID),
	}, nil
}

// duplicateChildrenRecursive 递归复制子节点
func (r *CanvasToolRegistry) duplicateChildrenRecursive(userID, canvasID, parentID, newParentID string) error {
	// 获取原始父节点的所有子节点
	children, err := r.service.repo.GetCanvasNodeChildren(userID, canvasID, parentID)
	if err != nil {
		return fmt.Errorf("get children of %s: %w", parentID, err)
	}

	for _, child := range children {
		// 复制子节点
		duplicate := child
		duplicate.ID = "" // 清空 ID，让数据库生成新的
		duplicate.ParentID = &newParentID

		// 调整位置（稍微偏移）
		if duplicate.Position != nil {
			duplicate.Position.X += 10
			duplicate.Position.Y += 10
		}

		created, err := r.service.repo.CreateCanvasNode(userID, canvasID, duplicate)
		if err != nil {
			log.Printf("[Agent] failed to duplicate child %s: %v", child.ID, err)
			continue
		}

		// 递归复制这个子节点的子节点
		if err := r.duplicateChildrenRecursive(userID, canvasID, child.ID, created.ID); err != nil {
			log.Printf("[Agent] failed to duplicate descendants of %s: %v", child.ID, err)
		}
	}

	return nil
}

// handleRelationshipCreate 处理创建关系
func (r *CanvasToolRegistry) handleRelationshipCreate(ctx context.Context, userID, runID string, args map[string]any) (any, error) {
	fromNodeID, _ := args["fromNodeId"].(string)
	toNodeID, _ := args["toNodeId"].(string)
	relType, _ := args["type"].(string)

	run, err := r.service.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, fmt.Errorf("get run: %w", err)
	}

	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, fmt.Errorf("decode state: %w", err)
	}

	// 创建关系
	relationship := model.CanvasRelationship{
		From: fromNodeID,
		To:   toNodeID,
		Type: relType,
	}

	if err := r.service.repo.CreateCanvasRelationship(userID, state.Request.CanvasID, relationship); err != nil {
		return nil, fmt.Errorf("create relationship: %w", err)
	}

	return map[string]any{
		"success": true,
		"message": fmt.Sprintf("✅ 已创建关系：%s -> %s (%s)", fromNodeID, toNodeID, relType),
	}, nil
}

// handleRelationshipDelete 处理删除关系
func (r *CanvasToolRegistry) handleRelationshipDelete(ctx context.Context, userID, runID string, args map[string]any) (any, error) {
	fromNodeID, _ := args["fromNodeId"].(string)
	toNodeID, _ := args["toNodeId"].(string)
	relType, _ := args["type"].(string)

	run, err := r.service.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, fmt.Errorf("get run: %w", err)
	}

	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, fmt.Errorf("decode state: %w", err)
	}

	if err := r.service.repo.DeleteCanvasRelationship(userID, state.Request.CanvasID, fromNodeID, toNodeID, relType); err != nil {
		return nil, fmt.Errorf("delete relationship: %w", err)
	}

	return map[string]any{
		"success": true,
		"message": fmt.Sprintf("✅ 已删除关系：%s -> %s", fromNodeID, toNodeID),
	}, nil
}

// handleLayout 处理自动布局
func (r *CanvasToolRegistry) handleLayout(ctx context.Context, userID, runID string, args map[string]any) (any, error) {
	algorithm, _ := args["algorithm"].(string)
	direction, _ := args["direction"].(string)
	spacing, _ := args["spacing"].(float64)

	if spacing == 0 {
		spacing = 100
	}

	var nodeIDs []string
	if ids, ok := args["nodeIds"].([]interface{}); ok {
		for _, id := range ids {
			if s, ok := id.(string); ok {
				nodeIDs = append(nodeIDs, s)
			}
		}
	}

	run, err := r.service.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, fmt.Errorf("get run: %w", err)
	}

	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, fmt.Errorf("decode state: %w", err)
	}

	// 获取要布局的节点
	var nodes []model.CanvasNode
	if len(nodeIDs) > 0 {
		for _, nodeID := range nodeIDs {
			node, err := r.service.repo.CanvasNode(userID, state.Request.CanvasID, nodeID)
			if err == nil {
				nodes = append(nodes, node)
			}
		}
	} else {
		nodes, err = r.service.repo.CanvasNodes(userID, state.Request.CanvasID)
		if err != nil {
			return nil, fmt.Errorf("get nodes: %w", err)
		}
	}

	// 执行布局算法
	layoutEngine := NewCanvasLayoutEngine(r.service)
	newPositions, err := layoutEngine.ApplyLayout(algorithm, direction, spacing, nodes)
	if err != nil {
		return nil, fmt.Errorf("apply layout: %w", err)
	}

	// 批量更新节点位置
	updatedCount := 0
	for nodeID, position := range newPositions {
		update := model.CanvasNodeUpdate{
			Position: position,
		}
		if _, err := r.service.repo.UpdateCanvasNode(userID, state.Request.CanvasID, nodeID, update); err == nil {
			updatedCount++
		}
	}

	return map[string]any{
		"success": true,
		"message": fmt.Sprintf("✅ 已应用 %s 布局，更新 %d 个节点", algorithm, updatedCount),
		"updated": updatedCount,
	}, nil
}

// handleSearch 处理搜索
func (r *CanvasToolRegistry) handleSearch(ctx context.Context, userID, runID string, args map[string]any) (any, error) {
	query, _ := args["query"].(string)
	nodeType, _ := args["type"].(string)
	category, _ := args["category"].(string)
	limit, _ := args["limit"].(float64)

	if limit == 0 {
		limit = 20
	}

	var tags []string
	if t, ok := args["tags"].([]interface{}); ok {
		for _, tag := range t {
			if s, ok := tag.(string); ok {
				tags = append(tags, s)
			}
		}
	}

	run, err := r.service.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, fmt.Errorf("get run: %w", err)
	}

	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, fmt.Errorf("decode state: %w", err)
	}

	// 搜索节点
	searchEngine := NewCanvasSearchEngine(r.service)
	results, err := searchEngine.Search(userID, state.Request.CanvasID, CanvasSearchQuery{
		Query:    query,
		Type:     nodeType,
		Category: category,
		Tags:     tags,
		Limit:    int(limit),
	})
	if err != nil {
		return nil, fmt.Errorf("search: %w", err)
	}

	return map[string]any{
		"success": true,
		"results": results,
		"count":   len(results),
		"message": fmt.Sprintf("找到 %d 个匹配节点", len(results)),
	}, nil
}

// handleBulkOperation 处理批量操作
func (r *CanvasToolRegistry) handleBulkOperation(ctx context.Context, userID, runID string, args map[string]any) (any, error) {
	operation, _ := args["operation"].(string)
	reason, _ := args["reason"].(string)
	params, _ := args["params"].(map[string]any)

	var nodeIDs []string
	if ids, ok := args["nodeIds"].([]interface{}); ok {
		for _, id := range ids {
			if s, ok := id.(string); ok {
				nodeIDs = append(nodeIDs, s)
			}
		}
	}

	if len(nodeIDs) == 0 {
		return nil, fmt.Errorf("no node IDs provided")
	}

	run, err := r.service.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, fmt.Errorf("get run: %w", err)
	}

	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, fmt.Errorf("decode state: %w", err)
	}

	successCount := 0
	failCount := 0

	switch operation {
	case "update":
		update := model.CanvasNodeUpdate{}
		if content, ok := params["content"].(string); ok {
			update.Content = &content
		}
		if metadata, ok := params["metadata"].(map[string]interface{}); ok {
			update.Metadata = metadata
		}

		for _, nodeID := range nodeIDs {
			if _, err := r.service.repo.UpdateCanvasNode(userID, state.Request.CanvasID, nodeID, update); err == nil {
				successCount++
			} else {
				failCount++
			}
		}

	case "delete":
		for _, nodeID := range nodeIDs {
			if err := r.service.repo.DeleteCanvasNode(userID, state.Request.CanvasID, nodeID, false); err == nil {
				successCount++
			} else {
				failCount++
			}
		}

	case "move":
		var position *model.CanvasPosition
		if pos, ok := params["position"].(map[string]any); ok {
			x, _ := pos["x"].(float64)
			y, _ := pos["y"].(float64)
			position = &model.CanvasPosition{X: x, Y: y}
		}

		for i, nodeID := range nodeIDs {
			update := model.CanvasNodeUpdate{
				Position: position,
			}
			// 为每个节点稍微偏移位置
			if position != nil && i > 0 {
				offsetPos := &model.CanvasPosition{
					X: position.X + float64(i*20),
					Y: position.Y + float64(i*20),
				}
				update.Position = offsetPos
			}

			if _, err := r.service.repo.UpdateCanvasNode(userID, state.Request.CanvasID, nodeID, update); err == nil {
				successCount++
			} else {
				failCount++
			}
		}

	case "tag":
		if tags, ok := params["tags"].([]interface{}); ok {
			tagStrings := make([]string, 0, len(tags))
			for _, tag := range tags {
				if s, ok := tag.(string); ok {
					tagStrings = append(tagStrings, s)
				}
			}

			for _, nodeID := range nodeIDs {
				node, err := r.service.repo.CanvasNode(userID, state.Request.CanvasID, nodeID)
				if err != nil {
					failCount++
					continue
				}

				if node.Metadata == nil {
					node.Metadata = make(map[string]interface{})
				}
				node.Metadata["tags"] = tagStrings

				update := model.CanvasNodeUpdate{
					Metadata: node.Metadata,
				}
				if _, err := r.service.repo.UpdateCanvasNode(userID, state.Request.CanvasID, nodeID, update); err == nil {
					successCount++
				} else {
					failCount++
				}
			}
		}

	default:
		return nil, fmt.Errorf("unsupported operation: %s", operation)
	}

	return map[string]any{
		"success":      true,
		"operation":    operation,
		"successCount": successCount,
		"failCount":    failCount,
		"message":      fmt.Sprintf("✅ 批量%s完成：成功 %d，失败 %d（原因：%s）", operation, successCount, failCount, reason),
	}, nil
}

// handleSnapshot 处理获取快照
func (r *CanvasToolRegistry) handleSnapshot(ctx context.Context, userID, runID string, args map[string]any) (any, error) {
	includeIntelligence, _ := args["includeIntelligence"].(bool)
	if _, ok := args["includeIntelligence"]; !ok {
		includeIntelligence = true // 默认包含智能分析
	}

	var focusNodeIDs []string
	if ids, ok := args["focusNodeIds"].([]interface{}); ok {
		for _, id := range ids {
			if s, ok := id.(string); ok {
				focusNodeIDs = append(focusNodeIDs, s)
			}
		}
	}

	run, err := r.service.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, fmt.Errorf("get run: %w", err)
	}

	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, fmt.Errorf("decode state: %w", err)
	}

	if includeIntelligence {
		// 使用完整的智能上下文
		canvasIntelligence := r.service.NewCanvasIntelligence()
		enhancedCanvas, err := canvasIntelligence.BuildEnhancedCanvasContext(ctx, userID, state.Request.CanvasID, focusNodeIDs)
		if err != nil {
			return nil, fmt.Errorf("build intelligence: %w", err)
		}

		return map[string]any{
			"success":      true,
			"snapshot":     enhancedCanvas.Snapshot,
			"intelligence": enhancedCanvas.Intelligence,
			"timestamp":    time.Now().Unix(),
		}, nil
	}

	// 简单快照（不含智能分析）
	nodes, err := r.service.repo.CanvasNodes(userID, state.Request.CanvasID)
	if err != nil {
		return nil, fmt.Errorf("get nodes: %w", err)
	}

	return map[string]any{
		"success":   true,
		"nodeCount": len(nodes),
		"nodes":     nodes,
		"timestamp": time.Now().Unix(),
	}, nil
}

// 辅助方法

func (r *CanvasToolRegistry) validatePermissions(userID string, requiredPermissions []string) error {
	// 实现真实的权限检查
	if len(requiredPermissions) == 0 {
		return nil
	}

	// 从用户服务获取用户权限
	user, err := r.service.repo.User(userID)
	if err != nil {
		return fmt.Errorf("failed to get user: %w", err)
	}

	if user.Role == model.UserRoleAdmin {
		return nil
	}
	return fmt.Errorf("permission denied: user role %s does not grant Agent canvas permissions", user.Role)
}

func (r *CanvasToolRegistry) validateParameters(tool *CanvasToolDefinition, args map[string]any) error {
	// 实现参数验证（基于 JSON Schema）
	if tool.Schema == nil {
		return nil
	}

	// 检查必需参数
	if required, ok := tool.Schema["required"].([]any); ok {
		for _, req := range required {
			if reqStr, ok := req.(string); ok {
				if _, exists := args[reqStr]; !exists {
					return fmt.Errorf("missing required parameter: %s", reqStr)
				}
			}
		}
	}

	// 检查参数类型
	if properties, ok := tool.Schema["properties"].(map[string]any); ok {
		for paramName, paramValue := range args {
			if propSchema, exists := properties[paramName]; exists {
				if schemaMap, ok := propSchema.(map[string]any); ok {
					if err := r.validateParameterType(paramName, paramValue, schemaMap); err != nil {
						return err
					}
				}
			}
		}
	}

	return nil
}

func (r *CanvasToolRegistry) validateParameterType(name string, value any, schema map[string]any) error {
	expectedType, _ := schema["type"].(string)

	switch expectedType {
	case "string":
		if _, ok := value.(string); !ok {
			return fmt.Errorf("parameter %s must be a string", name)
		}
	case "number":
		switch value.(type) {
		case float64, int, int64, float32:
			// OK
		default:
			return fmt.Errorf("parameter %s must be a number", name)
		}
	case "boolean":
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("parameter %s must be a boolean", name)
		}
	case "object":
		if _, ok := value.(map[string]any); !ok {
			return fmt.Errorf("parameter %s must be an object", name)
		}
	case "array":
		if _, ok := value.([]any); !ok {
			return fmt.Errorf("parameter %s must be an array", name)
		}
	}

	return nil
}

func (r *CanvasToolRegistry) checkApproval(userID, runID, toolName string, args map[string]any) (bool, error) {
	// 实现审批检查逻辑
	// 检查是否已经有批准记录

	// 从数据库查询审批记录
	approvalKey := fmt.Sprintf("approval:%s:%s:%s", runID, toolName, hashArgs(args))

	run, err := r.service.repo.CloudAgent(userID, runID)
	if err != nil {
		return false, fmt.Errorf("get run: %w", err)
	}

	state, err := cloudAgentDecode(run)
	if err != nil {
		return false, fmt.Errorf("load state: %w", err)
	}
	if state.Decisions != nil && state.Decisions[approvalKey] == "approved" {
		return true, nil
	}
	return false, nil
}

// hashArgs 生成参数的哈希值，用于审批记录的唯一标识
func hashArgs(args map[string]any) string {
	data, _ := json.Marshal(args)
	return fmt.Sprintf("%x", sha256.Sum256(data))[:16]
}
