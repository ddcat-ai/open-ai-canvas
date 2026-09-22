// Package layout 是画布节点排布的确定性几何实现，供云端 Agent 的"整理 / 归类 / 新增落位"使用。
//
// 这里刻意与前端 web/src/lib/canvas/canvas-layout.ts 保持同一套常量与算法语义：
// 前端"自动整理节点"按钮与 Agent 的整理工具必须给出同样的结果，否则同一个画布在两条
// 路径下会得到不同的布局。修改任一侧常量或算法时，另一侧要同步（两侧各自有黄金用例）。
//
// 本包只做几何，不读取画布文档、不判断权限、不写库。
package layout

import "sort"

const (
	// 与 canvas-layout.ts 的常量一一对应。
	FlowColumnGap = 120
	LaneGap       = 96
	LaneNodeGap   = 36
	GridNodeGap   = 32
	// 新增节点与已有节点之间的最小空隙（落位避让用）。
	PlacementGap = 40
)

// LaneOrder 是泳道的稳定顺序，决定从上到下的分区次序。
var LaneOrder = []string{"text", "image", "video", "audio"}

// Node 是排布所需的节点快照。Width/Height 为 0 时按默认尺寸补齐。
type Node struct {
	ID      string
	Type    string
	Lane    string
	X, Y    float64
	Width   float64
	Height  float64
	Locked  bool
	NoMove  bool // 容器节点（背板/文件夹）本身不参与整理
	Movable bool
}

// Position 是排布结果。
type Position struct {
	X float64
	Y float64
}

// Edge 是一条有向引用连线（来源 → 目标），用于依赖方向分层。
type Edge struct {
	From string
	To   string
}

// Mode 是整理模式。
type Mode string

const (
	ModeAuto   Mode = "auto"
	ModeFlow   Mode = "flow"
	ModeByLane Mode = "byType"
	ModeRow    Mode = "row"
	ModeColumn Mode = "column"
	ModeGrid   Mode = "grid"
)

// AlignMode 是对齐 / 等距分布模式。
type AlignMode string

const (
	AlignLeft        AlignMode = "left"
	AlignCenterX     AlignMode = "centerX"
	AlignRight       AlignMode = "right"
	AlignTop         AlignMode = "top"
	AlignCenterY     AlignMode = "centerY"
	AlignBottom      AlignMode = "bottom"
	AlignDistributeX AlignMode = "distributeX"
	AlignDistributeY AlignMode = "distributeY"
)

func (n Node) width() float64 {
	if n.Width > 0 {
		return n.Width
	}
	return 340
}

func (n Node) height() float64 {
	if n.Height > 0 {
		return n.Height
	}
	return 240
}

func minX(nodes []Node) float64 {
	value := nodes[0].X
	for _, node := range nodes[1:] {
		if node.X < value {
			value = node.X
		}
	}
	return value
}

func minY(nodes []Node) float64 {
	value := nodes[0].Y
	for _, node := range nodes[1:] {
		if node.Y < value {
			value = node.Y
		}
	}
	return value
}

func maxWidth(nodes []Node) float64 {
	value := 0.0
	for _, node := range nodes {
		if node.width() > value {
			value = node.width()
		}
	}
	return value
}

func maxHeight(nodes []Node) float64 {
	value := 0.0
	for _, node := range nodes {
		if node.height() > value {
			value = node.height()
		}
	}
	return value
}

// byPosition 复刻前端的稳定次序：先按 y，再按 x。
func byPosition(nodes []Node) []Node {
	sorted := append([]Node(nil), nodes...)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].Y != sorted[j].Y {
			return sorted[i].Y < sorted[j].Y
		}
		return sorted[i].X < sorted[j].X
	})
	return sorted
}

// Auto 复刻 layoutCanvasAuto：节点之间有连线时按依赖分层，否则按媒体类型泳道。
func Auto(nodes []Node, edges []Edge) map[string]Position {
	if len(nodes) < 2 {
		return map[string]Position{}
	}
	if connected(nodes, edges) {
		return Flow(nodes, edges)
	}
	return ByLane(nodes)
}

func connected(nodes []Node, edges []Edge) bool {
	ids := make(map[string]bool, len(nodes))
	for _, node := range nodes {
		ids[node.ID] = true
	}
	for _, edge := range edges {
		if ids[edge.From] && ids[edge.To] {
			return true
		}
	}
	return false
}

