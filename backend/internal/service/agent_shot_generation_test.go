package service

import (
	"fmt"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

/* ------------------------------------------------------------------ *
 * D-057B：Server Executor 语义护栏
 *
 * 这些测试的真正目的不是"覆盖代码"，而是把 D-056 的硬要求变成可执行断言：
 * **Browser 通道与 Server 通道必须同源同语义**。下面每一条期望值都来自
 * web/src/services/api/shot-generate.ts 与 web/src/lib/model-selection.ts
 * 的逐行翻译，改动任一侧都必须同步改这里，否则 CI 会拦下漂移。
 * ------------------------------------------------------------------ */

func newAgentShotTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:agent-shot-test-%d?mode=memory&cache=shared", time.Now().UnixNano())), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ModelChannel{}, &model.ChannelModel{}, &model.Project{}, &model.Shot{}, &model.ShotRevision{}); err != nil {
		t.Fatal(err)
	}
	return New(repository.New(db), t.TempDir()), db
}

// 1. 时长钳制：与浏览器 clampSeconds + generateShot 的调用方式逐条对齐。
func TestClampAgentShotSecondsMatchesBrowser(t *testing.T) {
	cases := []struct {
		name        string
		requested   *int
		durationMs  int64
		maxSeconds  int
		wantSeconds int
	}{
		// 显式值：无效（≤0）时回落 min(5, 上限)
		{name: "explicit zero falls back", requested: intPtr(0), durationMs: 0, maxSeconds: 15, wantSeconds: 5},
		{name: "explicit negative falls back", requested: intPtr(-3), durationMs: 8000, maxSeconds: 15, wantSeconds: 5},
		{name: "fallback capped by model limit", requested: intPtr(0), durationMs: 0, maxSeconds: 2, wantSeconds: 2},
		// 显式值：有效时取 [1, 上限] 内的整数
		{name: "explicit within limit", requested: intPtr(6), durationMs: 0, maxSeconds: 15, wantSeconds: 6},
		{name: "explicit above limit clamped", requested: intPtr(20), durationMs: 0, maxSeconds: 15, wantSeconds: 15},
		{name: "explicit below one clamped", requested: intPtr(1), durationMs: 0, maxSeconds: 15, wantSeconds: 1},
		// 未传值：用镜头时长（毫秒→秒，四舍五入），再钳进 [1, 上限]
		{name: "duration 3000ms", requested: nil, durationMs: 3000, maxSeconds: 15, wantSeconds: 3},
		{name: "duration 2500ms rounds half up", requested: nil, durationMs: 2500, maxSeconds: 15, wantSeconds: 3},
		{name: "duration 1499ms rounds down", requested: nil, durationMs: 1499, maxSeconds: 15, wantSeconds: 1},
		{name: "duration 8000ms above limit", requested: nil, durationMs: 8000, maxSeconds: 5, wantSeconds: 5},
		// 回归：0<durationMs<500 时浏览器经 Math.max(1, ...) 取 1s，不是 5s
		{name: "sub-second duration is one second", requested: nil, durationMs: 499, maxSeconds: 15, wantSeconds: 1},
		{name: "one millisecond duration is one second", requested: nil, durationMs: 1, maxSeconds: 15, wantSeconds: 1},
		// 无时长信息：默认 5s（受上限约束）
		{name: "no duration uses default", requested: nil, durationMs: 0, maxSeconds: 15, wantSeconds: 5},
		{name: "no duration capped by limit", requested: nil, durationMs: 0, maxSeconds: 3, wantSeconds: 3},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			got := clampAgentShotSeconds(item.requested, item.durationMs, item.maxSeconds)
			if got != item.wantSeconds {
				t.Fatalf("时长钳制与浏览器不一致：got=%d want=%d", got, item.wantSeconds)
			}
		})
	}
}

