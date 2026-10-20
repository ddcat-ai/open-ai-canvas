package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestCreationSelectedOutputCommerceExecution(t *testing.T) {
	for _, scenario := range []struct {
		name       string
		permission string
		ordinary   bool
		historical bool
		invalidate string
	}{
		{name: "agent-auto", permission: "auto"},
		{name: "agent-approval", permission: "request_approval"},
		{name: "ordinary-auto", permission: "auto", ordinary: true},
		{name: "ordinary-approval", permission: "request_approval", ordinary: true},
		{name: "historical-upload-auto", permission: "auto", historical: true},
		{name: "historical-upload-approval", permission: "request_approval", historical: true},
		{name: "ordinary-upload-auto", permission: "auto", ordinary: true, historical: true},
		{name: "ordinary-upload-approval", permission: "request_approval", ordinary: true, historical: true},
		{name: "unselected", permission: "auto", invalidate: "unselected"},
		{name: "foreign-resource", permission: "auto", invalidate: "foreign-resource"},
		{name: "changed-output", permission: "request_approval", invalidate: "changed-output"},
		{name: "foreign-task", permission: "request_approval", ordinary: true, invalidate: "foreign-task"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			s, db, _ := agentMediaFixture(t)
			installCreationParallelImageModel(t, db)
			req := creationAgentRequest()
			req.PermissionMode = scenario.permission
			req.Budget.MaxCredits, req.Budget.MaxGenerationTasks = 10, 1
			req.Attachments = []CloudAgentAttachment{{ResourceID: "ref-one", StorageKey: "resource:ref-one", Kind: "image", Role: "reference", Name: "原附件"}}
			req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "image-test"}, ParameterMode: "manual", Size: "1024x1024"}}
			source := model.Task{ID: "selected-product", UserID: "user", Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: `{}`, ResultJSON: `{"images":[{"storageKey":"resource:ref-two"}]}`}
			parentID := ""
			if scenario.historical {
				if scenario.ordinary {
					req.CreationContext = []CloudAgentCreationContextEntry{{Role: "user", Mode: "image", ResourceIDs: []string{"ref-two"}}}
				} else {
					parent, err := s.CreateCloudAgentRun("user", creationReferenceRequest(t, "historical-plan-parent", "", "ref-two"), "")
					if err != nil {
						t.Fatal(err)
					}
					parentID = parent.ID
					completeCreationReferenceRun(t, db, parentID)
				}
			} else if scenario.ordinary {
				req.CreationContext = []CloudAgentCreationContextEntry{{Role: "assistant", Mode: "image", TaskIDs: []string{source.ID}}}
				if err := db.Create(&source).Error; err != nil {
					t.Fatal(err)
				}
			}
			root, err := s.CreateCloudAgentRun("user", req, parentID)
			if err != nil {
				t.Fatal(err)
			}
			if !scenario.ordinary && !scenario.historical {
				source.AgentRunID = root.ID
				if err := db.Create(&source).Error; err != nil {
					t.Fatal(err)
				}
			}
			if scenario.invalidate != "unselected" {
				read := cloudAgentCall{ID: "read-selected-product"}
				read.Function.Name, read.Function.Arguments = "creation_media_read", `{"taskId":"selected-product","outputIndex":1}`
				if scenario.historical {
					read.Function.Arguments = mustMarshal(map[string]any{"runId": parentID, "resourceId": "ref-two"})
				}
				result, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", root.ID, read)
				if err != nil || result.(map[string]any)["isError"] == true {
					t.Fatalf("read selected product: %+v %v", result, err)
				}
			}
			switch scenario.invalidate {
			case "foreign-resource":
				err = db.Model(&model.Resource{}).Where("id = ?", "ref-two").Update("user_id", "other").Error
			case "changed-output":
				err = db.Model(&model.Task{}).Where("id = ?", source.ID).Update("result_json", `{"images":[{"storageKey":"resource:ref-one"}]}`).Error
			case "foreign-task":
				err = db.Model(&model.Task{}).Where("id = ?", source.ID).Update("user_id", "other").Error
			}
			if err != nil {
				t.Fatal(err)
			}
			plan := commerceFixturePlan()
			plan.ProductFacts[0].SourceIDs = []string{"ref-two"}
			plan.Items[0].AttachmentResourceIDs = []string{"ref-two"}
			plan.References = []cloudAgentCreationReference{{ResourceID: "ref-two", Role: "product", Usage: "沿用已选成品的产品外观"}}
			run, state := agentInterjectionState(t, s, root.ID)
			call := cloudAgentCall{ID: "submit-selected-product"}
			call.Function.Name, call.Function.Arguments = "commerce_plan_submit", mustMarshal(plan)
			state.ActiveTaskID, state.CallIndex, state.Calls = "", 0, []cloudAgentCall{call}
			if err := s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				return cloudAgentSave(current, &state)
			}); err != nil {
				t.Fatal(err)
			}
			run, state = agentInterjectionState(t, s, root.ID)
			if err := s.advanceCloudAgentTool(run, &state); err != nil {
				t.Fatal(err)
			}
			run, state = agentInterjectionState(t, s, root.ID)
			var tasks []model.Task
			if err := db.Where("agent_run_id = ? AND type = ? AND id <> ?", run.ID, "canvas_image", source.ID).Find(&tasks).Error; err != nil {
				t.Fatal(err)
			}
			if scenario.invalidate != "" {
				if len(tasks) != 0 || state.Approval != nil || state.CommerceBatch != nil {
					t.Fatalf("invalid reference reached admission: %s %+v", scenario.invalidate, state)
				}
				return
			}
			if state.CommercePlan == nil {
				t.Fatalf("selected authorized product rejected: status=%s error=%v", run.Status, state.Events[len(state.Events)-1].Payload["text"])
			}
			if scenario.permission == "request_approval" {
				if run.Status != "waiting_approval" || state.Approval == nil || len(tasks) != 0 {
					t.Fatalf("missing approval or generated before approval: status=%s tasks=%d", run.Status, len(tasks))
				}
				if err := s.refreshCloudAgentCommerceApproval("user", run.ID, state.Approval.ID); err != nil {
					t.Fatal(err)
				}
				run, state = agentInterjectionState(t, s, root.ID)
				if err := s.DecideCloudAgentApproval("user", run.ID, state.Approval.ID, "approve", ""); err != nil {
					t.Fatal(err)
				}
			}
			_, state = agentInterjectionState(t, s, root.ID)
			if scenario.historical && (len(state.Request.Attachments) != 1 || state.Request.Attachments[0].ResourceID != "ref-one") {
				t.Fatal("commerce admission promoted historical selection into request attachments")
			}
			reviews := 0
			for _, event := range state.Events {
				if event.Type != "plan_updated" || event.Payload["plan"] == nil {
					continue
				}
				reviews++
				refs := creationMaps(event.Payload["references"])
				if len(refs) != 2 || refs[1]["resourceId"] != "ref-two" || refs[1]["role"] != "product" {
					t.Fatalf("selected product missing from important information: %+v", refs)
				}
			}
			if reviews == 0 || scenario.permission == "request_approval" && reviews < 2 {
				t.Fatalf("missing original or refreshed important information: %d", reviews)
			}
			if err := db.Where("agent_run_id = ? AND type = ? AND id <> ?", run.ID, "canvas_image", source.ID).Find(&tasks).Error; err != nil {
				t.Fatal(err)
			}
			if len(tasks) != 1 {
				t.Fatalf("expected one admitted item, got %d", len(tasks))
			}
			var input map[string]any
			if err := json.Unmarshal([]byte(tasks[0].InputJSON), &input); err != nil {
				t.Fatal(err)
			}
			refs := creationMaps(input["referenceImages"])
			if len(refs) != 1 || refs[0]["storageKey"] != "resource:ref-two" || refs[0]["role"] != "product" {
				t.Fatalf("selected source lost during preparation or approval: %+v", refs)
			}
		})
	}
}

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

