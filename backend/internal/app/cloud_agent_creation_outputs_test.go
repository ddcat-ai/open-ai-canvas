package app

import (
	"context"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestCreationSelectedOutputSurvivesToolCheckpointAndCommercePlan(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	root, err := s.CreateCloudAgentRun("user", creationAgentRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Task{ID: "selected-product", UserID: "user", AgentRunID: root.ID, Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: `{}`, ResultJSON: `{"images":[{"storageKey":"resource:ref-one"}]}`}).Error; err != nil {
		t.Fatal(err)
	}
	plan := commerceFixturePlan()
	plan.Platform, plan.Site, plan.StyleBible = "Mercado Libre", "MX", "柔和日光、统一蓝色标题，保持商品外观"
	plan.ProductFacts[0].SourceIDs = []string{"ref-one"}
	plan.Items[0].AttachmentResourceIDs = []string{"ref-one"}
	plan.References = []cloudAgentCreationReference{{ResourceID: "ref-one", Role: "product", Usage: "按用户选择沿用上一张产品图"}}
	for _, step := range []struct{ tool, args string }{
		{"load_creation_workflow", `{"workflow":"commerce","purpose":"用户要求沿用上一张产品图创作"}`},
		{"creation_media_read", `{"taskId":"selected-product","outputIndex":1}`},
		{"commerce_plan_submit", mustMarshal(plan)},
	} {
		call := cloudAgentCall{ID: step.tool}
		call.Function.Name, call.Function.Arguments = step.tool, step.args
		result, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", root.ID, call)
		if err != nil || result.(map[string]any)["isError"] == true {
			t.Fatalf("%s rejected selected source: %+v %v", step.tool, result, err)
		}
	}
	_, state := agentInterjectionState(t, s, root.ID)
	if !state.CommerceToolsEnabled || len(state.CreationOutputRefs) != 1 || state.CommercePlan == nil {
		t.Fatal("selected workflow/source did not survive real tool checkpoints")
	}
	var review map[string]any
	for _, event := range state.Events {
		if event.Type == "plan_updated" && event.Payload["plan"] != nil {
			review = event.Payload
		}
	}
	var reviewedPlan cloudAgentCommercePlan
	if review == nil || decodeCloudAgentJSONObject(mustMarshal(review["plan"]), &reviewedPlan) != nil || mustMarshal(reviewedPlan) != mustMarshal(state.CommercePlan) {
		t.Fatal("complete commerce plan was reduced to execution titles at the tool checkpoint")
	}
	for _, key := range []string{"references", "skills", "planHash", "maxCredits"} {
		if _, exists := review[key]; !exists {
			t.Errorf("important information payload lost %s", key)
		}
	}
	if state.CommercePlan.Platform != plan.Platform || state.CommercePlan.StyleBible != plan.StyleBible || state.CommercePlan.Items[0].Prompt != plan.Items[0].Prompt {
		t.Fatal("important information did not retain platform, design and per-image prompt")
	}
}

func TestCreationOutputSelectionUsesExactOwnedSource(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	root, err := s.CreateCloudAgentRun("user", creationAgentRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	_, state := agentInterjectionState(t, s, root.ID)
	for i, item := range []struct{ id, resource, prompt string }{{"cat-task", "ref-one", "一只猫"}, {"dog-task", "ref-two", "一只狗"}} {
		task := model.Task{ID: item.id, UserID: "user", AgentRunID: root.ID, Type: "canvas_image", Status: model.TaskStatusSucceeded, Prompt: item.prompt, InputJSON: `{}`, ResultJSON: `{"images":[{"storageKey":"resource:` + item.resource + `"}]}`, CreatedAt: time.Unix(int64(i+1), 0)}
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	read := cloudAgentCall{ID: "read"}
	read.Function.Name, read.Function.Arguments = "creation_media_read", `{}`
	list, err := cloudAgentReadTool(s.repo, "user", &state, read, s)
	if err != nil {
		t.Fatal(err)
	}
	items := list.(map[string]any)["items"].([]map[string]any)
	if len(items) != 2 || items[1]["taskId"] != "dog-task" || len(state.CreationOutputRefs) != 0 {
		t.Fatalf("wrong catalogue or eager image reference: %+v", list)
	}
	read.Function.Arguments = `{"taskId":"dog-task","outputIndex":1}`
	if _, err := cloudAgentReadTool(s.repo, "user", &state, read, s); err != nil {
		t.Fatal(err)
	}
	req, err := cloudAgentCreationRequestWithOutputs(s.repo, "user", &state)
	if err != nil || len(req.Attachments) != 1 || req.Attachments[0].ResourceID != "ref-two" {
		t.Fatalf("selected the cat instead of the dog: %+v %v", req.Attachments, err)
	}
	state.Request.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{ParameterMode: "auto", Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "image-test"}}}
	run, _ := s.repo.CloudAgent("user", root.ID)
	task, _, err := s.prepareCloudAgentCreationMedia(run, &state, cloudAgentMediaArgs{Mode: "image", Prompt: "仅将狗换成猫，其他内容不变", AttachmentResourceIDs: []string{"ref-two"}, References: []cloudAgentCreationReference{{ResourceID: "ref-two", Role: "source", Usage: "只替换狗，保留背景、位置与构图"}}}, "edit")
	if err != nil {
		t.Fatal(err)
	}
	refs := creationMaps(task.Input["referenceImages"])
	if len(refs) != 1 || refs[0]["storageKey"] != "resource:ref-two" || task.Operation != "image_to_image" {
		t.Fatalf("edit did not use exact source: %s %+v", task.Operation, refs)
	}
	plain, _, err := s.prepareCloudAgentCreationMedia(run, &state, cloudAgentMediaArgs{Mode: "image", Prompt: "生成一座雪山"}, "new")
	if err != nil || len(creationMaps(plain.Input["referenceImages"])) != 0 {
		t.Fatalf("viewed image leaked into unrelated generation: %+v %v", plain, err)
	}
	state.Request.SessionID = "other-session"
	if _, err := cloudAgentReadTool(s.repo, "user", &state, read, s); err == nil {
		t.Fatal("cross-session image was accepted")
	}
	if _, err := cloudAgentCreationRequestWithOutputs(s.repo, "user", &state); err == nil {
		t.Fatal("stale reference bypassed session ownership at admission")
	}
}

func TestCreationCommerceToolsRequireModelSelectedWorkflow(t *testing.T) {
	req := creationAgentRequest()
	req.PermissionMode = "auto"
	req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{ParameterMode: "auto"}}
	state := cloudAgentRuntime{Request: req}
	state.Skills = []cloudAgentSkill{{ID: "commerce-visual-design", Version: "full-version", Instruction: "PRIVATE_FULL_DESIGN_BODY"}}
	tools := compileCloudAgentTools(req, false)
	initial := mustMarshal(cloudAgentCreationModelTools(&state, tools))
	for _, forbidden := range []string{"commerce_plan_submit", "commerce_plan_wait", "retryFailedTaskId", "Amazon", "styleLock"} {
		if strings.Contains(initial, forbidden) {
			t.Fatalf("ordinary generation exposed %s", forbidden)
		}
	}
	call := cloudAgentCall{}
	call.Function.Name, call.Function.Arguments = "load_creation_workflow", `{"workflow":"commerce","purpose":"用户要求商品营销套图"}`
	result, err := cloudAgentReadTool(nil, "user", &state, call)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(mustMarshal(result), "Amazon") || !strings.Contains(mustMarshal(cloudAgentCreationModelTools(&state, tools)), "commerce_plan_submit") {
		t.Fatal("selected workflow was not available on the next step")
	}
	recommended, ok := result.(map[string]any)["recommendedSkill"].(map[string]any)
	if !ok || recommended["skillId"] != "commerce-visual-design" || recommended["path"] != "SKILL.md" || strings.Contains(initial+mustMarshal(result), "PRIVATE_FULL_DESIGN_BODY") {
		t.Fatalf("workflow must point to the complete skill without eager body injection: %+v", recommended)
	}
	if !strings.Contains(mustMarshal(tools), "styleLock") {
		t.Fatal("model visibility filter mutated the executor registry")
	}
}