// 2. operation 推导：与 web/src/lib/model-selection.ts 的 inferVideoOperation 对齐。
func TestInferAgentVideoOperationMatchesBrowser(t *testing.T) {
	cases := []struct {
		imageCount int
		want       string
	}{
		{imageCount: 0, want: "text_to_video"},
		{imageCount: 1, want: "image_to_video"},
		{imageCount: 2, want: "image_to_video"},
		{imageCount: 3, want: "reference_to_video"},
		{imageCount: 4, want: "reference_to_video"},
	}
	for _, item := range cases {
		if got := inferAgentVideoOperation(item.imageCount); got != item.want {
			t.Fatalf("imageCount=%d 推导不一致：got=%s want=%s", item.imageCount, got, item.want)
		}
	}
}

// 3. 模型时长上限：与 shot-generate.ts 的 H3_MODEL_SECOND_LIMITS 对齐。
func TestAgentShotMaxSecondsForModel(t *testing.T) {
	cases := []struct {
		model string
		want  int
	}{
		{model: "minimax_h3_lightx2v_v5_15s", want: 15},
		{model: "minimax_h3_lightx2v_no_pic", want: 15},
		{model: "minimax_h3_lightx2v_v5", want: 10},
		{model: "minimax_h3_unknown_variant", want: agentShotFallbackMaxSec},
	}
	for _, item := range cases {
		if got := agentShotMaxSecondsForModel(item.model); got != item.want {
			t.Fatalf("model=%s 上限不一致：got=%d want=%d", item.model, got, item.want)
		}
	}
}

// 4. H3 模型发现：无参考图优先 no_pic，有参考图优先 v5_15s；非 H3 模型不入选。
func TestDiscoverH3VideoModelPrefersExpectedVariant(t *testing.T) {
	svc, db := newAgentShotTestService(t)
	seedH3Channel(t, db, "CH_A", []string{"minimax_h3_lightx2v_v5", "minimax_h3_lightx2v_no_pic", "minimax_h3_lightx2v_v5_15s", "other_model"})

	withoutRef, err := svc.discoverH3VideoModel(false)
	if err != nil {
		t.Fatal(err)
	}
	if withoutRef.Model != "minimax_h3_lightx2v_no_pic" {
		t.Fatalf("无参考图应优先 no_pic，实际 %s", withoutRef.Model)
	}
	withRef, err := svc.discoverH3VideoModel(true)
	if err != nil {
		t.Fatal(err)
	}
	if withRef.Model != "minimax_h3_lightx2v_v5_15s" {
		t.Fatalf("带参考图应优先 v5_15s，实际 %s", withRef.Model)
	}
	if withRef.ChannelID != "CH_A" {
		t.Fatalf("渠道 id 应为 CH_A，实际 %s", withRef.ChannelID)
	}
}

// 5. 停用的渠道/模型不得被选中（避免 Server 通道挑到浏览器里也看不到的模型）。
func TestDiscoverH3VideoModelSkipsDisabled(t *testing.T) {
	svc, db := newAgentShotTestService(t)
	db.Create(&model.ModelChannel{ID: "CH_OFF", Scope: model.ChannelScopeSystem, Enabled: false, Name: "off"})
	seedH3Channel(t, db, "CH_ON", []string{"minimax_h3_lightx2v_no_pic"})
	db.Create(&model.ChannelModel{ID: "M_OFF", ChannelID: "CH_ON", ModelKey: "minimax_h3_lightx2v_v5_15s", Enabled: false, Capability: "video"})

	got, err := svc.discoverH3VideoModel(true)
	if err != nil {
		t.Fatal(err)
	}
	if got.ChannelID != "CH_ON" || got.Model != "minimax_h3_lightx2v_no_pic" {
		t.Fatalf("停用的渠道/模型被选中了：%+v", got)
	}
}