// Flow 复刻 layoutCanvasFlow：Kahn 拓扑分层从左到右，层内按泳道竖排。
// 环上的节点留在第 0 层，避免布局死循环。
func Flow(nodes []Node, edges []Edge) map[string]Position {
	result := map[string]Position{}
	if len(nodes) == 0 {
		return result
	}
	index := make(map[string]Node, len(nodes))
	for _, node := range nodes {
		index[node.ID] = node
	}
	inbound := make(map[string]int, len(nodes))
	outbound := make(map[string][]string, len(nodes))
	for _, node := range nodes {
		inbound[node.ID] = 0
	}
	for _, edge := range edges {
		if _, ok := index[edge.From]; !ok {
			continue
		}
		if _, ok := index[edge.To]; !ok {
			continue
		}
		inbound[edge.To]++
		outbound[edge.From] = append(outbound[edge.From], edge.To)
	}

	queue := make([]string, 0, len(nodes))
	for _, node := range nodes {
		if inbound[node.ID] == 0 {
			queue = append(queue, node.ID)
		}
	}
	layer := map[string]int{}
	for _, id := range queue {
		layer[id] = 0
	}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		for _, target := range outbound[id] {
			if layer[target] < layer[id]+1 {
				layer[target] = layer[id] + 1
			}
			inbound[target]--
			if inbound[target] == 0 {
				queue = append(queue, target)
			}
		}
	}
	for _, node := range nodes {
		if _, ok := layer[node.ID]; !ok {
			layer[node.ID] = 0
		}
	}

	left, top := minX(nodes), minY(nodes)
	layerIDs := make([]int, 0, len(nodes))
	seen := map[int]bool{}
	for _, node := range nodes {
		if !seen[layer[node.ID]] {
			seen[layer[node.ID]] = true
			layerIDs = append(layerIDs, layer[node.ID])
		}
	}
	sort.Ints(layerIDs)
	layerX := map[int]float64{}
	x := left
	for _, value := range layerIDs {
		members := nodesInLayer(nodes, layer, value)
		layerX[value] = x
		x += maxWidth(members) + FlowColumnGap
	}

	laneTop := top
	for _, lane := range LaneOrder {
		lanes := laneNodes(nodes, lane)
		if len(lanes) == 0 {
			continue
		}
		stacks := map[int][]Node{}
		stackOrder := make([]int, 0, len(lanes))
		for _, node := range lanes {
			value := layer[node.ID]
			if _, ok := stacks[value]; !ok {
				stackOrder = append(stackOrder, value)
			}
			stacks[value] = append(stacks[value], node)
		}
		laneHeight := 0.0
		for _, stack := range stacks {
			height := 0.0
			for _, node := range stack {
				height += node.height()
			}
			height += float64(max(0, len(stack)-1)) * LaneNodeGap
			if height > laneHeight {
				laneHeight = height
			}
		}
		sort.Ints(stackOrder)
		for _, value := range stackOrder {
			stack := byPosition(stacks[value])
			y := laneTop
			for _, node := range stack {
				result[node.ID] = Position{X: layerX[value], Y: y}
				y += node.height() + LaneNodeGap
			}
		}
		laneTop += laneHeight + LaneGap
	}
	return result
}

func nodesInLayer(nodes []Node, layer map[string]int, value int) []Node {
	subset := make([]Node, 0, len(nodes))
	for _, node := range nodes {
		if layer[node.ID] == value {
			subset = append(subset, node)
		}
	}
	return subset
}

func laneNodes(nodes []Node, lane string) []Node {
	subset := make([]Node, 0, len(nodes))
	for _, node := range nodes {
		if node.Lane == lane {
			subset = append(subset, node)
		}
	}
	return subset
}

// ByLane 复刻 layoutCanvasNodesByMediaType：每个泳道内部按网格排布（最多 4 列）。
func ByLane(nodes []Node) map[string]Position {
	result := map[string]Position{}
	if len(nodes) == 0 {
		return result
	}
	left, top := minX(nodes), minY(nodes)
	laneTop := top
	for _, lane := range LaneOrder {
		lanes := byPosition(laneNodes(nodes, lane))
		if len(lanes) == 0 {
			continue
		}
		columns := min(4, max(1, ceilSqrt(len(lanes))))
		cellWidth := maxWidth(lanes) + GridNodeGap
		cellHeight := maxHeight(lanes) + GridNodeGap
		for index, node := range lanes {
			result[node.ID] = Position{
				X: left + float64(index%columns)*cellWidth,
				Y: laneTop + float64(index/columns)*cellHeight,
			}
		}
		rows := float64(ceilDiv(len(lanes), columns))
		laneTop += rows*cellHeight - GridNodeGap + LaneGap
	}
	return result
}

