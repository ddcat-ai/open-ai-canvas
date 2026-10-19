package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func setPreferredAdmissionRemaining(t *testing.T, s *Service, state *cloudAgentRuntime, amount int64) {
	t.Helper()
	remaining, err := s.cloudAgentRemainingBudget("user", state)
	if err != nil || remaining < 0 {
		t.Fatalf("initial budget: %d %v", remaining, err)
	}
	used := int64(state.Request.Budget.MaxCredits*float64(CreditScale)) - remaining
	state.Request.Budget.MaxCredits = (float64(used+amount) + .5) / float64(CreditScale)
}

func preferredAdmissionVideoFixture(t *testing.T, permission string) (*Service, *gorm.DB, *model.CloudAgentExecution, cloudAgentRuntime, model.ChannelModel) {
	t.Helper()
	s, db, _ := agentMediaFixture(t)
	original, err := s.repo.ChannelModelByKey("channel", "seedance-test")
	if err != nil {
		t.Fatal(err)
	}
	compatible := addPreferredFallback(t, s, *original, "compatible-video", "channel", "compatible-video", 1)
	var profile ModelCapabilityConfig
	if err := json.Unmarshal([]byte(original.CapabilityConfigJSON), &profile); err != nil {
		t.Fatal(err)
	}
	profile.Video.Ratios, profile.Video.DefaultRatio = []string{"16:9"}, "16:9"
	if err := db.Model(original).Update("capability_config_json", mustEncodeModelCapabilityConfig(t, &profile)).Error; err != nil {
		t.Fatal(err)
	}
	a := cloudAgentMediaArgs{Mode: "video", Prompt: "Keep the product and camera movement", Duration: 12, Size: "9:16", AttachmentResourceIDs: []string{"ref-one"}}
	choice := CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "seedance-test"}, SelectionMode: "preferred", ParameterMode: "manual", Size: "9:16", DurationSeconds: 12}
	run, state := creationMediaRun(t, s, "preferred-admission-"+permission, a, choice, permission)
	return s, db, run, state, compatible
}

