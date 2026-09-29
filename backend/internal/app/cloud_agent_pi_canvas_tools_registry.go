package app

import (
	"context"
	"fmt"
)

// 画布工具注册表：
// 1. 可扩展：新增工具只需注册，无需修改核心代码
// 2. 类型安全：每个工具有明确的参数和返回类型定义
// 3. 自动发现：工具定义自动生成 OpenAPI schema
// 4. 权限控制：每个工具可以配置权限和审批要求

// CanvasToolRegistry 画布工具注册表
type CanvasToolRegistry struct {
	service *Service
	tools   map[string]*CanvasToolDefinition
}

// CanvasToolDefinition 画布工具定义
type CanvasToolDefinition struct {
	Name            string            `json:"name"`
	DisplayName     string            `json:"displayName"`
	Description     string            `json:"description"`
	Category        string            `json:"category"` // node/relationship/layout/search/bulk
	Parameters      map[string]any    `json:"parameters"`
	Schema          map[string]any    `json:"schema,omitempty"`
	RequireApproval bool              `json:"requireApproval"`
	Permissions     []string          `json:"permissions"`
	Examples        []map[string]any  `json:"examples,omitempty"`
	Handler         CanvasToolHandler `json:"-"`
}

// CanvasToolHandler 工具处理器
type CanvasToolHandler func(ctx context.Context, userID, runID string, args map[string]any) (any, error)

// NewCanvasToolRegistry 创建工具注册表
func (s *Service) NewCanvasToolRegistry() *CanvasToolRegistry {
	registry := &CanvasToolRegistry{
		service: s,
		tools:   make(map[string]*CanvasToolDefinition),
	}

	// 注册所有画布工具
	registry.registerAllTools()

	return registry
}

// registerAllTools 注册所有工具
func (r *CanvasToolRegistry) registerAllTools() {
	// 节点操作工具
	r.registerNodeTools()

	// 关系操作工具
	r.registerRelationshipTools()

	// 布局工具
	r.registerLayoutTools()

	// 搜索工具
	r.registerSearchTools()

	// 批量操作工具
	r.registerBulkTools()

	// 快照工具
	r.registerSnapshotTools()
}