// 6. 参数护栏：projectId / shotId 必填，镜头必须属于该项目。
func TestAgentGenerateShotValidatesOwnership(t *testing.T) {
	svc, db := newAgentShotTestService(t)
	seedH3Channel(t, db, "CH_A", []string{"minimax_h3_lightx2v_no_pic"})
	db.Create(&model.Shot{ID: "SHOT_1", ProjectID: "PROJ_1", Title: "镜头一", DurationMs: 3000})

	if _, err := svc.AgentGenerateShot("user-1", "", AgentShotGenerateRequest{ShotID: "SHOT_1"}); err == nil {
		t.Fatal("空 projectId 应报错")
	}
	if _, err := svc.AgentGenerateShot("user-1", "PROJ_1", AgentShotGenerateRequest{ShotID: ""}); err == nil {
		t.Fatal("空 shotId 应报错")
	}
	if _, err := svc.AgentGenerateShot("user-1", "PROJ_OTHER", AgentShotGenerateRequest{ShotID: "SHOT_1"}); err == nil {
		t.Fatal("镜头不属于该项目时应报错")
	}
	// 镜头存在但没有 videoPrompt → 必须给出可行动的错误，而不是建一个空任务去烧钱。
	if _, err := svc.AgentGenerateShot("user-1", "PROJ_1", AgentShotGenerateRequest{ShotID: "SHOT_1"}); err == nil {
		t.Fatal("缺少 videoPrompt 时应报错")
	}
}

// 7. 提示词取最新修订版（按 version 倒序），且时长回退到镜头计划时长。
func TestLatestShotVideoPromptUsesHighestVersion(t *testing.T) {
	svc, db := newAgentShotTestService(t)
	db.Create(&model.Shot{ID: "SHOT_1", ProjectID: "PROJ_1", Title: "镜头一", DurationMs: 4000})
	db.Create(&model.ShotRevision{ID: "REV_1", ShotID: "SHOT_1", Version: 1, VideoPrompt: "旧提示词", DurationMs: 0})
	db.Create(&model.ShotRevision{ID: "REV_2", ShotID: "SHOT_1", Version: 3, VideoPrompt: "新提示词", DurationMs: 0})
	db.Create(&model.ShotRevision{ID: "REV_3", ShotID: "SHOT_1", Version: 2, VideoPrompt: "中间提示词", DurationMs: 0})

	shot, err := svc.repo.ShotForProject("PROJ_1", "SHOT_1")
	if err != nil || shot == nil {
		t.Fatalf("读取镜头失败：%v", err)
	}
	prompt, durationMs, err := svc.latestShotVideoPrompt("PROJ_1", "SHOT_1", shot)
	if err != nil {
		t.Fatal(err)
	}
	if prompt != "新提示词" {
		t.Fatalf("应取 version 最大的修订版，实际 %q", prompt)
	}
	// 修订版未写时长时回退镜头计划时长（与浏览器 latest?.durationMs || shot.durationMs 一致）。
	if durationMs != 4000 {
		t.Fatalf("时长应回退为镜头计划时长 4000，实际 %d", durationMs)
	}
}

// 8. 参考图数量上限（浏览器 schema 为 max(4)，服务端必须同样拦截）。
func TestAgentGenerateShotRejectsTooManyReferences(t *testing.T) {
	svc, db := newAgentShotTestService(t)
	seedH3Channel(t, db, "CH_A", []string{"minimax_h3_lightx2v_v5_15s"})
	db.Create(&model.Shot{ID: "SHOT_1", ProjectID: "PROJ_1", Title: "镜头一", DurationMs: 3000})
	db.Create(&model.ShotRevision{ID: "REV_1", ShotID: "SHOT_1", Version: 1, VideoPrompt: "提示词", DurationMs: 3000})

	_, err := svc.AgentGenerateShot("user-1", "PROJ_1", AgentShotGenerateRequest{
		ShotID:             "SHOT_1",
		ReferenceImageURLs: []string{"https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg", "https://a/4.jpg", "https://a/5.jpg"},
	})
	if err == nil {
		t.Fatal("超过 4 张参考图应被拒绝")
	}
}

func seedH3Channel(t *testing.T, db *gorm.DB, channelID string, models []string) {
	t.Helper()
	now := time.Now().UTC()
	channel := model.ModelChannel{ID: channelID, Scope: model.ChannelScopeSystem, Enabled: true, Name: channelID, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	for index, modelKey := range models {
		item := model.ChannelModel{
			ID:          fmt.Sprintf("M_%s_%d", channelID, index),
			ChannelID:   channelID,
			ModelKey:    modelKey,
			Capability:  "video",
			Enabled:     true,
			DisplayName: modelKey,
			CreatedAt:   now,
			UpdatedAt:   now,
		}
		if err := db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
	}
}