func TestCreationPreferredAdmissionRestoresAutoCheckpoint(t *testing.T) {
	s, db, run, state, compatible := preferredAdmissionVideoFixture(t, "auto")
	request, plan, err := s.prepareCloudAgentMedia(run, &state, state.Calls[0])
	if err != nil {
		t.Fatal(err)
	}
	preparation := &creationTaskPreparation{}
	request.creationPrepare = preparation
	task, err := s.prepareCloudAgentPreferredMedia(run, &state, &request, plan, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := applyCloudAgentResolvedMediaDefaults(&request, plan, task); err != nil {
		t.Fatal(err)
	}
	prepared, err := prepareCloudAgentMediaApproval(s.repo, "user", cloudAgentCreationMediaDocument(), plan, request, task, preparation.Order)
	if err != nil {
		t.Fatal(err)
	}
	state.AutoPreparedMedia, state.AutoPreparedCallHash = prepared, cloudAgentApprovalCallHash(state.Calls[0])
	if err := s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	var tasks []model.Task
	db.Where("agent_run_id = ? AND type = ?", run.ID, "canvas_video").Find(&tasks)
	if len(tasks) != 1 || tasks[0].Model != compatible.ModelKey {
		t.Fatalf("checkpoint returned to incompatible preference: %+v", tasks)
	}
}

func TestCreationPreferredAdmissionHonorsSelectionAndBudgetLimits(t *testing.T) {
	for _, name := range []string{"fixed", "explicit-tool-model", "budget", "three-candidates", "references", "hard-duration", "maintenance"} {
		t.Run(name, func(t *testing.T) {
			s, db, run, state, compatible := preferredAdmissionVideoFixture(t, "auto")
			args := cloudAgentMediaArgs{Mode: "video", Prompt: "Keep the exact product", Size: "9:16", Duration: 12, AttachmentResourceIDs: []string{"ref-one"}}
			switch name {
			case "fixed":
				state.Request.MediaSettings.Video.SelectionMode = "fixed"
			case "explicit-tool-model":
				args.RequirePreferredModel = true
			case "budget":
				setPreferredAdmissionRemaining(t, s, &state, 11)
			case "three-candidates":
				if err := db.Model(&compatible).Update("enabled", false).Error; err != nil {
					t.Fatal(err)
				}
				compatible.Enabled = true
				for i := 0; i < 4; i++ {
					price := int64(2)
					if i == 3 {
						price = 1
					}
					addPreferredFallback(t, s, compatible, fmt.Sprintf("bounded-%d", i), "channel", fmt.Sprintf("bounded-%d", i), price)
				}
				setPreferredAdmissionRemaining(t, s, &state, 12)
			case "references", "hard-duration":
				var profile ModelCapabilityConfig
				if err := json.Unmarshal([]byte(compatible.CapabilityConfigJSON), &profile); err != nil {
					t.Fatal(err)
				}
				if name == "references" {
					profile.Video.References.MaxImages = 0
				} else {
					profile.Video.Duration.Max = 6
					profile.Video.Duration.Default = 6
				}
				if err := db.Model(&compatible).Update("capability_config_json", mustEncodeModelCapabilityConfig(t, &profile)).Error; err != nil {
					t.Fatal(err)
				}
			}
			request, plan, err := s.prepareCloudAgentCreationMedia(run, &state, args, "limits")
			if err != nil {
				t.Fatal(err)
			}
			if name == "maintenance" {
				s.BeginDrain()
			}
			request.creationPrepare = &creationTaskPreparation{DeferActiveTaskLimit: true}
			if task, err := s.prepareCloudAgentPreferredMedia(run, &state, &request, plan, 0); err == nil || task != nil {
				t.Fatalf("unsafe fallback for %s: task=%+v error=%v", name, task, err)
			}
			var count int64
			db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
			if count != 0 {
				t.Fatalf("rejected preparation created %d tasks", count)
			}
		})
	}
}

func TestCreationPreferredAdmissionNeverReselectsAfterApproval(t *testing.T) {
	s, db, run, state, compatible := preferredAdmissionVideoFixture(t, "request_approval")
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, run.ID)
	if state.Approval == nil {
		t.Fatal("missing fallback approval")
	}
	addPreferredFallback(t, s, compatible, "third-video", "channel", "third-video", 1)
	if err := db.Model(&compatible).Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	_ = s.DecideCloudAgentApproval("user", run.ID, state.Approval.ID, "approve", "")
	var count int64
	db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", run.ID, "canvas_video").Count(&count)
	if count != 0 {
		t.Fatalf("approval silently switched to an unapproved third model: %d", count)
	}
}

func TestCreationPreferredAdmissionSupportsImageBatch(t *testing.T) {
	s, db, runID, call := creationContextImageBatchFixture(t, "request_approval")
	original, err := s.repo.ChannelModelByKey("channel", "image-test")
	if err != nil {
		t.Fatal(err)
	}
	compatible := addPreferredFallback(t, s, *original, "compatible-image", "channel", "compatible-image", 1)
	var profile ModelCapabilityConfig
	if err := json.Unmarshal([]byte(original.CapabilityConfigJSON), &profile); err != nil {
		t.Fatal(err)
	}
	profile.Image.References.MaxImages = 0
	if err := db.Model(original).Update("capability_config_json", mustEncodeModelCapabilityConfig(t, &profile)).Error; err != nil {
		t.Fatal(err)
	}
	run, state := agentInterjectionState(t, s, runID)
	batch, err := s.prepareCloudAgentImageBatch(run, &state, call)
	if err != nil {
		t.Fatal(err)
	}
	if len(batch.Items) != 5 {
		t.Fatalf("batch lost items: %d", len(batch.Items))
	}
	for i, item := range batch.Items {
		refs := creationMaps(item.Request.Input["referenceImages"])
		if item.Request.Model != compatible.ModelKey || item.Args.ChannelModelKey != compatible.ModelKey || len(refs) != 1 || refs[0]["storageKey"] != fmt.Sprintf("resource:previous-image-%d", i+1) {
			t.Fatalf("fallback altered image delivery: %+v", item)
		}
	}
	if !strings.Contains(mustMarshal(cloudAgentImageBatchPreview(batch)), compatible.ModelKey) {
		t.Fatal("image approval hides the selected fallback model")
	}
	var count int64
	db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", runID, "canvas_image").Count(&count)
	if count != 0 {
		t.Fatal("image batch preparation charged before approval")
	}
}