func TestCreationCurrentUploadCombinesWithOnlySelectedPreviousOutput(t *testing.T) {
	for _, tool := range []string{"generate_media", "commerce_plan_submit"} {
		for _, permission := range []string{"auto", "request_approval"} {
			t.Run(tool+"/"+permission, func(t *testing.T) {
				s, db, _ := agentMediaFixture(t)
				installCreationParallelImageModel(t, db)
				parentReq := creationAgentRequest()
				parentReq.Prompt = "接下来发的新商品图与前面的场景成品结合，保留背景"
				parent, err := s.CreateCloudAgentRun("user", parentReq, "")
				if err != nil {
					t.Fatal(err)
				}
				if err := db.Create(&model.Resource{ID: "unrelated-history", UserID: "user", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Width: 1024, Height: 1024, Size: 50}).Error; err != nil {
					t.Fatal(err)
				}
				source := model.Task{ID: "previous-scenes", UserID: "user", AgentRunID: parent.ID, Type: "canvas_image", Status: model.TaskStatusSucceeded, Prompt: "两张不同的场景", InputJSON: `{}`, ResultJSON: `{"images":[{"storageKey":"resource:ref-two"},{"storageKey":"resource:unrelated-history"}]}`}
				if err := db.Create(&source).Error; err != nil {
					t.Fatal(err)
				}
				completeCreationReferenceRun(t, db, parent.ID)
				req := creationReferenceRequest(t, "combine-current-with-history", "", "ref-one")
				req.Prompt, req.PermissionMode = "", permission
				req.Budget.MaxCredits, req.Budget.MaxGenerationTasks = 10, 1
				req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "image-test"}, ParameterMode: "manual", Size: "1024x1024"}}
				root, err := s.CreateCloudAgentRun("user", req, parent.ID)
				if err != nil {
					t.Fatal(err)
				}
				read := cloudAgentCall{ID: "read-previous-scene"}
				read.Function.Name, read.Function.Arguments = "creation_media_read", `{"taskId":"previous-scenes","outputIndex":1}`
				result, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", root.ID, read)
				if err != nil || result.(map[string]any)["isError"] == true {
					t.Fatalf("selected previous output could not be read: %+v %v", result, err)
				}
				refs := []cloudAgentCreationReference{
					{ResourceID: "ref-one", Role: "product", Usage: "保留新上传商品的形状"},
					{ResourceID: "ref-two", Role: "source", Usage: "保留上一轮场景的背景和构图"},
				}
				call := agentMediaCall(cloudAgentMediaArgs{Mode: "image", Prompt: "将新上传商品放入上一轮场景，保留背景", AttachmentResourceIDs: []string{"ref-one", "ref-two"}, References: refs})
				if tool == "commerce_plan_submit" {
					plan := commerceFixturePlan()
					plan.ProductFacts[0].SourceIDs = []string{"ref-one"}
					plan.Items[0].AttachmentResourceIDs = []string{"ref-one", "ref-two"}
					plan.References = refs
					call.Function.Name, call.Function.Arguments = tool, mustMarshal(plan)
				}
				run, state := agentInterjectionState(t, s, root.ID)
				state.ActiveTaskID, state.CallIndex, state.Calls = "", 0, []cloudAgentCall{call}
				if err := s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
					return cloudAgentSave(current, &state)
				}); err != nil {
					t.Fatal(err)
				}
				run, state = agentInterjectionState(t, s, root.ID)
				if err := s.advanceCloudAgentTool(run, &state); err != nil {
					t.Fatal(err)
				}
				if permission == "request_approval" {
					run, state = agentInterjectionState(t, s, root.ID)
					var count int64
					if err := db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", root.ID, "canvas_image").Count(&count).Error; err != nil {
						t.Fatal(err)
					}
					if run.Status != "waiting_approval" || state.Approval == nil || count != 0 {
						t.Fatalf("combined references bypassed approval: status=%s tasks=%d", run.Status, count)
					}
					if err := s.DecideCloudAgentApproval("user", root.ID, state.Approval.ID, "approve", ""); err != nil {
						t.Fatal(err)
					}
					if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
						t.Fatal(err)
					}
				}
				var tasks []model.Task
				if err := db.Where("agent_run_id = ? AND type = ?", root.ID, "canvas_image").Find(&tasks).Error; err != nil {
					t.Fatal(err)
				}
				if len(tasks) != 1 {
					_, state = agentInterjectionState(t, s, root.ID)
					t.Fatalf("combined source admission failed: tasks=%d events=%s", len(tasks), mustMarshal(state.Events))
				}
				var input canvasGenerationInput
				if err := json.Unmarshal([]byte(tasks[0].InputJSON), &input); err != nil {
					t.Fatal(err)
				}
				if len(input.ReferenceImages) != 2 || input.ReferenceImages[0].StorageKey != "resource:ref-one" || input.ReferenceImages[0].Role != "product" || input.ReferenceImages[1].StorageKey != "resource:ref-two" || input.ReferenceImages[1].Role != "source" {
					t.Fatalf("task lost explicit mixed references or included unrelated history: %+v", input.ReferenceImages)
				}
				view, err := s.CloudAgentRun("user", root.ID)
				if err != nil || len(view.Attachments) != 1 || view.Attachments[0].ResourceID != "ref-one" || view.UserPrompt != "" {
					t.Fatalf("historical selection became a new user attachment/message: %+v %v", view, err)
				}
			})
		}
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
