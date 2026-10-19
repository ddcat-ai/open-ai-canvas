package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func capacityBatchFixture(t *testing.T, kind, permission string) (*Service, *gorm.DB, string, cloudAgentCall) {
	t.Helper()
	s, db, _ := agentMediaFixture(t)
	// Production Agent carriers are text_replay and do not occupy media slots.
	s.legacyCloudAgentRootTask = false
	installCreationParallelImageModel(t, db)
	req := creationAgentRequest()
	req.Prompt, req.PermissionMode, req.IdempotencyKey = "生成七张独立商品图片", permission, "capacity-batch"
	req.Budget.MaxCredits, req.Budget.MaxGenerationTasks = 10, 7
	req.Attachments = []CloudAgentAttachment{{ResourceID: "ref-one", StorageKey: "resource:ref-one", Kind: "image", Role: "product", Name: "商品图"}}
	req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "image-test"}, ParameterMode: "manual", Size: "1024x1024", Count: 1}}
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	call := cloudAgentCall{ID: "capacity-batch-submit"}
	if kind == "commerce" {
		plan := commerceFixturePlan()
		plan.Intent, plan.ProductFacts[0].SourceIDs = req.Prompt, []string{"ref-one"}
		first := plan.Items[0]
		plan.Items = nil
		for i := 0; i < 7; i++ {
			item := first
			item.ID, item.Title, item.AttachmentResourceIDs = fmt.Sprintf("image-%d", i), fmt.Sprintf("图片%d", i), []string{"ref-one"}
			plan.Items = append(plan.Items, item)
		}
		call.Function.Name, call.Function.Arguments = "commerce_plan_submit", mustMarshal(plan)
	} else {
		items := make([]cloudAgentImageBatchItem, 7)
		for i := range items {
			items[i] = cloudAgentImageBatchItem{ID: fmt.Sprintf("image-%d", i), Title: fmt.Sprintf("图片%d", i), Prompt: "展示同一商品，保留外观", AttachmentResourceIDs: []string{"ref-one"}}
		}
		call.Function.Name, call.Function.Arguments = "generate_image_batch", mustMarshal(map[string]any{"items": items})
	}
	run, state := agentInterjectionState(t, s, root.ID)
	state.ActiveTaskID, state.PiModelCalls = "", []cloudAgentCall{call}
	if err := s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = agentInterjectionState(t, s, root.ID)
	if _, err := s.prepareCloudAgentWriteReceipt(run, call); err != nil {
		t.Fatal(err)
	}
	return s, db, root.ID, call
}

func advanceCapacityBatch(t *testing.T, s *Service, runID, permission string) {
	t.Helper()
	run, state := agentInterjectionState(t, s, runID)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	if permission == "request_approval" {
		_, state = agentInterjectionState(t, s, runID)
		if state.Approval == nil {
			t.Fatal("missing batch approval")
		}
		if err := s.DecideCloudAgentApproval("user", runID, state.Approval.ID, "approve", ""); err != nil {
			t.Fatal(err)
		}
	}
}

func assertCapacityBatch(t *testing.T, s *Service, db *gorm.DB, runID string, count int, pending bool) cloudAgentRuntime {
	t.Helper()
	run, state := agentInterjectionState(t, s, runID)
	var tasks, orders int64
	query := db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", runID, "canvas_image")
	if err := query.Count(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.BillingOrder{}).Where("task_id IN (?)", query.Select("id")).Count(&orders).Error; err != nil {
		t.Fatal(err)
	}
	if tasks != int64(count) || orders != int64(count) || state.Generations != count {
		t.Fatalf("tasks/orders/generations=%d/%d/%d, want %d", tasks, orders, state.Generations, count)
	}
	if pending && (run.Status != "running" || state.CallIndex != 0 || state.CommerceBatch == nil) {
		t.Fatalf("batch lost pending call: status=%s index=%d failure=%s", run.Status, state.CallIndex, run.FailureMessage)
	}
	active, err := s.repo.ActiveTaskCountForUser("user")
	if err != nil || active > 5 {
		t.Fatalf("active limit exceeded: %d %v", active, err)
	}
	return state
}

