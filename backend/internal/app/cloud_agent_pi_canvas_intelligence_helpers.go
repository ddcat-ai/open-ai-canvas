package app

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

// Canvas Intelligence 辅助方法

// isContextNode 判断节点是否为上下文节点（焦点节点的相邻节点）
func (ci *CanvasIntelligence) isContextNode(node model.CanvasNode, focusNodeIDs []string, allNodes []model.CanvasNode) bool {
	focusMap := make(map[string]bool)
	for _, id := range focusNodeIDs {
		focusMap[id] = true
	}

	// 检查是否是焦点节点的父节点
	if node.ParentID != nil && focusMap[*node.ParentID] {
		return true
	}

	// 检查是否是焦点节点的子节点
	for _, childID := range node.Children {
		if focusMap[childID] {
			return true
		}
	}

	// 检查是否在焦点节点的空间邻近范围内
	for _, focusID := range focusNodeIDs {
		for _, n := range allNodes {
			if n.ID == focusID && ci.isSpatiallyNear(node, n) {
				return true
			}
		}
	}

	return false
}

// isSpatiallyNear 判断两个节点是否空间邻近
func (ci *CanvasIntelligence) isSpatiallyNear(node1, node2 model.CanvasNode) bool {
	if node1.Position == nil || node2.Position == nil {
		return false
	}

	// 计算距离
	dx := node1.Position.X - node2.Position.X
	dy := node1.Position.Y - node2.Position.Y
	distance := math.Sqrt(dx*dx + dy*dy)

	// 邻近阈值：200px
	return distance < 200
}

// buildRelationships 构建关系视图
func (ci *CanvasIntelligence) buildRelationships(nodes []model.CanvasNode) []RelationshipView {
	relationships := make([]RelationshipView, 0)
	nodeMap := make(map[string]model.CanvasNode)

	for _, node := range nodes {
		nodeMap[node.ID] = node
	}

	for _, node := range nodes {
		// 父子关系
		if node.ParentID != nil {
			relationships = append(relationships, RelationshipView{
				From:        *node.ParentID,
				To:          node.ID,
				Type:        "parent",
				Strength:    1.0,
				Bidirection: false,
			})
		}

		// 引用关系（从内容中提取）
		refs := ci.extractReferences(node.Content)
		for _, refID := range refs {
			if _, exists := nodeMap[refID]; exists {
				relationships = append(relationships, RelationshipView{
					From:        node.ID,
					To:          refID,
					Type:        "reference",
					Strength:    0.7,
					Bidirection: false,
				})
			}
		}

		// 语义相似关系（简化实现）
		for _, other := range nodes {
			if node.ID != other.ID && ci.areSemanticallyRelated(node, other) {
				relationships = append(relationships, RelationshipView{
					From:        node.ID,
					To:          other.ID,
					Type:        "semantic",
					Strength:    0.5,
					Bidirection: true,
				})
			}
		}
	}

	return relationships
}

// extractReferences 从内容中提取引用（简化实现：查找 [[nodeId]] 模式）
func (ci *CanvasIntelligence) extractReferences(content string) []string {
	re := regexp.MustCompile(`\[\[([a-zA-Z0-9-]+)\]\]`)
	matches := re.FindAllStringSubmatch(content, -1)
	refs := make([]string, 0, len(matches))
	for _, match := range matches {
		if len(match) > 1 {
			refs = append(refs, match[1])
		}
	}
	return refs
}

// areSemanticallyRelated 判断两个节点是否语义相关（简化实现）
func (ci *CanvasIntelligence) areSemanticallyRelated(node1, node2 model.CanvasNode) bool {
	// 简化实现：检查共同关键词
	keywords1 := ci.extractKeywords(node1.Content)
	keywords2 := ci.extractKeywords(node2.Content)

	if len(keywords1) == 0 || len(keywords2) == 0 {
		return false
	}

	common := 0
	for _, k1 := range keywords1 {
		for _, k2 := range keywords2 {
			if k1 == k2 {
				common++
			}
		}
	}

	// 共同关键词 >= 2 则认为相关
	return common >= 2
}

