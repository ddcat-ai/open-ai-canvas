package app

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

// generateIntelligence 生成智能洞察
func (ci *CanvasIntelligence) generateIntelligence(nodes []model.CanvasNode, snapshot CanvasSnapshot) CanvasIntelligenceInsights {
	return CanvasIntelligenceInsights{
		Summary:     ci.generateSummary(nodes, snapshot),
		Suggestions: ci.generateSuggestions(nodes, snapshot),
		Patterns:    ci.recognizePatterns(nodes, snapshot),
		Issues:      ci.diagnoseIssues(nodes, snapshot),
		Trends:      ci.analyzeTrends(nodes),
	}
}

// generateSummary 生成画布总结
func (ci *CanvasIntelligence) generateSummary(nodes []model.CanvasNode, snapshot CanvasSnapshot) CanvasSummary {
	// 提取主要主题
	mainTopics := ci.extractMainTopics(nodes)

	// 评估进度
	progress := ci.assessProgress(nodes)

	// 计算完整性
	completeness := ci.calculateCompleteness(nodes, snapshot)

	// 生成一句话总结
	oneSentence := ci.generateOneSentenceSummary(nodes, snapshot, mainTopics)

	return CanvasSummary{
		OneSentence:  oneSentence,
		MainTopics:   mainTopics,
		Progress:     progress,
		Completeness: completeness,
	}
}

// extractMainTopics 提取主要主题
func (ci *CanvasIntelligence) extractMainTopics(nodes []model.CanvasNode) []string {
	// 收集所有关键词
	allKeywords := make(map[string]int)
	for _, node := range nodes {
		keywords := ci.extractKeywords(node.Content)
		for _, kw := range keywords {
			allKeywords[kw]++
		}
	}

	// 排序取前3个
	type kv struct {
		Key   string
		Value int
	}
	var sorted []kv
	for k, v := range allKeywords {
		sorted = append(sorted, kv{k, v})
	}
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].Value > sorted[j].Value
	})

	topics := make([]string, 0, 3)
	for i := 0; i < len(sorted) && i < 3; i++ {
		topics = append(topics, sorted[i].Key)
	}

	return topics
}

// assessProgress 评估进度
func (ci *CanvasIntelligence) assessProgress(nodes []model.CanvasNode) string {
	if len(nodes) < 5 {
		return "early"
	}

	// 统计完成状态
	completed := 0
	total := 0

	for _, node := range nodes {
		category := ci.categorizeNode(node)
		if category == "task" {
			total++
			sentiment := ci.analyzeSentiment(node.Content)
			if sentiment == "positive" {
				completed++
			}
		}
	}

	if total == 0 {
		// 没有任务节点，根据节点数量判断
		if len(nodes) < 10 {
			return "early"
		} else if len(nodes) < 30 {
			return "mid"
		} else {
			return "mature"
		}
	}

	completionRate := float64(completed) / float64(total)
	if completionRate < 0.3 {
		return "early"
	} else if completionRate < 0.7 {
		return "mid"
	} else {
		return "mature"
	}
}

// calculateCompleteness 计算完整性
func (ci *CanvasIntelligence) calculateCompleteness(nodes []model.CanvasNode, snapshot CanvasSnapshot) float64 {
	score := 0.0

	// 1. 节点数量（20%）
	if len(nodes) > 0 {
		score += 0.2
	}

	// 2. 结构完整性（20%）
	if len(snapshot.Hierarchy.RootNodes) > 0 {
		score += 0.2
	}

	// 3. 内容质量（30%）
	contentScore := 0.0
	for _, node := range nodes {
		if len(node.Content) > 50 {
			contentScore += 1.0
		}
	}
	if len(nodes) > 0 {
		contentScore /= float64(len(nodes))
		score += contentScore * 0.3
	}

	// 4. 关系完整性（30%）
	if len(snapshot.Relationships) > 0 {
		relationshipRatio := float64(len(snapshot.Relationships)) / float64(len(nodes))
		if relationshipRatio > 1 {
			relationshipRatio = 1
		}
		score += relationshipRatio * 0.3
	}

	return score
}