func TestCloudAgentBatchCapacityRefillsWithoutRepeatingTool(t *testing.T) {
	for _, kind := range []string{"commerce", "images"} {
		for _, permission := range []string{"auto", "request_approval"} {
			t.Run(kind+"/"+permission, func(t *testing.T) {
				s, db, runID, call := capacityBatchFixture(t, kind, permission)
				advanceCapacityBatch(t, s, runID, permission)
				state := assertCapacityBatch(t, s, db, runID, 5, true)
				batch := state.CommerceBatch
				// A later item frees a slot while the first item is still running.
				if err := db.Model(&model.Task{}).Where("id = ?", batch.Items[3].TaskID).Update("status", model.TaskStatusSucceeded).Error; err != nil {
					t.Fatal(err)
				}
				ctx, cancel := context.WithTimeout(context.Background(), time.Second)
				defer cancel()
				if _, err := s.waitCloudAgentMediaTask(ctx, "user", runID, state.MediaTaskID); err != nil {
					t.Fatal(err)
				}
				if err := s.settleCloudAgentMedia("user", runID); err != nil {
					t.Fatal(err)
				}
				assertCapacityBatch(t, s, db, runID, 6, true)
				if err := db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", runID, "canvas_image").Update("status", model.TaskStatusSucceeded).Error; err != nil {
					t.Fatal(err)
				}
				if err := s.settleCloudAgentMedia("user", runID); err != nil {
					t.Fatal(err)
				}
				assertCapacityBatch(t, s, db, runID, 7, true)
				if err := db.Model(&model.Task{}).Where("id = ?", batch.Items[6].TaskID).Update("status", model.TaskStatusSucceeded).Error; err != nil {
					t.Fatal(err)
				}
				if err := s.settleCloudAgentMedia("user", runID); err != nil {
					t.Fatal(err)
				}
				state = assertCapacityBatch(t, s, db, runID, 7, false)
				if state.CommerceBatch != nil || state.MediaTaskID != "" || state.CallIndex != 1 {
					t.Fatal("batch did not finish")
				}
				receipt, err := s.repo.CloudAgentReceipt("user", runID, "tool", call.ID)
				if err != nil || receipt.Status != "committed" || receipt.IsError {
					t.Fatalf("invalid final receipt: %+v %v", receipt, err)
				}
				if _, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", runID, call); err != nil {
					t.Fatal(err)
				}
				assertCapacityBatch(t, s, db, runID, 7, false)
			})
		}
	}
}