// registerNodeTools 注册节点工具
func (r *CanvasToolRegistry) registerNodeTools() {
	// 1. 创建节点
	r.Register(&CanvasToolDefinition{
		Name:        "canvas_node_create",
		DisplayName: "创建画布节点",
		Description: "在画布上创建一个新节点。支持多种节点类型（text/markdown/code/image/diagram等），可以指定位置、大小、父节点等属性。",
		Category:    "node",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"type": map[string]any{
					"type":        "string",
					"description": "节点类型：text/markdown/code/image/video/link/diagram/mindmap/task等",
					"enum":        []string{"text", "markdown", "code", "image", "video", "audio", "link", "diagram", "mindmap", "flowchart", "task", "note"},
				},
				"content": map[string]any{
					"type":        "string",
					"description": "节点内容",
				},
				"position": map[string]any{
					"type":        "object",
					"description": "节点位置 {x: number, y: number}",
					"properties": map[string]any{
						"x": map[string]any{"type": "number"},
						"y": map[string]any{"type": "number"},
					},
				},
				"size": map[string]any{
					"type":        "object",
					"description": "节点尺寸 {width: number, height: number}",
					"properties": map[string]any{
						"width":  map[string]any{"type": "number"},
						"height": map[string]any{"type": "number"},
					},
				},
				"parentId": map[string]any{
					"type":        "string",
					"description": "父节点ID（可选）",
				},
				"metadata": map[string]any{
					"type":        "object",
					"description": "额外元数据（可选）",
				},
			},
			"required": []string{"type", "content"},
		},
		RequireApproval: false,
		Permissions:     []string{"canCreate"},
		Examples: []map[string]any{
			{
				"type":    "text",
				"content": "这是一个文本节点",
				"position": map[string]any{
					"x": 100,
					"y": 200,
				},
			},
			{
				"type":     "task",
				"content":  "完成代码审查",
				"parentId": "parent-node-id",
			},
		},
		Handler: r.handleNodeCreate,
	})

	// 2. 读取节点
	r.Register(&CanvasToolDefinition{
		Name:        "canvas_node_read",
		DisplayName: "读取画布节点",
		Description: "读取指定节点的完整信息，可以选择是否包含子节点。",
		Category:    "node",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"nodeId": map[string]any{
					"type":        "string",
					"description": "节点ID",
				},
				"includeChildren": map[string]any{
					"type":        "boolean",
					"description": "是否包含子节点（默认false）",
				},
			},
			"required": []string{"nodeId"},
		},
		RequireApproval: false,
		Permissions:     []string{"canRead"},
		Handler:         r.handleNodeRead,
	})

	// 3. 更新节点
	r.Register(&CanvasToolDefinition{
		Name:        "canvas_node_update",
		DisplayName: "更新画布节点",
		Description: "更新节点的内容、位置、尺寸或元数据。只需要提供要更新的字段。",
		Category:    "node",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"nodeId": map[string]any{
					"type":        "string",
					"description": "节点ID",
				},
				"content": map[string]any{
					"type":        "string",
					"description": "新的内容（可选）",
				},
				"position": map[string]any{
					"type":        "object",
					"description": "新的位置（可选）",
				},
				"size": map[string]any{
					"type":        "object",
					"description": "新的尺寸（可选）",
				},
				"metadata": map[string]any{
					"type":        "object",
					"description": "新的元数据（可选）",
				},
			},
			"required": []string{"nodeId"},
		},
		RequireApproval: false,
		Permissions:     []string{"canUpdate"},
		Handler:         r.handleNodeUpdate,
	})

	// 4. 删除节点
	r.Register(&CanvasToolDefinition{
		Name:        "canvas_node_delete",
		DisplayName: "删除画布节点",
		Description: "删除指定节点。如果节点有子节点，可以选择是否同时删除。此操作需要用户审批。",
		Category:    "node",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"nodeId": map[string]any{
					"type":        "string",
					"description": "节点ID",
				},
				"reason": map[string]any{
					"type":        "string",
					"description": "删除原因",
				},
				"recursive": map[string]any{
					"type":        "boolean",
					"description": "是否递归删除子节点（默认false）",
				},
			},
			"required": []string{"nodeId", "reason"},
		},
		RequireApproval: true,
		Permissions:     []string{"canDelete"},
		Handler:         r.handleNodeDelete,
	})

	// 5. 移动节点
	r.Register(&CanvasToolDefinition{
		Name:        "canvas_node_move",
		DisplayName: "移动画布节点",
		Description: "移动节点到新位置，或改变节点的父子关系。",
		Category:    "node",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"nodeId": map[string]any{
					"type":        "string",
					"description": "节点ID",
				},
				"position": map[string]any{
					"type":        "object",
					"description": "新位置 {x: number, y: number}（可选）",
				},
				"newParentId": map[string]any{
					"type":        "string",
					"description": "新父节点ID（可选，null表示移到根层级）",
				},
			},
			"required": []string{"nodeId"},
		},
		RequireApproval: false,
		Permissions:     []string{"canMove"},
		Handler:         r.handleNodeMove,
	})

	// 6. 复制节点
	r.Register(&CanvasToolDefinition{
		Name:        "canvas_node_duplicate",
		DisplayName: "复制画布节点",
		Description: "复制一个节点，可以选择是否复制子节点。",
		Category:    "node",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"nodeId": map[string]any{
					"type":        "string",
					"description": "要复制的节点ID",
				},
				"includeChildren": map[string]any{
					"type":        "boolean",
					"description": "是否复制子节点（默认false）",
				},
				"position": map[string]any{
					"type":        "object",
					"description": "新节点位置（可选）",
				},
			},
			"required": []string{"nodeId"},
		},
		RequireApproval: false,
		Permissions:     []string{"canCreate"},
		Handler:         r.handleNodeDuplicate,
	})
}