// analyzeLayout 分析布局
func (ci *CanvasIntelligence) analyzeLayout(nodes []model.CanvasNode) LayoutAnalysis {
	if len(nodes) == 0 {
		return LayoutAnalysis{
			Algorithm: "empty",
			Direction: "none",
			Density:   0,
			Clusters:  []ClusterInfo{},
			Bounds:    Bounds{},
		}
	}

	// 计算边界
	bounds := ci.calculateBounds(nodes)

	// 检测布局算法
	algorithm := ci.detectLayoutAlgorithm(nodes)

	// 计算密度
	density := ci.calculateDensity(nodes, bounds)

	// 聚类分析
	clusters := ci.performClustering(nodes)

	// 推断方向
	direction := ci.inferDirection(nodes)

	return LayoutAnalysis{
		Algorithm:   algorithm,
		Direction:   direction,
		Density:     density,
		Clusters:    clusters,
		Bounds:      bounds,
		ViewportFit: ci.suggestViewportFit(bounds, density),
	}
}

// calculateBounds 计算边界
func (ci *CanvasIntelligence) calculateBounds(nodes []model.CanvasNode) Bounds {
	if len(nodes) == 0 {
		return Bounds{}
	}

	minX, minY := math.MaxFloat64, math.MaxFloat64
	maxX, maxY := -math.MaxFloat64, -math.MaxFloat64

	for _, node := range nodes {
		if node.Position != nil {
			minX = math.Min(minX, node.Position.X)
			minY = math.Min(minY, node.Position.Y)
			maxX = math.Max(maxX, node.Position.X)
			maxY = math.Max(maxY, node.Position.Y)

			if node.Size != nil {
				maxX = math.Max(maxX, node.Position.X+node.Size.Width)
				maxY = math.Max(maxY, node.Position.Y+node.Size.Height)
			}
		}
	}

	return Bounds{
		MinX: minX,
		MinY: minY,
		MaxX: maxX,
		MaxY: maxY,
	}
}

// detectLayoutAlgorithm 检测布局算法
func (ci *CanvasIntelligence) detectLayoutAlgorithm(nodes []model.CanvasNode) string {
	// 检查是否是树形布局（大部分节点有父节点）
	withParent := 0
	for _, node := range nodes {
		if node.ParentID != nil {
			withParent++
		}
	}
	if float64(withParent)/float64(len(nodes)) > 0.6 {
		return "tree"
	}

	// 检查是否是网格布局（位置规则）
	if ci.isGridLayout(nodes) {
		return "grid"
	}

	// 检查是否是力导向布局（分散均匀）
	if ci.isForceLayout(nodes) {
		return "force"
	}

	return "freeform"
}

// isGridLayout 判断是否是网格布局
func (ci *CanvasIntelligence) isGridLayout(nodes []model.CanvasNode) bool {
	if len(nodes) < 3 {
		return false
	}

	// 简化实现：检查X或Y坐标是否有明显对齐
	xCoords := make(map[float64]int)
	yCoords := make(map[float64]int)

	for _, node := range nodes {
		if node.Position != nil {
			// 量化坐标（容忍10px误差）
			xQuantized := math.Round(node.Position.X/10) * 10
			yQuantized := math.Round(node.Position.Y/10) * 10
			xCoords[xQuantized]++
			yCoords[yQuantized]++
		}
	}

	// 如果有3个以上坐标重复，认为是网格
	for _, count := range xCoords {
		if count >= 3 {
			return true
		}
	}
	for _, count := range yCoords {
		if count >= 3 {
			return true
		}
	}

	return false
}