func TestCloudAgentBatchCapacityInitiallyFull(t *testing.T) {
	for _, kind := range []string{"commerce", "images"} {
		t.Run(kind, func(t *testing.T) {
			s, db, runID, _ := capacityBatchFixture(t, kind, "auto")
			for i := 0; i < 5; i++ {
				if err := db.Create(&model.Task{ID: fmt.Sprintf("other-%d", i), UserID: "user", Type: "canvas_image", Status: model.TaskStatusRunning, InputJSON: `{}`}).Error; err != nil {
					t.Fatal(err)
				}
			}
			advanceCapacityBatch(t, s, runID, "auto")
			state := assertCapacityBatch(t, s, db, runID, 0, true)
			if state.MediaTaskID != "" {
				t.Fatal("unsubmitted task recorded as active")
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			done := make(chan error, 1)
			go func() { _, err := s.waitCloudAgentMediaTask(ctx, "user", runID, ""); done <- err }()
			select {
			case err := <-done:
				t.Fatalf("full capacity did not wait: %v", err)
			case <-time.After(150 * time.Millisecond):
			}
			if err := db.Model(&model.Task{}).Where("id = ?", "other-2").Update("status", model.TaskStatusSucceeded).Error; err != nil {
				t.Fatal(err)
			}
			if err := <-done; err != nil {
				t.Fatal(err)
			}
			if err := s.settleCloudAgentMedia("user", runID); err != nil {
				t.Fatal(err)
			}
			assertCapacityBatch(t, s, db, runID, 1, true)
		})
	}
}

func TestCloudAgentBatchCapacityAdmissionRaceRollsBackCharge(t *testing.T) {
	for _, kind := range []string{"commerce", "images"} {
		t.Run(kind, func(t *testing.T) {
			s, db, runID, _ := capacityBatchFixture(t, kind, "auto")
			// A concurrent admission can win after CreateTask's optimistic count.
			// Inject the repository's denial inside the task/credit transaction.
			denied := false
			const callback = "test:batch_capacity_race"
			if err := db.Callback().Create().Before("gorm:create").Register(callback, func(tx *gorm.DB) {
				if task, ok := tx.Statement.Dest.(*model.Task); ok && task.Type == "canvas_image" && !denied {
					denied = true
					tx.AddError(repository.ErrActiveTaskLimit)
				}
			}); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { db.Callback().Create().Remove(callback) })
			advanceCapacityBatch(t, s, runID, "auto")
			state := assertCapacityBatch(t, s, db, runID, 0, true)
			if !denied || !state.CommerceBatch.WaitingForCapacity {
				t.Fatal("transactional capacity denial was not retained for refill")
			}
			firstID := state.CommerceBatch.Items[0].TaskID
			if err := s.settleCloudAgentMedia("user", runID); err != nil {
				t.Fatal(err)
			}
			state = assertCapacityBatch(t, s, db, runID, 5, true)
			if state.TaskIDs[len(state.TaskIDs)-5] != firstID {
				t.Fatal("capacity retry changed the stable item ID")
			}
		})
	}
}

func TestCloudAgentBatchCapacityOwnerFenceAndStop(t *testing.T) {
	for _, kind := range []string{"commerce", "images"} {
		t.Run(kind, func(t *testing.T) {
			s, db, runID, _ := capacityBatchFixture(t, kind, "auto")
			advanceCapacityBatch(t, s, runID, "auto")
			state := assertCapacityBatch(t, s, db, runID, 5, true)
			first, err := s.repo.ClaimCloudAgentOwner("user", runID)
			if err != nil {
				t.Fatal(err)
			}
			if err := s.repo.ReleaseCloudAgentOwner("user", runID, first); err != nil {
				t.Fatal(err)
			}
			owner, err := s.repo.ClaimCloudAgentOwner("user", runID)
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.Task{}).Where("id = ?", state.CommerceBatch.Items[1].TaskID).Update("status", model.TaskStatusSucceeded).Error; err != nil {
				t.Fatal(err)
			}
			if err := s.settleCloudAgentMedia("user", runID, first); !errors.Is(err, repository.ErrCloudAgentOwnerLost) {
				t.Fatalf("stale owner admitted task: %v", err)
			}
			assertCapacityBatch(t, s, db, runID, 5, true)
			if err := s.settleCloudAgentMedia("user", runID, owner); err != nil {
				t.Fatal(err)
			}
			assertCapacityBatch(t, s, db, runID, 6, true)
			if err := s.CancelCloudAgent(context.Background(), "user", runID); err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", runID, "canvas_image").Update("status", model.TaskStatusSucceeded).Error; err != nil {
				t.Fatal(err)
			}
			if err := s.settleCloudAgentMedia("user", runID, owner); err != nil && !errors.Is(err, repository.ErrCloudAgentOwnerLost) {
				t.Fatal(err)
			}
			assertCapacityBatch(t, s, db, runID, 6, false)
			run, _ := agentInterjectionState(t, s, runID)
			if run.Status != "cancelled" {
				t.Fatalf("stopped batch resumed: %s", run.Status)
			}
		})
	}
}

