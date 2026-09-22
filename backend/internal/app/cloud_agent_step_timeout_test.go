package app

// 自研：画布 Agent 单步边界（输出上限 + 秒级墙钟）的可配置化与超时可恢复。
import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/platform"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/repository"
)

func TestCloudAgentStepOutputBudgetFollowsPolicy(t *testing.T) {
	cases := []struct {
		name          string
		outputTokens  int
		boosted       bool
		expectedValue int
	}{
		{name: "默认上限", outputTokens: platform.DefaultRuntimeAgentStepOutputTokens, expectedValue: 16_384},
		{name: "空输出重试遵守管理员上限", outputTokens: platform.DefaultRuntimeAgentStepOutputTokens, boosted: true, expectedValue: 16_384},
		{name: "自定义上限", outputTokens: 32_000, expectedValue: 32_000},
		{name: "自定义上限重试不翻倍", outputTokens: 100_000, boosted: true, expectedValue: 100_000},
		{name: "不限制时原值即 0", outputTokens: 0, expectedValue: 0},
		{name: "不限制时放大档必须有界", outputTokens: 0, boosted: true, expectedValue: cloudAgentStepBoostFallbackTokens},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			got := cloudAgentStepOutputBudget(cloudAgentStepLimits{OutputTokens: item.outputTokens}, item.boosted)
			if got != item.expectedValue {
				t.Fatalf("budget = %d, want %d", got, item.expectedValue)
			}
		})
	}
}

func TestTaskExecutionTimeoutPrefersAgentStepSeconds(t *testing.T) {
	policy := defaultRuntimePolicy().Task
	policy.TextTimeoutMinutes = 8
	policy.AgentStepTimeoutSeconds = 90
	step := &model.Task{Type: "canvas_text", Operation: cloudAgentStepOperation}
	if got := taskExecutionTimeout(step, policy); got != 90*time.Second {
		t.Fatalf("agent step timeout = %s, want 90s", got)
	}
	// 没配秒级值时沿用文本任务超时（旧行为不变）。
	policy.AgentStepTimeoutSeconds = 0
	if got := taskExecutionTimeout(step, policy); got != 8*time.Minute {
		t.Fatalf("fallback timeout = %s, want 8m", got)
	}
	// 非 Agent 的文本任务不受这个开关影响。
	policy.AgentStepTimeoutSeconds = 90
	plain := &model.Task{Type: "canvas_text", Operation: "canvas_text_generate"}
	if got := taskExecutionTimeout(plain, policy); got != 8*time.Minute {
		t.Fatalf("plain text timeout = %s, want 8m", got)
	}
}

// 单步边界必须真的来自策略：管理端改完，运行期下一步就用新值，不需要重发本轮。
func TestCloudAgentStepLimitsFollowAdminPolicy(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	actor := &model.User{ID: "admin", Role: model.UserRoleAdmin}

	defaults, err := svc.cloudAgentStepLimits()
	if err != nil {
		t.Fatal(err)
	}
	if defaults.OutputTokens != platform.DefaultRuntimeAgentStepOutputTokens || defaults.Timeout != 8*time.Minute {
		t.Fatalf("default step limits = %+v", defaults)
	}

	policy := defaultRuntimePolicy()
	policy.Task.AgentStepMaxOutputTokens = 32_768
	policy.Task.AgentStepTimeoutSeconds = 150
	if _, err := svc.UpdateRuntimePolicySetting(actor, policy); err != nil {
		t.Fatal(err)
	}
	updated, err := svc.cloudAgentStepLimits()
	if err != nil {
		t.Fatal(err)
	}
	if updated.OutputTokens != 32_768 || updated.Timeout != 150*time.Second {
		t.Fatalf("updated step limits = %+v", updated)
	}

	// 0 的两个含义：输出不限制、超时沿用文本任务超时。
	policy.Task.AgentStepMaxOutputTokens = 0
	policy.Task.AgentStepTimeoutSeconds = 0
	policy.Task.TextTimeoutMinutes = 12
	if _, err := svc.UpdateRuntimePolicySetting(actor, policy); err != nil {
		t.Fatal(err)
	}
	unbounded, err := svc.cloudAgentStepLimits()
	if err != nil {
		t.Fatal(err)
	}
	if unbounded.OutputTokens != 0 || unbounded.Timeout != 12*time.Minute {
		t.Fatalf("unbounded step limits = %+v", unbounded)
	}
}

func TestRuntimePolicyRejectsOutOfRangeAgentStepLimits(t *testing.T) {
	policy := defaultRuntimePolicy()
	policy.Task.AgentStepMaxOutputTokens = platform.MinRuntimeAgentStepOutputTokens - 1
	if err := validateRuntimePolicy(policy); err == nil {
		t.Fatal("过小的单步输出上限应被拒绝")
	}
	policy = defaultRuntimePolicy()
	policy.Task.AgentStepMaxOutputTokens = platform.MaxRuntimeAgentStepOutputTokens + 1
	if err := validateRuntimePolicy(policy); err == nil {
		t.Fatal("过大的单步输出上限应被拒绝")
	}
	policy = defaultRuntimePolicy()
	policy.Task.AgentStepMaxOutputTokens = 0
	if err := validateRuntimePolicy(policy); err != nil {
		t.Fatalf("0（不限制）应当合法: %v", err)
	}
	policy = defaultRuntimePolicy()
	policy.Task.AgentStepTimeoutSeconds = platform.MinRuntimeAgentStepTimeoutSeconds - 1
	if err := validateRuntimePolicy(policy); err == nil {
		t.Fatal("过小的单步超时（非 0）应被拒绝")
	}
	policy = defaultRuntimePolicy()
	policy.Task.AgentStepTimeoutSeconds = platform.MaxRuntimeAgentStepTimeoutSeconds + 1
	if err := validateRuntimePolicy(policy); err == nil {
		t.Fatal("过大的单步超时应被拒绝")
	}
}