// registerRelationshipTools 注册关系工具
func (r *CanvasToolRegistry) registerRelationshipTools() {
	// 1. 创建关系
	r.Register(&CanvasToolDefinition{
		Name:        "canvas_relationship_create",
		DisplayName: "创建节点关系",
		Description: "在两个节点之间建立关系。支持多种关系类型（reference/dependency/flow/semantic）。",
		Category:    "relationship",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"fromNodeId": map[string]any{
					"type":        "string",
					"description": "源节点ID",
				},
				"toNodeId": map[string]any{
					"type":        "string",
					"description": "目标节点ID",
				},
				"type": map[string]any{
					"type":        "string",
					"description": "关系类型",
					"enum":        []string{"reference", "dependency", "flow", "semantic", "custom"},
				},
				"bidirection": map[string]any{
					"type":        "boolean",
					"description": "是否双向（默认false）",
				},
				"label": map[string]any{
					"type":        "string",
					"description": "关系标签（可选）",
				},
			},
			"required": []string{"fromNodeId", "toNodeId", "type"},
		},
		RequireApproval: false,
		Permissions:     []string{"canManageRelations"},
		Handler:         r.handleRelationshipCreate,
	})

	// 2. 删除关系
	r.Register(&CanvasToolDefinition{
		Name:        "canvas_relationship_delete",
		DisplayName: "删除节点关系",
		Description: "删除两个节点之间的关系。",
		Category:    "relationship",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"fromNodeId": map[string]any{
					"type":        "string",
					"description": "源节点ID",
				},
				"toNodeId": map[string]any{
					"type":        "string",
					"description": "目标节点ID",
				},
				"type": map[string]any{
					"type":        "string",
					"description": "关系类型（可选，不指定则删除所有关系）",
				},
			},
			"required": []string{"fromNodeId", "toNodeId"},
		},
		RequireApproval: false,
		Permissions:     []string{"canManageRelations"},
		Handler:         r.handleRelationshipDelete,
	})
}

// registerLayoutTools 注册布局工具
func (r *CanvasToolRegistry) registerLayoutTools() {
	r.Register(&CanvasToolDefinition{
		Name:        "canvas_layout",
		DisplayName: "画布自动布局",
		Description: "对画布或指定节点组进行自动布局。支持多种布局算法（tree/grid/force/circular）。",
		Category:    "layout",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"algorithm": map[string]any{
					"type":        "string",
					"description": "布局算法",
					"enum":        []string{"tree", "grid", "force", "circular", "hierarchical", "auto"},
				},
				"nodeIds": map[string]any{
					"type":        "array",
					"description": "要布局的节点ID列表（可选，不指定则布局全部）",
					"items": map[string]any{
						"type": "string",
					},
				},
				"direction": map[string]any{
					"type":        "string",
					"description": "布局方向（tree/hierarchical算法适用）",
					"enum":        []string{"horizontal", "vertical"},
				},
				"spacing": map[string]any{
					"type":        "number",
					"description": "节点间距（默认100）",
				},
			},
			"required": []string{"algorithm"},
		},
		RequireApproval: false,
		Permissions:     []string{"canMove"},
		Handler:         r.handleLayout,
	})
}

// registerSearchTools 注册搜索工具
func (r *CanvasToolRegistry) registerSearchTools() {
	r.Register(&CanvasToolDefinition{
		Name:        "canvas_search",
		DisplayName: "搜索画布节点",
		Description: "根据关键词、类型、标签等条件搜索画布节点。支持全文搜索和过滤。",
		Category:    "search",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{
					"type":        "string",
					"description": "搜索关键词（可选）",
				},
				"type": map[string]any{
					"type":        "string",
					"description": "节点类型过滤（可选）",
				},
				"tags": map[string]any{
					"type":        "array",
					"description": "标签过滤（可选）",
					"items": map[string]any{
						"type": "string",
					},
				},
				"category": map[string]any{
					"type":        "string",
					"description": "分类过滤（可选）",
				},
				"limit": map[string]any{
					"type":        "number",
					"description": "返回结果数量限制（默认20）",
				},
			},
		},
		RequireApproval: false,
		Permissions:     []string{"canRead"},
		Handler:         r.handleSearch,
	})
}

