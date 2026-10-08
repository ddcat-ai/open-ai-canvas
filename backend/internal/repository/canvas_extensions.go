package repository

import (
	"errors"
	"fmt"
	"time"

	"yingce/backend/internal/model"
)

// Canvas 数据访问层扩展

// Canvas 获取画布
func (r *Repository) Canvas(userID, canvasID string) (model.Canvas, error) {
	var canvas model.Canvas
	err := r.db.Where("user_id = ? AND id = ?", userID, canvasID).First(&canvas).Error
	if err != nil {
		return canvas, fmt.Errorf("get canvas: %w", err)
	}
	return canvas, nil
}

// GetCanvas is the explicit repository name used by Agent policy builders.
func (r *Repository) GetCanvas(userID, canvasID string) (model.Canvas, error) {
	return r.Canvas(userID, canvasID)
}

func (r *Repository) CanvasNodes(userID, canvasID string) ([]model.CanvasNode, error) {
	var nodes []model.CanvasNode
	err := r.db.Where("canvas_id IN (SELECT id FROM canvases WHERE user_id = ? AND id = ?)", userID, canvasID).
		Find(&nodes).Error
	if err != nil {
		return nil, fmt.Errorf("get canvas nodes: %w", err)
	}
	return nodes, nil
}

// CanvasNode 获取单个节点
func (r *Repository) CanvasNode(userID, canvasID, nodeID string) (model.CanvasNode, error) {
	var node model.CanvasNode
	err := r.db.Where("id = ? AND canvas_id IN (SELECT id FROM canvases WHERE user_id = ? AND id = ?)",
		nodeID, userID, canvasID).First(&node).Error
	if err != nil {
		return node, fmt.Errorf("get canvas node: %w", err)
	}
	return node, nil
}

// CreateCanvasNode 创建节点
func (r *Repository) CreateCanvasNode(userID, canvasID string, node model.CanvasNode) (model.CanvasNode, error) {
	// 验证画布存在且属于用户
	var canvas model.Canvas
	err := r.db.Where("user_id = ? AND id = ?", userID, canvasID).First(&canvas).Error
	if err != nil {
		return node, fmt.Errorf("canvas not found: %w", err)
	}

	// 生成节点 ID
	if node.ID == "" {
		node.ID = generateNodeID()
	}
	node.CanvasID = canvasID

	// 创建节点
	err = r.db.Create(&node).Error
	if err != nil {
		return node, fmt.Errorf("create canvas node: %w", err)
	}

	return node, nil
}

// UpdateCanvasNode 更新节点
func (r *Repository) UpdateCanvasNode(userID, canvasID, nodeID string, update model.CanvasNodeUpdate) (model.CanvasNode, error) {
	// 获取现有节点
	node, err := r.CanvasNode(userID, canvasID, nodeID)
	if err != nil {
		return node, err
	}

	// 应用更新
	if update.Content != nil {
		node.Content = *update.Content
	}
	if update.Position != nil {
		node.Position = update.Position
	}
	if update.Size != nil {
		node.Size = update.Size
	}
	if update.ParentID != nil {
		node.ParentID = update.ParentID
	}
	if update.Metadata != nil {
		if node.Metadata == nil {
			node.Metadata = make(map[string]interface{})
		}
		for k, v := range update.Metadata {
			node.Metadata[k] = v
		}
	}

	// 保存
	err = r.db.Save(&node).Error
	if err != nil {
		return node, fmt.Errorf("update canvas node: %w", err)
	}

	return node, nil
}

// DeleteCanvasNode 删除节点，可选递归删除子节点。
func (r *Repository) DeleteCanvasNode(userID, canvasID, nodeID string, recursive ...bool) error {
	// 验证节点存在且属于用户
	_, err := r.CanvasNode(userID, canvasID, nodeID)
	if err != nil {
		return err
	}
	if len(recursive) > 0 && recursive[0] {
		var children []model.CanvasNode
		if err := r.db.Where("canvas_id = ? AND parent_id = ?", canvasID, nodeID).Find(&children).Error; err != nil {
			return fmt.Errorf("list child nodes: %w", err)
		}
		for _, child := range children {
			if err := r.DeleteCanvasNode(userID, canvasID, child.ID, true); err != nil {
				return err
			}
		}
	}

	// 删除节点
	if err := r.db.Where("id = ? AND canvas_id = ?", nodeID, canvasID).Delete(&model.CanvasNode{}).Error; err != nil {
		return fmt.Errorf("delete canvas node: %w", err)
	}
	return nil
}