// isForceLayout 判断是否是力导向布局
func (ci *CanvasIntelligence) isForceLayout(nodes []model.CanvasNode) bool {
	// 简化实现：检查节点分布是否均匀
	if len(nodes) < 5 {
		return false
	}

	// 计算平均距离
	totalDist := 0.0
	count := 0
	for i, node1 := range nodes {
		if node1.Position == nil {
			continue
		}
		for j, node2 := range nodes {
			if i >= j || node2.Position == nil {
				continue
			}
			dx := node1.Position.X - node2.Position.X
			dy := node1.Position.Y - node2.Position.Y
			dist := math.Sqrt(dx*dx + dy*dy)
			totalDist += dist
			count++
		}
	}

	if count == 0 {
		return false
	}

	avgDist := totalDist / float64(count)

	// 计算距离方差
	variance := 0.0
	count = 0
	for i, node1 := range nodes {
		if node1.Position == nil {
			continue
		}
		for j, node2 := range nodes {
			if i >= j || node2.Position == nil {
				continue
			}
			dx := node1.Position.X - node2.Position.X
			dy := node1.Position.Y - node2.Position.Y
			dist := math.Sqrt(dx*dx + dy*dy)
			variance += (dist - avgDist) * (dist - avgDist)
			count++
		}
	}

	if count == 0 {
		return false
	}

	variance /= float64(count)
	stdDev := math.Sqrt(variance)

	// 标准差/平均值 < 0.3 认为是均匀分布（力导向特征）
	return stdDev/avgDist < 0.3
}

// calculateDensity 计算密度
func (ci *CanvasIntelligence) calculateDensity(nodes []model.CanvasNode, bounds Bounds) float64 {
	if len(nodes) == 0 {
		return 0
	}

	area := (bounds.MaxX - bounds.MinX) * (bounds.MaxY - bounds.MinY)
	if area == 0 {
		return 0
	}

	totalNodeArea := 0.0
	for _, node := range nodes {
		if node.Size != nil {
			totalNodeArea += node.Size.Width * node.Size.Height
		} else {
			totalNodeArea += 100 * 100 // 默认大小
		}
	}

	density := totalNodeArea / area
	if density > 1 {
		density = 1
	}

	return density
}

// performClustering 执行聚类分析（简化K-means）
func (ci *CanvasIntelligence) performClustering(nodes []model.CanvasNode) []ClusterInfo {
	// 过滤有位置的节点
	positioned := make([]model.CanvasNode, 0)
	for _, node := range nodes {
		if node.Position != nil {
			positioned = append(positioned, node)
		}
	}

	if len(positioned) < 3 {
		return []ClusterInfo{}
	}

	// 简化实现：基于空间距离的简单聚类
	k := int(math.Min(5, float64(len(positioned)/3))) // 最多5个聚类
	if k < 2 {
		k = 2
	}

	clusters := ci.simpleKMeans(positioned, k)
	return clusters
}

