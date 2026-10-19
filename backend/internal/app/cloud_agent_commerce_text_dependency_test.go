package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestCommerceTextDependenciesRequireDeliveredCopy(t *testing.T) {
	s, _, _ := agentMediaFixture(t)
	for _, tc := range []struct {
		name      string
		copy      string
		wantReady bool
	}{
		{"delivered", "A finished product headline", true},
		{"missing", "", false},
		{"whitespace", " \n\t", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			plan := commerceFixturePlan()
			plan.Items[0].Dependencies = []string{"copy"}
			plan.Items = append(plan.Items, cloudAgentCommerceItem{ID: "copy", Type: "text", Prompt: "Write a product headline", TargetCopy: tc.copy, ChineseReviewCopy: "仅审核译文"})
			state := cloudAgentRuntime{CommercePlan: &plan}
			err := cloudAgentCommerceDependenciesReady(s.repo, "user", &state, "hero")
			if (err == nil) != tc.wantReady {
				t.Fatalf("readiness = %v, want %v: %v", err == nil, tc.wantReady, err)
			}
		})
	}
}

func TestCommerceTextDependenciesPreserveTransitiveMediaOwnership(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	plan := commerceFixturePlan()
	plan.Items[0].Dependencies = []string{"copy"}
	plan.Items = append(plan.Items,
		cloudAgentCommerceItem{ID: "copy", Type: "text", TargetCopy: "Finished headline", Dependencies: []string{"source"}},
		cloudAgentCommerceItem{ID: "source", Type: "image"},
	)
	state := cloudAgentRuntime{CommercePlan: &plan}
	taskID := cloudAgentCommerceTaskID("user", &plan, "source")
	input, _ := json.Marshal(map[string]any{"metadata": map[string]any{
		"commercePlanId": plan.PlanID, "commerceVersion": plan.Version,
		"commerceItemId": "source", "commercePlanHash": cloudAgentCommercePlanHash(&plan),
	}})
	if err := db.Create(&model.Task{ID: taskID, UserID: "other", Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: string(input)}).Error; err != nil {
		t.Fatal(err)
	}
	if err := cloudAgentCommerceDependenciesReady(s.repo, "user", &state, "hero"); err == nil {
		t.Fatal("another user's transitive media dependency was accepted")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Update("user_id", "user").Error; err != nil {
		t.Fatal(err)
	}
	if err := cloudAgentCommerceDependenciesReady(s.repo, "user", &state, "hero"); err != nil {
		t.Fatalf("finished text with an owned successful source was blocked: %v", err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Update("status", model.TaskStatusFailed).Error; err != nil {
		t.Fatal(err)
	}
	if err := cloudAgentCommerceDependenciesReady(s.repo, "user", &state, "hero"); err == nil {
		t.Fatal("finished text bypassed its failed media source")
	}
	retryID := cloudAgentCommerceRetryTaskID("user", taskID)
	if err := db.Create(&model.Task{ID: retryID, UserID: "user", Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: string(input)}).Error; err != nil {
		t.Fatal(err)
	}
	if err := cloudAgentCommerceDependenciesReady(s.repo, "user", &state, "hero"); err != nil {
		t.Fatalf("successful retry did not release transitive text dependency: %v", err)
	}
	plan.Items[1].TargetCopy = "Changed after the media task was generated"
	if err := cloudAgentCommerceDependenciesReady(s.repo, "user", &state, "hero"); err == nil {
		t.Fatal("media from a different plan hash was accepted")
	}
}

func TestCommerceIncompleteTextDependencyRejectedBeforeBatchQuote(t *testing.T) {
	s, db, run, state := pausedCommerceApprovalFixture(t)
	plan := *state.CommercePlan
	plan.Items = append([]cloudAgentCommerceItem(nil), plan.Items...)
	plan.Items[0].Dependencies = []string{"copy"}
	plan.Items = append(plan.Items, cloudAgentCommerceItem{ID: "copy", Type: "text", Prompt: "Write a headline"})
	state.CommercePlan = nil
	batch, err := s.prepareCloudAgentCommerceBatch(run, &state, &plan, cloudAgentCall{ID: "missing-text"})
	if err == nil || batch != nil || !strings.Contains(err.Error(), "尚无完成文案") {
		t.Fatalf("unfinished text was quoted as executable media: %+v %v", batch, err)
	}
	var count int64
	if err := db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("unfinished text generated a billable media task: count=%d err=%v", count, err)
	}
}

func TestCommerceTextDependencyChainRequiresEveryDeliveredCopy(t *testing.T) {
	s, _, _ := agentMediaFixture(t)
	plan := commerceFixturePlan()
	plan.Items[0].Dependencies = []string{"copy"}
	plan.Items = append(plan.Items,
		cloudAgentCommerceItem{ID: "copy", Type: "text", TargetCopy: "Finished headline", Dependencies: []string{"outline"}},
		cloudAgentCommerceItem{ID: "outline", Type: "text", Prompt: "Write an outline"},
	)
	state := cloudAgentRuntime{CommercePlan: &plan}
	if err := cloudAgentCommerceDependenciesReady(s.repo, "user", &state, "hero"); err == nil {
		t.Fatal("missing upstream text output was treated as finished")
	}
	plan.Items[2].TargetCopy = "Finished campaign outline"
	if err := cloudAgentCommerceDependenciesReady(s.repo, "user", &state, "hero"); err != nil {
		t.Fatalf("completed text chain was blocked: %v", err)
	}
	dependencies, err := cloudAgentCommerceDependencies(&plan, "hero")
	if err != nil || len(dependencies) != 2 || dependencies[0].ID != "outline" || dependencies[1].ID != "copy" {
		t.Fatalf("text dependencies lost prerequisite ordering: %+v %v", dependencies, err)
	}
	plan.Items[2].Dependencies = []string{"copy"}
	if err := cloudAgentCommerceDependenciesReady(s.repo, "user", &state, "hero"); err == nil {
		t.Fatal("cyclic text dependency was accepted")
	}
}

func TestCommerceBatchConsumesFinishedTextDependencyWithoutCreatingTextTask(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	choice := CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "seedance-test"}, ParameterMode: "manual", Size: "9:16", DurationSeconds: 6}
	run, state := creationMediaRun(t, s, "commerce-text-dependency", cloudAgentMediaArgs{Mode: "video", Prompt: "placeholder"}, choice, "auto")
	plan := commerceFixturePlan()
	plan.ProductFacts[0].SourceIDs = []string{"ref-one"}
	plan.Items[0].Type, plan.Items[0].Operation = "video", "image_to_video"
	plan.Items[0].AttachmentResourceIDs = []string{"ref-one"}
	plan.Items[0].Dependencies = []string{"copy"}
	plan.Items = append(plan.Items, cloudAgentCommerceItem{ID: "copy", Type: "text", Title: "文案", Prompt: "Write final product copy", TargetCopy: "A considered everyday companion", ChineseReviewCopy: "用心打造的日常伙伴"})
	raw, _ := json.Marshal(plan)
	state.Calls[0].Function.Name, state.Calls[0].Function.Arguments = "commerce_plan_submit", string(raw)
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	task, err := s.repo.TaskForUser("user", cloudAgentCommerceTaskID("user", &plan, "hero", state.Request.SessionID))
	if err != nil {
		t.Fatalf("finished text dependency blocked media admission: %v", err)
	}
	if !strings.Contains(task.Prompt, plan.Items[1].TargetCopy) || strings.Contains(task.Prompt, plan.Items[1].Prompt) || strings.Contains(task.Prompt, plan.Items[1].ChineseReviewCopy) {
		t.Fatalf("media did not consume only the delivered target-language copy: %s", task.Prompt)
	}
	var count int64
	if err := db.Model(&model.Task{}).Where("id = ?", cloudAgentCommerceTaskID("user", &plan, "copy", state.Request.SessionID)).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("text delivery must not create a media task: count=%d err=%v", count, err)
	}
}