// generateOneSentenceSummary 生成一句话总结
func (ci *CanvasIntelligence) generateOneSentenceSummary(nodes []model.CanvasNode, snapshot CanvasSnapshot, mainTopics []string) string {
	nodeCount := len(nodes)
	progress := ci.assessProgress(nodes)

	topicsStr := "various topics"
	if len(mainTopics) > 0 {
		topicsStr = strings.Join(mainTopics, ", ")
	}

	progressMap := map[string]string{
		"early":  "刚开始",
		"mid":    "进行中",
		"mature": "接近完成",
	}

	return fmt.Sprintf("包含 %d 个节点的画布，主题：%s，状态：%s", nodeCount, topicsStr, progressMap[progress])
}

// generateSuggestions 生成行动建议
func (ci *CanvasIntelligence) generateSuggestions(nodes []model.CanvasNode, snapshot CanvasSnapshot) []ActionSuggestion {
	suggestions := make([]ActionSuggestion, 0)

	// 1. 孤立节点建议
	orphans := ci.findOrphanNodes(nodes, snapshot)
	if len(orphans) > 0 {
		suggestions = append(suggestions, ActionSuggestion{
			Priority: 3,
			Action:   "连接孤立节点",
			Reason:   fmt.Sprintf("发现 %d 个孤立节点，建立关联可以增强结构", len(orphans)),
			Impact:   "提升画布结构完整性",
		})
	}

	// 2. 布局优化建议
	if snapshot.Layout.Density > 0.8 {
		suggestions = append(suggestions, ActionSuggestion{
			Priority: 2,
			Action:   "优化布局密度",
			Reason:   "当前布局密度过高，可能影响可读性",
			Impact:   "改善视觉体验和导航效率",
		})
	}

	// 3. 内容完善建议
	emptyNodes := ci.findEmptyOrShortNodes(nodes)
	if len(emptyNodes) > 0 {
		suggestions = append(suggestions, ActionSuggestion{
			Priority: 4,
			Action:   "完善节点内容",
			Reason:   fmt.Sprintf("发现 %d 个内容较少的节点", len(emptyNodes)),
			Impact:   "提高画布信息密度",
		})
	}

	// 4. 分类整理建议
	if len(nodes) > 20 && len(snapshot.Layout.Clusters) < 3 {
		suggestions = append(suggestions, ActionSuggestion{
			Priority: 3,
			Action:   "添加分类节点",
			Reason:   "节点数量较多但缺少明确分类",
			Impact:   "改善信息架构和可维护性",
		})
	}

	// 5. 任务跟进建议
	incompleteTasks := ci.findIncompleteTasks(nodes)
	if len(incompleteTasks) > 0 {
		suggestions = append(suggestions, ActionSuggestion{
			Priority: 5,
			Action:   "跟进待办任务",
			Reason:   fmt.Sprintf("有 %d 个待办任务需要处理", len(incompleteTasks)),
			Impact:   "推进工作进度",
		})
	}

	// 按优先级排序
	sort.Slice(suggestions, func(i, j int) bool {
		return suggestions[i].Priority > suggestions[j].Priority
	})

	return suggestions
}

// recognizePatterns 识别模式
func (ci *CanvasIntelligence) recognizePatterns(nodes []model.CanvasNode, snapshot CanvasSnapshot) []PatternRecognition {
	patterns := make([]PatternRecognition, 0)

	// 1. 思维导图模式
	if ci.isMindMapPattern(snapshot) {
		patterns = append(patterns, PatternRecognition{
			Pattern:     "mindmap",
			Confidence:  0.85,
			Evidence:    snapshot.Hierarchy.RootNodes,
			Description: "检测到思维导图结构：以中心主题向外扩展",
		})
	}

	// 2. 看板模式
	if ci.isKanbanPattern(snapshot) {
		patterns = append(patterns, PatternRecognition{
			Pattern:     "kanban",
			Confidence:  0.75,
			Evidence:    []string{},
			Description: "检测到看板模式：按阶段组织的任务流",
		})
	}

	// 3. 时间线模式
	if ci.isTimelinePattern(nodes, snapshot) {
		patterns = append(patterns, PatternRecognition{
			Pattern:     "timeline",
			Confidence:  0.7,
			Evidence:    []string{},
			Description: "检测到时间线模式：按时间顺序排列的事件",
		})
	}

	// 4. 层级结构模式
	if snapshot.Hierarchy.MaxDepth >= 3 {
		patterns = append(patterns, PatternRecognition{
			Pattern:     "hierarchy",
			Confidence:  0.8,
			Evidence:    snapshot.Hierarchy.RootNodes,
			Description: fmt.Sprintf("检测到层级结构：最大深度 %d 层", snapshot.Hierarchy.MaxDepth),
		})
	}

	// 5. 协作模式
	if ci.isCollaborativePattern(nodes) {
		patterns = append(patterns, PatternRecognition{
			Pattern:     "collaborative",
			Confidence:  0.65,
			Evidence:    []string{},
			Description: "检测到协作模式：多人参与编辑",
		})
	}

	return patterns
}

