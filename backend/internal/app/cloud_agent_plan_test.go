package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestCloudAgentPlanUpdateAndPending(t *testing.T) {
	state := &cloudAgentRuntime{}
	call := cloudAgentCall{ID: "plan-1"}
	call.Function.Name = "plan_update"
	call.Function.Arguments = `{"items":[{"id":"1","title":"生成镜头1","status":"doing"},{"id":"2","title":"生成镜头2","status":"pending"}]}`
	result, err := cloudAgentApplyPlanUpdate(state, call)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := result.(map[string]any)
	pending, _ := body["pendingTitles"].([]string)
	if len(state.Plan) != 2 || len(pending) != 2 || pending[0] != "生成镜头1" {
		t.Fatalf("plan not applied: %+v pending=%v", state.Plan, pending)
	}
	if preview, ok := cloudAgentPlanApprovalPreview(call); !ok || preview.Kind != "plan" || len(preview.Items) != 2 {
		t.Fatalf("first-plan approval preview missing: %+v ok=%v", preview, ok)
	}
}

func TestCloudAgentPlanRequiresFirstApprovalOnlyInRequestApproval(t *testing.T) {
	call := cloudAgentCall{ID: "plan-1"}
	call.Function.Name = "plan_update"
	call.Function.Arguments = `{"items":[{"id":"1","title":"生成镜头1","status":"pending"},{"id":"2","title":"生成镜头2","status":"pending"}]}`
	auto := &cloudAgentRuntime{Request: CloudAgentRequest{PermissionMode: "auto"}}
	if cloudAgentPlanRequiresFirstApproval(auto, call) {
		t.Fatal("auto 模式不应为首次清单弹审批")
	}
	readOnly := &cloudAgentRuntime{Request: CloudAgentRequest{PermissionMode: "read_only"}}
	if cloudAgentPlanRequiresFirstApproval(readOnly, call) {
		t.Fatal("只读模式不应为首次清单弹审批")
	}
	need := &cloudAgentRuntime{Request: CloudAgentRequest{PermissionMode: "request_approval"}}
	if !cloudAgentPlanRequiresFirstApproval(need, call) {
		t.Fatal("request_approval 首次 ≥2 项清单应当弹审批")
	}
	need.Plan = []cloudAgentPlanItem{{ID: "1", Title: "已有", Status: "doing"}}
	if cloudAgentPlanRequiresFirstApproval(need, call) {
		t.Fatal("清单已存在时不应再弹首次审批")
	}
}

func TestCreationPlanningContinuesUntilConcreteMediaReview(t *testing.T) {
	call := cloudAgentCall{ID: "planning-only"}
	call.Function.Name = "plan_update"
	call.Function.Arguments = `{"items":[{"id":"revise","title":"按备注调整规格与风格","status":"doing"},{"id":"review","title":"提交完整方案及报价","status":"pending"}]}`
	state := &cloudAgentRuntime{Request: CloudAgentRequest{Surface: "creation", PermissionMode: "request_approval"}}
	if cloudAgentPlanRequiresFirstApproval(state, call) {
		t.Fatal("creation paused before producing a concrete media plan and quote")
	}
	if _, err := cloudAgentApplyPlanUpdate(state, call); err != nil || len(state.Plan) != 2 {
		t.Fatalf("planning checklist could not update: %v", err)
	}
}