// GetCanvasNodeChildren 返回指定父节点的直接子节点。
func (r *Repository) GetCanvasNodeChildren(userID, canvasID, parentID string) ([]model.CanvasNode, error) {
	if _, err := r.CanvasNode(userID, canvasID, parentID); err != nil {
		return nil, err
	}
	var children []model.CanvasNode
	if err := r.db.Where("canvas_id = ? AND parent_id = ?", canvasID, parentID).Find(&children).Error; err != nil {
		return nil, fmt.Errorf("get canvas node children: %w", err)
	}
	return children, nil
}

// CanvasNodes 获取画布所有节点
func (r *Repository) CreateCanvasRelationship(userID, canvasID string, rel model.CanvasRelationship) error {
	// 验证节点存在
	_, err := r.CanvasNode(userID, canvasID, rel.From)
	if err != nil {
		return fmt.Errorf("source node not found: %w", err)
	}
	_, err = r.CanvasNode(userID, canvasID, rel.To)
	if err != nil {
		return fmt.Errorf("target node not found: %w", err)
	}

	// 存储关系到 from 节点的 metadata
	fromNode, err := r.CanvasNode(userID, canvasID, rel.From)
	if err != nil {
		return err
	}

	if fromNode.Metadata == nil {
		fromNode.Metadata = make(map[string]interface{})
	}

	relationshipsKey := "relationships"
	relationships, ok := fromNode.Metadata[relationshipsKey].([]interface{})
	if !ok {
		relationships = []interface{}{}
	}

	// 检查关系是否已存在
	for _, r := range relationships {
		if relMap, ok := r.(map[string]interface{}); ok {
			if relMap["to"] == rel.To && relMap["type"] == rel.Type {
				return nil // 关系已存在
			}
		}
	}

	// 添加新关系
	relationships = append(relationships, map[string]interface{}{
		"to":   rel.To,
		"type": rel.Type,
	})
	fromNode.Metadata[relationshipsKey] = relationships

	// 保存
	err = r.db.Save(&fromNode).Error
	if err != nil {
		return fmt.Errorf("save relationship: %w", err)
	}

	return nil
}

// DeleteCanvasRelationship 删除节点关系
func (r *Repository) DeleteCanvasRelationship(userID, canvasID, from, to, relType string) error {
	fromNode, err := r.CanvasNode(userID, canvasID, from)
	if err != nil {
		return err
	}

	if fromNode.Metadata == nil {
		return errors.New("relationship not found")
	}

	relationshipsKey := "relationships"
	relationships, ok := fromNode.Metadata[relationshipsKey].([]interface{})
	if !ok {
		return errors.New("relationship not found")
	}

	// 过滤掉要删除的关系
	filtered := make([]interface{}, 0)
	found := false
	for _, r := range relationships {
		if relMap, ok := r.(map[string]interface{}); ok {
			if relMap["to"] == to && relMap["type"] == relType {
				found = true
				continue
			}
		}
		filtered = append(filtered, r)
	}

	if !found {
		return errors.New("relationship not found")
	}

	fromNode.Metadata[relationshipsKey] = filtered

	// 保存
	err = r.db.Save(&fromNode).Error
	if err != nil {
		return fmt.Errorf("delete relationship: %w", err)
	}

	return nil
}

// CreateApproval 创建审批
func (r *Repository) CreateApproval(approval *model.Approval) error {
	return r.db.Create(approval).Error
}

// GetApproval 获取审批
func (r *Repository) GetApproval(approvalID string) (*model.Approval, error) {
	var approval model.Approval
	err := r.db.Where("id = ?", approvalID).First(&approval).Error
	if err != nil {
		return nil, err
	}
	return &approval, nil
}

// UpdateApprovalDecision 更新审批决策
func (r *Repository) UpdateApprovalDecision(approvalID, decision string) error {
	return r.db.Model(&model.Approval{}).
		Where("id = ?", approvalID).
		Updates(map[string]interface{}{
			"status":   "completed",
			"decision": decision,
		}).Error
}

// generateNodeID 生成节点 ID（简化实现）
func generateNodeID() string {
	return fmt.Sprintf("node_%d", time.Now().UnixNano())
}
