package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func agentLessonTestRepo(t *testing.T) *repository.Repository {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	return s.repo
}

func rememberLessonCall(arguments string) cloudAgentCall {
	return cloudAgentCall{Function: struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	}{Name: "remember_lesson", Arguments: arguments}}
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
		t.Fatalf("待审记忆不该出现在召回结果里：%+v", approved)
	}

	if err := repo.SetAgentLessonStatus("user-a", entry.ID, model.AgentLessonStatusApproved); err != nil {
		t.Fatal(err)
	}
	approved, err = repo.ApprovedAgentLessons("user-a", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(approved) != 1 || approved[0].Topic != "video.duration" {
		t.Fatalf("批准后应当可召回：%+v", approved)
	}
	other, err := repo.ApprovedAgentLessons("user-b", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(other) != 0 {
		t.Fatalf("别人的已批准记忆不该出现在我的召回里：%+v", other)
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
	sameUserDup := makeEntry("user-a")
	duplicate, err := cloudAgentFindDuplicateLesson(repo, "user-a", sameUserDup)
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

func lessonWithSteps(topic, category string, tools ...string) model.AgentLesson {
	steps := make([]model.AgentLessonStep, 0, len(tools))
	for _, tool := range tools {
		steps = append(steps, model.AgentLessonStep{Tool: tool, Action: "做点什么"})
	}
	raw, _ := json.Marshal(steps)
	return model.AgentLesson{
		ID: newID(), Topic: topic, Category: category, Situation: "某种情况",
		Lesson: "某做法", StepsJSON: string(raw), Status: model.AgentLessonStatusApproved,
	}
}

func TestLessonsBlockIsIndexNotDump(t *testing.T) {
	view := cloudAgentLessonView{
		Total: 9,
		Counts: []repository.AgentLessonCategoryCount{
			{Category: "storyboard", Count: 6},
			{Category: "canvas", Count: 3},
		},
		Index: []model.AgentLesson{{Topic: "storyboard.row-connect", Situation: "给分镜行接线", Lesson: "不该出现的做法全文"}},
	}
	block := cloudAgentLessonsBlock(view)
	if !strings.Contains(block, "共 9 条") || !strings.Contains(block, "分镜 6") || !strings.Contains(block, "storyboard.row-connect") {
		t.Fatalf("应注入分类概览和索引：%s", block)
	}
	if strings.Contains(block, "不该出现的做法全文") || strings.Contains(block, "；做法：") {
		t.Fatalf("记忆不得把做法全文塞进系统提示：%s", block)
	}
	if strings.Contains(block, "动手前") || strings.Contains(block, "仍应 recall_lessons") {
		t.Fatalf("索引不应注入强制召回指令：%s", block)
	}
}

func TestLessonsBlockDoesNotInlineMatches(t *testing.T) {
	view := cloudAgentLessonView{
		Total:    1,
		MatchedN: 1,
		Index:    []model.AgentLesson{lessonWithSteps("canvas.snapshot-hash", "canvas", "canvas_apply_ops")},
	}
	block := cloudAgentLessonsBlock(view)
	if !strings.Contains(block, "canvas.snapshot-hash") || !strings.Contains(block, "可能相关") {
		t.Fatalf("命中项应出现在索引里：%s", block)
	}
	if strings.Contains(block, "某做法") || strings.Contains(block, "；做法：") {
		t.Fatalf("命中项也不该自动注入全文：%s", block)
	}
}

func TestLessonsBlockRanksMatchedFirst(t *testing.T) {
	lessons := []model.AgentLesson{
		lessonWithSteps("video.duration", "video"),
		lessonWithSteps("canvas.snapshot-hash", "canvas", "canvas_apply_ops"),
	}
	index, matchedN := cloudAgentPickLessonIndex(lessons, "把资产挂上，正在调用 canvas_apply_ops", 20)
	if matchedN != 1 || len(index) != 2 || index[0].Topic != "canvas.snapshot-hash" {
		t.Fatalf("命中项应排在索引前面：matchedN=%d topics=%v", matchedN, topicsOf(index))
	}
}

func TestLessonsBlockEmptyLibrary(t *testing.T) {
	block := cloudAgentLessonsBlock(cloudAgentLessonView{})
	if !strings.Contains(block, "还没有已批准记忆") {
		t.Fatalf("空库提示缺失：%s", block)
	}
}

func TestLessonMatchesByRouteTools(t *testing.T) {
	lesson := lessonWithSteps("storyboard.asset-slot-reuse", "storyboard", "canvas_apply_ops", "canvas_read_storyboard")
	if !cloudAgentLessonMatchesTask(lesson, "把资产挂到分镜行上，正在调用 canvas_apply_ops") {
		t.Fatal("路线工具出现在任务文本里，应当命中")
	}
	if cloudAgentLessonMatchesTask(lesson, "帮我写一首歌，编曲用钢琴") {
		t.Fatal("毫不相关的任务不该命中")
	}
}

func TestLessonMatchIgnoresGenericTokens(t *testing.T) {
	lesson := lessonWithSteps("video", "video")
	if cloudAgentLessonMatchesTask(lesson, "我要生成一个视频") {
		t.Fatal("只有泛词命中时不该算相关")
	}
}

func TestLessonTaskTextCoversPromptPlanAndCalls(t *testing.T) {
	state := &cloudAgentRuntime{
		Request: CloudAgentRequest{Prompt: "做个手机广告"},
		Plan:    []cloudAgentPlanItem{{ID: "1", Title: "生成角色资产", Status: "doing"}},
		Calls: []cloudAgentCall{{Function: struct {
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
		}{Name: "generate_media"}}},
	}
	text := cloudAgentLessonTaskText(state)
	for _, want := range []string{"手机广告", "生成角色资产", "generate_media"} {
		if !strings.Contains(text, want) {
			t.Fatalf("任务文本缺少 %q：%s", want, text)
		}
	}
}

func TestLessonCategoryIsControlled(t *testing.T) {
	if _, ok := cloudAgentLessonCategoryOf("storyboard"); !ok {
		t.Fatal("合法分类被拒")
	}
	if _, ok := cloudAgentLessonCategoryOf("我自己编的类"); ok {
		t.Fatal("词表外的分类不该通过")
	}
	if cloudAgentNormalizeLessonCategory("乱写的") != "other" {
		t.Fatal("未知分类应归一为 other")
	}
	if len(cloudAgentLessonCategoryKeys()) != len(cloudAgentLessonCategories) {
		t.Fatal("enum 与词表不同源")
	}
}

func TestRecallResultIndexVsFull(t *testing.T) {
	lesson := lessonWithSteps("video.model-duration", "video", "model_list")
	index := cloudAgentLessonResult([]model.AgentLesson{lesson}, false)
	items := index["lessons"].([]map[string]any)
	if _, has := items[0]["steps"]; has {
		t.Fatal("索引层不该带路线")
	}
	if _, has := items[0]["lesson"]; has {
		t.Fatal("索引层不该带做法正文")
	}
	if items[0]["topic"] != "video.model-duration" || items[0]["category"] != "video" {
		t.Fatalf("索引项缺字段：%+v", items[0])
	}
	if index["mode"] != "index" {
		t.Fatalf("模式标记不对：%v", index["mode"])
	}
	full := cloudAgentLessonResult([]model.AgentLesson{lesson}, true)
	fullItems := full["lessons"].([]map[string]any)
	if _, has := fullItems[0]["steps"]; !has {
		t.Fatal("正文层必须带路线")
	}
	if full["mode"] != "full" {
		t.Fatalf("模式标记不对：%v", full["mode"])
	}
}

func TestLessonSearchTokensSplitsOnSpacesAndPunctuation(t *testing.T) {
	got := cloudAgentLessonSearchTokens("分镜 合并 视频 合成 拼接 one take")
	want := []string{"分镜", "合并", "视频", "合成", "拼接", "one", "take"}
	if len(got) != len(want) {
		t.Fatalf("切词结果 %v，期望 %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("切词结果 %v，期望 %v", got, want)
		}
	}
	got = cloudAgentLessonSearchTokens("视频、分辨率；视频！a")
	for _, token := range got {
		if len([]rune(token)) < 2 {
			t.Fatalf("单字词应当被丢掉：%v", got)
		}
	}
	if len(got) != 2 {
		t.Fatalf("标点应切开且去重，得到 %v", got)
	}
}

func TestLessonSearchTokensAreCapped(t *testing.T) {
	long := ""
	for index := 0; index < 20; index++ {
		long += "词条" + string(rune('a'+index)) + " "
	}
	if got := cloudAgentLessonSearchTokens(long); len(got) > cloudAgentLessonSearchTokenMax {
		t.Fatalf("词数应被截到 %d，得到 %d", cloudAgentLessonSearchTokenMax, len(got))
	}
}

func TestLessonSearchTokensKeepsSingleCJKRune(t *testing.T) {
	// 单字停用词过滤照搬的是英文逻辑（a / I）；中文单字「梗」「钩」「戏」本身就是完整语义的最小单位，
	// 被 < 2 一刀切后 tokens 为空，cloudAgentSearchLessons 会静默回落为「列前 N 条」——
	// 用户以为搜过了，拿到的却是任意清单。
	got := cloudAgentLessonSearchTokens("反转 钩子 梗 钩")
	want := []string{"反转", "钩子", "梗", "钩"}
	if len(got) != len(want) {
		t.Fatalf("切词结果 %v，期望 %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("切词结果 %v，期望 %v", got, want)
		}
	}
	// 只放行汉字单字：英文/数字单字与空串仍按停用词处理。
	for _, keyword := range []string{"a", "I", "7", "", "，、。；"} {
		if tokens := cloudAgentLessonSearchTokens(keyword); len(tokens) != 0 {
			t.Fatalf("%q 应无候选词，得到 %v", keyword, tokens)
		}
	}
}

func TestLessonMatchScoreRanksByHit(t *testing.T) {
	tokens := cloudAgentLessonSearchTokens("视频 合并 拼接")
	strong := model.AgentLesson{Topic: "video.merge-concat-not-a-feature", Situation: "用户要把多条镜头视频合并成一条成片"}
	weak := model.AgentLesson{Topic: "video.model-duration", Situation: "选一个全批都能出片的模型"}
	unrelated := model.AgentLesson{Topic: "canvas.snapshot-hash", Situation: "快照过期"}
	if cloudAgentLessonMatchScore(strong, tokens) <= cloudAgentLessonMatchScore(weak, tokens) {
		t.Fatal("命中更多的应当分更高")
	}
	if cloudAgentLessonMatchScore(unrelated, tokens) != 0 {
		t.Fatal("不相干的应当是 0 分")
	}
}

func TestLessonSearchFindsMergeLessonByRealKeyword(t *testing.T) {
	repo := agentLessonTestRepo(t)
	now := time.Now()
	seed := []model.AgentLesson{
		{ID: newID(), Topic: "video.merge-concat-not-a-feature", Category: "video",
			Situation: "用户要求把多条已出好的镜头视频合并成一条成片",
			Lesson:    "分镜脚本节点没有合并视频的动作，合片属于后期剪辑", Status: model.AgentLessonStatusApproved, AuthorUserID: "user-a"},
		{ID: newID(), Topic: "canvas.snapshot-hash", Category: "canvas",
			Situation: "连续写画布时反复报快照过期", Lesson: "每次写成功后用返回的新 snapshotHash",
			Status: model.AgentLessonStatusApproved, AuthorUserID: "user-a"},
		{ID: newID(), Topic: "storyboard.asset-slot-reuse", Category: "storyboard",
			Situation: "分镜行的资产格", Lesson: "只给空缺格生成资产", Status: model.AgentLessonStatusApproved, AuthorUserID: "user-a"},
	}
	for index := range seed {
		seed[index].CreatedAt, seed[index].UpdatedAt, seed[index].LastVerifiedAt = now, now, &now
		if err := repo.Create(&seed[index]); err != nil {
			t.Fatal(err)
		}
	}
	got, err := cloudAgentSearchLessons(repo, "user-a", "分镜 合并 视频 合成 拼接 one take", 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) == 0 {
		t.Fatal("切词后应当能命中")
	}
	if got[0].Topic != "video.merge-concat-not-a-feature" {
		t.Fatalf("讲「合并视频」的那条应当排第一，实际第一是 %q（全部：%+v）", got[0].Topic, topicsOf(got))
	}
}

func TestLessonSearchNoMatchReturnsActionableError(t *testing.T) {
	repo := agentLessonTestRepo(t)
	now := time.Now()
	entry := model.AgentLesson{ID: newID(), Topic: "canvas.snapshot-hash", Category: "canvas",
		Situation: "快照过期", Lesson: "用新哈希", Status: model.AgentLessonStatusApproved,
		AuthorUserID: "user-a", CreatedAt: now, UpdatedAt: now, LastVerifiedAt: &now}
	if err := repo.Create(&entry); err != nil {
		t.Fatal(err)
	}
	_, err := cloudAgentRecallLessons(repo, "user-a", cloudAgentCall{
		Function: struct {
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
		}{Name: "recall_lessons", Arguments: `{"keyword":"完全不存在的词条xyzzy"}`},
	})
	if err == nil {
		t.Fatal("搜不到应当报错")
	}
	if !strings.Contains(err.Error(), "列索引") {
		t.Fatalf("报错要给出下一步，实际：%v", err)
	}
}

func topicsOf(lessons []model.AgentLesson) []string {
	out := make([]string, 0, len(lessons))
	for _, lesson := range lessons {
		out = append(out, lesson.Topic)
	}
	return out
}

func TestLessonsBlockDoesNotAutoInject(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	now := time.Now()
	matched := model.AgentLesson{
		ID: newID(), Topic: "canvas.snapshot-hash", Category: "canvas",
		Situation: "写画布时报快照过期", Lesson: "用返回的新 snapshotHash",
		StepsJSON: `[{"tool":"canvas_apply_ops","action":"写画布"}]`,
		Status:    model.AgentLessonStatusApproved, AuthorUserID: "user-a",
	}
	matched.CreatedAt, matched.UpdatedAt, matched.LastVerifiedAt = now, now, &now
	if err := s.repo.Create(&matched); err != nil {
		t.Fatal(err)
	}

	block := s.cloudAgentLessonsBlock("user-a", "把资产挂上，正在调用 canvas_apply_ops")
	if !strings.Contains(block, "canvas.snapshot-hash") {
		t.Fatalf("相关记忆应出现在索引里：%s", block)
	}
	if strings.Contains(block, "用返回的新 snapshotHash") {
		t.Fatalf("相关记忆也不该自动注入做法全文：%s", block)
	}

	got, err := s.repo.AgentLessonForUser("user-a", matched.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Injected != 0 || got.Hits != 0 {
		t.Fatalf("未主动查阅时 injected/hits 都应是 0：injected=%d hits=%d", got.Injected, got.Hits)
	}
}

func TestRememberLessonBlockedInReadOnlyAndWithoutRealWork(t *testing.T) {
	repo := agentLessonTestRepo(t)
	call := rememberLessonCall(`{"topic":"canvas.snapshot-hash","category":"canvas","situation":"写画布时报快照过期","lesson":"用返回的新 snapshotHash"}`)
	readOnly := &cloudAgentRuntime{
		Request: CloudAgentRequest{PermissionMode: "read_only"},
		Events:  []CloudAgentEvent{{Type: "tool_completed", Payload: map[string]any{"toolName": "canvas_apply_ops"}}},
	}
	if _, err := cloudAgentRememberLesson(repo, "user", readOnly, call); err == nil || !strings.Contains(err.Error(), "只读模式") {
		t.Fatalf("只读模式必须拒绝写入：%v", err)
	}
	if cloudAgentToolAllowed(agentTestRequest(), "remember_lesson") {
		t.Fatal("只读工具清单不该出现 remember_lesson")
	}
	if !cloudAgentToolAllowed(agentTestRequest(), "recall_lessons") {
		t.Fatal("只读模式仍应能查阅已批准经验")
	}

	idle := &cloudAgentRuntime{
		Request: CloudAgentRequest{PermissionMode: "auto"},
		Events:  []CloudAgentEvent{{Type: "tool_completed", Payload: map[string]any{"toolName": "skills_load"}}},
	}
	if _, err := cloudAgentRememberLesson(repo, "user", idle, call); err == nil || !strings.Contains(err.Error(), "没有可沉淀") {
		t.Fatalf("仅 skills_load 不能打开写入闸：%v", err)
	}
}

func TestRememberLessonCapsWritesPerRun(t *testing.T) {
	repo := agentLessonTestRepo(t)
	events := []CloudAgentEvent{{Type: "tool_completed", Payload: map[string]any{"toolName": "canvas_apply_ops"}}}
	for i := 0; i < cloudAgentRememberLessonMaxPerRun; i++ {
		events = append(events, CloudAgentEvent{Type: "tool_completed", Payload: map[string]any{"toolName": "remember_lesson"}})
	}
	state := &cloudAgentRuntime{Request: CloudAgentRequest{PermissionMode: "auto"}, Events: events}
	_, err := cloudAgentRememberLesson(repo, "user", state, rememberLessonCall(`{"topic":"canvas.snapshot-hash","category":"canvas","situation":"写画布时报快照过期","lesson":"用返回的新 snapshotHash"}`))
	if err == nil || !strings.Contains(err.Error(), "最多记录") {
		t.Fatalf("超出本轮条数上限应拒绝：%v", err)
	}
}

func TestAttachLessonsDoesNotAppendUserNudge(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	canonical := canonicalAgentRequest{
		SystemPrompt: "system",
		Messages:     []map[string]any{{"role": "user", "content": "帮我做分镜"}},
	}
	s.attachCloudAgentLessons(&canonical, "user-a", "帮我做分镜")
	if len(canonical.Messages) != 1 || stringField(canonical.Messages[0], "role") != "user" {
		t.Fatalf("经验库不得再塞一条假用户催办：%+v", canonical.Messages)
	}
	if !strings.Contains(canonical.SystemPrompt, cloudAgentLessonBlockMarker) {
		t.Fatalf("记忆入口应只出现在系统提示：%s", canonical.SystemPrompt)
	}
	if strings.Contains(canonical.SystemPrompt, "；做法：") {
		t.Fatalf("系统提示不得带记忆全文：%s", canonical.SystemPrompt)
	}
	if stripped := stripCloudAgentLessonBlock(canonical.SystemPrompt); stripped != "system" {
		t.Fatalf("剥离后应回到原系统提示，got %q", stripped)
	}
	frozen := canonical.SystemPrompt
	s.attachCloudAgentLessons(&canonical, "user-a", "完全不同的后续任务 canvas_apply_ops")
	if canonical.SystemPrompt != frozen {
		t.Fatalf("同轮不得重算记忆块，否则会打爆前缀缓存：%s", canonical.SystemPrompt)
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
		t.Fatalf("本人批准后应可召回：%+v（%v）", got, err)
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
