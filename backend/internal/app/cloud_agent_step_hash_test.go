package app

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/model"
)

// 回归（2026-09-15）：模型一轮里并发提交多个写操作（实测：给 6 个镜头建图时一轮 3 个
// generate_media），它们共享同一个「读画布时的哈希」。第一个写成功后画布就变了，后续调用
// 全部撞快照 CAS，模型得靠报错里的新哈希重试 —— 而下一轮又并发提交，十几轮都跑不完。
//
// 这里锁住放宽的**边界**：只把「与本轮基线同源」的后续调用接到当前哈希；
// 本轮第一个调用、模型自己已改用新哈希的调用、以及跨轮的情况都不动。
func TestCloudAgentRefreshStepSnapshotHash(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	// Windows：池里的连接要在 t.TempDir 清理前关掉，否则整个包报红。
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	base := a.SnapshotHash
	if base == "" {
		t.Fatal("fixture 缺少 snapshotHash")
	}

	state := cloudAgentRuntime{Request: agentTestRequest(), Step: 3, CallIndex: 1}
	state.Request.CanvasID = "agent-canvas"
	state.Calls = []cloudAgentCall{agentMediaCall(a), agentMediaCall(a)}
	// 生产路径在收到这一轮调用时就把「读画布时的哈希」记进快照（见 state.Calls = calls 处）。
	state.StepSnapshotHash = base

	run := &model.CloudAgentExecution{ID: "run-1", UserID: "user", CanvasID: "agent-canvas"}

	// ① 画布没变 → 原样返回，不做任何改动。
	got := s.cloudAgentRefreshStepSnapshotHash(run, &state, state.Calls[1])
	if got.Function.Arguments != state.Calls[1].Function.Arguments {
		t.Fatal("画布未变时不应改写参数")
	}

	// ② 画布变了（模拟本轮第一个写操作已成功）→ 第二个调用应接到最新哈希。
	var canvas model.CanvasProject
	if err := db.First(&canvas, "id = ?", "agent-canvas").Error; err != nil {
		t.Fatal(err)
	}
	beforeRaw := canvas.PayloadJSON
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	doc["nodes"] = append(creationMaps(doc["nodes"]), map[string]any{"id": "sibling-write", "type": "image", "title": "本轮第一个写操作留下的节点"})
	raw, _ := json.Marshal(doc)
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	latest := cloudAgentCanvasHash(doc)
	if latest == base {
		t.Fatal("测试前提不成立：画布哈希没变")
	}
	if err := s.repo.CreateCloudAgentCanvasMutation(&model.CloudAgentCanvasMutation{ID: "mutation-1", RunID: run.ID, UserID: run.UserID, CanvasID: run.CanvasID, StepID: state.Calls[0].ID, Operation: "canvas_apply_ops", BeforeSnapshotHash: base, AfterSnapshotHash: latest, BeforeJSON: beforeRaw, Status: "applied"}); err != nil {
		t.Fatal(err)
	}

	got = s.cloudAgentRefreshStepSnapshotHash(run, &state, state.Calls[1])
	var args struct {
		SnapshotHash string `json:"snapshotHash"`
		NodeID       string `json:"nodeId"`
	}
	if err := json.Unmarshal([]byte(got.Function.Arguments), &args); err != nil {
		t.Fatal(err)
	}
	if args.SnapshotHash != latest {
		t.Fatalf("同源后续调用应接到最新哈希：got %s want %s", truncateRunes(args.SnapshotHash, 12), truncateRunes(latest, 12))
	}
	if args.NodeID != a.NodeID {
		t.Fatal("刷新哈希时不能改动其它参数")
	}

	// ③ 本轮第一个调用不刷新（它的哈希本身就该被校验）。
	//    真实运行时 call 恒为 Calls[CallIndex]，所以这里把游标回到 0 才是等价场景。
	state.CallIndex = 0
	first := s.cloudAgentRefreshStepSnapshotHash(run, &state, state.Calls[0])
	state.CallIndex = 1
	if first.Function.Arguments != state.Calls[0].Function.Arguments {
		t.Fatal("同一轮的第一个调用不应被改写")
	}

	// ④ 模型已自行改用新哈希的调用不刷新 —— 那种情况要如实报冲突，别掩盖。
	//    基线与该调用不同源（模型中途重读过画布），就不该替它抹平。
	own := state.Calls[1]
	var ownArgs map[string]any
	if err := json.Unmarshal([]byte(own.Function.Arguments), &ownArgs); err != nil {
		t.Fatal(err)
	}
	ownArgs["snapshotHash"] = "model-reread-hash"
	rawOwn, _ := json.Marshal(ownArgs)
	own.Function.Arguments = string(rawOwn)
	again := s.cloudAgentRefreshStepSnapshotHash(run, &state, own)
	if again.Function.Arguments != own.Function.Arguments {
		t.Fatal("与基线不同源的调用不应被改写")
	}

	// ⑤ 批卡批准后的真实序列：服务端把整批调用统一改写成同一个新哈希，基线一起抬到该哈希；
	//    此后逐条提交，**每提交一条画布都会再变**（那条草稿节点要绑上 taskId）。
	//    后面几条必须仍能被补到当时的哈希 —— 补不上就撞快照 CAS，
	//    实测表现就是「一轮里第二个镜头必被拒」。基线也不能再被 Calls[0] 的改写带跑，
	//    否则这几条会被判成"模型自己换了哈希"而跳过补哈希。
	state.Calls[1].Function.Arguments = got.Function.Arguments // 服务端：整批同一个哈希
	state.StepSnapshotHash = latest                            // 服务端：基线同步抬到该哈希
	doc["nodes"] = append(creationMaps(doc["nodes"]), map[string]any{"id": "bound-task", "type": "video", "title": "第一条提交后绑上 taskId"})
	rawBound, _ := json.Marshal(doc)
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", string(rawBound)).Error; err != nil {
		t.Fatal(err)
	}
	afterBind := cloudAgentCanvasHash(doc)
	if afterBind == latest {
		t.Fatal("测试前提不成立：提交第一条后画布哈希没变")
	}
	if err := s.repo.CreateCloudAgentCanvasMutation(&model.CloudAgentCanvasMutation{ID: "mutation-2", RunID: run.ID, UserID: run.UserID, CanvasID: run.CanvasID, StepID: state.Calls[1].ID, Operation: "generate_media_submit", BeforeSnapshotHash: latest, AfterSnapshotHash: afterBind, BeforeJSON: string(raw), Status: "applied"}); err != nil {
		t.Fatal(err)
	}
	fresh := s.cloudAgentRefreshStepSnapshotHash(run, &state, state.Calls[1])
	var freshArgs struct {
		SnapshotHash string `json:"snapshotHash"`
	}
	if err := json.Unmarshal([]byte(fresh.Function.Arguments), &freshArgs); err != nil {
		t.Fatal(err)
	}
	if freshArgs.SnapshotHash != afterBind {
		t.Fatalf("同源调用应被补到最新哈希：got %s want %s", truncateRunes(freshArgs.SnapshotHash, 12), truncateRunes(afterBind, 12))
	}

	empty := agentMediaCall(a)
	var emptyArgs map[string]any
	if err := json.Unmarshal([]byte(empty.Function.Arguments), &emptyArgs); err != nil {
		t.Fatal(err)
	}
	delete(emptyArgs, "snapshotHash")
	rawEmpty, _ := json.Marshal(emptyArgs)
	empty.Function.Arguments = string(rawEmpty)
	filled := s.cloudAgentRefreshStepSnapshotHash(run, &state, empty)
	var filledArgs struct {
		SnapshotHash string `json:"snapshotHash"`
	}
	if err := json.Unmarshal([]byte(filled.Function.Arguments), &filledArgs); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&canvas, "id = ?", "agent-canvas").Error; err != nil {
		t.Fatal(err)
	}
	currentDoc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	if filledArgs.SnapshotHash != cloudAgentMediaContentHash(currentDoc) {
		t.Fatalf("漏传 snapshotHash 应补当前媒体快照：got %s", truncateRunes(filledArgs.SnapshotHash, 12))
	}
}

