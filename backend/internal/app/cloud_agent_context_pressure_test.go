package app

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

// 计量用的估算尺子：ASCII 每 4 字节 1 token 向上取整，非 ASCII 每字符 1 token。
func TestEstimateCloudAgentTokensTreatsCJKConservatively(t *testing.T) {
	if got := estimateCloudAgentTokens([]byte("abcd中文")); got != 3 {
		t.Fatalf("estimate = %d, want 3", got)
	}
	if got := estimateCloudAgentTokens([]byte("hello")); got != 2 {
		t.Fatalf("estimate = %d, want 2", got)
	}
	if got := estimateCloudAgentTokens(nil); got != 0 {
		t.Fatalf("empty estimate = %d, want 0", got)
	}
}

// 两把尺子不混画：本地估算描述下一次请求，上游实测量的是上一次请求。
func TestCloudAgentContextPressureSeparatesNextRequestEstimateFromPreviousProviderMeasurement(t *testing.T) {
	pressure := cloudAgentContextPressure{EstimatedInputTokens: 20000, UsableInputTokens: 100000}
	state := &cloudAgentRuntime{TokenAnchor: &cloudAgentTokenAnchor{
		Step: 2, InputTokens: 10500, EstimatedTokens: 19500, Accepted: true,
	}}
	payload := cloudAgentContextPressurePayload(pressure, state)
	if payload["readingScope"] != "next_request" || payload["estimateMethod"] != "local_v1" {
		t.Fatalf("next request scope missing: %+v", payload)
	}
	if payload["providerMeasurementScope"] != "previous_request" {
		t.Fatalf("provider scope = %v", payload["providerMeasurementScope"])
	}
	if payload["estimatedInputTokens"] != 20000 || payload["projectedTokens"] != 11000 {
		t.Fatalf("estimate/projected readings were mixed: %+v", payload)
	}
}

// 快照字段：读数必须带版本、相位、测量来源、窗口与锚点状态，消费方不该靠字段名猜。
func TestCloudAgentContextPressurePayloadCarriesSnapshotFields(t *testing.T) {
	pressure := cloudAgentContextPressure{
		EstimatedInputTokens: 20000, UsableInputTokens: 100000, ContextWindowTokens: 128000,
		ReservedOutputTokens: 16000, OverheadTokens: 5120, InputBudgetTokens: 100000,
		CompactAtTokens: 85000, BudgetSource: "channel-model", ModelLimitConfigured: true, Estimate: true,
	}
	state := &cloudAgentRuntime{
		Step:        6,
		TokenAnchor: &cloudAgentTokenAnchor{TaskID: "task-anchor", Step: 4, InputTokens: 10500, CachedTokens: 2000, OutputTokens: 300, EstimatedTokens: 19500, Accepted: true},
	}
	payload := cloudAgentContextPressurePayload(pressure, state)
	if payload["schemaVersion"] != 2 || payload["phase"] != "before_request" {
		t.Fatalf("snapshot version/phase 缺失：%+v", payload)
	}
	if payload["measurementSource"] != "provider" || payload["normalizedInputTokens"] != int64(10500) || payload["projectedNextInputTokens"] != 11000 {
		t.Fatalf("测量来源与两种量纲没分开：%+v", payload)
	}
	if payload["contextWindowTokens"] != 128000 || payload["usableInputTokens"] != 100000 ||
		payload["reservedOutputTokens"] != 16000 || payload["overheadTokens"] != 5120 ||
		payload["inputBudgetTokens"] != 100000 || payload["compactAtTokens"] != 85000 ||
		payload["budgetSource"] != "channel-model" || payload["modelLimitConfigured"] != true {
		t.Fatalf("窗口口径字段不齐：%+v", payload)
	}
	anchor, ok := payload["anchor"].(map[string]any)
	if !ok || anchor["id"] != "task-anchor" || anchor["valid"] != true || anchor["ageSteps"] != 2 {
		t.Fatalf("anchor 快照不对：%+v", payload["anchor"])
	}
	usage, ok := payload["providerUsage"].(map[string]any)
	if !ok || usage["cacheReadTokens"] != int64(2000) || usage["uncachedInputTokens"] != int64(8500) {
		t.Fatalf("providerUsage 不对：%+v", payload["providerUsage"])
	}
	if payload["tokenSource"] != "provider" || payload["tokenScale"] != 0.5385 {
		t.Fatalf("tokenSource/tokenScale 不对：%+v", payload)
	}
}