func TestCloudAgentBatchCapacityExpiredQuoteDoesNotAdmitRemainder(t *testing.T) {
	for _, kind := range []string{"commerce", "images"} {
		t.Run(kind, func(t *testing.T) {
			s, db, runID, call := capacityBatchFixture(t, kind, "auto")
			advanceCapacityBatch(t, s, runID, "auto")
			run, state := agentInterjectionState(t, s, runID)
			state.CommerceBatch.Items[5].Prepared.Quote.ExpiresAt = time.Now().Add(-time.Second)
			if err := s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				return cloudAgentSave(current, &state)
			}); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			if _, err := s.waitCloudAgentMediaTask(ctx, "user", runID, state.MediaTaskID); err != nil {
				t.Fatal(err)
			}
			if err := s.settleCloudAgentMedia("user", runID); err != nil {
				t.Fatal(err)
			}
			assertCapacityBatch(t, s, db, runID, 5, false)
			run, state = agentInterjectionState(t, s, runID)
			if run.Status != "failed" || state.MediaTaskID != "" || !strings.Contains(run.FailureMessage, "报价已过期") {
				t.Fatalf("expired quote did not fail safely: %s %s", run.Status, run.FailureMessage)
			}
			receipt, err := s.repo.CloudAgentReceipt("user", runID, "tool", call.ID)
			if err != nil || receipt.Status != "committed" || !receipt.IsError {
				t.Fatalf("failure checkpoint lost: %+v %v", receipt, err)
			}
		})
	}
}

func TestCloudAgentBatchCapacityWaiterRestoresWithoutModelCall(t *testing.T) {
	for _, kind := range []string{"commerce", "images"} {
		t.Run(kind, func(t *testing.T) {
			s, db, runID, call := capacityBatchFixture(t, kind, "auto")
			for i := 0; i < 5; i++ {
				if err := db.Create(&model.Task{ID: fmt.Sprintf("occupied-%d", i), UserID: "user", Type: "canvas_image", Status: model.TaskStatusRunning, InputJSON: `{}`}).Error; err != nil {
					t.Fatal(err)
				}
			}
			advanceCapacityBatch(t, s, runID, "auto")
			ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
			defer cancel()
			done := make(chan error, 1)
			// Recovery's existing media waiter owns the frozen pending tool. It
			// resumes without executing a planning model or repeating approval.
			go func() {
				done <- s.runOwnedCloudAgent(ctx, "user", runID, func(owned context.Context) error { return s.finishApprovedCloudAgentMedia(owned, "user", runID, "") })
			}()
			select {
			case err := <-done:
				t.Fatalf("restored waiter exited while slots full: %v", err)
			case <-time.After(150 * time.Millisecond):
			}
			if err := db.Model(&model.Task{}).Where("id LIKE ?", "occupied-%").Update("status", model.TaskStatusSucceeded).Error; err != nil {
				t.Fatal(err)
			}
			ticker := time.NewTicker(20 * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case err := <-done:
					if err != nil {
						t.Fatal(err)
					}
					state := assertCapacityBatch(t, s, db, runID, 7, false)
					if state.ActiveTaskID != "" || state.CommerceBatch != nil || state.Step != 0 {
						t.Fatal("waiter invoked a model or lost pending batch")
					}
					receipt, err := s.repo.CloudAgentReceipt("user", runID, "tool", call.ID)
					if err != nil || receipt.Status != "committed" || receipt.IsError {
						t.Fatalf("restored receipt: %+v %v", receipt, err)
					}
					return
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				case <-ticker.C:
					if err := db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", runID, "canvas_image").Update("status", model.TaskStatusSucceeded).Error; err != nil {
						t.Fatal(err)
					}
				}
			}
		})
	}
}