// simpleKMeans 简化的K-means聚类
func (ci *CanvasIntelligence) simpleKMeans(nodes []model.CanvasNode, k int) []ClusterInfo {
	if len(nodes) == 0 {
		return []ClusterInfo{}
	}
	if k < 1 {
		k = 1
	}
	if len(nodes) < k {
		k = len(nodes)
	}

	// 初始化中心点（均匀分布）
	centers := make([]Position, k)
	step := len(nodes) / k
	for i := 0; i < k; i++ {
		idx := i * step
		if idx >= len(nodes) {
			idx = len(nodes) - 1
		}
		centers[i] = Position{
			X: nodes[idx].Position.X,
			Y: nodes[idx].Position.Y,
		}
	}

	// 迭代3次（简化）
	for iter := 0; iter < 3; iter++ {
		// 分配节点到最近的聚类
		assignments := make([]int, len(nodes))
		for i, node := range nodes {
			minDist := math.MaxFloat64
			minCluster := 0
			for j, center := range centers {
				dx := node.Position.X - center.X
				dy := node.Position.Y - center.Y
				dist := math.Sqrt(dx*dx + dy*dy)
				if dist < minDist {
					minDist = dist
					minCluster = j
				}
			}
			assignments[i] = minCluster
		}

		// 更新中心点
		for j := 0; j < k; j++ {
			sumX, sumY := 0.0, 0.0
			count := 0
			for i, assignment := range assignments {
				if assignment == j {
					sumX += nodes[i].Position.X
					sumY += nodes[i].Position.Y
					count++
				}
			}
			if count > 0 {
				centers[j] = Position{
					X: sumX / float64(count),
					Y: sumY / float64(count),
				}
			}
		}
	}

	// 构建聚类结果
	finalAssignments := make([]int, len(nodes))
	for i, node := range nodes {
		minDist := math.MaxFloat64
		minCluster := 0
		for j, center := range centers {
			dx := node.Position.X - center.X
			dy := node.Position.Y - center.Y
			dist := math.Sqrt(dx*dx + dy*dy)
			if dist < minDist {
				minDist = dist
				minCluster = j
			}
		}
		finalAssignments[i] = minCluster
	}

	clusters := make([]ClusterInfo, k)
	for j := 0; j < k; j++ {
		nodeIDs := make([]string, 0)
		for i, assignment := range finalAssignments {
			if assignment == j {
				nodeIDs = append(nodeIDs, nodes[i].ID)
			}
		}

		if len(nodeIDs) == 0 {
			continue
		}

		clusters[j] = ClusterInfo{
			ID:       fmt.Sprintf("cluster-%d", j),
			NodeIDs:  nodeIDs,
			Center:   centers[j],
			Label:    ci.generateClusterLabel(nodes, nodeIDs),
			Cohesion: ci.calculateCohesion(nodes, nodeIDs, centers[j]),
		}
	}

	// 过滤空聚类
	result := make([]ClusterInfo, 0)
	for _, cluster := range clusters {
		if len(cluster.NodeIDs) > 0 {
			result = append(result, cluster)
		}
	}

	return result
}

// generateClusterLabel 生成聚类标签
func (ci *CanvasIntelligence) generateClusterLabel(allNodes []model.CanvasNode, clusterNodeIDs []string) string {
	// 收集聚类中的关键词
	keywords := make(map[string]int)
	for _, nodeID := range clusterNodeIDs {
		for _, node := range allNodes {
			if node.ID == nodeID {
				for _, kw := range ci.extractKeywords(node.Content) {
					keywords[kw]++
				}
			}
		}
	}

	// 找到最频繁的关键词
	maxCount := 0
	topKeyword := "Cluster"
	for kw, count := range keywords {
		if count > maxCount {
			maxCount = count
			topKeyword = kw
		}
	}

	return topKeyword
}

// calculateCohesion 计算内聚度
func (ci *CanvasIntelligence) calculateCohesion(allNodes []model.CanvasNode, clusterNodeIDs []string, center Position) float64 {
	if len(clusterNodeIDs) == 0 {
		return 0
	}

	totalDist := 0.0
	count := 0
	for _, nodeID := range clusterNodeIDs {
		for _, node := range allNodes {
			if node.ID == nodeID && node.Position != nil {
				dx := node.Position.X - center.X
				dy := node.Position.Y - center.Y
				dist := math.Sqrt(dx*dx + dy*dy)
				totalDist += dist
				count++
			}
		}
	}

	if count == 0 {
		return 0
	}

	avgDist := totalDist / float64(count)

	// 归一化：距离越小，内聚度越高
	cohesion := 1.0 / (1.0 + avgDist/100.0)
	return cohesion
}

// inferDirection 推断方向
func (ci *CanvasIntelligence) inferDirection(nodes []model.CanvasNode) string {
	if len(nodes) < 2 {
		return "none"
	}

	// 统计父子关系的方向
	horizontalCount := 0
	verticalCount := 0

	for _, node := range nodes {
		if node.ParentID == nil || node.Position == nil {
			continue
		}

		// 找到父节点
		for _, parent := range nodes {
			if parent.ID == *node.ParentID && parent.Position != nil {
				dx := math.Abs(node.Position.X - parent.Position.X)
				dy := math.Abs(node.Position.Y - parent.Position.Y)

				if dx > dy {
					horizontalCount++
				} else {
					verticalCount++
				}
			}
		}
	}

	if horizontalCount > verticalCount {
		return "horizontal"
	} else if verticalCount > horizontalCount {
		return "vertical"
	}

	return "mixed"
}

