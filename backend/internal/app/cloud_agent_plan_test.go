package app

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
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

func TestCloudAgentInheritedPlanReachesFirstModelRequest(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	run, state := agentInterjectionState(t, s, root.ID)
	state.Plan = []cloudAgentPlanItem{{ID: "1", Title: "生成镜头2视频", Status: "doing"}}
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
	if !strings.Contains(task.InputJSON, "本轮待办清单") || !strings.Contains(task.InputJSON, "生成镜头2视频") {
		t.Fatalf("继承清单没有进入第一拍模型请求: %s", task.InputJSON)
	}
	_, childState := agentInterjectionState(t, s, child.ID)
	if strings.Contains(childState.Canonical.SystemPrompt, "本轮待办清单") {
		t.Fatal("运行态系统提示不应长期钉死上一轮的清单快照，后续应按当前 Plan 重拼")
	}
	if len(childState.Plan) != 1 || childState.Plan[0].Title != "生成镜头2视频" {
		t.Fatalf("运行态没有继承清单: %+v", childState.Plan)
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

func TestCloudAgentPlanNudgePrefersLatestUserInstruction(t *testing.T) {
	state := &cloudAgentRuntime{
		Canonical: canonicalAgentRequest{Messages: []map[string]any{{"role": "user", "content": "改成 16:9"}}},
	}
	content := cloudAgentPlanNudgeContent(state, "生成镜头2视频")
	if !strings.Contains(content, "改成 16:9") || !strings.Contains(content, "生成镜头2视频") || !strings.Contains(content, "plan_update") {
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
		if strings.Contains(content, "生成镜头1") && strings.Contains(content, "plan_update") {
			found = true
		}
	}
	if !found {
		t.Fatalf("没有催办未完成项: %+v", state.Canonical.Messages)
	}
}
