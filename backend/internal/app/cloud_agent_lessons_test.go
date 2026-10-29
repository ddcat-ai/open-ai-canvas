package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 旧版经验库只剩用户与管理员的管理接口；Agent 侧的写入、注入与召回已由长期记忆文件取代。

func agentLessonTestRepo(t *testing.T) *repository.Repository {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	return s.repo
}

func TestAgentLessonScrubRejectsUserTraces(t *testing.T) {
	rejected := []struct{ name, text string }{
		{"链接", "参考 https://cdn.example.com/a.png 的写法"},
		{"接口路径", "调用 /api/resources/xxx/file 拿文件"},
		{"资源键", "storageKey 用 resource:abcdef123456 这种"},
		{"运行或任务 ID", "运行 ag0480e47a0473a245bf6c6163c383b894 里跑通了"},
		{"UUID", "节点 3f2504e0-4f89-11d3-9a0c-0305e82c3301 这么连"},
		{"节点或连线 ID", "把 conn-abc123 保留下来"},
	}
	for _, item := range rejected {
		if err := cloudAgentLessonScrub("lesson", item.text); err == nil {
			t.Fatalf("%s：这条带用户痕迹的内容必须被拒：%s", item.name, item.text)
		}
	}
	allowed := []string{
		"视频模型只认分辨率参数，不要传画幅比例",
		"分镜行挂资产必须指明具体是哪一行，否则会被服务端拒绝",
		"同一轮里的多个生成调用要连续发出，中间插别的调用会退化成串行",
		"把 @叮当猫在飞 连到分镜行",
	}
	for _, text := range allowed {
		if err := cloudAgentLessonScrub("lesson", text); err != nil {
			t.Fatalf("通用说法不该被拒：%s（%v）", text, err)
		}
	}
}