// 窗口未配置时不假装有百分比：既不下发窗口字段，也不下发占用率，只留可用的本地估算。
func TestCloudAgentContextPressureWithoutWindowDoesNotFakeRatio(t *testing.T) {
	// 没有 repository：解析不到任何模型声明的窗口。
	service := &Service{}
	canonical := canonicalAgentRequest{
		SystemPrompt: "系统提示",
		Messages:     []map[string]interface{}{{"role": "user", "content": "你好"}},
	}
	pressure := service.cloudAgentContextPressure(canonical, "你好", CloudAgentRequest{})
	if pressure.ModelLimitConfigured || pressure.UsableInputTokens != 0 || pressure.PressureRatio != 0 {
		t.Fatalf("未声明窗口时不该声称配置了模型上限：%+v", pressure)
	}
	payload := cloudAgentContextPressurePayload(pressure, &cloudAgentRuntime{})
	for _, key := range []string{
		"contextWindowTokens", "usableInputTokens", "reservedOutputTokens", "overheadTokens",
		"inputBudgetTokens", "compactAtTokens", "budgetSource", "pressureRatio", "projectedPressureRatio",
	} {
		if _, exists := payload[key]; exists {
			t.Fatalf("窗口未确认时不该下发 %s：%+v", key, payload)
		}
	}
	if payload["modelLimitConfigured"] != false {
		t.Fatalf("modelLimitConfigured = %v", payload["modelLimitConfigured"])
	}
	if payload["tokenSource"] != "estimate" || payload["measurementSource"] != "estimate" {
		t.Fatalf("没有实测时必须如实标注估算：%+v", payload)
	}
	if payload["estimatedInputTokens"] != pressure.EstimatedInputTokens || payload["normalizedInputTokens"] != pressure.EstimatedInputTokens {
		t.Fatalf("估算读数缺失：%+v", payload)
	}
}

// 声明了窗口的渠道模型：窗口/输出预留/overhead/输入预算按同一算式给出，读数才有百分比。
func TestCloudAgentContextPressureReportsWindowBudgetFromChannelCapability(t *testing.T) {
	service, _, _, _ := creationTestService(t)
	canonical := canonicalAgentRequest{
		SystemPrompt: "系统提示",
		Messages:     []map[string]interface{}{{"role": "user", "content": "分析剧情"}},
	}
	pressure := service.cloudAgentContextPressure(canonical, "分析剧情", agentTestRequest())
	if !pressure.ModelLimitConfigured {
		t.Fatalf("渠道模型声明了窗口，读数必须按窗口口径：%+v", pressure)
	}
	if pressure.ContextWindowTokens != defaultCloudAgentContextWindowTokens {
		t.Fatalf("contextWindowTokens = %d", pressure.ContextWindowTokens)
	}
	// overhead = 窗口的 4% 夹在 4096–32768；输入预算 = 窗口 − 输出预留 − overhead。
	wantOverhead := defaultCloudAgentContextWindowTokens / 25
	if pressure.OverheadTokens != wantOverhead {
		t.Fatalf("overheadTokens = %d, want %d", pressure.OverheadTokens, wantOverhead)
	}
	if pressure.InputBudgetTokens != pressure.ContextWindowTokens-defaultCloudAgentMaxOutputTokens-wantOverhead {
		t.Fatalf("inputBudgetTokens = %d", pressure.InputBudgetTokens)
	}
	if pressure.UsableInputTokens != pressure.InputBudgetTokens || pressure.BudgetSource != "channel-model" {
		t.Fatalf("预算来源/可用输入不一致：%+v", pressure)
	}
	payload := cloudAgentContextPressurePayload(pressure, &cloudAgentRuntime{})
	if payload["budgetSource"] != "channel-model" || payload["usableInputTokens"] != pressure.InputBudgetTokens {
		t.Fatalf("载荷缺少窗口口径：%+v", payload)
	}
	if _, exists := payload["pressureRatio"]; !exists {
		t.Fatalf("已确认窗口时必须给出占用率：%+v", payload)
	}
}

// 窗口从未确认变为已确认：要落且只落一条 context_transition。
func TestCloudAgentNoteContextWindowResolvedEmitsOnce(t *testing.T) {
	state := &cloudAgentRuntime{}
	pressure := cloudAgentContextPressure{ModelLimitConfigured: true, ContextWindowTokens: 1000000, UsableInputTokens: 967232, BudgetSource: "channel-model"}
	cloudAgentNoteContextWindowResolved("run-1", state, pressure)
	cloudAgentNoteContextWindowResolved("run-1", state, pressure)
	transitions := 0
	for _, event := range state.Events {
		if event.Type == "context_transition" {
			transitions++
			if event.Payload["kind"] != "window_resolved" {
				t.Fatalf("过渡类型不对：%+v", event.Payload)
			}
		}
	}
	if transitions != 1 {
		t.Fatalf("context_transition 条数 = %d，期望 1", transitions)
	}
	if !state.ContextWindowKnown {
		t.Fatal("窗口识别标记没落下")
	}
}