// diagnoseIssues 诊断问题
func (ci *CanvasIntelligence) diagnoseIssues(nodes []model.CanvasNode, snapshot CanvasSnapshot) []CanvasIssue {
	issues := make([]CanvasIssue, 0)

	// 1. 孤立节点
	orphans := ci.findOrphanNodes(nodes, snapshot)
	if len(orphans) > 0 {
		issues = append(issues, CanvasIssue{
			Severity:      "medium",
			Type:          "orphan",
			Description:   fmt.Sprintf("发现 %d 个孤立节点，没有与其他节点建立关系", len(orphans)),
			AffectedNodes: orphans,
			FixSuggestion: "使用 canvas_relationship_create 工具建立关联",
		})
	}

	// 2. 重复内容
	duplicates := ci.findDuplicateNodes(nodes)
	if len(duplicates) > 0 {
		issues = append(issues, CanvasIssue{
			Severity:      "low",
			Type:          "duplicate",
			Description:   fmt.Sprintf("发现 %d 组可能重复的节点", len(duplicates)),
			AffectedNodes: ci.flattenDuplicates(duplicates),
			FixSuggestion: "合并或删除重复节点",
		})
	}

	// 3. 空节点
	emptyNodes := ci.findEmptyOrShortNodes(nodes)
	if len(emptyNodes) > 3 {
		issues = append(issues, CanvasIssue{
			Severity:      "low",
			Type:          "incomplete",
			Description:   fmt.Sprintf("发现 %d 个内容较少的节点", len(emptyNodes)),
			AffectedNodes: emptyNodes,
			FixSuggestion: "补充节点内容或删除无用节点",
		})
	}

	// 4. 布局问题
	if snapshot.Layout.Density > 0.9 {
		issues = append(issues, CanvasIssue{
			Severity:      "medium",
			Type:          "layout",
			Description:   "节点密度过高，可能影响可读性",
			AffectedNodes: []string{},
			FixSuggestion: "使用 canvas_layout 工具重新布局",
		})
	}

	// 5. 深度过深
	if snapshot.Hierarchy.MaxDepth > 5 {
		issues = append(issues, CanvasIssue{
			Severity:      "low",
			Type:          "hierarchy",
			Description:   fmt.Sprintf("层级深度 %d 过深，可能难以导航", snapshot.Hierarchy.MaxDepth),
			AffectedNodes: []string{},
			FixSuggestion: "考虑扁平化结构或添加中间层级",
		})
	}

	return issues
}

// analyzeTrends 分析趋势
func (ci *CanvasIntelligence) analyzeTrends(nodes []model.CanvasNode) TrendAnalysis {
	// 计算最近活动
	recentActivity := ci.calculateRecentActivity(nodes)

	// 计算增长率（简化实现：基于节点创建时间）
	growthRate := ci.calculateGrowthRate(nodes)

	// 识别热门区域
	hotAreas := ci.identifyHotAreas(nodes)

	// 协作地图
	collaborationMap := ci.buildCollaborationMap(nodes)

	return TrendAnalysis{
		RecentActivity:   recentActivity,
		GrowthRate:       growthRate,
		HotAreas:         hotAreas,
		CollaborationMap: collaborationMap,
	}
}

// 辅助方法