func TestCloudAgentBatchCapacityIsScopedPerUser(t *testing.T) {
	s, db, runID, _ := capacityBatchFixture(t, "images", "auto")
	for i := 0; i < 5; i++ {
		if err := db.Create(&model.Task{ID: fmt.Sprintf("foreign-%d", i), UserID: "other", Type: "canvas_image", Status: model.TaskStatusQueued, InputJSON: `{}`}).Error; err != nil {
			t.Fatal(err)
		}
	}
	advanceCapacityBatch(t, s, runID, "auto")
	assertCapacityBatch(t, s, db, runID, 5, true)
	active, err := s.repo.ActiveTaskCountForUser("other")
	if err != nil || active != 5 {
		t.Fatalf("another user's queue changed: %d %v", active, err)
	}
}

func TestCloudAgentBatchCapacityRechecksAdmissionBeforeRefill(t *testing.T) {
	for _, reason := range []string{"task_budget", "price", "resource"} {
		t.Run(reason, func(t *testing.T) {
			s, db, runID, _ := capacityBatchFixture(t, "images", "auto")
			advanceCapacityBatch(t, s, runID, "auto")
			run, state := agentInterjectionState(t, s, runID)
			switch reason {
			case "task_budget":
				state.Request.Budget.MaxGenerationTasks = state.Generations
				if err := s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
					return cloudAgentSave(current, &state)
				}); err != nil {
					t.Fatal(err)
				}
			case "price":
				if err := db.Model(&model.ChannelModelPriceTier{}).Where("channel_model_id = ?", "parallel-image-cm").Update("unit_price_microcredits", 200).Error; err != nil {
					t.Fatal(err)
				}
			case "resource":
				if err := db.Model(&model.Resource{}).Where("id = ?", "ref-one").Update("user_id", "other").Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := db.Model(&model.Task{}).Where("id = ?", state.CommerceBatch.Items[0].TaskID).Update("status", model.TaskStatusSucceeded).Error; err != nil {
				t.Fatal(err)
			}
			if err := s.settleCloudAgentMedia("user", runID); err != nil {
				t.Fatal(err)
			}
			assertCapacityBatch(t, s, db, runID, 5, false)
			run, state = agentInterjectionState(t, s, runID)
			if run.Status != "failed" || state.CallIndex != 1 || state.MediaTaskID != "" {
				t.Fatalf("changed admission continued: %s %s", run.Status, run.FailureMessage)
			}
		})
	}
}

func TestCloudAgentBatchCapacityRestoresBeforeFirstAdmission(t *testing.T) {
	for _, kind := range []string{"commerce", "images"} {
		t.Run(kind, func(t *testing.T) {
			s, db, runID, call := capacityBatchFixture(t, kind, "auto")
			run, state := agentInterjectionState(t, s, runID)
			var batch *cloudAgentCommerceBatch
			var err error
			if kind == "images" {
				batch, err = s.prepareCloudAgentImageBatch(run, &state, call)
			} else {
				state.CommercePlan, err = cloudAgentParseCommercePlan(state.Request, call)
				if err != nil {
					t.Fatal(err)
				}
				batch, err = s.prepareCloudAgentCommerceBatch(run, &state, state.CommercePlan, call)
			}
			if err != nil {
				t.Fatal(err)
			}
			// Simulate process loss immediately after persisting the frozen set,
			// before any task or capacity-wait checkpoint has been created.
			state.CommerceBatch = batch
			if err := s.mutateCloudAgentTool(run, &state, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				return cloudAgentSave(current, &state)
			}); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			if _, err := s.waitCloudAgentMediaTask(ctx, "user", runID, ""); err != nil {
				t.Fatalf("frozen batch could not resume admission: %v", err)
			}
			if err := s.settleCloudAgentMedia("user", runID); err != nil {
				t.Fatal(err)
			}
			assertCapacityBatch(t, s, db, runID, 5, true)
		})
	}
}