func TestCreationPreferredAdmissionSupportsCommerceBatchAndCumulativeQuote(t *testing.T) {
	for _, enough := range []bool{true, false} {
		t.Run(fmt.Sprint(enough), func(t *testing.T) {
			s, db, run, state, compatible := preferredAdmissionVideoFixture(t, "request_approval")
			plan := commerceFixturePlan()
			plan.ProductFacts[0].SourceIDs = []string{"ref-one"}
			plan.Items[0].Type, plan.Items[0].Operation, plan.Items[0].AttachmentResourceIDs = "video", "image_to_video", []string{"ref-one"}
			detail := plan.Items[0]
			detail.ID, detail.Title, detail.Prompt = "detail", "细节视频", "Show the exact product in detail"
			plan.Items = append(plan.Items, detail)
			remaining := int64(23)
			if enough {
				remaining = 24
			}
			setPreferredAdmissionRemaining(t, s, &state, remaining)
			batch, err := s.prepareCloudAgentCommerceBatch(run, &state, &plan, cloudAgentCall{ID: "commerce-fallback"})
			if enough {
				if err != nil || len(batch.Items) != 2 || batch.QuoteMicrocredits != 24 {
					remaining, _ := s.cloudAgentRemainingBudget("user", &state)
					t.Fatalf("compatible commerce batch failed: %+v %v remaining=%d", batch, err, remaining)
				}
				for _, item := range batch.Items {
					if item.Request.Model != compatible.ModelKey || item.Args.Duration != 12 {
						t.Fatalf("commerce fallback changed delivery: %+v", item)
					}
				}
				if !strings.Contains(mustMarshal(cloudAgentCommerceBatchPreview(&plan, batch, state.Request.Budget.MaxCredits)), compatible.ModelKey) {
					t.Fatal("commerce approval hides the selected fallback model")
				}
			} else if err == nil {
				t.Fatalf("batch ignored earlier quoted item: %+v", batch)
			}
			var count int64
			db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", run.ID, "canvas_video").Count(&count)
			if count != 0 {
				t.Fatal("commerce preparation created a billed task")
			}
		})
	}
}

func TestCreationPreferredAdmissionSelectsCompatibleModelBeforeAnyTask(t *testing.T) {
	for _, permission := range []string{"auto", "request_approval"} {
		t.Run(permission, func(t *testing.T) {
			s, db, run, state, compatible := preferredAdmissionVideoFixture(t, permission)
			if err := s.advanceCloudAgentTool(run, &state); err != nil {
				t.Fatal(err)
			}
			run, state = agentInterjectionState(t, s, run.ID)
			if permission == "request_approval" {
				if run.Status != "waiting_approval" || state.Approval == nil || state.Approval.Prepared == nil {
					t.Fatalf("compatible model never reached approval: status=%s events=%s", run.Status, mustMarshal(state.Events))
				}
				config := state.Approval.Prepared.Input["config"].(map[string]any)
				if config["model"] != compatible.ModelKey {
					t.Fatalf("approval froze wrong model: %+v", config)
				}
				var count int64
				db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
				if count != 0 {
					t.Fatal("dry fallback billed before approval")
				}
				if err := s.DecideCloudAgentApproval("user", run.ID, state.Approval.ID, "approve", ""); err != nil {
					t.Fatal(err)
				}
				run, state = agentInterjectionState(t, s, run.ID)
			}
			var tasks []model.Task
			if err := db.Where("agent_run_id = ? AND type = ?", run.ID, "canvas_video").Find(&tasks).Error; err != nil {
				t.Fatal(err)
			}
			if len(tasks) != 1 || tasks[0].Model != compatible.ModelKey {
				t.Fatalf("compatible video not admitted exactly once: tasks=%+v events=%s", tasks, mustMarshal(state.Events))
			}
			var input map[string]any
			if err := json.Unmarshal([]byte(tasks[0].InputJSON), &input); err != nil {
				t.Fatal(err)
			}
			config := input["config"].(map[string]any)
			refs := creationMaps(input["referenceImages"])
			if config["size"] != "9:16" || stringValue(config["videoSeconds"]) != "12" || len(refs) != 1 || refs[0]["storageKey"] != "resource:ref-one" {
				t.Fatalf("fallback changed explicit parameters or references: %s", tasks[0].InputJSON)
			}
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			var count int64
			db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", run.ID, "canvas_video").Count(&count)
			if count != 1 {
				t.Fatalf("recovery duplicated admission: %d", count)
			}
		})
	}
}
