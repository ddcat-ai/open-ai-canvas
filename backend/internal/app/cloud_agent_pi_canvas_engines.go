package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// Canvas Layout Engine - 自动布局引擎

type CanvasLayoutEngine struct {
	service *Service
}

func NewCanvasLayoutEngine(service *Service) *CanvasLayoutEngine {
	return &CanvasLayoutEngine{service: service}
}

// ApplyLayout 应用布局算法
func (e *CanvasLayoutEngine) ApplyLayout(algorithm, direction string, spacing float64, nodes []model.CanvasNode) (map[string]*model.CanvasPosition, error) {
	if algorithm == "auto" {
		algorithm = e.detectBestAlgorithm(nodes)
	}

	switch algorithm {
	case "tree":
		return e.applyTreeLayout(nodes, direction, spacing)
	case "grid":
		return e.applyGridLayout(nodes, spacing)
	case "force":
		return e.applyForceLayout(nodes, spacing)
	case "circular":
		return e.applyCircularLayout(nodes, spacing)
	case "hierarchical":
		return e.applyHierarchicalLayout(nodes, direction, spacing)
	default:
		return nil, fmt.Errorf("unsupported layout algorithm: %s", algorithm)
	}
}

// detectBestAlgorithm 检测最佳布局算法
func (e *CanvasLayoutEngine) detectBestAlgorithm(nodes []model.CanvasNode) string {
	// 检查父子关系比例
	withParent := 0
	for _, node := range nodes {
		if node.ParentID != nil {
			withParent++
		}
	}

	if len(nodes) > 0 && float64(withParent)/float64(len(nodes)) > 0.6 {
		return "tree"
	}

	if len(nodes) > 20 {
		return "force"
	}

	return "grid"
}

// applyTreeLayout 树形布局
func (e *CanvasLayoutEngine) applyTreeLayout(nodes []model.CanvasNode, direction string, spacing float64) (map[string]*model.CanvasPosition, error) {
	positions := make(map[string]*model.CanvasPosition)

	// 找出根节点
	roots := make([]model.CanvasNode, 0)
	nodeMap := make(map[string]model.CanvasNode)
	for _, node := range nodes {
		nodeMap[node.ID] = node
		if node.ParentID == nil {
			roots = append(roots, node)
		}
	}

	if len(roots) == 0 {
		return nil, fmt.Errorf("no root nodes found")
	}

	// 为每个根节点构建子树
	currentY := 0.0
	for _, root := range roots {
		if direction == "horizontal" {
			e.layoutTreeHorizontal(root, nodeMap, positions, 0, &currentY, spacing)
		} else {
			e.layoutTreeVertical(root, nodeMap, positions, 0, &currentY, spacing)
		}
		currentY += spacing * 2
	}

	return positions, nil
}

// layoutTreeVertical 垂直树形布局
func (e *CanvasLayoutEngine) layoutTreeVertical(node model.CanvasNode, nodeMap map[string]model.CanvasNode, positions map[string]*model.CanvasPosition, depth int, currentX *float64, spacing float64) {
	x := *currentX
	y := float64(depth) * spacing * 2

	positions[node.ID] = &model.CanvasPosition{X: x, Y: y}

	// 布局子节点
	if len(node.Children) > 0 {
		childX := x
		for _, childID := range node.Children {
			if child, ok := nodeMap[childID]; ok {
				e.layoutTreeVertical(child, nodeMap, positions, depth+1, &childX, spacing)
				childX += spacing
			}
		}
	} else {
		*currentX += spacing
	}
}

// layoutTreeHorizontal 水平树形布局
func (e *CanvasLayoutEngine) layoutTreeHorizontal(node model.CanvasNode, nodeMap map[string]model.CanvasNode, positions map[string]*model.CanvasPosition, depth int, currentY *float64, spacing float64) {
	x := float64(depth) * spacing * 2
	y := *currentY

	positions[node.ID] = &model.CanvasPosition{X: x, Y: y}

	// 布局子节点
	if len(node.Children) > 0 {
		childY := y
		for _, childID := range node.Children {
			if child, ok := nodeMap[childID]; ok {
				e.layoutTreeHorizontal(child, nodeMap, positions, depth+1, &childY, spacing)
				childY += spacing
			}
		}
	} else {
		*currentY += spacing
	}
}

