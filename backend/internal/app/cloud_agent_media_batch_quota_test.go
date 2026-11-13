package app

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestCloudAgentFullStorageFinishesTerminalMediaBatch(t *testing.T) {
	for _, outcome := range []string{"pending", "succeeded", "submitted_upstream", "cancelled_before_submit"} {
		t.Run(outcome, func(t *testing.T) {
			s, db := agentMediaBatchFixture(t)
			run, state := agentMediaBatchRun(t, s, agentMediaBatchArgs("v1", "v2"), 4)
			if err := s.advanceCloudAgentTool(run, &state); err != nil {
				t.Fatal(err)
			}
			approveAgentMediaDraft(t, s, run.ID)
			if outcome != "pending" {
				if _, err := s.stepCloudAgentMediaBatch(context.Background(), "user", run.ID); err != nil {
					t.Fatal(err)
				}
			}
			run, state = agentMediaBatchState(t, s, run.ID)
			taskID := state.MediaBatch.Items[0].taskID()
			if outcome == "succeeded" || outcome == "submitted_upstream" {
				if err := db.Create(&model.Resource{ID: "batch-output", UserID: "user", Kind: "video", Status: "ready", MimeType: "video/mp4"}).Error; err != nil {
					t.Fatal(err)
				}
				update := map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"mode":"video","video":{"storageKey":"resource:batch-output"}}`}
				if outcome == "submitted_upstream" {
					update = map[string]any{"status": model.TaskStatusRunning, "provider_request_id": "upstream-batch"}
				}
				if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(update).Error; err != nil {
					t.Fatal(err)
				}
			}
			before := *run
			usedBefore, err := s.repo.AgentStoredBytes("user")
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.AgentStorageUsage{}).Where("user_id = ?", "user").Update("stored_bytes", repository.AgentStoredDataLimit).Error; err != nil {
				t.Fatal(err)
			}
			if err := s.CancelCloudAgent(context.Background(), "user", run.ID); err != nil {
				t.Fatal(err)
			}
			if outcome == "submitted_upstream" {
				done, err := s.stepCloudAgentMediaBatch(context.Background(), "user", run.ID)
				if err != nil || done {
					t.Fatalf("submitted task must remain in flight: done=%v err=%v", done, err)
				}
				live, err := s.repo.TaskForUser("user", taskID)
				if err != nil || live.Status != model.TaskStatusRunning {
					t.Fatalf("already submitted media was cancelled: %+v %v", live, err)
				}
				run, _ = agentMediaBatchState(t, s, run.ID)
				if !run.CleanupPending {
					t.Fatal("cleanup finished before the upstream task")
				}
				if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"mode":"video","video":{"storageKey":"resource:batch-output"}}`}).Error; err != nil {
					t.Fatal(err)
				}
			}
			if done, err := s.stepCloudAgentMediaBatch(context.Background(), "user", run.ID); err != nil || !done {
				t.Fatalf("full quota blocked terminal batch cleanup: done=%v err=%v", done, err)
			}
			run, state = agentMediaBatchState(t, s, run.ID)
			if run.Status != "cancelled" || run.CleanupPending || state.MediaBatch.Phase != cloudAgentMediaBatchPhaseDone || state.MediaBatch.inFlight() != 0 {
				t.Fatalf("terminal batch still busy: status=%s cleanup=%v batch=%+v", run.Status, run.CleanupPending, state.MediaBatch)
			}
			var leases int64
			if err := db.Model(&model.CloudAgentResourceLease{}).Where("user_id = ? AND run_id = ?", "user", run.ID).Count(&leases).Error; err != nil || leases != 0 {
				t.Fatalf("batch retained leases: count=%d err=%v", leases, err)
			}
			if !reflect.DeepEqual(before.Journal, run.Journal) || !reflect.DeepEqual(before.Transcript, run.Transcript) {
				t.Fatal("capacity cleanup appended or changed conversation history")
			}
			var oldState, newState map[string]json.RawMessage
			if err := json.Unmarshal([]byte(before.StateJSON), &oldState); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal([]byte(run.StateJSON), &newState); err != nil {
				t.Fatal(err)
			}
			delete(oldState, "mediaBatch")
			delete(newState, "mediaBatch")
			if !reflect.DeepEqual(oldState, newState) {
				t.Fatal("capacity cleanup changed fields outside the terminal batch")
			}
			usedAfter, err := s.repo.AgentStoredBytes("user")
			delta := int64(len(run.StateJSON) - len(before.StateJSON))
			if err != nil || delta >= 0 || usedAfter != repository.AgentStoredDataLimit+delta {
				t.Fatalf("cleanup exceeded or bypassed quota: delta=%d used=%d err=%v", delta, usedAfter, err)
			}
			if state.MediaBatch.Items[1].Status != cloudAgentMediaBatchItemCancelled {
				t.Fatal("unsubmitted item did not stop")
			}
			if outcome == "succeeded" || outcome == "submitted_upstream" {
				meta := agentCanvasNode(t, s, "v1")["metadata"].(map[string]any)
				if meta["status"] != "success" || meta["storageKey"] != "resource:batch-output" || state.MediaBatch.Items[0].Status != cloudAgentMediaBatchItemSucceeded {
					t.Fatalf("finished task was not written back: meta=%+v batch=%+v", meta, state.MediaBatch)
				}
			}
			if outcome == "cancelled_before_submit" {
				task, err := s.repo.TaskForUser("user", taskID)
				if err != nil || task.Status != model.TaskStatusCancelled {
					t.Fatalf("unsubmitted task survived stop: %+v %v", task, err)
				}
			}
			// Remove the artificial full-ledger fixture, then verify the real
			// continuation path can decode and inherit this compact receipt.
			if err := db.Model(&model.AgentStorageUsage{}).Where("user_id = ?", "user").Update("stored_bytes", usedBefore+delta).Error; err != nil {
				t.Fatal(err)
			}
			req := agentTestRequest()
			req.IdempotencyKey = "continue-after-batch-quota"
			req.Prompt = "继续整理刚才的批次结果"
			if child, err := s.CreateCloudAgentRun("user", req, run.ID); err != nil || child.ParentID != run.ID {
				t.Fatalf("compact terminal batch blocked continuation: child=%+v err=%v", child, err)
			}
		})
	}
}