// 第一步没有实测：读数是估算；上一步的 provider 用量到达后，第二步改用实测锚点，
// 并给出 tokenScale 与投影（锚点 + 本地有符号增量）。
func TestCloudAgentContextPressureUsesEstimateOnFirstStepThenProviderAnchor(t *testing.T) {
	service, db, _, _ := creationTestService(t)
	request := agentTestRequest()
	budget := service.cloudAgentContextBudgetForRequest(request)
	if !budget.Configured {
		t.Fatal("测试夹具的渠道模型应当声明了窗口")
	}
	state := &cloudAgentRuntime{Request: request, Step: 1, Canonical: canonicalAgentRequest{SystemPrompt: "系统提示"}}

	// 第一步：还没有任何上游实测，只能如实标注估算。
	first := cloudAgentContextPressurePayload(cloudAgentContextPressure{EstimatedInputTokens: 20000, ModelLimitConfigured: true, UsableInputTokens: budget.InputBudgetTokens}, state)
	if first["tokenSource"] != "estimate" || first["measurementSource"] != "estimate" {
		t.Fatalf("第一步必须标估算：%+v", first)
	}
	if _, exists := first["tokenScale"]; exists {
		t.Fatalf("没有锚点就不该有 tokenScale：%+v", first)
	}

	// 上一步的模型调用回来了，上游上报了用量（qwen 系实测过本地估算偏高 ~18%）。
	if err := db.Create(&model.ApiCallLog{
		ID: "log-step-1", UserID: "user", TaskID: "task-step-1", Capability: "text", Model: "text-test",
		Status: model.ApiCallStatusSucceeded, InputTokens: 10500, CachedTokens: 2000, OutputTokens: 300, UsageAvailable: true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	state.Step = 2
	state.LastStepTaskID = "task-step-1"
	state.LastStepOperation = cloudAgentStepOperation
	state.LastStepEstimate = 20000
	state.LastStepSourceBytes = 40000
	state.LastStepSignature = cloudAgentStepSignature(state)
	service.recordCloudAgentTokenAnchor("user", state)
	if state.TokenAnchor == nil || !state.TokenAnchor.Accepted {
		t.Fatalf("合理的上游用量必须被采信：%+v", state.TokenAnchor)
	}

	// 第二步：主读数换成"锚点实测 + 本地增量"，并带上换算比例。
	second := cloudAgentContextPressurePayload(cloudAgentContextPressure{EstimatedInputTokens: 22000, ModelLimitConfigured: true, UsableInputTokens: budget.InputBudgetTokens}, state)
	if second["tokenSource"] != "provider" || second["measurementSource"] != "provider" {
		t.Fatalf("拿到实测后主读数必须换成 provider：%+v", second)
	}
	if second["pressureTokens"] != int64(10500) || second["normalizedInputTokens"] != int64(10500) {
		t.Fatalf("锚点实测值不对：%+v", second)
	}
	if second["projectedNextInputTokens"] != 12500 || second["projectedTokens"] != 12500 {
		t.Fatalf("投影应为 10500 + (22000-20000)：%+v", second)
	}
	if second["tokenScale"] != 0.525 || second["anchorDeltaTokens"] != 2000 {
		t.Fatalf("换算比例/增量不对：%+v", second)
	}
	if second["estimatedInputTokens"] != 22000 {
		t.Fatalf("本地估算不能被实测覆盖：%+v", second)
	}
}

// 锚点跨步沿用，但超过 3 步未刷新就作废（真机踩过"锚点冻结"）。
func TestCloudAgentTokenAnchorSurvivesWithinMaxAgeAndExpiresAfterwards(t *testing.T) {
	state := &cloudAgentRuntime{Request: agentTestRequest(), Step: 2, TokenAnchor: &cloudAgentTokenAnchor{TaskID: "task-1", Step: 2, Accepted: true, InputTokens: 10500, EstimatedTokens: 20000}}
	state.TokenAnchor.Signature = cloudAgentStepSignature(state)

	state.Step = 2 + cloudAgentAnchorMaxAgeSteps
	cloudAgentExpireTokenAnchor("run-1", state, 0)
	if !state.TokenAnchor.Accepted || state.TokenAnchor.RejectReason != "" {
		t.Fatalf("第 %d 步仍在有效期内，不该作废：%+v", cloudAgentAnchorMaxAgeSteps, state.TokenAnchor)
	}
	pressure := cloudAgentContextPressurePayload(cloudAgentContextPressure{EstimatedInputTokens: 20000}, state)
	if pressure["tokenSource"] != "provider" {
		t.Fatalf("沿用中的锚点必须继续当主读数：%+v", pressure)
	}
	anchor, ok := pressure["anchor"].(map[string]any)
	if !ok || anchor["valid"] != true || anchor["ageSteps"] != cloudAgentAnchorMaxAgeSteps {
		t.Fatalf("anchor 快照不对：%+v", pressure["anchor"])
	}

	state.Step++
	cloudAgentExpireTokenAnchor("run-1", state, 0)
	if state.TokenAnchor.Accepted || !strings.Contains(state.TokenAnchor.RejectReason, "未刷新") {
		t.Fatalf("超期锚点必须作废：%+v", state.TokenAnchor)
	}
	pressure = cloudAgentContextPressurePayload(cloudAgentContextPressure{EstimatedInputTokens: 20000}, state)
	if pressure["tokenSource"] != "estimate" || pressure["anchorRejected"] == nil {
		t.Fatalf("作废后必须退回估算并给出原因：%+v", pressure)
	}
}

// 窗口变化后锚点作废：同一个 token 数在 8K 窗口和 256K 窗口下的含义完全不同。
func TestCloudAgentTokenAnchorExpiresWhenWindowChanges(t *testing.T) {
	state := &cloudAgentRuntime{
		Request: agentTestRequest(), Step: 4,
		TokenAnchor: &cloudAgentTokenAnchor{TaskID: "task-1", Step: 1, Accepted: true, InputTokens: 10500, EstimatedTokens: 20000, ContextWindowTokens: 128000},
	}
	state.TokenAnchor.Signature = cloudAgentStepSignature(state)
	cloudAgentExpireTokenAnchor("run-1", state, 256000)
	if state.TokenAnchor.Accepted || !strings.Contains(state.TokenAnchor.RejectReason, "窗口已变化") {
		t.Fatalf("换窗口后锚点必须作废：%+v", state.TokenAnchor)
	}
	transitions := 0
	for _, event := range state.Events {
		if event.Type == "context_transition" && event.Payload["kind"] == "window_changed" {
			transitions++
			before, _ := event.Payload["before"].(map[string]any)
			after, _ := event.Payload["after"].(map[string]any)
			if before["contextWindowTokens"] != 128000 || after["contextWindowTokens"] != 256000 {
				t.Fatalf("窗口过渡事件缺少前后值：%+v", event.Payload)
			}
		}
	}
	if transitions != 1 {
		t.Fatalf("窗口变化应落一条 context_transition(window_changed)，实际 %d", transitions)
	}
	// 窗口未知（未解析到真实能力）时不比较，也不该据此作废。
	unknown := &cloudAgentRuntime{
		Request: agentTestRequest(), Step: 2,
		TokenAnchor: &cloudAgentTokenAnchor{TaskID: "task-2", Step: 1, Accepted: true, InputTokens: 10500, EstimatedTokens: 20000, ContextWindowTokens: 128000},
	}
	unknown.TokenAnchor.Signature = cloudAgentStepSignature(unknown)
	cloudAgentExpireTokenAnchor("run-1", unknown, 0)
	if !unknown.TokenAnchor.Accepted {
		t.Fatal("窗口未知时不该作废锚点")
	}
}

func TestCloudAgentTokenAnchorExpiresOnlyWhenRequestSignatureChanges(t *testing.T) {
	for _, testCase := range []struct {
		name, model, channelID, system, kind string
		changeTools                          bool
	}{
		{name: "model", model: "other-model", channelID: "channel", system: "policy", kind: "model_changed"},
		{name: "route", model: "text-test", channelID: "other-channel", system: "policy", kind: "route_changed"},
		{name: "system", model: "text-test", channelID: "channel", system: "new policy"},
		{name: "tools", model: "text-test", channelID: "channel", system: "policy", changeTools: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			canonical := canonicalAgentRequest{SystemPrompt: "policy", Tools: []map[string]interface{}{{"name": "a"}}}
			state := &cloudAgentRuntime{Request: agentTestRequest(), Step: 2}
			signature := cloudAgentRequestSignature(state, canonical, "channel", "text-test")
			state.TokenAnchor = &cloudAgentTokenAnchor{
				TaskID: "task", Step: 1, Accepted: true, InputTokens: 10000, EstimatedTokens: 18000,
				Signature: signature, Model: "text-test", ChannelID: "channel",
			}
			canonical.Messages = []map[string]interface{}{{"role": "user", "content": "changed message"}}
			cloudAgentExpireTokenAnchorForRequest("run", state, 0, cloudAgentRequestSignature(state, canonical, "channel", "text-test"), "text-test", "channel")
			if !state.TokenAnchor.Accepted {
				t.Fatal("messages alone must not invalidate the tokenizer anchor")
			}
			canonical.SystemPrompt = testCase.system
			if testCase.changeTools {
				canonical.Tools = []map[string]interface{}{{"name": "b"}}
			}
			cloudAgentExpireTokenAnchorForRequest("run", state, 0, cloudAgentRequestSignature(state, canonical, testCase.channelID, testCase.model), testCase.model, testCase.channelID)
			if state.TokenAnchor.Accepted || state.TokenAnchor.RejectReason == "" {
				t.Fatalf("signature changed without invalidation: %+v", state.TokenAnchor)
			}
			if testCase.kind != "" && (len(state.Events) != 1 || state.Events[0].Payload["kind"] != testCase.kind) {
				t.Fatalf("missing transition %s: %+v", testCase.kind, state.Events)
			}
		})
	}
}

// 上游实测与本地估算差出一个量级（<0.5× / >2×）时不采信，并说明原因。
func TestCloudAgentTokenAnchorRejectsImplausibleProviderUsage(t *testing.T) {
	cases := []struct {
		name  string
		usage int64
		found string
	}{
		{name: "远低于本地估算", usage: 5000, found: "远低于"},
		{name: "远高于本地估算", usage: 45000, found: "远高于"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			service, db, _, _ := creationTestService(t)
			request := agentTestRequest()
			taskID := "task-" + testCase.name
			if err := db.Create(&model.ApiCallLog{
				ID: "log-" + testCase.name, UserID: "user", TaskID: taskID, Capability: "text", Model: "text-test",
				Status: model.ApiCallStatusSucceeded, InputTokens: testCase.usage, OutputTokens: 300, UsageAvailable: true,
			}).Error; err != nil {
				t.Fatal(err)
			}
			state := &cloudAgentRuntime{
				Request: request, Step: 2, LastStepTaskID: taskID, LastStepOperation: cloudAgentStepOperation,
				LastStepEstimate: 20000, LastStepSourceBytes: 40000,
			}
			state.LastStepSignature = cloudAgentStepSignature(state)
			service.recordCloudAgentTokenAnchor("user", state)
			if state.TokenAnchor == nil || state.TokenAnchor.Accepted {
				t.Fatalf("离谱的实测不该被采信：%+v", state.TokenAnchor)
			}
			if !strings.Contains(state.TokenAnchor.RejectReason, testCase.found) {
				t.Fatalf("拒绝原因不对：%q", state.TokenAnchor.RejectReason)
			}
			payload := cloudAgentContextPressurePayload(cloudAgentContextPressure{EstimatedInputTokens: 20000}, state)
			if payload["tokenSource"] != "estimate" {
				t.Fatalf("被拒绝的锚点不得当主读数：%+v", payload)
			}
			if reason, _ := payload["anchorRejected"].(string); !strings.Contains(reason, testCase.found) {
				t.Fatalf("事件必须说明为什么不用这个实测：%+v", payload)
			}
		})
	}
}