func (ci *CanvasIntelligence) findOrphanNodes(nodes []model.CanvasNode, snapshot CanvasSnapshot) []string {
	connected := make(map[string]bool)

	// 标记有关系的节点
	for _, rel := range snapshot.Relationships {
		connected[rel.From] = true
		connected[rel.To] = true
	}

	// 找出孤立节点
	orphans := make([]string, 0)
	for _, node := range nodes {
		if !connected[node.ID] && node.ParentID == nil && len(node.Children) == 0 {
			orphans = append(orphans, node.ID)
		}
	}

	return orphans
}

func (ci *CanvasIntelligence) findDuplicateNodes(nodes []model.CanvasNode) [][]string {
	// 简化实现：基于内容哈希
	contentMap := make(map[string][]string)

	for _, node := range nodes {
		if len(node.Content) < 10 {
			continue
		}
		hash := hashContentSHA256(node.Content)
		contentMap[hash] = append(contentMap[hash], node.ID)
	}

	duplicates := make([][]string, 0)
	for _, ids := range contentMap {
		if len(ids) > 1 {
			duplicates = append(duplicates, ids)
		}
	}

	return duplicates
}

func (ci *CanvasIntelligence) flattenDuplicates(duplicates [][]string) []string {
	result := make([]string, 0)
	for _, group := range duplicates {
		result = append(result, group...)
	}
	return result
}

func (ci *CanvasIntelligence) findEmptyOrShortNodes(nodes []model.CanvasNode) []string {
	result := make([]string, 0)
	for _, node := range nodes {
		if len(strings.TrimSpace(node.Content)) < 10 {
			result = append(result, node.ID)
		}
	}
	return result
}

func (ci *CanvasIntelligence) findIncompleteTasks(nodes []model.CanvasNode) []string {
	result := make([]string, 0)
	for _, node := range nodes {
		category := ci.categorizeNode(node)
		sentiment := ci.analyzeSentiment(node.Content)
		if category == "task" && sentiment == "todo" {
			result = append(result, node.ID)
		}
	}
	return result
}

func (ci *CanvasIntelligence) isMindMapPattern(snapshot CanvasSnapshot) bool {
	// 思维导图特征：单一根节点，多层级
	return len(snapshot.Hierarchy.RootNodes) == 1 && snapshot.Hierarchy.MaxDepth >= 2
}

func (ci *CanvasIntelligence) isKanbanPattern(snapshot CanvasSnapshot) bool {
	// 看板特征：多个根节点（列），每个根节点下有多个子节点（卡片）
	if len(snapshot.Hierarchy.RootNodes) < 2 {
		return false
	}

	// 检查每个根节点是否有子节点
	for _, rootID := range snapshot.Hierarchy.RootNodes {
		if treeNode, ok := snapshot.Hierarchy.Tree[rootID]; ok {
			if len(treeNode.Children) == 0 {
				return false
			}
		}
	}

	return true
}

func (ci *CanvasIntelligence) isTimelinePattern(nodes []model.CanvasNode, snapshot CanvasSnapshot) bool {
	// 时间线特征：节点按时间顺序排列（X轴）
	if len(nodes) < 3 {
		return false
	}

	// 检查节点是否按X坐标排序
	positions := make([]float64, 0)
	timestamps := make([]int64, 0)

	for _, node := range nodes {
		if node.Position != nil {
			positions = append(positions, node.Position.X)
			timestamps = append(timestamps, node.CreatedAt.Unix())
		}
	}

	if len(positions) < 3 {
		return false
	}

	// 检查位置和时间是否相关
	posIncreasing := true
	timeIncreasing := true

	for i := 1; i < len(positions); i++ {
		if positions[i] < positions[i-1] {
			posIncreasing = false
		}
		if timestamps[i] < timestamps[i-1] {
			timeIncreasing = false
		}
	}

	return posIncreasing && timeIncreasing
}

func (ci *CanvasIntelligence) isCollaborativePattern(nodes []model.CanvasNode) bool {
	// 协作特征：多个不同的更新者
	updaters := make(map[string]bool)

	for _, node := range nodes {
		if node.Metadata != nil {
			if updatedBy, ok := node.Metadata["updatedBy"].(string); ok && updatedBy != "" {
				updaters[updatedBy] = true
			}
		}
	}

	return len(updaters) >= 2
}