// applyGridLayout 网格布局
func (e *CanvasLayoutEngine) applyGridLayout(nodes []model.CanvasNode, spacing float64) (map[string]*model.CanvasPosition, error) {
	positions := make(map[string]*model.CanvasPosition)

	// 计算网格维度
	cols := int(math.Ceil(math.Sqrt(float64(len(nodes)))))
	if cols == 0 {
		cols = 1
	}

	for i, node := range nodes {
		row := i / cols
		col := i % cols

		positions[node.ID] = &model.CanvasPosition{
			X: float64(col) * spacing,
			Y: float64(row) * spacing,
		}
	}

	return positions, nil
}

// applyForceLayout 力导向布局（简化版）
func (e *CanvasLayoutEngine) applyForceLayout(nodes []model.CanvasNode, spacing float64) (map[string]*model.CanvasPosition, error) {
	positions := make(map[string]*model.CanvasPosition)

	// 初始随机分布
	for i, node := range nodes {
		angle := float64(i) * 2 * math.Pi / float64(len(nodes))
		radius := spacing * 2
		positions[node.ID] = &model.CanvasPosition{
			X: radius * math.Cos(angle),
			Y: radius * math.Sin(angle),
		}
	}

	// 简化的力导向迭代（10次）
	for iter := 0; iter < 10; iter++ {
		forces := make(map[string]*model.CanvasPosition)
		for id := range positions {
			forces[id] = &model.CanvasPosition{X: 0, Y: 0}
		}

		// 计算斥力
		for id1, pos1 := range positions {
			for id2, pos2 := range positions {
				if id1 != id2 {
					dx := pos1.X - pos2.X
					dy := pos1.Y - pos2.Y
					dist := math.Sqrt(dx*dx + dy*dy)
					if dist < 1 {
						dist = 1
					}
					force := spacing * spacing / dist
					forces[id1].X += dx / dist * force
					forces[id1].Y += dy / dist * force
				}
			}
		}

		// 计算引力（父子关系）
		nodeMap := make(map[string]model.CanvasNode)
		for _, node := range nodes {
			nodeMap[node.ID] = node
		}

		for _, node := range nodes {
			if node.ParentID != nil {
				if parentPos, ok := positions[*node.ParentID]; ok {
					if childPos, ok := positions[node.ID]; ok {
						dx := parentPos.X - childPos.X
						dy := parentPos.Y - childPos.Y
						dist := math.Sqrt(dx*dx + dy*dy)
						if dist > 0 {
							force := dist * 0.1
							forces[node.ID].X += dx / dist * force
							forces[node.ID].Y += dy / dist * force
						}
					}
				}
			}
		}

		// 应用力
		for id, force := range forces {
			positions[id].X += force.X * 0.1
			positions[id].Y += force.Y * 0.1
		}
	}

	return positions, nil
}

// applyCircularLayout 环形布局
func (e *CanvasLayoutEngine) applyCircularLayout(nodes []model.CanvasNode, spacing float64) (map[string]*model.CanvasPosition, error) {
	positions := make(map[string]*model.CanvasPosition)

	if len(nodes) == 0 {
		return positions, nil
	}

	radius := spacing * float64(len(nodes)) / (2 * math.Pi)
	if radius < spacing {
		radius = spacing
	}

	for i, node := range nodes {
		angle := float64(i) * 2 * math.Pi / float64(len(nodes))
		positions[node.ID] = &model.CanvasPosition{
			X: radius * math.Cos(angle),
			Y: radius * math.Sin(angle),
		}
	}

	return positions, nil
}