func TestCloudAgentRefreshStepSnapshotHashRejectsExternalWrites(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	baseCanvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	baseDoc, err := creationDocument(baseCanvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	base := cloudAgentCanvasHash(baseDoc)
	state := cloudAgentRuntime{Request: agentTestRequest(), Step: 1, CallIndex: 1, StepSnapshotHash: base}
	state.Request.CanvasID = "agent-canvas"
	state.Calls = []cloudAgentCall{agentMediaCall(a), agentMediaCall(a)}
	run := &model.CloudAgentExecution{ID: "run-current", UserID: "user", CanvasID: "agent-canvas"}

	// A direct autosave or another tab has no current-run mutation record.
	directDoc := cloneCreationDocument(baseDoc)
	directDoc["nodes"] = append(creationMaps(directDoc["nodes"]), map[string]any{"id": "external-node", "type": "image"})
	directRaw, _ := json.Marshal(directDoc)
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", string(directRaw)).Error; err != nil {
		t.Fatal(err)
	}
	got := s.cloudAgentRefreshStepSnapshotHash(run, &state, state.Calls[1])
	if got.Function.Arguments != state.Calls[1].Function.Arguments {
		t.Fatal("无记录的外部写入不能被吸收")
	}

	// A different Agent run's mutation is also a conflict for this run.
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", baseCanvas.PayloadJSON).Error; err != nil {
		t.Fatal(err)
	}
	otherDoc := cloneCreationDocument(baseDoc)
	otherDoc["nodes"] = append(creationMaps(otherDoc["nodes"]), map[string]any{"id": "other-run-node", "type": "image"})
	otherRaw, _ := json.Marshal(otherDoc)
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", string(otherRaw)).Error; err != nil {
		t.Fatal(err)
	}
	otherHash := cloudAgentCanvasHash(otherDoc)
	if err := s.repo.CreateCloudAgentCanvasMutation(&model.CloudAgentCanvasMutation{ID: "mutation-other", RunID: "run-other", UserID: "user", CanvasID: "agent-canvas", StepID: "other-call", Operation: "canvas_apply_ops", BeforeSnapshotHash: base, AfterSnapshotHash: otherHash, Status: "applied"}); err != nil {
		t.Fatal(err)
	}
	got = s.cloudAgentRefreshStepSnapshotHash(run, &state, state.Calls[1])
	if got.Function.Arguments != state.Calls[1].Function.Arguments {
		t.Fatal("其他 Agent run 的写入不能被当前 run 吸收")
	}
}

func cloneCreationDocument(doc map[string]any) map[string]any {
	raw, _ := json.Marshal(doc)
	copy, _ := creationDocument(string(raw))
	return copy
}
