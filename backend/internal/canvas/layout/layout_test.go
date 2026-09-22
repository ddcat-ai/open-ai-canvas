package layout

import (
	"math"
	"testing"
)

func node(id, lane string, x, y, w, h float64) Node {
	return Node{ID: id, Lane: lane, X: x, Y: y, Width: w, Height: h}
}

func assertPosition(t *testing.T, positions map[string]Position, id string, x, y float64) {
	t.Helper()
	position, ok := positions[id]
	if !ok {
		t.Fatalf("缺少节点 %s 的位置：%+v", id, positions)
	}
	if math.Abs(position.X-x) > 0.001 || math.Abs(position.Y-y) > 0.001 {
		t.Fatalf("节点 %s 位置 = (%v,%v)，期望 (%v,%v)", id, position.X, position.Y, x, y)
	}
}

// 与前端 layoutCanvasAuto 的媒体泳道分支对齐：text / image / video / audio 从上到下分区。
func TestByLaneKeepsLaneOrderAndAvoidsOverlap(t *testing.T) {
	nodes := []Node{
		node("text-1", "text", 0, 0, 340, 240),
		node("image-1", "image", 900, 500, 720, 405),
		node("video-1", "video", 900, 1200, 720, 405),
		node("audio-1", "audio", 900, 1800, 340, 120),
	}
	positions := ByLane(nodes)

	assertPosition(t, positions, "text-1", 0, 0)
	// text 泳道一行高 240，之后是本泳道与下一泳道之间的 LaneGap
	assertPosition(t, positions, "image-1", 0, 240+LaneGap)
	// image 泳道一行高 405，其后同样是 LaneGap
	imageBottom := 240.0 + LaneGap + 405
	assertPosition(t, positions, "video-1", 0, imageBottom+LaneGap)
	assertPosition(t, positions, "audio-1", 0, imageBottom+LaneGap+405+LaneGap)

	if pairs := Overlaps(withPositions(nodes, positions), 0); len(pairs) != 0 {
		t.Fatalf("泳道排布出现重叠：%+v", pairs)
	}
}

// 与前端 layoutCanvasFlow 对齐：依赖方向从左到右，层内同泳道竖向堆叠。
func TestFlowLaysOutDependenciesLeftToRight(t *testing.T) {
	nodes := []Node{
		node("text-1", "text", 0, 0, 340, 240),
		node("image-1", "image", 0, 400, 720, 405),
		node("video-1", "video", 0, 900, 720, 405),
	}
	edges := []Edge{{From: "text-1", To: "video-1"}, {From: "image-1", To: "video-1"}}
	positions := Flow(nodes, edges)

	textX := positions["text-1"].X
	imageX := positions["image-1"].X
	videoX := positions["video-1"].X
	if textX != imageX {
		t.Fatalf("同层起点应一致：text=%v image=%v", textX, imageX)
	}
	wantVideoX := textX + 720 + FlowColumnGap
	if math.Abs(videoX-wantVideoX) > 0.001 {
		t.Fatalf("下一层 x = %v，期望 %v", videoX, wantVideoX)
	}
	// 没有入边的自环也要落在第一层，不能死循环
	cyclic := Flow(nodes, append(edges, Edge{From: "video-1", To: "text-1"}))
	if _, ok := cyclic["text-1"]; !ok {
		t.Fatal("含环时第一层节点丢失")
	}
}

func TestAutoFallsBackToLanesWithoutConnections(t *testing.T) {
	nodes := []Node{node("image-1", "image", 0, 0, 720, 405), node("image-2", "image", 800, 0, 720, 405)}
	edges := []Edge{{From: "image-1", To: "missing"}} // 集合外的连线不算

	positions := Auto(nodes, edges)
	if positions["image-1"].Y != positions["image-2"].Y {
		t.Fatalf("无有效连线时应按泳道横排：%+v", positions)
	}

	connected := Auto(nodes, []Edge{{From: "image-1", To: "image-2"}})
	if connected["image-1"].X == connected["image-2"].X {
		t.Fatalf("有连线时应分层左右排开：%+v", connected)
	}
}