// Linear 复刻 layoutCanvasNodes：单行 / 单列 / 方阵。
func Linear(nodes []Node, mode Mode) map[string]Position {
	result := map[string]Position{}
	if len(nodes) == 0 {
		return result
	}
	sorted := byPosition(nodes)
	left, top := minX(nodes), minY(nodes)
	switch mode {
	case ModeRow:
		x := left
		for _, node := range sorted {
			result[node.ID] = Position{X: x, Y: top}
			x += node.width() + GridNodeGap
		}
	case ModeColumn:
		y := top
		for _, node := range sorted {
			result[node.ID] = Position{X: left, Y: y}
			y += node.height() + GridNodeGap
		}
	default:
		columns := max(1, int(ceilSqrt(len(sorted))))
		cellWidth := maxWidth(sorted) + GridNodeGap
		cellHeight := maxHeight(sorted) + GridNodeGap
		for index, node := range sorted {
			result[node.ID] = Position{
				X: left + float64(index%columns)*cellWidth,
				Y: top + float64(index/columns)*cellHeight,
			}
		}
	}
	return result
}

// Align 复刻 alignCanvasNodes：对齐与等距分布。
func Align(nodes []Node, mode AlignMode) map[string]Position {
	result := map[string]Position{}
	if len(nodes) < 2 {
		return result
	}
	left, top := minX(nodes), minY(nodes)
	right, bottom := 0.0, 0.0
	for index, node := range nodes {
		if index == 0 || node.X+node.width() > right {
			right = node.X + node.width()
		}
		if index == 0 || node.Y+node.height() > bottom {
			bottom = node.Y + node.height()
		}
	}
	centerX, centerY := (left+right)/2, (top+bottom)/2

	switch mode {
	case AlignDistributeX:
		sorted := append([]Node(nil), nodes...)
		sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].X < sorted[j].X })
		total := 0.0
		for _, node := range sorted {
			total += node.width()
		}
		gap := (right - left - total) / float64(max(1, len(sorted)-1))
		x := left
		for _, node := range sorted {
			result[node.ID] = Position{X: x, Y: node.Y}
			x += node.width() + gap
		}
		return result
	case AlignDistributeY:
		sorted := append([]Node(nil), nodes...)
		sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Y < sorted[j].Y })
		total := 0.0
		for _, node := range sorted {
			total += node.height()
		}
		gap := (bottom - top - total) / float64(max(1, len(sorted)-1))
		y := top
		for _, node := range sorted {
			result[node.ID] = Position{X: node.X, Y: y}
			y += node.height() + gap
		}
		return result
	}

	for _, node := range nodes {
		x, y := node.X, node.Y
		switch mode {
		case AlignLeft:
			x = left
		case AlignCenterX:
			x = centerX - node.width()/2
		case AlignRight:
			x = right - node.width()
		case AlignTop:
			y = top
		case AlignCenterY:
			y = centerY - node.height()/2
		case AlignBottom:
			y = bottom - node.height()
		}
		result[node.ID] = Position{X: x, Y: y}
	}
	return result
}

// Band 是一组节点（"归类"后的一个分组）。Bands 按给定顺序从上到下排成带状。
type Band struct {
	Label string
	Nodes []Node
	Mode  Mode
}

// Bands 把分组排成横向带：每组占一条带，带内按各自模式排布，带间留 gap（默认 LaneGap）。
// 这是"只做位置分带"的实现：不改变节点层级，也不创建容器节点。
func Bands(bands []Band, gap float64) map[string]Position {
	result := map[string]Position{}
	if len(bands) == 0 {
		return result
	}
	if gap <= 0 {
		gap = LaneGap
	}
	all := make([]Node, 0)
	for _, band := range bands {
		all = append(all, band.Nodes...)
	}
	if len(all) == 0 {
		return result
	}
	left, top := minX(all), minY(all)
	bandTop := top
	for _, band := range bands {
		if len(band.Nodes) == 0 {
			continue
		}
		mode := band.Mode
		if mode == "" || mode == ModeAuto {
			mode = ModeByLane
		}
		var positions map[string]Position
		switch mode {
		case ModeFlow:
			positions = Flow(band.Nodes, nil)
		case ModeByLane:
			positions = ByLane(band.Nodes)
		default:
			positions = Linear(band.Nodes, mode)
		}
		// 把这一带整体移到带起点：纵向从 bandTop 开始，横向统一从 left 开始。
		bandLeft, bandTopValue := 0.0, 0.0
		first := true
		for _, position := range positions {
			if first {
				bandLeft, bandTopValue, first = position.X, position.Y, false
				continue
			}
			if position.X < bandLeft {
				bandLeft = position.X
			}
			if position.Y < bandTopValue {
				bandTopValue = position.Y
			}
		}
		height := 0.0
		for id, position := range positions {
			node := findNode(band.Nodes, id)
			result[id] = Position{X: left + (position.X - bandLeft), Y: bandTop + (position.Y - bandTopValue)}
			if bottom := result[id].Y + node.height() - bandTop; bottom > height {
				height = bottom
			}
		}
		bandTop += height + gap
	}
	return result
}