// registerBulkTools 注册批量工具
func (r *CanvasToolRegistry) registerBulkTools() {
	r.Register(&CanvasToolDefinition{
		Name:        "canvas_bulk_operation",
		DisplayName: "批量操作节点",
		Description: "对多个节点执行批量操作（更新/删除/移动）。此操作需要用户审批。",
		Category:    "bulk",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"operation": map[string]any{
					"type":        "string",
					"description": "操作类型",
					"enum":        []string{"update", "delete", "move", "tag"},
				},
				"nodeIds": map[string]any{
					"type":        "array",
					"description": "节点ID列表",
					"items": map[string]any{
						"type": "string",
					},
				},
				"params": map[string]any{
					"type":        "object",
					"description": "操作参数",
				},
				"reason": map[string]any{
					"type":        "string",
					"description": "操作原因",
				},
			},
			"required": []string{"operation", "nodeIds", "reason"},
		},
		RequireApproval: true,
		Permissions:     []string{"canUpdate", "canDelete", "canMove"},
		Handler:         r.handleBulkOperation,
	})
}

// registerSnapshotTools 注册快照工具
func (r *CanvasToolRegistry) registerSnapshotTools() {
	r.Register(&CanvasToolDefinition{
		Name:        "canvas_snapshot",
		DisplayName: "获取画布快照",
		Description: "获取当前画布的结构化快照，包括节点、关系、布局分析、智能洞察等。",
		Category:    "snapshot",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"includeIntelligence": map[string]any{
					"type":        "boolean",
					"description": "是否包含智能分析（默认true）",
				},
				"focusNodeIds": map[string]any{
					"type":        "array",
					"description": "焦点节点ID列表（可选）",
					"items": map[string]any{
						"type": "string",
					},
				},
			},
		},
		RequireApproval: false,
		Permissions:     []string{"canRead"},
		Handler:         r.handleSnapshot,
	})
}

// Register 注册工具
func (r *CanvasToolRegistry) Register(tool *CanvasToolDefinition) {
	if tool.Schema == nil {
		tool.Schema = tool.Parameters
	}
	r.tools[tool.Name] = tool
}

// GetToolDefinition 获取工具定义
func (r *CanvasToolRegistry) GetToolDefinition(name string) (*CanvasToolDefinition, bool) {
	tool, ok := r.tools[name]
	return tool, ok
}

// GetAllToolDefinitions 获取所有工具定义
func (r *CanvasToolRegistry) GetAllToolDefinitions() []map[string]any {
	result := make([]map[string]any, 0, len(r.tools))

	for _, tool := range r.tools {
		result = append(result, map[string]any{
			"name":            tool.Name,
			"displayName":     tool.DisplayName,
			"description":     tool.Description,
			"category":        tool.Category,
			"parameters":      tool.Parameters,
			"requireApproval": tool.RequireApproval,
			"permissions":     tool.Permissions,
			"examples":        tool.Examples,
		})
	}

	return result
}

// ExecuteTool 执行工具
func (r *CanvasToolRegistry) ExecuteTool(ctx context.Context, userID, runID, toolName string, args map[string]any) (any, error) {
	tool, ok := r.GetToolDefinition(toolName)
	if !ok {
		return nil, fmt.Errorf("unknown tool: %s", toolName)
	}

	// 验证权限
	if err := r.validatePermissions(userID, tool.Permissions); err != nil {
		return nil, fmt.Errorf("permission denied: %w", err)
	}

	// 验证参数
	if err := r.validateParameters(tool, args); err != nil {
		return nil, fmt.Errorf("invalid parameters: %w", err)
	}

	// 检查是否需要审批
	if tool.RequireApproval {
		if approved, err := r.checkApproval(userID, runID, toolName, args); err != nil || !approved {
			return map[string]any{
				"requiresApproval": true,
				"status":           "pending_approval",
				"message":          "此操作需要用户审批",
			}, nil
		}
	}

	// 执行工具
	return tool.Handler(ctx, userID, runID, args)
}

// 工具处理器实现将在下一个文件中
