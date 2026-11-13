package app

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestUnboundAgentRootsRespectPerUserQuota(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	s.disablePiRuntime = true
	s.legacyCloudAgentRootTask = false
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	limit := policy.Task.AgentMaxRunsPerUser
	for i := 0; i < limit; i++ {
		run, err := s.CreateCloudAgentRun("user", unboundAgentTestRequest(fmt.Sprintf("agent-quota-%d", i)), "")
		if err != nil {
			t.Fatalf("root %d: %v", i, err)
		}
		task, err := s.repo.TaskForUser("user", run.ID)
		if err != nil || task.Status != model.TaskStatusTextReplay {
			t.Fatalf("carrier=%+v err=%v", task, err)
		}
	}
	if _, err := s.CreateCloudAgentRun("user", unboundAgentTestRequest("quota-overflow"), ""); err == nil {
		t.Fatal("unbound Agent bypassed user quota")
	}
	var liveRuns int64
	if err := db.Model(&model.CloudAgentExecution{}).Where("user_id = ?", "user").Count(&liveRuns).Error; err != nil {
		t.Fatal(err)
	}
	if liveRuns != int64(limit) {
		t.Fatalf("live roots=%d limit=%d", liveRuns, limit)
	}
}

func TestCloudAgentFullStorageStillCancelsAndFails(t *testing.T) {
	for _, action := range []string{"cancel", "fail"} {
		t.Run(action, func(t *testing.T) {
			s, db, root := cancelAuthorizationFixture(t)
			if err := db.Create(&model.AgentStorageUsage{UserID: "user", StoredBytes: repository.AgentStoredDataLimit}).Error; err != nil {
				t.Fatal(err)
			}
			if action == "cancel" {
				if err := s.CancelCloudAgent(context.Background(), "user", root.ID); err != nil {
					t.Fatal(err)
				}
			} else {
				s.failPiRunner(root.ID, "user", errors.New("quota failure"))
			}
			run, err := s.repo.CloudAgent("user", root.ID)
			if err != nil || (action == "cancel" && run.Status != "cancelled") || (action == "fail" && run.Status != "failed") {
				t.Fatalf("full quota blocked %s: %+v %v", action, run, err)
			}
			if err := s.finishCloudAgentCleanup(context.Background(), run); err != nil {
				t.Fatalf("cleanup: %v", err)
			}
			run, err = s.repo.CloudAgent("user", root.ID)
			if err != nil || run.CleanupPending {
				t.Fatalf("cleanup remained pending: %+v %v", run, err)
			}
		})
	}
}

func TestCloudAgentFailedInitialCheckpointReleasesAdmission(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	s.disablePiRuntime = true
	s.legacyCloudAgentRootTask = false
	if err := db.Create(&model.AgentStorageUsage{UserID: "user", StoredBytes: repository.AgentStoredDataLimit - 1}).Error; err != nil {
		t.Fatal(err)
	}
	req := unboundAgentTestRequest("no-room-for-first-checkpoint")
	if _, err := s.CreateCloudAgentRun("user", req, ""); !agentStorageCapacityError(err) {
		t.Fatalf("expected storage quota rejection: %v", err)
	}
	task, err := s.repo.TaskForUser("user", cloudAgentID("user", req.IdempotencyKey))
	if err != nil || task.Status != model.TaskStatusFailed || task.AgentExecutionReady {
		t.Fatalf("reservation not released: %+v %v", task, err)
	}
}