func findNode(nodes []Node, id string) Node {
	for _, node := range nodes {
		if node.ID == id {
			return node
		}
	}
	return Node{}
}

// Bounds 计算一组节点的包围盒（含尺寸）。
func Bounds(nodes []Node) (left, top, right, bottom float64, ok bool) {
	if len(nodes) == 0 {
		return 0, 0, 0, 0, false
	}
	left, top = minX(nodes), minY(nodes)
	for index, node := range nodes {
		if index == 0 || node.X+node.width() > right {
			right = node.X + node.width()
		}
		if index == 0 || node.Y+node.height() > bottom {
			bottom = node.Y + node.height()
		}
	}
	return left, top, right, bottom, true
}

// overlaps 判断两个节点（含额外空隙）是否相交。
func overlaps(first, second Node, gap float64) bool {
	return first.X < second.X+second.width()+gap &&
		second.X < first.X+first.width()+gap &&
		first.Y < second.Y+second.height()+gap &&
		second.Y < first.Y+first.height()+gap
}

// Overlaps 返回相互重叠（含 gap 余量）的节点对，用于回执里的自查提示。
func Overlaps(nodes []Node, gap float64) [][2]string {
	pairs := make([][2]string, 0)
	for index := 0; index < len(nodes); index++ {
		for next := index + 1; next < len(nodes); next++ {
			if overlaps(nodes[index], nodes[next], gap) {
				pairs = append(pairs, [2]string{nodes[index].ID, nodes[next].ID})
			}
		}
	}
	return pairs
}

// FreeSlot 为新增节点找一块不与已有节点重叠的空位。
//
// 策略：先按泳道在同类节点右侧找空位；冲突则沿该泳道向右、再向下扫描（步长为节点尺寸 + 空隙）。
// occupied 是画布现有节点（含本批已落位的新节点）；preferred 非空时优先尝试该坐标（依赖落位）。
func FreeSlot(width, height float64, lane string, occupied []Node, preferred *Position, gap float64) Position {
	if width <= 0 {
		width = 340
	}
	if height <= 0 {
		height = 240
	}
	if gap <= 0 {
		gap = PlacementGap
	}
	candidate := Node{Width: width, Height: height}
	fits := func(x, y float64) bool {
		candidate.X, candidate.Y = x, y
		for _, node := range occupied {
			if overlaps(candidate, node, gap) {
				return false
			}
		}
		return true
	}
	if preferred != nil && fits(preferred.X, preferred.Y) {
		return *preferred
	}

	// 起点：该泳道已有节点的最右下方；没有同类节点时退回画布左下角。
	sameLane := laneNodes(occupied, lane)
	startX, startY := 0.0, 0.0
	if len(sameLane) > 0 {
		startY = minY(sameLane)
		startX = 0
		for _, node := range sameLane {
			if right := node.X + node.width() + gap; right > startX {
				startX = right
			}
		}
	} else if len(occupied) > 0 {
		_, _, right, _, _ := Bounds(occupied)
		startX = right + gap
		startY = minY(occupied)
	}
	if preferred != nil {
		startX, startY = preferred.X, preferred.Y
	}
	stepX, stepY := width+gap, height+gap
	for column := 0; column < 64; column++ {
		for row := 0; row < 64; row++ {
			x := startX + float64(column)*stepX
			y := startY + float64(row)*stepY
			if fits(x, y) {
				return Position{X: x, Y: y}
			}
		}
	}
	return Position{X: startX, Y: startY}
}

func ceilSqrt(value int) int {
	if value <= 0 {
		return 0
	}
	root := 1
	for root*root < value {
		root++
	}
	return root
}

func ceilDiv(value, divisor int) int {
	if divisor <= 0 {
		return 0
	}
	return (value + divisor - 1) / divisor
}