// 没有上游用量（usage_available=false）时不瞎猜：退回估算，且不产生锚点。
func TestCloudAgentTokenAnchorRequiresProviderReportedUsage(t *testing.T) {
	service, db, _, _ := creationTestService(t)
	request := agentTestRequest()
	if err := db.Create(&model.ApiCallLog{
		ID: "log-no-usage", UserID: "user", TaskID: "task-no-usage", Capability: "text", Model: "text-test",
		Status: model.ApiCallStatusSucceeded, InputTokens: 10500, OutputTokens: 300, UsageAvailable: false,
	}).Error; err != nil {
		t.Fatal(err)
	}
	state := &cloudAgentRuntime{
		Request: request, Step: 2, LastStepTaskID: "task-no-usage", LastStepOperation: cloudAgentStepOperation,
		LastStepEstimate: 20000, LastStepSourceBytes: 40000,
	}
	service.recordCloudAgentTokenAnchor("user", state)
	if state.TokenAnchor != nil {
		t.Fatalf("上游没报用量就不该定锚：%+v", state.TokenAnchor)
	}
	payload := cloudAgentContextPressurePayload(cloudAgentContextPressure{EstimatedInputTokens: 20000}, state)
	if payload["tokenSource"] != "estimate" || payload["normalizedInputTokens"] != 20000 {
		t.Fatalf("没有实测时必须退回估算：%+v", payload)
	}
}