func (ci *CanvasIntelligence) calculateRecentActivity(nodes []model.CanvasNode) ActivityLevel {
	now := time.Now()
	recentUpdates := 0

	for _, node := range nodes {
		if now.Sub(node.UpdatedAt) < 1*time.Hour {
			recentUpdates++
		}
	}

	level := "low"
	if recentUpdates > 10 {
		level = "high"
	} else if recentUpdates > 3 {
		level = "medium"
	}

	lastUpdated := int64(0)
	for _, node := range nodes {
		if node.UpdatedAt.Unix() > lastUpdated {
			lastUpdated = node.UpdatedAt.Unix()
		}
	}

	return ActivityLevel{
		Level:       level,
		LastUpdated: lastUpdated,
		UpdateCount: recentUpdates,
	}
}

func (ci *CanvasIntelligence) calculateGrowthRate(nodes []model.CanvasNode) float64 {
	if len(nodes) == 0 {
		return 0
	}

	// 简化实现：计算最近1天的增长
	now := time.Now()
	recentNodes := 0

	for _, node := range nodes {
		if now.Sub(node.CreatedAt) < 24*time.Hour {
			recentNodes++
		}
	}

	return float64(recentNodes) / float64(len(nodes))
}

func (ci *CanvasIntelligence) identifyHotAreas(nodes []model.CanvasNode) []string {
	// 简化实现：找出最近更新最频繁的区域（聚类）
	recentNodes := make([]model.CanvasNode, 0)
	now := time.Now()

	for _, node := range nodes {
		if node.Position != nil && now.Sub(node.UpdatedAt) < 1*time.Hour {
			recentNodes = append(recentNodes, node)
		}
	}

	if len(recentNodes) == 0 {
		return []string{}
	}
	for index := range recentNodes {
		if recentNodes[index].Position == nil {
			recentNodes[index].Position = &model.CanvasPosition{}
		}
	}

	// 使用聚类找出热门区域
	clusterCount := 3
	if len(recentNodes) < clusterCount {
		clusterCount = len(recentNodes)
	}
	clusters := ci.simpleKMeans(recentNodes, clusterCount)
	hotAreas := make([]string, 0)
	for _, cluster := range clusters {
		if len(cluster.NodeIDs) > 0 {
			hotAreas = append(hotAreas, cluster.Label)
		}
	}

	return hotAreas
}

func (ci *CanvasIntelligence) buildCollaborationMap(nodes []model.CanvasNode) map[string]int {
	collaborationMap := make(map[string]int)

	for _, node := range nodes {
		if node.Metadata != nil {
			if updatedBy, ok := node.Metadata["updatedBy"].(string); ok && updatedBy != "" {
				collaborationMap[updatedBy]++
			}
		}
	}

	return collaborationMap
}

// buildCapabilityMatrix 构建能力矩阵
func (ci *CanvasIntelligence) buildCapabilityMatrix(userID, canvasID string) CanvasCapabilityMatrix {
	return CanvasCapabilityMatrix{
		SupportedNodeTypes: ci.getSupportedNodeTypes(),
		Permissions:        ci.getCanvasPermissions(userID, canvasID),
		Limits:             ci.getCanvasLimits(),
		Features:           ci.getFeatures(),
		Extensions:         ci.getExtensions(),
	}
}

func (ci *CanvasIntelligence) getSupportedNodeTypes() []NodeTypeCapability {
	return []NodeTypeCapability{
		{Type: "text", DisplayName: "文本", Description: "纯文本内容", Creatable: true, Operations: []string{"read", "update", "delete", "move", "duplicate"}},
		{Type: "markdown", DisplayName: "Markdown", Description: "Markdown格式文本", Creatable: true, Operations: []string{"read", "update", "delete", "move", "duplicate"}},
		{Type: "code", DisplayName: "代码", Description: "代码片段", Creatable: true, Operations: []string{"read", "update", "delete", "move", "duplicate"}},
		{Type: "image", DisplayName: "图片", Description: "图片节点", Creatable: true, Operations: []string{"read", "update", "delete", "move", "duplicate"}},
		{Type: "link", DisplayName: "链接", Description: "外部链接", Creatable: true, Operations: []string{"read", "update", "delete", "move", "duplicate"}},
		{Type: "diagram", DisplayName: "图表", Description: "图表节点", Creatable: true, Operations: []string{"read", "update", "delete", "move"}},
		{Type: "mindmap", DisplayName: "思维导图", Description: "思维导图节点", Creatable: true, Operations: []string{"read", "update", "delete", "move"}},
		{Type: "task", DisplayName: "任务", Description: "待办任务", Creatable: true, Operations: []string{"read", "update", "delete", "move", "duplicate"}},
	}
}