// applyHierarchicalLayout 层级布局
func (e *CanvasLayoutEngine) applyHierarchicalLayout(nodes []model.CanvasNode, direction string, spacing float64) (map[string]*model.CanvasPosition, error) {
	positions := make(map[string]*model.CanvasPosition)

	// 计算每个节点的层级
	levels := make(map[string]int)
	nodeMap := make(map[string]model.CanvasNode)
	for _, node := range nodes {
		nodeMap[node.ID] = node
	}

	// 找根节点
	roots := make([]string, 0)
	for _, node := range nodes {
		if node.ParentID == nil {
			roots = append(roots, node.ID)
			levels[node.ID] = 0
		}
	}

	// BFS 计算层级
	queue := make([]string, len(roots))
	copy(queue, roots)

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]

		currentLevel := levels[current]
		node := nodeMap[current]

		for _, childID := range node.Children {
			if _, visited := levels[childID]; !visited {
				levels[childID] = currentLevel + 1
				queue = append(queue, childID)
			}
		}
	}

	// 按层级分组
	levelGroups := make(map[int][]string)
	maxLevel := 0
	for id, level := range levels {
		levelGroups[level] = append(levelGroups[level], id)
		if level > maxLevel {
			maxLevel = level
		}
	}

	// 布局每一层
	if direction == "horizontal" {
		for level := 0; level <= maxLevel; level++ {
			nodeIDs := levelGroups[level]
			x := float64(level) * spacing * 2
			for i, nodeID := range nodeIDs {
				y := float64(i) * spacing
				positions[nodeID] = &model.CanvasPosition{X: x, Y: y}
			}
		}
	} else {
		for level := 0; level <= maxLevel; level++ {
			nodeIDs := levelGroups[level]
			y := float64(level) * spacing * 2
			for i, nodeID := range nodeIDs {
				x := float64(i) * spacing
				positions[nodeID] = &model.CanvasPosition{X: x, Y: y}
			}
		}
	}

	return positions, nil
}

// Canvas Search Engine - 搜索引擎

type CanvasSearchEngine struct {
	service *Service
}

type CanvasSearchQuery struct {
	Query    string
	Type     string
	Category string
	Tags     []string
	Limit    int
}

type CanvasSearchResult struct {
	Node      model.CanvasNode `json:"node"`
	Score     float64          `json:"score"`
	Highlight string           `json:"highlight"`
}

func NewCanvasSearchEngine(service *Service) *CanvasSearchEngine {
	return &CanvasSearchEngine{service: service}
}

// Search 执行搜索
func (e *CanvasSearchEngine) Search(userID, canvasID string, query CanvasSearchQuery) ([]CanvasSearchResult, error) {
	// 获取所有节点
	nodes, err := e.service.repo.CanvasNodes(userID, canvasID)
	if err != nil {
		return nil, fmt.Errorf("get nodes: %w", err)
	}

	results := make([]CanvasSearchResult, 0)

	// 搜索和评分
	for _, node := range nodes {
		score := e.calculateScore(node, query)
		if score > 0 {
			highlight := e.generateHighlight(node, query)
			results = append(results, CanvasSearchResult{
				Node:      node,
				Score:     score,
				Highlight: highlight,
			})
		}
	}

	// 排序
	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})

	// 限制结果数量
	if query.Limit > 0 && len(results) > query.Limit {
		results = results[:query.Limit]
	}

	return results, nil
}

// calculateScore 计算搜索得分
func (e *CanvasSearchEngine) calculateScore(node model.CanvasNode, query CanvasSearchQuery) float64 {
	score := 0.0

	// 类型匹配
	if query.Type != "" && node.Type != query.Type {
		return 0
	}

	// 关键词搜索
	if query.Query != "" {
		queryLower := strings.ToLower(query.Query)
		contentLower := strings.ToLower(node.Content)

		// 精确匹配
		if strings.Contains(contentLower, queryLower) {
			score += 10.0

			// 标题匹配（前100字符）
			if len(contentLower) > 100 && strings.Contains(contentLower[:100], queryLower) {
				score += 5.0
			}

			// 完整词匹配
			words := strings.Fields(contentLower)
			for _, word := range words {
				if word == queryLower {
					score += 3.0
				}
			}
		}

		// 模糊匹配（分词）
		queryWords := strings.Fields(queryLower)
		for _, qWord := range queryWords {
			if strings.Contains(contentLower, qWord) {
				score += 1.0
			}
		}
	}

	// 分类匹配
	if query.Category != "" {
		ci := e.service.NewCanvasIntelligence()
		nodeCategory := ci.categorizeNode(node)
		if nodeCategory == query.Category {
			score += 5.0
		}
	}

	// 标签匹配
	if len(query.Tags) > 0 && node.Metadata != nil {
		if nodeTags, ok := node.Metadata["tags"].([]interface{}); ok {
			matchedTags := 0
			for _, qt := range query.Tags {
				for _, nt := range nodeTags {
					if ntStr, ok := nt.(string); ok && ntStr == qt {
						matchedTags++
					}
				}
			}
			score += float64(matchedTags) * 3.0
		}
	}

	return score
}