func TestCreationWorkflowVisibilityDoesNotRouteByPromptKeywords(t *testing.T) {
	req := creationAgentRequest()
	req.PermissionMode = "auto"
	req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{ParameterMode: "auto"}}
	for _, prompt := range []string{
		"猫、狗各一张，分别生成", "给这款商品做五张宣传图", "生成适用于新平台的商品套图", "把上轮五张图片的文字换成中文，其他内容不变",
	} {
		t.Run(prompt, func(t *testing.T) {
			req.Prompt = prompt
			state := cloudAgentRuntime{Request: req}
			tools := compileCloudAgentTools(req, false)
			visible := func(name string) bool {
				for _, tool := range cloudAgentCreationModelTools(&state, tools) {
					function, _ := tool["function"].(map[string]any)
					if stringField(function, "name") == name {
						return true
					}
				}
				return false
			}
			if visible("commerce_plan_submit") || !visible("generate_image_batch") {
				t.Fatal("prompt text eagerly selected commerce or hid generic batch creation")
			}
			call := cloudAgentCall{}
			call.Function.Name, call.Function.Arguments = "load_creation_workflow", `{"workflow":"commerce","purpose":"模型依据当前用户目标选择整套设计"}`
			if _, err := cloudAgentLoadCreationWorkflow(&state, call); err != nil {
				t.Fatal(err)
			}
			if !visible("commerce_plan_submit") || !visible("generate_image_batch") || state.CommercePlan != nil || len(state.TaskIDs) != 0 || state.Approval != nil {
				t.Fatal("loading a design workflow must expose tools without generating, approving or blocking generic edits")
			}
		})
	}
}