// Bands 是"只做位置分带"的归类：每组一条带，带间留 gap，组内不重叠。
func TestBandsSeparatesGroups(t *testing.T) {
	bands := []Band{
		{Label: "A", Mode: ModeByLane, Nodes: []Node{node("a1", "image", 0, 0, 720, 405), node("a2", "video", 800, 0, 720, 405)}},
		{Label: "B", Mode: ModeByLane, Nodes: []Node{node("b1", "image", 0, 3000, 720, 405)}},
	}
	positions := Bands(bands, 120)
	// 带内按泳道排：image 泳道在上，video 泳道在其下方
	if positions["a1"].Y != 0 {
		t.Fatalf("第一条带应从顶部开始：%+v", positions["a1"])
	}
	if positions["a2"].Y <= positions["a1"].Y {
		t.Fatalf("带内不同泳道应上下分开：a1=%v a2=%v", positions["a1"], positions["a2"])
	}
	// 第二整条带排在第一条带之下，且所有带左对齐
	if positions["b1"].Y <= positions["a2"].Y+405 {
		t.Fatalf("第二带应排在第一带下方：a2=%v b1=%v", positions["a2"], positions["b1"])
	}
	if positions["b1"].X != positions["a1"].X {
		t.Fatalf("各带应左对齐：a1=%v b1=%v", positions["a1"], positions["b1"])
	}
	applied := append([]Node{}, bands[0].Nodes...)
	applied = append(applied, bands[1].Nodes...)
	if pairs := Overlaps(withPositions(applied, positions), 0); len(pairs) != 0 {
		t.Fatalf("分带后出现重叠：%+v", pairs)
	}
}

func TestAlignDistributesAndCenters(t *testing.T) {
	nodes := []Node{node("a", "text", 0, 0, 100, 100), node("b", "text", 300, 400, 100, 100), node("c", "text", 900, 900, 100, 100)}
	left := Align(nodes, AlignLeft)
	for _, id := range []string{"a", "b", "c"} {
		if left[id].X != 0 {
			t.Fatalf("%s 未左对齐：%+v", id, left[id])
		}
	}
	distributed := Align(nodes, AlignDistributeY)
	gaps := []float64{
		distributed["b"].Y - (distributed["a"].Y + 100),
		distributed["c"].Y - (distributed["b"].Y + 100),
	}
	if math.Abs(gaps[0]-gaps[1]) > 0.001 {
		t.Fatalf("纵向等距分布不均匀：%v", gaps)
	}
}

func TestFreeSlotAvoidsExistingNodes(t *testing.T) {
	occupied := []Node{node("image-1", "image", 0, 0, 720, 405)}

	// 优选坐标被占用时让位
	preferred := Position{X: 0, Y: 0}
	slot := FreeSlot(720, 405, "image", occupied, &preferred, 40)
	if slot.X == 0 && slot.Y == 0 {
		t.Fatalf("优选坐标被占用时未让位：%+v", slot)
	}
	candidate := Node{ID: "new", Lane: "image", X: slot.X, Y: slot.Y, Width: 720, Height: 405}
	if pairs := Overlaps(append(occupied, candidate), 0); len(pairs) != 0 {
		t.Fatalf("落位后仍重叠：%+v slot=%+v", pairs, slot)
	}

	// 空闲的优选坐标直接采用
	free := Position{X: 2000, Y: 0}
	if got := FreeSlot(720, 405, "image", occupied, &free, 40); got != free {
		t.Fatalf("空闲优选坐标未被采用：%+v", got)
	}

	// 没有任何节点时落在原点附近
	empty := FreeSlot(340, 240, "text", nil, nil, 40)
	if empty.X != 0 || empty.Y != 0 {
		t.Fatalf("空画布落位 = %+v", empty)
	}
}

func withPositions(nodes []Node, positions map[string]Position) []Node {
	applied := make([]Node, 0, len(nodes))
	for _, item := range nodes {
		if position, ok := positions[item.ID]; ok {
			item.X, item.Y = position.X, position.Y
		}
		applied = append(applied, item)
	}
	return applied
}