// generateHighlight 生成高亮摘要
func (e *CanvasSearchEngine) generateHighlight(node model.CanvasNode, query CanvasSearchQuery) string {
	if query.Query == "" {
		if len(node.Content) > 100 {
			return node.Content[:100] + "..."
		}
		return node.Content
	}

	queryLower := strings.ToLower(query.Query)
	contentLower := strings.ToLower(node.Content)

	// 找到匹配位置
	index := strings.Index(contentLower, queryLower)
	if index == -1 {
		// 没找到精确匹配，返回开头
		if len(node.Content) > 100 {
			return node.Content[:100] + "..."
		}
		return node.Content
	}

	// 提取匹配周围的文本
	start := index - 50
	if start < 0 {
		start = 0
	}

	end := index + len(query.Query) + 50
	if end > len(node.Content) {
		end = len(node.Content)
	}

	highlight := ""
	if start > 0 {
		highlight += "..."
	}
	highlight += node.Content[start:end]
	if end < len(node.Content) {
		highlight += "..."
	}

	return highlight
}

// Canvas Event Handlers - 事件处理器

// handleMessageStart 处理消息开始事件
func (s *Service) handleMessageStart(userID, runID string, data map[string]any, fences ...*model.CloudAgentFence) (any, error) {
	// 记录消息开始
	slog.Debug("agent message_start", "run", runID)

	// 更新运行状态
	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, err
	}

	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, err
	}

	// 标记正在生成响应
	state.IsGenerating = true

	if err := s.saveCloudAgentRuntimeState(userID, runID, &state, fences...); err != nil {
		return nil, err
	}

	return map[string]any{"ok": true}, nil
}

// handleMessageDelta 处理消息增量事件
func (s *Service) handleMessageDelta(userID, runID string, data map[string]any, fences ...*model.CloudAgentFence) (any, error) {
	delta, _ := data["delta"].(string)
	messageID, _ := data["messageId"].(string)
	slog.Debug("agent message_delta", "run", runID, "message_id", messageID, "len", len(delta))

	// 推送实时增量到前端
	if err := s.broadcastAgentEvent(userID, runID, "message_delta", map[string]any{
		"delta":     delta,
		"messageId": messageID,
	}, fences...); err != nil {
		slog.Warn("agent message_delta broadcast failed", "run", runID, "error", err)
		return nil, err
	}

	return map[string]any{"ok": true}, nil
}

// handleMessageEnd 处理消息结束事件（关键修复点）
func (s *Service) handleMessageEnd(userID, runID string, data map[string]any, fences ...*model.CloudAgentFence) (any, error) {
	slog.Debug("agent message_end", "run", runID, "role", data["role"])

	// 检查消息角色，防止将用户消息误认为助手消息
	role, _ := data["role"].(string)
	if role == "user" {
		// 这是用户消息结束，不是助手响应，直接返回
		slog.Debug("agent message_end ignored", "run", runID, "role", "user")
		return map[string]any{"ok": true, "ignored": true, "reason": "user message"}, nil
	}

	// 只处理助手消息结束
	if role != "assistant" {
		slog.Debug("agent message_end ignored", "run", runID, "role", role)
		return map[string]any{"ok": true, "ignored": true, "reason": fmt.Sprintf("non-assistant role: %s", role)}, nil
	}

	// 更新运行状态
	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, err
	}

	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, err
	}

	// 标记生成完成
	state.IsGenerating = false

	// 计数真实的助手响应
	state.PiAssistantResponses++

	slog.Debug("agent assistant response completed", "run", runID, "count", state.PiAssistantResponses)

	if err := s.saveCloudAgentRuntimeState(userID, runID, &state, fences...); err != nil {
		return nil, err
	}

	return map[string]any{"ok": true, "assistantResponses": state.PiAssistantResponses}, nil
}

// handleToolCall 处理工具调用事件
func (s *Service) handleToolCall(userID, runID string, data map[string]any, fences ...*model.CloudAgentFence) (any, error) {
	toolName, _ := data["toolName"].(string)
	slog.Debug("agent tool_call", "run", runID, "tool", toolName)

	return map[string]any{"ok": true}, nil
}

// handleError 处理错误事件
func (s *Service) handleError(userID, runID string, data map[string]any, fences ...*model.CloudAgentFence) (any, error) {
	errorMsg, _ := data["error"].(string)
	slog.Warn("agent runtime error", "run", runID, "error", errorMsg)

	// 更新运行状态为失败
	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, err
	}

	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, err
	}

	state.IsGenerating = false
	state.LastError = errorMsg

	if err := s.saveCloudAgentRuntimeState(userID, runID, &state, fences...); err != nil {
		return nil, err
	}

	return map[string]any{"ok": true}, nil
}

