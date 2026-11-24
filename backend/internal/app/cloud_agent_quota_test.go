package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
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
			if err := db.Create(&model.AgentStorageUsage{UserID: "user", StoredBytes: model.DefaultAgentHistoryMB << 20}).Error; err != nil {
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
	if err := db.Create(&model.AgentStorageUsage{UserID: "user", StoredBytes: model.DefaultAgentHistoryMB<<20 - 1}).Error; err != nil {
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

func TestAgentHistoryPolicyRestoresAdmissionWithoutDeletingData(t *testing.T) {
	svc, db, _, _ := creationTestService(t)
	svc.legacyCloudAgentRootTask = false
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	if err := db.Create(&model.SystemSetting{Key: model.RuntimePolicySettingKey, ValueJSON: `{"resource":{"structuredDataMB":1024}}`}).Error; err != nil {
		t.Fatal(err)
	}
	policy, err := svc.RuntimePolicy()
	if err != nil || policy.Resource.AgentHistoryMB != 256 {
		t.Fatalf("legacy policy: %+v, %v", policy.Resource, err)
	}
	session := &model.CloudAgentPiSession{RunID: "old", UserID: "user", SessionJSONL: strings.Repeat("x", 1<<20)}
	if err := svc.repo.SaveCloudAgentPiSession(session, 0); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []int64{0, model.MaxAgentHistoryMB + 1} {
		policy.Resource.AgentHistoryMB = invalid
		if _, err := svc.UpdateRuntimePolicySetting(admin, policy); err == nil {
			t.Fatalf("accepted invalid limit %d", invalid)
		}
	}
	policy.Resource.AgentHistoryMB = 1
	if _, err := svc.UpdateRuntimePolicySetting(admin, policy); err != nil {
		t.Fatal(err)
	}
	_, err = svc.CreateCloudAgentRun("user", unboundAgentTestRequest("no-space"), "")
	var quota *kernel.AppError
	if !errors.As(err, &quota) || quota.Reason != kernel.ReasonAgentHistoryCapacityExceeded || quota.Status != 403 || !strings.Contains(quota.Message, "1 MiB") {
		t.Fatalf("wrong admission error: %+v", err)
	}
	policy.Resource.AgentHistoryMB = 2
	if _, err := svc.UpdateRuntimePolicySetting(admin, policy); err != nil {
		t.Fatal(err)
	}
	detail, err := svc.AdminUserDetail(admin, "user")
	if err != nil || detail.StorageUsage.AgentBytes != 1<<20 || detail.StorageUsage.AgentLimitBytes != 2<<20 {
		t.Fatalf("admin usage: %+v, %v", detail, err)
	}
	if _, err := svc.CreateCloudAgentRun("user", unboundAgentTestRequest("room-again"), ""); err != nil {
		t.Fatalf("raised quota must restore admission: %v", err)
	}
	old, err := svc.repo.CloudAgentPiSession("user", "old")
	if err != nil || old.SessionJSONL != session.SessionJSONL {
		t.Fatalf("changing the quota changed history: %v", err)
	}
}