// suggestViewportFit 建议视口适配
func (ci *CanvasIntelligence) suggestViewportFit(bounds Bounds, density float64) string {
	width := bounds.MaxX - bounds.MinX
	height := bounds.MaxY - bounds.MinY

	if width == 0 && height == 0 {
		return "center"
	}

	if density > 0.7 {
		return "zoom-out" // 密度高，建议缩小
	} else if density < 0.2 {
		return "zoom-in" // 密度低，建议放大
	}

	aspectRatio := width / height
	if aspectRatio > 2 {
		return "fit-width"
	} else if aspectRatio < 0.5 {
		return "fit-height"
	}

	return "fit-all"
}

// buildHierarchy 构建层级视图
func (ci *CanvasIntelligence) buildHierarchy(nodes []model.CanvasNode) HierarchyView {
	nodeMap := make(map[string]model.CanvasNode)
	for _, node := range nodes {
		nodeMap[node.ID] = node
	}

	// 找到根节点
	rootNodes := make([]string, 0)
	for _, node := range nodes {
		if node.ParentID == nil {
			rootNodes = append(rootNodes, node.ID)
		}
	}

	// 构建树
	tree := make(map[string]TreeNode)
	maxDepth := 0

	var buildTree func(nodeID string, depth int, path []string)
	buildTree = func(nodeID string, depth int, path []string) {
		if depth > maxDepth {
			maxDepth = depth
		}

		currentPath := append(path, nodeID)
		node := nodeMap[nodeID]

		tree[nodeID] = TreeNode{
			ID:       nodeID,
			Depth:    depth,
			Children: node.Children,
			Path:     currentPath,
		}

		for _, childID := range node.Children {
			buildTree(childID, depth+1, currentPath)
		}
	}

	for _, rootID := range rootNodes {
		buildTree(rootID, 0, []string{})
	}

	return HierarchyView{
		MaxDepth:  maxDepth,
		RootNodes: rootNodes,
		Tree:      tree,
	}
}

// extractKeywords 提取关键词（简化实现）
func (ci *CanvasIntelligence) extractKeywords(content string) []string {
	// 移除常见停用词
	stopWords := map[string]bool{
		"the": true, "is": true, "at": true, "which": true, "on": true,
		"a": true, "an": true, "and": true, "or": true, "but": true,
		"in": true, "of": true, "to": true, "for": true, "with": true,
		"这": true, "是": true, "在": true, "的": true, "了": true,
		"和": true, "与": true, "或": true, "但": true, "可以": true,
	}

	// 简单分词（按空格和标点）
	re := regexp.MustCompile(`[^\w\p{Han}]+`)
	words := re.Split(strings.ToLower(content), -1)

	// 统计词频
	freq := make(map[string]int)
	for _, word := range words {
		word = strings.TrimSpace(word)
		if len(word) > 1 && !stopWords[word] {
			freq[word]++
		}
	}

	// 排序并取前5个
	type kv struct {
		Key   string
		Value int
	}
	var sorted []kv
	for k, v := range freq {
		sorted = append(sorted, kv{k, v})
	}
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].Value > sorted[j].Value
	})

	keywords := make([]string, 0, 5)
	for i := 0; i < len(sorted) && i < 5; i++ {
		keywords = append(keywords, sorted[i].Key)
	}

	return keywords
}