// saveCloudAgentRuntimeState persists only the Pi control fields changed by an
// event handler, merging them into the latest revision before checkpointing.
func (s *Service) saveCloudAgentRuntimeState(userID, runID string, state *cloudAgentRuntime, fences ...*model.CloudAgentFence) error {
	if state == nil {
		return fmt.Errorf("missing Agent runtime state")
	}
	for attempt := 0; attempt < 4; attempt++ {
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return err
		}
		cloudAgentBindFence(run, fences)
		err = s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			fresh, err := cloudAgentDecode(current)
			if err != nil {
				return err
			}
			fresh.IsGenerating = state.IsGenerating
			fresh.LastError = state.LastError
			fresh.PiAssistantResponses = state.PiAssistantResponses
			return cloudAgentSave(current, &fresh)
		})
		if !errors.Is(err, repository.ErrCreationConflict) {
			return err
		}
	}
	return repository.ErrCreationConflict
}

func (s *Service) broadcastAgentEvent(userID, runID, kind string, payload map[string]any, fences ...*model.CloudAgentFence) error {
	for attempt := 0; attempt < 4; attempt++ {
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return err
		}
		cloudAgentBindFence(run, fences)
		err = s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			state, err := cloudAgentDecode(current)
			if err != nil {
				return err
			}
			state.event(runID, kind, payload)
			return cloudAgentSave(current, &state)
		})
		if !errors.Is(err, repository.ErrCreationConflict) {
			return err
		}
	}
	return repository.ErrCreationConflict
}

// updatePiRunWithStep 更新运行状态（添加步骤）
func (s *Service) updatePiRunWithStep(userID, runID string, revision int64, stepID string, state *cloudAgentRuntime) error {
	return s.repo.MutateCloudAgent(userID, runID, revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		state.ActiveTaskID = stepID
		return cloudAgentSave(current, state)
	})
}

// routeStandardTool 路由标准工具（非画布工具）
func (s *Service) routeStandardTool(ctx context.Context, userID, runID, toolName string, payload map[string]json.RawMessage) (any, error) {
	slog.Debug("agent routing standard tool", "run", runID, "tool", toolName)

	// 将参数从 json.RawMessage 转换为 map[string]any
	args := make(map[string]any)
	for key, rawValue := range payload {
		var value any
		if err := json.Unmarshal(rawValue, &value); err != nil {
			return nil, fmt.Errorf("decode standard tool parameter %q: %w", key, err)
		}
		args[key] = value
	}

	// 路由到对应的工具处理器
	switch toolName {
	case "read_file", "write_file", "edit_file", "delete_file":
		return s.handleFileOperation(ctx, userID, runID, toolName, args)
	case "list_directory", "search_files", "glob_files":
		return s.handleFileSearch(ctx, userID, runID, toolName, args)
	case "bash", "shell_command":
		return s.handleShellCommand(ctx, userID, runID, args)
	case "web_search", "fetch_url":
		return s.handleWebOperation(ctx, userID, runID, toolName, args)
	default:
		return map[string]any{
			"success": false,
			"error":   fmt.Sprintf("unsupported standard tool: %s", toolName),
		}, nil
	}
}

// handleFileOperation 处理文件操作工具
func (s *Service) handleFileOperation(ctx context.Context, userID, runID, toolName string, args map[string]any) (any, error) {
	return nil, fmt.Errorf("standard tool %q is unavailable: file access is not configured", toolName)
}

// handleFileSearch 处理文件搜索工具
func (s *Service) handleFileSearch(ctx context.Context, userID, runID, toolName string, args map[string]any) (any, error) {
	return nil, fmt.Errorf("standard tool %q is unavailable: file search is not configured", toolName)
}

// handleShellCommand 处理 Shell 命令工具
func (s *Service) handleShellCommand(ctx context.Context, userID, runID string, args map[string]any) (any, error) {
	return nil, errors.New("standard tool shell execution is unavailable: no approval-backed executor is configured")
}

// handleWebOperation 处理 Web 操作工具
func (s *Service) handleWebOperation(ctx context.Context, userID, runID, toolName string, args map[string]any) (any, error) {
	return nil, fmt.Errorf("standard tool %q is unavailable: web access is not configured", toolName)
}