// 媒体任务不是"模型调用"这一步：拿它的用量当锚点会把压力算到错误的信封上。
func TestCloudAgentTokenAnchorIgnoresNonStepOperations(t *testing.T) {
	service, db, _, _ := creationTestService(t)
	request := agentTestRequest()
	if err := db.Create(&model.ApiCallLog{
		ID: "log-media", UserID: "user", TaskID: "task-media", Capability: "text", Model: "text-test",
		Status: model.ApiCallStatusSucceeded, InputTokens: 10500, OutputTokens: 300, UsageAvailable: true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	state := &cloudAgentRuntime{
		Request: request, Step: 2, LastStepTaskID: "task-media", LastStepOperation: "cloud_agent_media",
		LastStepEstimate: 20000, LastStepSourceBytes: 40000,
	}
	service.recordCloudAgentTokenAnchor("user", state)
	if state.TokenAnchor != nil {
		t.Fatalf("非模型调用步骤不该定锚：%+v", state.TokenAnchor)
	}
}

func TestCloudAgentTokenAnchorOnlyUsesOwnedSuccessfulTextCall(t *testing.T) {
	service, db, _, _ := creationTestService(t)
	state := &cloudAgentRuntime{
		Request: agentTestRequest(), Step: 2, LastStepTaskID: "task-owned",
		LastStepOperation: cloudAgentStepOperation, LastStepEstimate: 20000,
		LastStepChannelID: "channel",
	}
	state.LastStepSignature = cloudAgentStepSignature(state)
	for _, log := range []model.ApiCallLog{
		{ID: "other-user", UserID: "other", TaskID: "task-owned", Capability: "text", Status: model.ApiCallStatusSucceeded, UsageAvailable: true, InputTokens: 11000},
		{ID: "failed", UserID: "user", TaskID: "task-owned", Capability: "text", Status: model.ApiCallStatusFailed, UsageAvailable: true, InputTokens: 11000},
		{ID: "video", UserID: "user", TaskID: "task-owned", Capability: "video", Status: model.ApiCallStatusSucceeded, UsageAvailable: true, InputTokens: 11000},
	} {
		if err := db.Create(&log).Error; err != nil {
			t.Fatal(err)
		}
	}
	service.recordCloudAgentTokenAnchor("user", state)
	if state.TokenAnchor != nil {
		t.Fatalf("foreign/failed/non-text log must not become an anchor: %+v", state.TokenAnchor)
	}
	valid := model.ApiCallLog{ID: "owned", UserID: "user", TaskID: "task-owned", ChannelID: "channel", Capability: "text", Status: model.ApiCallStatusSucceeded, UsageAvailable: true, InputTokens: 11000}
	if err := db.Create(&valid).Error; err != nil {
		t.Fatal(err)
	}
	service.recordCloudAgentTokenAnchor("user", state)
	if state.TokenAnchor == nil || !state.TokenAnchor.Accepted {
		t.Fatalf("owned successful text usage must be accepted: %+v", state.TokenAnchor)
	}
	state.TokenAnchor = nil
	state.LastStepChannelID = "different-channel"
	service.recordCloudAgentTokenAnchor("user", state)
	if state.TokenAnchor != nil {
		t.Fatalf("route changed after request construction: %+v", state.TokenAnchor)
	}
}

// 占用分布：分段合计必须与 system 桶严格对得上（字节逐字节、token 逐 token）。
func TestCloudAgentContextBreakdownSystemSegmentsFillSystemBucket(t *testing.T) {
	system, policy, err := compileCloudAgentPolicies(agentTestRequest(), nil, "", cloudAgentProfileSnapshot{Revision: agentProfileRevision(nil), Hash: agentProfileHash("")})
	if err != nil {
		t.Fatal(err)
	}
	if len(policy.SystemSegments) == 0 {
		t.Fatal("编译器必须登记系统提示分段")
	}
	// 编译之后拼接的个人记忆块：不登记就会让分段合计小于 system 桶。
	canonical := canonicalAgentRequest{
		SystemPrompt: system + "\n\n## 个人记忆\n\n- 标题：适用场景\n",
		Messages:     []map[string]interface{}{{"role": "user", "content": "分析剧情"}},
		Tools:        []map[string]interface{}{{"type": "function", "function": map[string]interface{}{"name": "canvas_get_state"}}},
	}
	cloudAgentRecordMemorySegment(&policy, canonical.SystemPrompt)
	state := &cloudAgentRuntime{Canonical: canonical, Policy: policy}

	breakdown := cloudAgentContextBreakdownPayload(state)
	segments, ok := breakdown["systemSegments"].([]cloudAgentContextSegment)
	if !ok || len(segments) == 0 {
		t.Fatalf("缺少系统提示分段：%+v", breakdown["systemSegments"])
	}
	buckets, ok := breakdown["buckets"].([]map[string]any)
	if !ok || len(buckets) != 3 {
		t.Fatalf("buckets 不对：%+v", breakdown["buckets"])
	}
	systemBucket := buckets[0]
	if systemBucket["key"] != "system" {
		t.Fatalf("第一个桶必须是 system：%+v", systemBucket)
	}
	segmentBytes, segmentTokens := 0, 0
	keys := []string{}
	for _, segment := range segments {
		segmentBytes += segment.Bytes
		segmentTokens += segment.Tokens
		keys = append(keys, segment.Key)
		if segment.Bytes <= 0 {
			t.Fatalf("分段 %s 的字节数必须为正：%+v", segment.Key, segment)
		}
	}
	if segmentBytes != systemBucket["bytes"] || segmentBytes != len(canonical.SystemPrompt) {
		t.Fatalf("分段字节合计 %d 与 system 桶 %v（真实 %d）对不上：%+v", segmentBytes, systemBucket["bytes"], len(canonical.SystemPrompt), keys)
	}
	if segmentTokens != systemBucket["tokens"] {
		t.Fatalf("分段 token 合计 %d 与 system 桶 %v 对不上：%+v", segmentTokens, systemBucket["tokens"], keys)
	}
	if !strings.Contains(strings.Join(keys, ","), "memory") {
		t.Fatalf("个人记忆必须登记为分段：%+v", keys)
	}
	if buckets[1]["key"] != "tools" || buckets[2]["key"] != "messages" {
		t.Fatalf("三桶顺序不对：%+v", buckets)
	}
	// 未登记的内容归入"其它"，合计仍然对得上，不会出现"少算一截"。
	state.Canonical.SystemPrompt += "\n未登记的一段拼接内容"
	breakdown = cloudAgentContextBreakdownPayload(state)
	segments = breakdown["systemSegments"].([]cloudAgentContextSegment)
	buckets = breakdown["buckets"].([]map[string]any)
	segmentBytes, segmentTokens, hasOther := 0, 0, false
	for _, segment := range segments {
		segmentBytes += segment.Bytes
		segmentTokens += segment.Tokens
		if segment.Key == "other" {
			hasOther = true
		}
	}
	if !hasOther {
		t.Fatalf("零头必须归入 other：%+v", segments)
	}
	if segmentBytes != buckets[0]["bytes"] || segmentTokens != buckets[0]["tokens"] {
		t.Fatalf("有零头时分段合计仍须等于 system 桶：%d/%v %d/%v", segmentBytes, buckets[0]["bytes"], segmentTokens, buckets[0]["tokens"])
	}
}

// 有锚点时，占用分布另给一份按换算比例校准的读数，原值不覆盖。
func TestCloudAgentContextBreakdownScalesBucketsWithAnchor(t *testing.T) {
	state := &cloudAgentRuntime{
		Canonical: canonicalAgentRequest{SystemPrompt: "系统提示内容", Messages: []map[string]interface{}{{"role": "user", "content": "你好"}}},
		TokenAnchor: &cloudAgentTokenAnchor{
			TaskID: "task-1", Step: 1, Accepted: true, InputTokens: 10000, EstimatedTokens: 20000,
		},
	}
	breakdown := cloudAgentContextBreakdownPayload(state)
	if breakdown["tokenScale"] != 0.5 {
		t.Fatalf("tokenScale = %v，期望 0.5", breakdown["tokenScale"])
	}
	buckets := breakdown["buckets"].([]map[string]any)
	systemTokens := buckets[0]["tokens"].(int)
	if buckets[0]["scaledTokens"].(int) != systemTokens/2 {
		t.Fatalf("scaledTokens 应按锚点比例换算：%+v", buckets[0])
	}
}

// 走真实运行路径（调度器推进 + 任务接缝注入模型输出）：每一步都落一条 context_pressure，
// 第一步是估算、第二步换成上游实测锚点。这条用例守的是运行期接线（登记的是哪一步、
// 哪一次调用、什么时候配锚点），而不是载荷函数本身。
func TestCloudAgentRuntimeEmitsContextPressurePerStep(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[],"connections":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	root, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	load := func() (*model.CloudAgentExecution, cloudAgentRuntime) {
		t.Helper()
		run, err := s.repo.CloudAgent("user", root.ID)
		if err != nil {
			t.Fatal(err)
		}
		state, err := cloudAgentDecode(run)
		if err != nil {
			t.Fatal(err)
		}
		return run, state
	}
	advance := func() {
		t.Helper()
		if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
			t.Fatal(err)
		}
	}
	pressures := func(state cloudAgentRuntime) []CloudAgentEvent {
		events := []CloudAgentEvent{}
		for _, event := range state.Events {
			if event.Type == "context_pressure" {
				events = append(events, event)
			}
		}
		return events
	}

	// 建运行：第一步的模型调用就是根任务，读数在发出请求之前就落下了。
	advance()
	_, state := load()
	if state.ActiveTaskID != root.ID || state.LastStepTaskID != root.ID || state.LastStepOperation != cloudAgentStepOperation {
		t.Fatalf("第一步的记账不对：active=%s last=%s op=%s", state.ActiveTaskID, state.LastStepTaskID, state.LastStepOperation)
	}
	first := pressures(state)
	if len(first) != 1 {
		t.Fatalf("第一步应落一条 context_pressure，实际 %d", len(first))
	}
	if first[0].Payload["tokenSource"] != "estimate" || first[0].Payload["measurementSource"] != "estimate" {
		t.Fatalf("第一步没有实测，必须标估算：%+v", first[0].Payload)
	}
	if first[0].Payload["requestId"] != root.ID || first[0].Payload["readingScope"] != "next_request" {
		t.Fatalf("读数必须钉在本次请求上：%+v", first[0].Payload)
	}
	if _, ok := first[0].Payload["breakdown"].(map[string]any); !ok {
		t.Fatalf("读数必须带占用分布：%+v", first[0].Payload)
	}
	assertMatchesTask := func(taskID string, event CloudAgentEvent) {
		t.Helper()
		task, err := s.repo.TaskForUser("user", taskID)
		if err != nil {
			t.Fatal(err)
		}
		var input map[string]any
		if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
			t.Fatal(err)
		}
		canonical, ok := canonicalAgentRequestFromInput(input)
		if !ok {
			t.Fatalf("task %s missing canonical envelope", taskID)
		}
		raw, err := json.Marshal(canonical)
		if err != nil {
			t.Fatal(err)
		}
		breakdown := event.Payload["breakdown"].(map[string]any)
		if breakdown["totalBytes"] != float64(len(raw)) || event.Payload["sourceBytes"] != float64(len(raw)) {
			t.Fatalf("pressure/breakdown not based on actual task envelope: task=%s event=%+v", taskID, event.Payload)
		}
		buckets := breakdown["buckets"].([]any)
		messages := buckets[2].(map[string]any)
		messageBytes, _ := json.Marshal(canonical.Messages)
		if messages["bytes"] != float64(len(messageBytes)) {
			t.Fatalf("message bucket not based on task input: %v != %d", messages["bytes"], len(messageBytes))
		}
	}
	assertMatchesTask(root.ID, first[0])

	// 第一步的模型调用回来了，上游上报了用量。
	if err := db.Create(&model.ApiCallLog{
		ID: "log-root", UserID: "user", TaskID: root.ID, Capability: "text", Model: "text-test",
		Status: model.ApiCallStatusSucceeded, InputTokens: 10500, CachedTokens: 2000, OutputTokens: 300, UsageAvailable: true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	// 在任务接缝注入模型输出：一次只读工具调用，让这一轮进入第二步。
	call := cloudAgentCall{ID: "call-1"}
	call.Function.Name, call.Function.Arguments = "canvas_get_state", `{}`
	body, _ := json.Marshal(map[string]any{"toolCalls": []cloudAgentCall{call}})
	if err := db.Model(&model.Task{}).Where("id = ?", state.ActiveTaskID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": string(body)}).Error; err != nil {
		t.Fatal(err)
	}
	// 模型结果 → 执行工具 → 记锚点 → 发下一步：推进到第二步的读数落下为止（有界）。
	for attempt := 0; attempt < 6; attempt++ {
		advance()
		if _, current := load(); len(pressures(current)) == 2 {
			break
		}
	}
	run, state := load()
	if run.Status != "running" {
		t.Fatalf("这一步应当继续（工具已执行、下一步已提交）：status=%s failure=%s", run.Status, run.FailureMessage)
	}
	if state.TokenAnchor == nil || !state.TokenAnchor.Accepted || state.TokenAnchor.TaskID != root.ID {
		t.Fatalf("根任务的上游用量必须配成锚点：%+v", state.TokenAnchor)
	}
	if state.LastStepTaskID == root.ID || state.LastStepOperation != cloudAgentStepOperation {
		t.Fatalf("第二步的记账不对：last=%s op=%s", state.LastStepTaskID, state.LastStepOperation)
	}
	second := pressures(state)
	if len(second) != 2 {
		t.Fatalf("第二步应再落一条 context_pressure，实际 %d", len(second))
	}
	payload := second[1].Payload
	// 事件是经 JSON 落库再读回来的，数字到这一层都是 float64（消费方也不该假设整型）。
	if payload["tokenSource"] != "provider" || payload["measurementSource"] != "provider" {
		t.Fatalf("拿到实测后主读数必须换成 provider：%+v", payload)
	}
	if payload["normalizedInputTokens"] != float64(10500) || payload["requestId"] != state.LastStepTaskID {
		t.Fatalf("实测值与请求绑定不对：%+v", payload)
	}
	assertMatchesTask(state.LastStepTaskID, second[1])
	if _, exists := payload["tokenScale"]; !exists {
		t.Fatalf("provider 口径必须带换算比例：%+v", payload)
	}
	anchor, ok := payload["anchor"].(map[string]any)
	if !ok || anchor["valid"] != true || anchor["ageSteps"] != float64(0) || anchor["id"] != root.ID {
		t.Fatalf("anchor 快照不对：%+v", payload["anchor"])
	}
}