func TestAgentLessonPendingIsNotRecalledUntilApproved(t *testing.T) {
	repo := agentLessonTestRepo(t)
	now := time.Now()
	entry := &model.AgentLesson{
		ID: newID(), Topic: "video.duration", Situation: "竖屏视频生成",
		Lesson: "用模型目录返回的时长，不要猜", Source: "generate_media",
		Status: model.AgentLessonStatusPending, AuthorUserID: "user-a",
		LastVerifiedAt: &now, CreatedAt: now, UpdatedAt: now,
	}
	if err := repo.Create(entry); err != nil {
		t.Fatal(err)
	}
	approved, err := repo.ApprovedAgentLessons("user-a", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(approved) != 0 {
		t.Fatalf("待审记忆不该出现在已批准列表里：%+v", approved)
	}
	if err := repo.SetAgentLessonStatus("user-a", entry.ID, model.AgentLessonStatusApproved); err != nil {
		t.Fatal(err)
	}
	approved, err = repo.ApprovedAgentLessons("user-a", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(approved) != 1 || approved[0].Topic != "video.duration" {
		t.Fatalf("批准后应当可取回：%+v", approved)
	}
	other, err := repo.ApprovedAgentLessons("user-b", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(other) != 0 {
		t.Fatalf("别人的已批准记忆不该出现在我的列表里：%+v", other)
	}
}

func TestAgentLessonStoresSteps(t *testing.T) {
	repo := agentLessonTestRepo(t)
	steps := []model.AgentLessonStep{
		{Tool: "canvas_get_state", Action: "读取画布，拿到真实行 id"},
		{Tool: "canvas_apply_ops", Action: "connect_nodes 带上 rowId 把资产挂到该行", Note: "只连节点本身会被拒"},
	}
	raw, err := json.Marshal(steps)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	entry := &model.AgentLesson{
		ID: newID(), Topic: "storyboard.row-connect", Situation: "给某一镜挂参考资产",
		StepsJSON: string(raw), Status: model.AgentLessonStatusApproved,
		AuthorUserID: "user-b", LastVerifiedAt: &now, CreatedAt: now, UpdatedAt: now,
	}
	if err := repo.Create(entry); err != nil {
		t.Fatal(err)
	}
	got, err := repo.ApprovedAgentLessons("user-b", 10)
	if err != nil || len(got) != 1 {
		t.Fatalf("应取回一条：%+v（%v）", got, err)
	}
	var decoded []model.AgentLessonStep
	if err := json.Unmarshal([]byte(got[0].StepsJSON), &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded) != 2 || decoded[1].Tool != "canvas_apply_ops" || !strings.Contains(decoded[1].Note, "会被拒") {
		t.Fatalf("steps 未原样保留：%+v", decoded)
	}
}

func TestAgentLessonAdminViewExposesParsedSteps(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	now := time.Now()
	entry := &model.AgentLesson{
		ID: newID(), Topic: "canvas.snapshot-hash", Category: "canvas", Situation: "连续写画布时报快照过期",
		Lesson: "每次写成功后用返回的新 snapshotHash", StepsJSON: `[{"tool":"canvas_apply_ops","action":"写画布","note":"先读后写"}]`,
		Status: model.AgentLessonStatusPending, AuthorUserID: "user-a",
		LastVerifiedAt: &now, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.Create(entry); err != nil {
		t.Fatal(err)
	}
	views, err := s.AdminAgentLessons("pending", "", "", 10)
	if err != nil || len(views) != 1 {
		t.Fatalf("管理端应看到待审条目：%+v（%v）", views, err)
	}
	if views[0].AuthorUserID != "user-a" {
		t.Fatalf("管理端必须能看到作者以便追责：%+v", views[0])
	}
	if len(views[0].Steps) != 1 || views[0].Steps[0].Tool != "canvas_apply_ops" || views[0].Steps[0].Note != "先读后写" {
		t.Fatalf("管理端必须能看到解析后的路线，不能被 json:\"-\" 藏掉：%+v", views[0].Steps)
	}
	raw, err := json.Marshal(views[0])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"steps"`) || !strings.Contains(string(raw), "canvas_apply_ops") {
		t.Fatalf("管理端 JSON 必须带 steps：%s", raw)
	}
}

func TestAgentLessonUpsertDeduplicates(t *testing.T) {
	repo := agentLessonTestRepo(t)
	makeEntry := func(userID string) *model.AgentLesson {
		now := time.Now()
		return &model.AgentLesson{
			ID: newID(), Topic: "video.duration", Situation: "竖屏视频生成",
			Lesson: "用模型目录返回的时长", Status: model.AgentLessonStatusPending,
			AuthorUserID: userID, LastVerifiedAt: &now, CreatedAt: now, UpdatedAt: now,
		}
	}
	first := makeEntry("user-a")
	if err := repo.Create(first); err != nil {
		t.Fatal(err)
	}
	if err := repo.Create(makeEntry("user-c")); err != nil {
		t.Fatal(err)
	}
	duplicate, err := cloudAgentFindDuplicateLesson(repo, "user-a", makeEntry("user-a"))
	if err != nil {
		t.Fatal(err)
	}
	if duplicate == nil || duplicate.ID != first.ID {
		t.Fatalf("同一用户同内容应判重复：%+v", duplicate)
	}
	crossUser, err := cloudAgentFindDuplicateLesson(repo, "user-c", makeEntry("user-c"))
	if err != nil {
		t.Fatal(err)
	}
	if crossUser == nil {
		t.Fatal("user-c 自己的第二条应能找到自己刚写入的那条")
	}
	allA, err := repo.UserAgentLessons("user-a", "", 50)
	if err != nil {
		t.Fatal(err)
	}
	allC, err := repo.UserAgentLessons("user-c", "", 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(allA) != 1 || len(allC) != 1 {
		t.Fatalf("两个用户各自应有一条，got a=%d c=%d", len(allA), len(allC))
	}
}

func TestAgentLessonDedupIgnoresTopicSpelling(t *testing.T) {
	repo := agentLessonTestRepo(t)
	now := time.Now()
	first := &model.AgentLesson{
		ID: newID(), Topic: "视频生成 图片需先入库", Situation: "把图片当参考生成视频时",
		Lesson: "参考图必须先存进资源库，否则模型拒绝该参考", Status: model.AgentLessonStatusPending,
		AuthorUserID: "user-a", LastVerifiedAt: &now, CreatedAt: now, UpdatedAt: now,
	}
	if err := repo.Create(first); err != nil {
		t.Fatal(err)
	}
	same := &model.AgentLesson{
		ID: newID(), Topic: "视频生成 参考资产未入库 错误处理", Situation: "把图片当参考生成视频时",
		Lesson: "参考图必须先存进资源库，否则模型拒绝该参考", Status: model.AgentLessonStatusPending,
		AuthorUserID: "user-a", LastVerifiedAt: &now, CreatedAt: now, UpdatedAt: now,
	}
	duplicate, err := cloudAgentFindDuplicateLesson(repo, "user-a", same)
	if err != nil {
		t.Fatal(err)
	}
	if duplicate == nil || duplicate.ID != first.ID {
		t.Fatalf("topic 不同但内容一致应判重复，got %+v", duplicate)
	}
	fresh := &model.AgentLesson{
		ID: newID(), Topic: "视频生成 图片需先入库", Situation: "分镜行挂参考图时",
		Lesson: "先建资产卡并生成形象图，再挂到行上", Status: model.AgentLessonStatusPending,
		AuthorUserID: "user-a", LastVerifiedAt: &now, CreatedAt: now, UpdatedAt: now,
	}
	duplicate, err = cloudAgentFindDuplicateLesson(repo, "user-a", fresh)
	if err != nil {
		t.Fatal(err)
	}
	if duplicate != nil {
		t.Fatalf("内容不同不该判重复，got %+v", duplicate)
	}
}

func TestUserAgentMemoryCRUDAndIsolation(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	created, err := s.CreateUserAgentMemory("user-a", AgentMemoryRequest{
		Topic: "canvas.snapshot-hash", Category: "canvas", Situation: "写画布时报快照过期", Lesson: "用返回的新 snapshotHash",
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Status != model.AgentLessonStatusApproved {
		t.Fatalf("用户手动添加应直接生效：%s", created.Status)
	}
	other, err := s.UserAgentMemories("user-b", "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(other) != 0 {
		t.Fatalf("不能读到别人的记忆：%+v", other)
	}
	if _, err := s.UpdateUserAgentMemory("user-b", created.ID, AgentMemoryRequest{
		Topic: "canvas.snapshot-hash", Category: "canvas", Situation: "写画布时报快照过期", Lesson: "偷改别人的记忆",
	}); err == nil {
		t.Fatal("不能改别人的记忆")
	}
	if err := s.DeleteUserAgentMemory("user-b", created.ID); err == nil {
		t.Fatal("不能删别人的记忆")
	}
	own, err := s.UserAgentMemories("user-a", "approved", 20)
	if err != nil || len(own) != 1 {
		t.Fatalf("本人应看到自己添加的记忆：%+v（%v）", own, err)
	}
}

func TestUserAgentMemoryApproveIsOwnerOnly(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	now := time.Now()
	entry := &model.AgentLesson{
		ID: newID(), Topic: "video.duration", Category: "video", Situation: "竖屏视频生成",
		Lesson: "用模型目录返回的时长", Status: model.AgentLessonStatusPending, AuthorUserID: "user-a",
		CreatedAt: now, UpdatedAt: now, LastVerifiedAt: &now,
	}
	if err := s.repo.Create(entry); err != nil {
		t.Fatal(err)
	}
	if err := s.DecideUserAgentMemory("user-b", entry.ID, "approve"); err == nil {
		t.Fatal("不能批准别人的待审记忆")
	}
	if err := s.DecideUserAgentMemory("user-a", entry.ID, "approve"); err != nil {
		t.Fatal(err)
	}
	got, err := s.repo.ApprovedAgentLessons("user-a", 10)
	if err != nil || len(got) != 1 {
		t.Fatalf("本人批准后应可取回：%+v（%v）", got, err)
	}
}

func TestUserAgentMemoryExportImport(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	if _, err := s.CreateUserAgentMemory("user-a", AgentMemoryRequest{
		Topic: "canvas.snapshot-hash", Category: "canvas", Situation: "写画布时报快照过期", Lesson: "用返回的新 snapshotHash",
	}); err != nil {
		t.Fatal(err)
	}
	bundle, err := s.ExportUserAgentMemories("user-a")
	if err != nil || bundle.Kind != "agent-memories" || len(bundle.Memories) != 1 {
		t.Fatalf("导出失败：%+v（%v）", bundle, err)
	}
	result, err := s.ImportUserAgentMemories("user-b", bundle)
	if err != nil || result.Imported != 1 {
		t.Fatalf("导入到另一用户应新增：%+v（%v）", result, err)
	}
	again, err := s.ImportUserAgentMemories("user-b", bundle)
	if err != nil || again.Merged != 1 {
		t.Fatalf("重复导入应合并：%+v（%v）", again, err)
	}
	if _, err := s.ImportUserAgentMemories("user-a", AgentMemoryBundle{Kind: "not-memories", Memories: bundle.Memories}); err == nil {
		t.Fatal("错误 kind 必须拒绝")
	}
}

func TestAdminAgentLessonsFiltersByUser(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	now := time.Now()
	for _, userID := range []string{"user-a", "user-b"} {
		entry := &model.AgentLesson{
			ID: newID(), Topic: "canvas.snapshot-hash-" + userID, Category: "canvas", Situation: "写画布时报快照过期",
			Lesson: "用返回的新 snapshotHash", Status: model.AgentLessonStatusApproved, AuthorUserID: userID,
			CreatedAt: now, UpdatedAt: now, LastVerifiedAt: &now,
		}
		if err := s.repo.Create(entry); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.repo.Create(&model.User{ID: "user-a", Username: "alice", DisplayName: "爱丽丝"}); err != nil {
		t.Fatal(err)
	}
	filtered, err := s.AdminAgentLessons("", "user-a", "", 20)
	if err != nil || len(filtered) != 1 || filtered[0].AuthorUserID != "user-a" {
		t.Fatalf("应按用户筛选：%+v（%v）", filtered, err)
	}
	if filtered[0].AuthorUsername != "alice" {
		t.Fatalf("管理端应带上用户名：%+v", filtered[0])
	}
	byName, err := s.AdminAgentLessons("", "", "alice", 20)
	if err != nil || len(byName) != 1 || byName[0].AuthorUserID != "user-a" {
		t.Fatalf("应按用户名搜索：%+v（%v）", byName, err)
	}
	all, err := s.AdminAgentLessons("", "", "", 20)
	if err != nil || len(all) != 2 {
		t.Fatalf("不筛选时应看到全部：%d（%v）", len(all), err)
	}
}

func TestPendingAgentLessonsExpireWithoutTouchingApproved(t *testing.T) {
	repo := agentLessonTestRepo(t)
	now := time.Now()
	old := now.Add(-cloudAgentPendingLessonTTL - time.Hour)
	entries := []*model.AgentLesson{
		{ID: newID(), Topic: "old-pending", Status: model.AgentLessonStatusPending, AuthorUserID: "user-a", CreatedAt: old, UpdatedAt: old},
		{ID: newID(), Topic: "fresh-pending", Status: model.AgentLessonStatusPending, AuthorUserID: "user-a", CreatedAt: now, UpdatedAt: now},
		{ID: newID(), Topic: "old-approved", Status: model.AgentLessonStatusApproved, AuthorUserID: "user-a", CreatedAt: old, UpdatedAt: old},
	}
	for _, entry := range entries {
		if err := repo.Create(entry); err != nil {
			t.Fatal(err)
		}
	}
	changed, err := repo.ExpirePendingAgentLessons("", now.Add(-cloudAgentPendingLessonTTL), now, 500)
	if err != nil || changed != 1 {
		t.Fatalf("应只过期一条旧 pending：changed=%d err=%v", changed, err)
	}
	for _, want := range []struct{ id, status string }{
		{entries[0].ID, model.AgentLessonStatusExpired},
		{entries[1].ID, model.AgentLessonStatusPending},
		{entries[2].ID, model.AgentLessonStatusApproved},
	} {
		got, findErr := repo.AgentLessonForUser("user-a", want.id)
		if findErr != nil || got.Status != want.status {
			t.Fatalf("记忆 %s 状态不符：got=%+v err=%v", want.id, got, findErr)
		}
	}
}