func TestCloudAgentInheritedPlanReachesFirstModelRequest(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	run, state := agentInterjectionState(t, s, root.ID)
	state.Plan = []cloudAgentPlanItem{{ID: "1", Title: "生成镜头2视频", Status: "doing"}}
	state.ConfirmationRounds = 1
	state.ConfirmationFingerprints = []string{strings.Repeat("a", 64)}
	state.PendingConfirmationFingerprint = state.ConfirmationFingerprints[0]
	if err := cloudAgentSave(run, &state); err != nil {
		t.Fatal(err)
	}
	if err := db.Save(run).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", root.ID).Updates(map[string]any{
		"status": model.TaskStatusSucceeded, "result_json": `{"text":"先停在这里"}`,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).Update("status", "completed").Error; err != nil {
		t.Fatal(err)
	}
	next := agentTestRequest()
	next.IdempotencyKey = "agent-plan-inherit-key"
	next.Prompt = "继续做镜头2"
	child, err := s.CreateCloudAgentRun("user", next, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	var task model.Task
	if err := db.First(&task, "id = ?", child.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(task.InputJSON, "plan_state") || !strings.Contains(task.InputJSON, "生成镜头2视频") {
		t.Fatalf("继承清单没有进入第一拍模型请求: %s", task.InputJSON)
	}
	_, childState := agentInterjectionState(t, s, child.ID)
	if strings.Contains(childState.Canonical.SystemPrompt, "本轮待办清单") {
		t.Fatal("运行态系统提示不应长期钉死上一轮的清单快照，后续应按当前 Plan 重拼")
	}
	if len(childState.Plan) != 1 || childState.Plan[0].Title != "生成镜头2视频" {
		t.Fatalf("运行态没有继承清单: %+v", childState.Plan)
	}
	if childState.ConfirmationRounds != 1 {
		t.Fatalf("运行态没有继承确认轮次: %d", childState.ConfirmationRounds)
	}
	wired := cloudAgentCanonicalWithPlan(&childState)
	if strings.Contains(wired.SystemPrompt, "生成镜头2视频") || strings.Contains(wired.SystemPrompt, "本轮待办清单") {
		t.Fatalf("清单不得写进系统提示，否则会打爆前缀缓存: %s", wired.SystemPrompt)
	}
	if len(wired.Messages) == 0 {
		t.Fatal("后续调用缺少会话")
	}
	last := wired.Messages[len(wired.Messages)-1]
	if stringField(last, "role") != "user" || !strings.Contains(stringField(last, "content"), "生成镜头2视频") {
		t.Fatalf("后续调用没有把当前清单挂在末尾消息: %+v", last)
	}
}

func TestCloudAgentAskUserRequiresChoices(t *testing.T) {
	call := cloudAgentCall{ID: "ask-1"}
	call.Function.Name = "ask_user"
	call.Function.Arguments = `{"question":"用哪个模型？","options":[{"label":"A"},{"label":"B","detail":"更稳"}]}`
	result, err := cloudAgentAskUser(call)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := result.(map[string]any)
	if body["question"] != "用哪个模型？" || body["phase"] != "question" {
		t.Fatalf("ask_user result = %+v", body)
	}
	call.Function.Arguments = `{"question":"只有一个选项","options":[{"label":"A"}]}`
	if _, err := cloudAgentAskUser(call); err == nil {
		t.Fatal("ask_user accepted a single option")
	}
}

func TestCreationAutoQuestionsOnlyBlockForNecessaryDecisions(t *testing.T) {
	for _, tc := range []struct{ permission, reason, detail, phase string }{
		{"auto", "", "", "defaulted"},
		{"auto", "preference", "", "defaulted"},
		{"auto", "ambiguous_target", "两张历史图都有狗，无法确定用户指哪张", "question"},
		{"auto", "missing_required_input", "用户要替换产品，但没有新产品图片或外观描述", "question"},
		{"auto", "conflicting_requirements", "同时要求无字图和在图中显示标题", "question"},
		{"request_approval", "preference", "", "question"},
		{"read_only", "preference", "", "question"},
	} {
		t.Run(tc.permission+tc.reason, func(t *testing.T) {
			state := &cloudAgentRuntime{Request: CloudAgentRequest{Surface: "creation", PermissionMode: tc.permission}}
			call := cloudAgentCall{ID: "ask-creation"}
			call.Function.Name = "ask_user"
			call.Function.Arguments = mustMarshal(map[string]any{"question": "确认创作信息", "decisionType": tc.reason, "blockingDetail": tc.detail, "options": []map[string]any{{"label": "A"}, {"label": "B"}}})
			result, err := cloudAgentAskUser(call, state)
			if err != nil {
				t.Fatal(err)
			}
			body := result.(map[string]any)
			if body["phase"] != tc.phase {
				t.Fatalf("wrong decision: %#v", body)
			}
			bridge := cloudAgentPiToolResult(call, mustMarshal(result))
			if (bridge["terminate"] == true) != (tc.phase == "question") {
				t.Fatalf("runtime paused incorrectly: %#v", bridge)
			}
			if tc.phase == "defaulted" && (state.ConfirmationRounds != 0 || state.PendingConfirmationFingerprint != "") {
				t.Fatal("optional question consumed a confirmation round")
			}
		})
	}
}

func TestCreationBlockingQuestionRequiresReason(t *testing.T) {
	state := &cloudAgentRuntime{Request: CloudAgentRequest{Surface: "creation", PermissionMode: "auto"}}
	call := cloudAgentCall{}
	call.Function.Arguments = `{"question":"确认信息","decisionType":"missing_required_input","options":[{"label":"A"},{"label":"B"}]}`
	if _, err := cloudAgentAskUser(call, state); err == nil {
		t.Fatal("unexplained blocking question accepted")
	}
}

func TestCloudAgentAskUserAcceptsDynamicForm(t *testing.T) {
	call := cloudAgentCall{ID: "ask-form-1"}
	call.Function.Name = "ask_user"
	call.Function.Arguments = `{"question":"确认创作方向","questionId":"canvas-setup","fields":[{"id":"genre","title":"题材","type":"single_select","options":[{"id":"comedy","label":"搞笑"},{"id":"other","label":"其他"}],"defaultValue":"comedy","allowCustom":true},{"id":"aspectRatio","title":"画幅","type":"segmented","options":[{"id":"9:16","label":"9:16"},{"id":"16:9","label":"16:9"}],"defaultValue":"9:16"},{"id":"notes","title":"补充说明","type":"textarea","placeholder":"可选"}]}`
	result, err := cloudAgentAskUser(call)
	if err != nil {
		t.Fatal(err)
	}
	body := result.(map[string]any)
	if body["kind"] != "form" || body["questionId"] != "canvas-setup" {
		t.Fatalf("dynamic form payload = %+v", body)
	}
	fields, ok := body["fields"].([]map[string]any)
	if !ok || len(fields) != 3 {
		t.Fatalf("dynamic form fields = %#v", body["fields"])
	}
}

func TestCloudAgentAskUserAcceptsMultiSelectField(t *testing.T) {
	call := cloudAgentCall{ID: "ask-multi-select"}
	call.Function.Name = "ask_user"
	call.Function.Arguments = `{"question":"确认视频输出","fields":[{"id":"outputs","title":"输出内容","type":"multi_select","options":[{"id":"video","label":"视频","recommended":true},{"id":"cover","label":"封面"}],"defaultValue":["video"]}]}`
	result, err := cloudAgentAskUser(call)
	if err != nil {
		t.Fatal(err)
	}
	body := result.(map[string]any)
	fields, ok := body["fields"].([]map[string]any)
	if !ok || len(fields) != 1 {
		t.Fatalf("multi_select fields = %#v", body["fields"])
	}
	if fields[0]["type"] != "multi_select" {
		t.Fatalf("multi_select type was lost: %+v", fields[0])
	}
	if values, ok := fields[0]["defaultValue"].([]string); !ok || len(values) != 1 || values[0] != "video" {
		t.Fatalf("multi_select defaultValue = %#v", fields[0]["defaultValue"])
	}
}

func TestCloudAgentAskUserTracksConfirmationRoundsAndDefaults(t *testing.T) {
	call := cloudAgentCall{ID: "ask-1"}
	call.Function.Name = "ask_user"
	call.Function.Arguments = `{"question":"选哪个方向？","options":[{"label":"A"},{"label":"B"}]}`
	state := &cloudAgentRuntime{}
	result, err := cloudAgentAskUser(call, state)
	if err != nil {
		t.Fatal(err)
	}
	body := result.(map[string]any)
	if body["phase"] != "question" || body["round"] != 1 || state.ConfirmationRounds != 1 || state.PendingConfirmationFingerprint == "" {
		t.Fatalf("first ask_user payload/state = %+v / %+v", body, state)
	}
	call.Function.Arguments = `{"question":"哪一个方向更合适？","options":[{"label":"B"},{"label":"A"}]}`
	result, err = cloudAgentAskUser(call, state)
	if err != nil {
		t.Fatal(err)
	}
	body = result.(map[string]any)
	if body["phase"] != "defaulted" || body["defaulted"] != true || body["reason"] != "repeated_confirmation_point" || state.ConfirmationRounds != 1 {
		t.Fatalf("repeated ask_user payload/state = %+v / %+v", body, state)
	}
	call.Function.Arguments = `{"question":"换一个说法","options":[{"label":"A"},{"label":"C"}]}`
	result, err = cloudAgentAskUser(call, state)
	if err != nil {
		t.Fatal(err)
	}
	body = result.(map[string]any)
	if body["phase"] != "question" || body["round"] != 2 || state.ConfirmationRounds != cloudAgentMaxConfirmationRounds {
		t.Fatalf("second confirmation payload/state = %+v / %+v", body, state)
	}
	call.Function.Arguments = `{"question":"最后一个方向","options":[{"label":"D"},{"label":"E"}]}`
	result, err = cloudAgentAskUser(call, state)
	if err != nil {
		t.Fatal(err)
	}
	body = result.(map[string]any)
	if body["phase"] != "defaulted" || body["defaulted"] != true || body["reason"] != "confirmation_round_limit" || state.ConfirmationRounds != cloudAgentMaxConfirmationRounds {
		t.Fatalf("exhausted ask_user payload/state = %+v / %+v", body, state)
	}
}
func TestCloudAgentPlanNudgePrefersLatestUserInstruction(t *testing.T) {
	state := &cloudAgentRuntime{
		Canonical: canonicalAgentRequest{Messages: []map[string]any{{"role": "user", "content": "改成 16:9"}}},
	}
	content := stringField(cloudAgentPlanNudgeMessage(state, "生成镜头2视频"), "content")
	if !strings.Contains(content, "改成 16:9") || !strings.Contains(content, "生成镜头2视频") || !strings.Contains(content, "pending_plan") {
		t.Fatalf("nudge missing user-first prefix: %s", content)
	}
}

func TestCloudAgentPendingPlanPreventsTextOnlyCompletion(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	state.Plan = []cloudAgentPlanItem{{ID: "1", Title: "生成镜头1", Status: "doing"}}
	if err := cloudAgentSave(run, &state); err != nil {
		t.Fatal(err)
	}
	if err := db.Save(run).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", root.ID).Updates(map[string]any{
		"status": model.TaskStatusSucceeded, "result_json": `{"text":"先看到这里"}`,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, root.ID)
	if run.Status != "running" {
		t.Fatalf("未完成清单时不该收尾，status=%s", run.Status)
	}
	found := false
	for _, message := range state.Canonical.Messages {
		content, _ := message["content"].(string)
		if strings.Contains(content, "生成镜头1") && strings.Contains(content, "pending_plan") {
			found = true
		}
	}
	if !found {
		t.Fatalf("没有催办未完成项: %+v", state.Canonical.Messages)
	}
	if state.Canonical.ToolChoice != "auto" {
		t.Fatal("旧计划催办不得强制工具调用")
	}
	// An unchanged plan gets one reminder, not an endless loop of paid steps.
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	_, state = agentInterjectionState(t, s, root.ID)
	if err := db.Model(&model.Task{}).Where("id = ?", state.ActiveTaskID).Updates(map[string]any{
		"status": model.TaskStatusSucceeded, "result_json": `{"text":"按最新要求停止生成，保留草稿。"}`,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, root.ID)
	if run.Status != "completed" || state.Plan[0].Status == "done" {
		t.Fatalf("应允许结束对话而不伪造计划完成: status=%s plan=%+v", run.Status, state.Plan)
	}
}