func (ci *CanvasIntelligence) getCanvasPermissions(userID, canvasID string) CanvasPermissions {
	// CanvasProjectForUser uses the persisted canvas store and enforces the same
	// owner scope as every other Agent canvas operation.
	if _, err := ci.service.repo.CanvasProjectForUser(userID, canvasID); err != nil {
		log.Printf("[Agent] failed to get canvas permissions for %s: %v", canvasID, err)
		return CanvasPermissions{
			CanRead:         true,
			CanCreate:       false,
			CanUpdate:       false,
			CanDelete:       false,
			CanMove:         false,
			CanShare:        false,
			RequireApproval: []string{"canvas_node_create", "canvas_node_update", "canvas_node_delete", "canvas_bulk_operation"},
		}
	}
	return CanvasPermissions{CanRead: true, CanCreate: true, CanUpdate: true, CanDelete: true, CanMove: true, CanShare: true, RequireApproval: []string{}}
}

func (ci *CanvasIntelligence) getCanvasLimits() CanvasLimits {
	return CanvasLimits{
		MaxNodes:       10000,
		MaxDepth:       10,
		MaxContentSize: 1024 * 1024, // 1MB
		MaxBatchSize:   50,
	}
}

func (ci *CanvasIntelligence) getFeatures() map[string]bool {
	return map[string]bool{
		"real_time_collaboration": true,
		"version_history":         true,
		"ai_suggestions":          true,
		"auto_layout":             true,
		"search":                  true,
		"export":                  true,
		"templates":               true,
	}
}

func (ci *CanvasIntelligence) getExtensions() []ExtensionPoint {
	return []ExtensionPoint{
		{Name: "custom_node_types", Type: "plugin", Enabled: true, Description: "支持自定义节点类型"},
		{Name: "webhooks", Type: "hook", Enabled: true, Description: "画布事件webhook"},
		{Name: "integrations", Type: "plugin", Enabled: true, Description: "第三方集成"},
	}
}

// getRealtimeState 获取实时状态
func (ci *CanvasIntelligence) getRealtimeState(ctx context.Context, document map[string]any) CanvasRealtimeState {
	// Realtime presence is optional. Keep the Agent request scoped to the saved
	// document instead of querying the unpersisted Canvas extension model.
	state := CanvasRealtimeState{
		OnlineUsers:       []string{},
		ActiveCursors:     make(map[string]Position),
		LockedNodes:       []string{},
		PendingOperations: 0,
		SyncStatus:        "synced",
	}

	metadata, ok := document["metadata"].(map[string]any)
	if !ok {
		return state
	}
	if onlineUsers, ok := metadata["onlineUsers"].([]any); ok {
		for _, user := range onlineUsers {
			if userStr, ok := user.(string); ok {
				state.OnlineUsers = append(state.OnlineUsers, userStr)
			}
		}
	}
	if cursors, ok := metadata["activeCursors"].(map[string]any); ok {
		for userID, cursorData := range cursors {
			if cursorMap, ok := cursorData.(map[string]any); ok {
				state.ActiveCursors[userID] = Position{X: numberValue(cursorMap["x"], 0), Y: numberValue(cursorMap["y"], 0)}
			}
		}
	}
	if lockedNodes, ok := metadata["lockedNodes"].([]any); ok {
		for _, node := range lockedNodes {
			if nodeStr, ok := node.(string); ok {
				state.LockedNodes = append(state.LockedNodes, nodeStr)
			}
		}
	}
	if syncStatus, ok := metadata["syncStatus"].(string); ok {
		state.SyncStatus = syncStatus
	}
	return state
}