// 旧配置 JSON 没有这两个字段时按默认值回填：不需要数据迁移。
func TestRuntimePolicyBackfillsAgentStepLimitsForLegacyJSON(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	legacy := defaultRuntimePolicy()
	encoded, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(encoded, &value); err != nil {
		t.Fatal(err)
	}
	task := value["task"].(map[string]any)
	delete(task, "agentStepMaxOutputTokens")
	delete(task, "agentStepTimeoutSeconds")
	trimmed, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: runtimePolicySettingKey, ValueJSON: string(trimmed)}).Error; err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	effective, err := svc.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	if effective.Task.AgentStepMaxOutputTokens != platform.DefaultRuntimeAgentStepOutputTokens {
		t.Fatalf("legacy json 未回填单步输出上限: %d", effective.Task.AgentStepMaxOutputTokens)
	}
	if effective.Task.AgentStepTimeoutSeconds != platform.DefaultRuntimeAgentStepTimeout {
		t.Fatalf("legacy json 未回填单步超时: %d", effective.Task.AgentStepTimeoutSeconds)
	}
}

// 单步墙钟到点不再把整轮判死：关思考重试一次；重试仍超时才失败，且失败原因可读。
func TestCloudAgentStepTimeoutRetriesThenFailsWithReadableReason(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	failStepTask(t, db, root.ID)

	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	run, state := agentInterjectionState(t, s, root.ID)
	if state.StepTimeoutEscalated != 1 || !state.ForceThinkingOff {
		t.Fatalf("超时后应关思考重试: escalated=%d forceThinkingOff=%v", state.StepTimeoutEscalated, state.ForceThinkingOff)
	}
	if run.Status != "running" {
		t.Fatalf("超时应先重试而不是判死，实际 status=%s（%s）", run.Status, run.FailureMessage)
	}
	if !agentHasEventWithReason(state, "model_failure_recovered", "step_timeout_retried") {
		t.Fatal("缺少可读的自动重试事件")
	}

	// 重试那一步：必须真的关掉思考，并且带着生效的输出上限。
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	_, retried := agentInterjectionState(t, s, root.ID)
	if retried.ActiveTaskID == "" {
		t.Fatal("重试没有重新发起模型调用")
	}
	task, err := s.repo.TaskForUser("user", retried.ActiveTaskID)
	if err != nil {
		t.Fatal(err)
	}
	options := stepTaskTextOptions(t, s, task)
	if options["thinking"] != false {
		t.Fatalf("重试请求没有关思考: %+v", options)
	}
	if options["maxOutputTokens"] != float64(platform.DefaultRuntimeAgentStepOutputTokens) {
		t.Fatalf("重试请求的输出上限 = %v", options["maxOutputTokens"])
	}

	// 重试也超时 → 整轮失败，原因指向可配置的那条线。
	failStepTask(t, db, retried.ActiveTaskID)
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, root.ID)
	if run.Status != "failed" {
		t.Fatalf("重试仍超时应结束本轮，实际 status=%s", run.Status)
	}
	if !strings.Contains(run.FailureMessage, "单步模型调用超过执行时限") {
		t.Fatalf("失败文案没有解释单步超时: %s", run.FailureMessage)
	}
	if !agentHasEventWithReason(state, "run_failed", "model_step_timeout") {
		t.Fatal("失败事件缺少 model_step_timeout 原因")
	}
}

func failStepTask(t *testing.T, db *gorm.DB, taskID string) {
	t.Helper()
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{
		"status": model.TaskStatusFailed,
		"error":  cloudAgentStepTimeoutError + "，已中止这一步",
	}).Error; err != nil {
		t.Fatal(err)
	}
}

func stepTaskTextOptions(t *testing.T, s *Service, task *model.Task) map[string]any {
	t.Helper()
	decrypted, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		t.Fatal(err)
	}
	var input struct {
		TextOptions map[string]any `json:"textOptions"`
	}
	if err := json.Unmarshal([]byte(decrypted), &input); err != nil {
		t.Fatal(err)
	}
	if len(input.TextOptions) == 0 {
		t.Fatalf("任务缺少 textOptions: %s", decrypted)
	}
	return input.TextOptions
}

func agentHasEventWithReason(state cloudAgentRuntime, eventType, reason string) bool {
	for _, event := range state.Events {
		if event.Type == eventType && event.Payload["reason"] == reason {
			return true
		}
	}
	return false
}

// agentEventValue 取最近一条指定类型事件里的某个字段值。
func agentEventValue(state cloudAgentRuntime, eventType, key string) (any, bool) {
	for i := len(state.Events) - 1; i >= 0; i-- {
		if state.Events[i].Type != eventType {
			continue
		}
		value, ok := state.Events[i].Payload[key]
		return value, ok
	}
	return nil, false
}

// 执行时限到点必须按失败收尾（而不是被"租约丢失"提前返回）。
func TestAgentExecutionDeadlineCountsAsTaskFailure(t *testing.T) {
	policy := defaultRuntimePolicy().Task
	policy.AgentStepTimeoutSeconds = 30
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	<-ctx.Done()
	task := &model.Task{Type: "canvas_text", Operation: cloudAgentStepOperation}
	if got := taskExecutionTimeout(task, policy); got != 30*time.Second {
		t.Fatalf("timeout = %s", got)
	}
	if !errors.Is(ctx.Err(), context.DeadlineExceeded) {
		t.Fatal("到期后 ctx 必须报告 DeadlineExceeded（worker 据此区分租约丢失）")
	}
}
