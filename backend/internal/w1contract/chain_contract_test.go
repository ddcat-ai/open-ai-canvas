// Package w1contract 存放 W1-01（影策 2.0 任务链）的数据链契约测试。
//
// 为什么独立成包：
//   · 只覆盖 W1-01 的契约，不与既有包的其它测试混在一起，结果一眼可读；
//   · 用与运行时同款的纯 Go 驱动 glebarez/sqlite，本机无 gcc 也能跑；
//   · 不改动任何既有 _test.go——全仓驱动统一是另一件事（Q-21A2），不在本包范围。
//
// 建库走真实的 database.MigrateSchema，因此 schema（含 V7 的部分唯一索引）
// 与生产一致，不是「测试专用简化 schema」。
package w1contract

import (
	"context"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// ─────────────────────────────────────────────────────────────────────────
// 测试夹具
// ─────────────────────────────────────────────────────────────────────────

func newContractDB(t *testing.T) *gorm.DB {
	t.Helper()
	name := strings.NewReplacer("/", "_", " ", "_").Replace(t.Name())
	db, err := gorm.Open(sqlite.Open("file:w1-"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("打开测试库失败：%v", err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatalf("迁移 schema 失败：%v", err)
	}
	return db
}

type chainFixture struct {
	db         *gorm.DB
	repo       *repository.Repository
	svc        *service.Service
	userID     string
	projectID  string
	unitID     string
	shotID     string
	revisionID string
	taskID     string
	bridgeID   string
	now        time.Time
}

func seedChain(t *testing.T) *chainFixture {
	t.Helper()
	db := newContractDB(t)
	now := time.Now().Truncate(time.Second)

	f := &chainFixture{
		db:         db,
		repo:       repository.New(db),
		userID:     "user-w1",
		projectID:  "proj-w1",
		unitID:     "unit-w1",
		shotID:     "shot-w1",
		revisionID: "rev-w1",
		taskID:     "task-w1",
		bridgeID:   "bridge-w1",
		now:        now,
	}
	f.svc = service.New(repository.New(db), t.TempDir())

	project := model.Project{
		ID: f.projectID, UserID: f.userID, Name: "契约测试项目",
		Type: "drama", Status: model.ProjectStatusActive, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&project).Error; err != nil {
		t.Fatalf("创建项目失败：%v", err)
	}
	unit := model.ProjectUnit{
		ID: f.unitID, ProjectID: f.projectID, Kind: model.ProjectUnitKindChapter,
		Title: "第一章", Position: 1, Status: "active", CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&unit).Error; err != nil {
		t.Fatalf("创建章节失败：%v", err)
	}
	shot := model.Shot{
		ID: f.shotID, ProjectID: f.projectID, UnitID: f.unitID, Position: 1,
		Title: "镜头一", Status: "draft", CurrentRevisionID: f.revisionID,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&shot).Error; err != nil {
		t.Fatalf("创建分镜失败：%v", err)
	}
	revision := model.ShotRevision{
		ID: f.revisionID, ShotID: f.shotID, Version: 1, DurationMs: 3000,
		CreatedAt: now,
	}
	if err := db.Create(&revision).Error; err != nil {
		t.Fatalf("创建分镜版本失败：%v", err)
	}
	// 最小系统渠道：RegenerateShot 最终会走 CreateTask，而 CreateTask 要求
	// 系统渠道存在、模型启用且价格有效。用 fixed_request + 单价 0（免费）
	// 满足 HasValidPrice，无需搭完整的价格档位体系——那不是 W1-01 的契约。
	channel := model.ModelChannel{
		ID: "chan-w1", Scope: model.ChannelScopeSystem, Enabled: true,
		Name: "契约测试渠道", APIFormat: "openai", CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("创建渠道失败：%v", err)
	}
	channelModel := model.ChannelModel{
		ID: "cm-w1", ChannelID: "chan-w1", ModelKey: "w1-test",
		ProviderModelKey: "w1-test", DisplayName: "契约测试模型",
		Capability: "video", Protocol: model.ChannelInterfaceVolcengineArkVideo,
		BillingMode: "fixed_request", UnitPriceMicrocredits: 0,
		PriceConfigured: true, Enabled: true, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&channelModel).Error; err != nil {
		t.Fatalf("创建渠道模型失败：%v", err)
	}

	// Prompt / Operation / Provider / Model 是独立的列，不是 InputJSON 的字段：
	// RegenerateShot 克隆的是 latest.Prompt 这一列，InputJSON 只作为 Input 透传。
	// config.channelId 存在时会被判定为系统渠道任务，从而走渠道校验而非自定义渠道开关。
	task := model.Task{
		ID: f.taskID, UserID: f.userID, Type: "canvas_video", Status: model.TaskStatusQueued,
		ProjectID: f.projectID, ShotID: f.shotID,
		Prompt:    "契约测试镜头", Operation: "video", Provider: "comfy", Model: "w1-test",
		InputJSON: `{"prompt":"契约测试镜头","config":{"channelId":"chan-w1","model":"w1-test"}}`,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatalf("创建任务失败：%v", err)
	}
	return f
}

// newBridge 注册一个启用中的 ComfyBridge，是 EnqueueComfyBridgeRequest 的前置。
func (f *chainFixture) newBridge(t *testing.T) {
	t.Helper()
	bridge := model.ComfyBridge{
		ID: f.bridgeID, UserID: f.userID, Name: "契约测试 Bridge",
		TokenHash: "token-hash-" + f.bridgeID, Enabled: true,
		CreatedAt: f.now, UpdatedAt: f.now,
	}
	if err := f.db.Create(&bridge).Error; err != nil {
		t.Fatalf("创建 Bridge 失败：%v", err)
	}
}

// newClaimedRequest 造一个已被 Bridge 认领的请求（claimed），
// 这是 CompleteComfyBridgeRequestWithAssets 的前置状态。
func (f *chainFixture) newClaimedRequest(t *testing.T, requestID string, attempt int) {
	t.Helper()
	request := model.ComfyBridgeRequest{
		ID:               requestID,
		TaskID:           f.taskID,
		UserID:           f.userID,
		BridgeID:         f.bridgeID,
		Kind:             "video",
		Status:           "claimed",
		PayloadJSON:      "{}",
		ExpiresAt:        f.now.Add(time.Hour),
		GenerationTaskID: f.taskID,
		ShotID:           f.shotID,
		CanvasNodeID:     "node-w1",
		AttemptNo:        attempt,
		CreatedAt:        f.now,
		UpdatedAt:        f.now,
	}
	if err := f.db.Create(&request).Error; err != nil {
		t.Fatalf("创建 Bridge 请求失败：%v", err)
	}
}

// bridgeRequest 回库读取原始记录。
//
// 为什么要绕一圈：service 层返回的 ComfyBridgeRequest 是给 Bridge 轮询用的 DTO，
// 只暴露 id/kind/taskId/bridgeId/payload/createdAt 六个字段，
// 不含 status 与任务链四列——要验证 D-036 契约② 只能回库查。
func (f *chainFixture) bridgeRequest(t *testing.T, id string) model.ComfyBridgeRequest {
	t.Helper()
	var row model.ComfyBridgeRequest
	if err := f.db.Where("id = ?", id).First(&row).Error; err != nil {
		t.Fatalf("读取 Bridge 请求失败：%v", err)
	}
	return row
}

func (f *chainFixture) artifacts(t *testing.T) []model.ShotArtifact {
	t.Helper()
	var rows []model.ShotArtifact
	if err := f.db.Where("shot_id = ?", f.shotID).Order("version asc").Find(&rows).Error; err != nil {
		t.Fatalf("读取产物失败：%v", err)
	}
	return rows
}

func (f *chainFixture) completeOnce(t *testing.T, requestID string, at time.Duration, outputs []model.BridgeOutputAsset) bool {
	t.Helper()
	_, applied, err := f.repo.CompleteComfyBridgeRequestWithAssets(
		f.bridgeID, requestID, "succeeded", "{}", "", f.now.Add(at), outputs,
	)
	if err != nil {
		t.Fatalf("完成 Bridge 请求失败：%v", err)
	}
	return applied
}

func sampleOutputs(uri string) []model.BridgeOutputAsset {
	return []model.BridgeOutputAsset{{
		StorageURI: uri, PreviewURI: uri, Mime: "video/mp4",
		AssetType: "video", Provider: "comfy", FPS: 24,
		FileSize: 1024, DurationMs: 4000, Width: 1280, Height: 720,
	}}
}

// ─────────────────────────────────────────────────────────────────────────
// T1 · Submit（Task → ComfyBridgeRequest，任务链字段必须填全）
// ─────────────────────────────────────────────────────────────────────────

func TestT1SubmitWritesTaskChainFields(t *testing.T) {
	f := seedChain(t)
	f.newBridge(t)

	request, err := f.svc.EnqueueComfyBridgeRequest(
		context.Background(), f.userID, f.bridgeID, f.taskID,
		map[string]any{"prompt": "契约测试"},
	)
	if err != nil {
		t.Fatalf("Submit 失败：%v", err)
	}
	if request.TaskID != f.taskID {
		t.Fatalf("返回的 task_id 应为 %q，实际 %q", f.taskID, request.TaskID)
	}
	// D-036 契约②：F-12 事故就是这四列没填，导致任务链断掉。
	stored := f.bridgeRequest(t, request.ID)
	if stored.Status != "queued" {
		t.Fatalf("新请求状态应为 queued，实际 %q", stored.Status)
	}
	if stored.GenerationTaskID != f.taskID {
		t.Fatalf("generation_task_id 应为 %q，实际 %q", f.taskID, stored.GenerationTaskID)
	}
	if stored.ShotID != f.shotID {
		t.Fatalf("shot_id 应为 %q，实际 %q", f.shotID, stored.ShotID)
	}
	if stored.AttemptNo != 1 {
		t.Fatalf("首次提交的 attempt_no 应为 1，实际 %d", stored.AttemptNo)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// T2 · Retry（Task 不变 / Job 新建 / attempt_no +1）
// ─────────────────────────────────────────────────────────────────────────

func TestT2RetryReusesTaskAndIncrementsAttempt(t *testing.T) {
	f := seedChain(t)
	f.newBridge(t)

	first, err := f.svc.EnqueueComfyBridgeRequest(
		context.Background(), f.userID, f.bridgeID, f.taskID, map[string]any{"prompt": "第一次"},
	)
	if err != nil {
		t.Fatalf("首次提交失败：%v", err)
	}
	// 第二次用同一个 Task 提交 —— 即 D-020 定义的 Retry：同一 GenerationTask 新增一个 ComfyJob。
	second, err := f.svc.EnqueueComfyBridgeRequest(
		context.Background(), f.userID, f.bridgeID, f.taskID, map[string]any{"prompt": "第二次"},
	)
	if err != nil {
		t.Fatalf("重试提交失败：%v", err)
	}

	firstStored := f.bridgeRequest(t, first.ID)
	secondStored := f.bridgeRequest(t, second.ID)
	if secondStored.TaskID != firstStored.TaskID || secondStored.GenerationTaskID != f.taskID {
		t.Fatalf("Retry 应复用同一 Task，实际 task_id=%q generation_task_id=%q",
			secondStored.TaskID, secondStored.GenerationTaskID)
	}
	if second.ID == first.ID {
		t.Fatalf("Retry 应新建一个 Job（新的 Bridge 请求），不应复用 %q", first.ID)
	}
	if secondStored.AttemptNo != firstStored.AttemptNo+1 {
		t.Fatalf("attempt_no 应递增：期望 %d，实际 %d", firstStored.AttemptNo+1, secondStored.AttemptNo)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// T3 · Regenerate（新建 Task）—— 同时沉淀 F-25 的实测证据
// ─────────────────────────────────────────────────────────────────────────

func TestT3RegenerateCreatesNewTask(t *testing.T) {
	f := seedChain(t)
	f.newBridge(t)

	// ① F-25 前置：Shot.LatestTaskID 为空时，RegenerateShot 必须明确报错。
	//    这条断言同时是 F-25 调查的实证——它证明该字段目前确实是 Bridge 完成才回写。
	if _, err := f.svc.RegenerateShot(f.userID, f.projectID, f.shotID); err == nil {
		t.Fatalf("F-25：LatestTaskID 为空时 RegenerateShot 应当报错，实际成功了")
	} else if !strings.Contains(err.Error(), "还没有生成记录") {
		t.Fatalf("F-25：期望「还没有生成记录」错误，实际：%v", err)
	}

	// ② 走一次 Bridge 完成，让 Shot.LatestTaskID 被回写。
	f.newClaimedRequest(t, "req-t3-1", 1)
	f.completeOnce(t, "req-t3-1", time.Second, sampleOutputs("file:///t3-v1.mp4"))

	// ③ LatestTaskID 就绪后，Regenerate 应新建 Task 并绑定同一 Shot。
	newTask, err := f.svc.RegenerateShot(f.userID, f.projectID, f.shotID)
	if err != nil {
		t.Fatalf("LatestTaskID 就绪后 Regenerate 应成功，实际失败：%v", err)
	}
	if newTask.ID == f.taskID {
		t.Fatalf("Regenerate 应新建 Task（D-030），不应复用 %q", f.taskID)
	}
	if newTask.ShotID != f.shotID {
		t.Fatalf("新 Task 应绑定同一 Shot %q，实际 %q", f.shotID, newTask.ShotID)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// T4 · Duplicate completion（重复完成必须幂等）
// ─────────────────────────────────────────────────────────────────────────

func TestT4DuplicateCompletionIsIdempotent(t *testing.T) {
	f := seedChain(t)
	f.newClaimedRequest(t, "req-t4", 1)

	if applied := f.completeOnce(t, "req-t4", time.Second, sampleOutputs("file:///t4.mp4")); !applied {
		t.Fatalf("首次完成应当生效")
	}
	if applied := f.completeOnce(t, "req-t4", 2*time.Second, sampleOutputs("file:///t4.mp4")); applied {
		t.Fatalf("重复完成不应再次生效（幂等键失效）")
	}

	rows := f.artifacts(t)
	if len(rows) != 1 {
		t.Fatalf("重复完成后产物数应为 1，实际 %d", len(rows))
	}
	if rows[0].Status != model.ShotArtifactStatusPendingResource {
		t.Fatalf("产物状态应为 pending_resource，实际 %q", rows[0].Status)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// T5 · 同一镜头二次生成，旧产物必须取消 selected（P0-3 修的 Bug）
// ─────────────────────────────────────────────────────────────────────────

func TestT5SecondGenerationClearsPreviousSelected(t *testing.T) {
	f := seedChain(t)

	f.newClaimedRequest(t, "req-t5-1", 1)
	f.completeOnce(t, "req-t5-1", time.Second, sampleOutputs("file:///t5-v1.mp4"))

	f.newClaimedRequest(t, "req-t5-2", 1)
	f.completeOnce(t, "req-t5-2", 2*time.Second, sampleOutputs("file:///t5-v2.mp4"))

	rows := f.artifacts(t)
	if len(rows) != 2 {
		t.Fatalf("两次生成应产生 2 条产物，实际 %d", len(rows))
	}
	if rows[0].Version != 1 || rows[1].Version != 2 {
		t.Fatalf("版本号应递增为 1、2，实际 %d、%d", rows[0].Version, rows[1].Version)
	}

	selected := make([]model.ShotArtifact, 0, 2)
	for _, row := range rows {
		if row.Selected {
			selected = append(selected, row)
		}
	}
	if len(selected) != 1 {
		var detail []string
		for _, row := range rows {
			detail = append(detail, "v"+string(rune('0'+row.Version))+" selected="+boolText(row.Selected))
		}
		t.Fatalf("selected 应恰好 1 条，实际 %d 条（%s）——selected 泄漏已复现", len(selected), strings.Join(detail, ", "))
	}
	if selected[0].Version != 2 {
		t.Fatalf("selected 应指向最新版本 2，实际指向 %d", selected[0].Version)
	}
}

func boolText(v bool) string {
	if v {
		return "true"
	}
	return "false"
}

// ─────────────────────────────────────────────────────────────────────────
// T6 · version 唯一性保护
// ─────────────────────────────────────────────────────────────────────────

func TestT6VersionUniquenessIsProtected(t *testing.T) {
	f := seedChain(t)

	makeArtifact := func(id string, version int) *model.ShotArtifact {
		return &model.ShotArtifact{
			ID: id, ProjectID: f.projectID, UnitID: f.unitID, ShotID: f.shotID,
			RevisionID: f.revisionID, TaskID: f.taskID, Type: "video",
			Version: version, Status: model.ShotArtifactStatusReady, Selected: true,
			CreatedAt: f.now, UpdatedAt: f.now,
		}
	}

	// ① 统一入口应自动分配递增版本号，不撞唯一约束。
	first, created, err := f.repo.CreateOrGetShotArtifact(
		makeArtifact("art-t6-1", 0),
		repository.ArtifactIdempotencyKey{Kind: repository.ArtifactIdemNone},
	)
	if err != nil {
		t.Fatalf("首个产物创建失败：%v", err)
	}
	if !created {
		t.Fatalf("首个产物应当是新创建的")
	}
	if first.Version != 1 {
		t.Fatalf("首个产物版本应为 1，实际 %d", first.Version)
	}

	second, created, err := f.repo.CreateOrGetShotArtifact(
		makeArtifact("art-t6-2", 0),
		repository.ArtifactIdempotencyKey{Kind: repository.ArtifactIdemNone},
	)
	if err != nil {
		t.Fatalf("第二个产物创建失败：%v", err)
	}
	if !created || second.Version != 2 {
		t.Fatalf("第二个产物应为新建且版本为 2，实际 created=%v version=%d", created, second.Version)
	}

	// ② 幂等键命中时应返回既有行，而不是再插一条。
	key := repository.ArtifactIdempotencyKey{
		Kind: repository.ArtifactIdemByRequest, RequestID: "req-t6", AssetIndex: 0,
	}
	third := makeArtifact("art-t6-3", 0)
	third.RequestID = key.RequestID
	third.AssetIndex = key.AssetIndex
	third, created, err = f.repo.CreateOrGetShotArtifact(third, key)
	if err != nil || !created {
		t.Fatalf("首次按幂等键创建应成功：created=%v err=%v", created, err)
	}
	again := makeArtifact("art-t6-4", 0)
	again.RequestID = key.RequestID
	again.AssetIndex = key.AssetIndex
	again, created, err = f.repo.CreateOrGetShotArtifact(again, key)
	if err != nil {
		t.Fatalf("重复按幂等键创建失败：%v", err)
	}
	if created {
		t.Fatalf("幂等键命中时不该再新建")
	}
	if again.ID != third.ID {
		t.Fatalf("幂等命中应返回既有行 ID %q，实际 %q", third.ID, again.ID)
	}

	// ④ 调用方漏填 RequestID / AssetIndex 时，入口应以幂等键为准回填，
	//    不能静默退化成「按 A 查重、却写入 B」导致每次都新建。
	omittedKey := repository.ArtifactIdempotencyKey{
		Kind: repository.ArtifactIdemByRequest, RequestID: "req-t6-omitted", AssetIndex: 2,
	}
	omitted, created, err := f.repo.CreateOrGetShotArtifact(makeArtifact("art-t6-5", 0), omittedKey)
	if err != nil || !created {
		t.Fatalf("漏填字段场景下首次创建应成功：created=%v err=%v", created, err)
	}
	if omitted.RequestID != "req-t6-omitted" || omitted.AssetIndex != 2 {
		t.Fatalf("入口应把幂等键回填到产物，实际 request_id=%q asset_index=%d",
			omitted.RequestID, omitted.AssetIndex)
	}
	repeat, created, err := f.repo.CreateOrGetShotArtifact(makeArtifact("art-t6-6", 0), omittedKey)
	if err != nil {
		t.Fatalf("漏填字段场景下重复创建失败：%v", err)
	}
	if created || repeat.ID != omitted.ID {
		t.Fatalf("漏填字段时仍应幂等命中：created=%v id=%q（期望 %q）", created, repeat.ID, omitted.ID)
	}

	// ③ 数据库层的唯一约束确实存在：手工插入重复 (shot_id,type,version) 必须被拒。
	duplicate := *first
	duplicate.ID = "art-t6-dup"
	if err := f.db.Create(&duplicate).Error; err == nil {
		t.Fatalf("唯一约束 UNIQUE(shot_id,type,version) 未生效：重复版本被写入")
	} else if !strings.Contains(strings.ToLower(err.Error()), "unique") {
		t.Fatalf("期望唯一约束错误，实际：%v", err)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// T7 · LatestTaskID 语义（F-25 / W1-02）
//
// 契约：shots.latest_task_id = 「最近一次**成功**的生成任务」。
//   · Bridge 失败 attempt 不得把成功指针拉黑（否则 Regenerate 克隆失败参数）；
//   · Job 级指针（latest_job_id）保持「最近一次尝试」语义，无论成败照旧回写；
//   · 非 Bridge Provider 的成功任务由 task_terminal.handleSuccess →
//     TouchShotLatestTask 统一回写（这里直接验证 repo 层契约）。
// ─────────────────────────────────────────────────────────────────────────

func TestT7LatestTaskPointerIgnoresFailedBridgeAttempt(t *testing.T) {
	f := seedChain(t)
	f.newBridge(t)

	// ① 第一次生成成功：latest_task_id 应指向 task-w1。
	f.newClaimedRequest(t, "req-t7-ok", 1)
	f.completeOnce(t, "req-t7-ok", time.Second, sampleOutputs("file:///t7-v1.mp4"))

	shot := f.shotRow(t)
	if shot.LatestTaskID != f.taskID {
		t.Fatalf("成功生成后 latest_task_id 应为 %q，实际 %q", f.taskID, shot.LatestTaskID)
	}

	// ② 同 Task 的第二次 attempt 失败：latest_task_id 必须保持 task-w1。
	request := model.ComfyBridgeRequest{
		ID: "req-t7-fail", TaskID: f.taskID, UserID: f.userID, BridgeID: f.bridgeID,
		Kind: "video", Status: "claimed", PayloadJSON: "{}",
		ExpiresAt: f.now.Add(time.Hour), GenerationTaskID: f.taskID, ShotID: f.shotID,
		AttemptNo: 2, CreatedAt: f.now, UpdatedAt: f.now,
	}
	if err := f.db.Create(&request).Error; err != nil {
		t.Fatalf("创建失败 attempt 请求失败：%v", err)
	}
	if _, applied, err := f.repo.CompleteComfyBridgeRequestWithAssets(
		f.bridgeID, "req-t7-fail", "failed", "{}", "GPU OOM", f.now.Add(2*time.Second), nil,
	); err != nil || !applied {
		t.Fatalf("失败回调应正常落库：applied=%v err=%v", applied, err)
	}

	shot = f.shotRow(t)
	if shot.LatestTaskID != f.taskID {
		t.Fatalf("失败 attempt 不得覆盖成功指针：latest_task_id=%q（期望 %q）——F-25 回归", shot.LatestTaskID, f.taskID)
	}
	if shot.LatestJobID != "req-t7-fail" {
		t.Fatalf("Job 指针应保持最近一次尝试语义：latest_job_id=%q（期望 req-t7-fail）", shot.LatestJobID)
	}

	// ③ 非 Bridge Provider 的成功任务（统一收口 handleSuccess → TouchShotLatestTask）：
	//    换一个新 Task 成功后，指针应前移。
	if err := f.repo.TouchShotLatestTask(f.shotID, "task-w2", f.now.Add(3*time.Second)); err != nil {
		t.Fatalf("TouchShotLatestTask 失败：%v", err)
	}
	shot = f.shotRow(t)
	if shot.LatestTaskID != "task-w2" {
		t.Fatalf("非 Bridge 成功任务应前移指针：latest_task_id=%q（期望 task-w2）", shot.LatestTaskID)
	}
}

// shotRow 回库读取分镜行（验证指针只能查库，DTO 不带这些加速字段）。
func (f *chainFixture) shotRow(t *testing.T) model.Shot {
	t.Helper()
	var row model.Shot
	if err := f.db.Where("id = ?", f.shotID).First(&row).Error; err != nil {
		t.Fatalf("读取分镜失败：%v", err)
	}
	return row
}
