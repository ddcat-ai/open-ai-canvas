package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

// Canvas Intelligence Layer - 让 Agent 深度理解画布
// 这是重构的核心：从"工具调用"升级到"画布认知"

// CanvasIntelligence 画布智能层
type CanvasIntelligence struct {
	service *Service
}

// NewCanvasIntelligence 创建画布智能层
func (s *Service) NewCanvasIntelligence() *CanvasIntelligence {
	return &CanvasIntelligence{service: s}
}

// EnhancedCanvasContext 增强的画布上下文（传递给Pi）
type EnhancedCanvasContext struct {
	// 基础信息
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`

	// 结构化快照
	Snapshot CanvasSnapshot `json:"snapshot"`

	// 智能洞察
	Intelligence CanvasIntelligenceInsights `json:"intelligence"`

	// 能力矩阵
	Capabilities CanvasCapabilityMatrix `json:"capabilities"`

	// 实时状态
	RealtimeState CanvasRealtimeState `json:"realtimeState"`
}

// CanvasSnapshot 画布快照（结构化）
type CanvasSnapshot struct {
	Timestamp     int64              `json:"timestamp"`
	TotalNodes    int                `json:"totalNodes"`
	FocusNodes    []EnhancedNodeView `json:"focusNodes"`
	ContextNodes  []EnhancedNodeView `json:"contextNodes"` // 焦点节点周边相关节点
	Relationships []RelationshipView `json:"relationships"`
	Layout        LayoutAnalysis     `json:"layout"`
	Hierarchy     HierarchyView      `json:"hierarchy"`
}

// EnhancedNodeView 增强的节点视图（更智能的表示）
type EnhancedNodeView struct {
	// 标识
	ID   string `json:"id"`
	Type string `json:"type"`

	// 内容摘要（智能压缩）
	ContentPreview string `json:"contentPreview"` // 前200字符
	ContentHash    string `json:"contentHash"`
	ContentLength  int    `json:"contentLength"`
	HasFullContent bool   `json:"hasFullContent"` // 是否在焦点中（有完整内容）

	// 完整内容（仅焦点节点）
	FullContent string `json:"fullContent,omitempty"`

	// 空间信息
	Position *Position `json:"position,omitempty"`
	Size     *Size     `json:"size,omitempty"`
	ZIndex   int       `json:"zIndex"`

	// 关系
	ParentID string   `json:"parentId,omitempty"`
	Children []string `json:"children,omitempty"`
	Siblings []string `json:"siblings,omitempty"` // 同级节点

	// 语义标签
	Tags      []string `json:"tags,omitempty"`
	Category  string   `json:"category,omitempty"`  // 自动分类
	Sentiment string   `json:"sentiment,omitempty"` // 情感：positive/neutral/negative/todo
	Keywords  []string `json:"keywords,omitempty"`  // 关键词提取

	// 状态
	IsFocus    bool   `json:"isFocus"`
	IsModified bool   `json:"isModified"` // 最近是否被修改
	Status     string `json:"status"`     // draft/review/approved/archived

	// 元数据
	CreatedAt int64                  `json:"createdAt"`
	UpdatedAt int64                  `json:"updatedAt"`
	UpdatedBy string                 `json:"updatedBy,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// Position 位置
type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Size 尺寸
type Size struct {
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// RelationshipView 关系视图
type RelationshipView struct {
	From        string  `json:"from"`
	To          string  `json:"to"`
	Type        string  `json:"type"`        // parent/reference/dependency/flow/semantic
	Strength    float64 `json:"strength"`    // 0-1，关系强度
	Bidirection bool    `json:"bidirection"` // 是否双向
	Label       string  `json:"label,omitempty"`
}

// LayoutAnalysis 布局分析
type LayoutAnalysis struct {
	Algorithm   string        `json:"algorithm"`   // detected: tree/grid/force/freeform
	Direction   string        `json:"direction"`   // horizontal/vertical/radial
	Density     float64       `json:"density"`     // 0-1，节点密度
	Clusters    []ClusterInfo `json:"clusters"`    // 聚类分析
	Bounds      Bounds        `json:"bounds"`      // 画布边界
	ViewportFit string        `json:"viewportFit"` // 视口适配建议
}

// ClusterInfo 聚类信息
type ClusterInfo struct {
	ID       string   `json:"id"`
	NodeIDs  []string `json:"nodeIds"`
	Center   Position `json:"center"`
	Label    string   `json:"label"`    // 聚类主题
	Cohesion float64  `json:"cohesion"` // 0-1，内聚度
}

// Bounds 边界
type Bounds struct {
	MinX float64 `json:"minX"`
	MinY float64 `json:"minY"`
	MaxX float64 `json:"maxX"`
	MaxY float64 `json:"maxY"`
}

// HierarchyView 层级视图
type HierarchyView struct {
	MaxDepth  int                 `json:"maxDepth"`
	RootNodes []string            `json:"rootNodes"`
	Tree      map[string]TreeNode `json:"tree"` // nodeID -> TreeNode
}

// TreeNode 树节点
type TreeNode struct {
	ID       string   `json:"id"`
	Depth    int      `json:"depth"`
	Children []string `json:"children"`
	Path     []string `json:"path"` // 从根到当前节点的路径
}

// CanvasIntelligenceInsights 画布智能洞察
type CanvasIntelligenceInsights struct {
	// 自动总结
	Summary CanvasSummary `json:"summary"`

	// 建议
	Suggestions []ActionSuggestion `json:"suggestions"`

	// 模式识别
	Patterns []PatternRecognition `json:"patterns"`

	// 问题诊断
	Issues []CanvasIssue `json:"issues"`

	// 趋势分析
	Trends TrendAnalysis `json:"trends"`
}

// CanvasSummary 画布总结
type CanvasSummary struct {
	OneSentence  string   `json:"oneSentence"`  // 一句话总结
	MainTopics   []string `json:"mainTopics"`   // 主要主题
	Progress     string   `json:"progress"`     // 进度评估：early/mid/mature
	Completeness float64  `json:"completeness"` // 0-1，完整性评分
}

// ActionSuggestion 行动建议
type ActionSuggestion struct {
	Priority int    `json:"priority"` // 1-5
	Action   string `json:"action"`   // 建议的操作
	Reason   string `json:"reason"`   // 原因
	Impact   string `json:"impact"`   // 预期影响
}

// PatternRecognition 模式识别
type PatternRecognition struct {
	Pattern     string   `json:"pattern"`     // 识别的模式名称
	Confidence  float64  `json:"confidence"`  // 0-1，置信度
	Evidence    []string `json:"evidence"`    // 证据节点
	Description string   `json:"description"` // 描述
}

// CanvasIssue 画布问题
type CanvasIssue struct {
	Severity      string   `json:"severity"`      // low/medium/high/critical
	Type          string   `json:"type"`          // orphan/duplicate/inconsistent/incomplete
	Description   string   `json:"description"`   // 问题描述
	AffectedNodes []string `json:"affectedNodes"` // 受影响的节点
	FixSuggestion string   `json:"fixSuggestion"` // 修复建议
}

// TrendAnalysis 趋势分析
type TrendAnalysis struct {
	RecentActivity   ActivityLevel  `json:"recentActivity"`
	GrowthRate       float64        `json:"growthRate"`       // 节点增长率
	HotAreas         []string       `json:"hotAreas"`         // 热门区域
	CollaborationMap map[string]int `json:"collaborationMap"` // userID -> 贡献数
}

// ActivityLevel 活动水平
type ActivityLevel struct {
	Level       string `json:"level"`       // low/medium/high
	LastUpdated int64  `json:"lastUpdated"` // 最后更新时间
	UpdateCount int    `json:"updateCount"` // 更新次数（最近1小时）
}

// CanvasCapabilityMatrix 画布能力矩阵
type CanvasCapabilityMatrix struct {
	// 节点类型支持
	SupportedNodeTypes []NodeTypeCapability `json:"supportedNodeTypes"`

	// 操作权限
	Permissions CanvasPermissions `json:"permissions"`

	// 限制
	Limits CanvasLimits `json:"limits"`

	// 特性开关
	Features map[string]bool `json:"features"`

	// 扩展点
	Extensions []ExtensionPoint `json:"extensions"`
}

// NodeTypeCapability 节点类型能力
type NodeTypeCapability struct {
	Type        string                 `json:"type"`
	DisplayName string                 `json:"displayName"`
	Description string                 `json:"description"`
	Icon        string                 `json:"icon,omitempty"`
	Creatable   bool                   `json:"creatable"`
	Operations  []string               `json:"operations"` // read/update/delete/move/duplicate
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

// CanvasPermissions 画布权限
type CanvasPermissions struct {
	CanRead         bool     `json:"canRead"`
	CanCreate       bool     `json:"canCreate"`
	CanUpdate       bool     `json:"canUpdate"`
	CanDelete       bool     `json:"canDelete"`
	CanMove         bool     `json:"canMove"`
	CanShare        bool     `json:"canShare"`
	RequireApproval []string `json:"requireApproval"` // 需要审批的操作
}

// CanvasLimits 画布限制
type CanvasLimits struct {
	MaxNodes       int `json:"maxNodes"`
	MaxDepth       int `json:"maxDepth"`
	MaxContentSize int `json:"maxContentSize"` // bytes
	MaxBatchSize   int `json:"maxBatchSize"`   // 批量操作限制
}

// ExtensionPoint 扩展点
type ExtensionPoint struct {
	Name        string `json:"name"`
	Type        string `json:"type"` // hook/plugin/custom
	Enabled     bool   `json:"enabled"`
	Description string `json:"description"`
}

// CanvasRealtimeState 画布实时状态
type CanvasRealtimeState struct {
	OnlineUsers       []string            `json:"onlineUsers"`
	ActiveCursors     map[string]Position `json:"activeCursors"` // userID -> Position
	LockedNodes       []string            `json:"lockedNodes"`
	PendingOperations int                 `json:"pendingOperations"`
	SyncStatus        string              `json:"syncStatus"` // synced/syncing/conflict
}

// BuildEnhancedCanvasContext constructs the Agent context from CanvasProject,
// the application's persisted canvas document. The extension Canvas/CanvasNode
// models are not part of the production schema.
func (ci *CanvasIntelligence) BuildEnhancedCanvasContext(ctx context.Context, userID, canvasID string, focusNodeIDs []string) (*EnhancedCanvasContext, error) {
	canvas, err := ci.service.repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, fmt.Errorf("get canvas: %w", err)
	}
	document, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, fmt.Errorf("parse canvas document: %w", err)
	}
	nodes := canvasIntelligenceNodes(canvas, document)

	// 2. 构建结构化快照
	snapshot := ci.buildSnapshot(nodes, focusNodeIDs, canvasIntelligenceRelationships(document, nodes))

	// 3. 生成智能洞察
	intelligence := ci.generateIntelligence(nodes, snapshot)

	// 4. 构建能力矩阵
	capabilities := ci.buildCapabilityMatrix(userID, canvasID)

	// 5. 获取实时状态
	realtimeState := ci.getRealtimeState(ctx, document)

	return &EnhancedCanvasContext{
		ID:            canvasID,
		Name:          canvas.Title,
		Description:   stringValue(document["description"]),
		Snapshot:      snapshot,
		Intelligence:  intelligence,
		Capabilities:  capabilities,
		RealtimeState: realtimeState,
	}, nil
}

// buildSnapshot 构建画布快照
func (ci *CanvasIntelligence) buildSnapshot(nodes []model.CanvasNode, focusNodeIDs []string, explicitRelationships ...[]RelationshipView) CanvasSnapshot {
	focusMap := make(map[string]bool)
	for _, id := range focusNodeIDs {
		focusMap[id] = true
	}

	// 构建节点视图
	focusNodes := make([]EnhancedNodeView, 0)
	contextNodes := make([]EnhancedNodeView, 0)

	for _, node := range nodes {
		view := ci.buildEnhancedNodeView(node, focusMap[node.ID])
		if focusMap[node.ID] {
			focusNodes = append(focusNodes, view)
		} else {
			// 判断是否是上下文节点（焦点节点的相邻节点）
			if ci.isContextNode(node, focusNodeIDs, nodes) {
				contextNodes = append(contextNodes, view)
			}
		}
	}

	// 构建关系
	relationships := ci.buildRelationships(nodes)
	if len(explicitRelationships) > 0 {
		relationships = append(explicitRelationships[0], relationships...)
	}

	// 分析布局
	layout := ci.analyzeLayout(nodes)

	// 构建层级
	hierarchy := ci.buildHierarchy(nodes)

	return CanvasSnapshot{
		Timestamp:     time.Now().Unix(),
		TotalNodes:    len(nodes),
		FocusNodes:    focusNodes,
		ContextNodes:  contextNodes,
		Relationships: relationships,
		Layout:        layout,
		Hierarchy:     hierarchy,
	}
}

func canvasIntelligenceNodes(canvas *model.CanvasProject, document map[string]any) []model.CanvasNode {
	rawNodes := creationMaps(document["nodes"])
	nodes := make([]model.CanvasNode, 0, len(rawNodes))
	children := make(map[string][]string)

	for _, raw := range rawNodes {
		id := stringValue(raw["id"])
		if id == "" {
			continue
		}
		metadata := canvasIntelligenceMetadata(raw)
		content := firstNonEmpty(
			stringValue(raw["content"]),
			stringValue(metadata["content"]),
			stringValue(raw["title"]),
		)
		var parentID *string
		if value := stringValue(raw["parentId"]); value != "" {
			parentID = &value
			children[value] = append(children[value], id)
		}
		nodes = append(nodes, model.CanvasNode{
			ID: id, CanvasID: canvas.ID, Type: stringValue(raw["type"]), Content: content,
			Position: canvasIntelligencePosition(raw), Size: canvasIntelligenceSize(raw), ParentID: parentID, Metadata: metadata,
			CreatedAt: canvas.CreatedAt, UpdatedAt: canvas.UpdatedAt,
		})
	}
	for index := range nodes {
		nodes[index].Children = children[nodes[index].ID]
	}
	return nodes
}

func canvasIntelligenceMetadata(raw map[string]any) map[string]any {
	metadata := map[string]any{}
	if value, ok := raw["metadata"].(map[string]any); ok {
		for key, item := range value {
			metadata[key] = item
		}
	}
	if value, ok := raw["data"].(map[string]any); ok {
		for key, item := range value {
			if _, exists := metadata[key]; !exists {
				metadata[key] = item
			}
		}
	}
	return metadata
}

func canvasIntelligencePosition(raw map[string]any) *model.CanvasPosition {
	position, _ := raw["position"].(map[string]any)
	x, y := numberValue(raw["x"], 0), numberValue(raw["y"], 0)
	if position != nil {
		x, y = numberValue(position["x"], x), numberValue(position["y"], y)
	}
	if position == nil && raw["x"] == nil && raw["y"] == nil {
		return nil
	}
	return &model.CanvasPosition{X: x, Y: y}
}

func canvasIntelligenceSize(raw map[string]any) *model.CanvasSize {
	size, _ := raw["size"].(map[string]any)
	width, height := numberValue(raw["width"], 0), numberValue(raw["height"], 0)
	if size != nil {
		width, height = numberValue(size["width"], width), numberValue(size["height"], height)
	}
	if size == nil && raw["width"] == nil && raw["height"] == nil {
		return nil
	}
	return &model.CanvasSize{Width: width, Height: height}
}

func canvasIntelligenceRelationships(document map[string]any, nodes []model.CanvasNode) []RelationshipView {
	known := make(map[string]bool, len(nodes))
	for _, node := range nodes {
		known[node.ID] = true
	}
	relationships := make([]RelationshipView, 0)
	for _, edge := range creationMaps(document["connections"]) {
		from, to := stringValue(edge["fromNodeId"]), stringValue(edge["toNodeId"])
		if from == "" || to == "" || !known[from] || !known[to] {
			continue
		}
		typeName := strings.TrimSpace(stringValue(edge["type"]))
		if typeName == "" {
			typeName = "flow"
		}
		relationships = append(relationships, RelationshipView{
			From: from, To: to, Type: typeName, Strength: 1, Label: stringValue(edge["label"]),
		})
	}
	return relationships
}

// buildEnhancedNodeView 构建增强节点视图
func (ci *CanvasIntelligence) buildEnhancedNodeView(node model.CanvasNode, isFocus bool) EnhancedNodeView {
	// 智能内容摘要
	preview := node.Content
	if len(preview) > 200 {
		preview = preview[:200] + "..."
	}

	// 提取关键词（简化实现）
	keywords := ci.extractKeywords(node.Content)

	// 自动分类
	category := ci.categorizeNode(node)

	// 情感分析（简化）
	sentiment := ci.analyzeSentiment(node.Content)

	view := EnhancedNodeView{
		ID:             node.ID,
		Type:           node.Type,
		ContentPreview: preview,
		ContentHash:    hashContentSHA256(node.Content),
		ContentLength:  len(node.Content),
		HasFullContent: isFocus,
		Position:       ci.convertPosition(node.Position),
		Size:           ci.convertSize(node.Size),
		ZIndex:         ci.getZIndex(node),
		ParentID:       ci.getParentID(node.ParentID),
		Children:       node.Children,
		Tags:           ci.extractTags(node),
		Category:       category,
		Sentiment:      sentiment,
		Keywords:       keywords,
		IsFocus:        isFocus,
		IsModified:     ci.isRecentlyModified(node),
		Status:         ci.getNodeStatus(node),
		CreatedAt:      node.CreatedAt.Unix(),
		UpdatedAt:      node.UpdatedAt.Unix(),
		Metadata:       node.Metadata,
	}

	if isFocus {
		view.FullContent = node.Content
	}

	return view
}

// Continue in next chunk...