// categorizeNode 自动分类节点
func (ci *CanvasIntelligence) categorizeNode(node model.CanvasNode) string {
	content := strings.ToLower(node.Content)

	// 基于内容特征的简单分类
	if strings.Contains(content, "todo") || strings.Contains(content, "task") || strings.Contains(content, "待办") {
		return "task"
	}
	if strings.Contains(content, "idea") || strings.Contains(content, "concept") || strings.Contains(content, "想法") || strings.Contains(content, "概念") {
		return "idea"
	}
	if strings.Contains(content, "note") || strings.Contains(content, "memo") || strings.Contains(content, "笔记") {
		return "note"
	}
	if strings.Contains(content, "question") || strings.Contains(content, "问题") || strings.Contains(content, "?") || strings.Contains(content, "？") {
		return "question"
	}
	if strings.Contains(content, "decision") || strings.Contains(content, "决策") || strings.Contains(content, "结论") {
		return "decision"
	}

	// 基于类型
	switch node.Type {
	case "code":
		return "code"
	case "image", "video", "audio":
		return "media"
	case "link":
		return "reference"
	case "diagram", "flowchart", "mindmap":
		return "diagram"
	default:
		return "general"
	}
}

// analyzeSentiment 分析情感（简化实现）
func (ci *CanvasIntelligence) analyzeSentiment(content string) string {
	content = strings.ToLower(content)

	// 正面词汇
	positiveWords := []string{"good", "great", "excellent", "success", "完成", "成功", "优秀", "很好", "✅", "✓"}
	// 负面词汇
	negativeWords := []string{"bad", "error", "fail", "problem", "issue", "bug", "错误", "失败", "问题", "❌", "✗"}
	// TODO词汇
	todoWords := []string{"todo", "task", "待办", "需要", "应该"}

	positiveScore := 0
	negativeScore := 0
	todoScore := 0

	for _, word := range positiveWords {
		if strings.Contains(content, word) {
			positiveScore++
		}
	}
	for _, word := range negativeWords {
		if strings.Contains(content, word) {
			negativeScore++
		}
	}
	for _, word := range todoWords {
		if strings.Contains(content, word) {
			todoScore++
		}
	}

	if todoScore > 0 {
		return "todo"
	}
	if positiveScore > negativeScore {
		return "positive"
	}
	if negativeScore > positiveScore {
		return "negative"
	}

	return "neutral"
}

// convertPosition 转换位置
func (ci *CanvasIntelligence) convertPosition(pos *model.CanvasPosition) *Position {
	if pos == nil {
		return nil
	}
	return &Position{X: pos.X, Y: pos.Y}
}

// convertSize 转换尺寸
func (ci *CanvasIntelligence) convertSize(size *model.CanvasSize) *Size {
	if size == nil {
		return nil
	}
	return &Size{Width: size.Width, Height: size.Height}
}

// getZIndex 获取Z-index
func (ci *CanvasIntelligence) getZIndex(node model.CanvasNode) int {
	if node.Metadata != nil {
		if zIndex, ok := node.Metadata["zIndex"].(float64); ok {
			return int(zIndex)
		}
	}
	return 0
}

// getParentID 获取父节点ID
func (ci *CanvasIntelligence) getParentID(parentID *string) string {
	if parentID == nil {
		return ""
	}
	return *parentID
}

// extractTags 提取标签
func (ci *CanvasIntelligence) extractTags(node model.CanvasNode) []string {
	if node.Metadata != nil {
		if tags, ok := node.Metadata["tags"].([]interface{}); ok {
			result := make([]string, 0, len(tags))
			for _, tag := range tags {
				if s, ok := tag.(string); ok {
					result = append(result, s)
				}
			}
			return result
		}
	}
	return []string{}
}

// isRecentlyModified 判断是否最近被修改
func (ci *CanvasIntelligence) isRecentlyModified(node model.CanvasNode) bool {
	return time.Since(node.UpdatedAt) < 10*time.Minute
}

// getNodeStatus 获取节点状态
func (ci *CanvasIntelligence) getNodeStatus(node model.CanvasNode) string {
	if node.Metadata != nil {
		if status, ok := node.Metadata["status"].(string); ok {
			return status
		}
	}
	return "draft"
}
