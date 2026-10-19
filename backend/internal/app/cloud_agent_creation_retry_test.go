package app

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestCreationBatchRetryValidatesAllTargetsAndRestoresTheirSources(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	root, err := s.CreateCloudAgentRun("user", creationAgentRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	completeCreationReferenceRun(t, db, root.ID)
	for _, task := range []model.Task{
		{ID: "failed-one", UserID: "user", AgentRunID: root.ID, Type: "canvas_image", Status: model.TaskStatusFailed, InputJSON: `{"referenceImages":[{"storageKey":"resource:ref-one","role":"product"}]}`},
		{ID: "failed-two", UserID: "user", AgentRunID: root.ID, Type: "canvas_image", Status: model.TaskStatusFailed, InputJSON: `{"referenceImages":[{"storageKey":"resource:ref-two","role":"product"}]}`},
		{ID: "done", UserID: "user", AgentRunID: root.ID, Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: `{}`},
		{ID: "running", UserID: "user", AgentRunID: root.ID, Type: "canvas_image", Status: model.TaskStatusRunning, InputJSON: `{}`},
		{ID: "recoverable", UserID: "user", AgentRunID: root.ID, Type: "canvas_image", Status: model.TaskStatusFailed, InputJSON: `{}`, MediaRecoveryJSON: `{}`},
		{ID: "foreign", UserID: "another-user", AgentRunID: root.ID, Type: "canvas_image", Status: model.TaskStatusFailed, InputJSON: `{}`},
	} {
		if task.Status == model.TaskStatusFailed {
			task.ExecutionDiagnosticJSON = `{"submissionOutcome":"not_submitted"}`
		}
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	req := creationAgentRequest()
	req.SessionID, req.IdempotencyKey = root.SessionID, "batch-retry"
	decode := func(body string) {
		t.Helper()
		req.Retry = nil
		if err := json.Unmarshal([]byte(body), &req.Retry); err != nil {
			t.Fatal(err)
		}
	}
	decode(`{"runId":"` + root.ID + `","taskIds":["failed-one","failed-two"]}`)
	next, err := s.CreateCloudAgentRun("user", req, root.ID)
	if err != nil {
		t.Fatalf("batch retry rejected: %v", err)
	}
	if got := creationReferenceIDs(next.Attachments); !reflect.DeepEqual(got, []string{"ref-one", "ref-two"}) {
		t.Fatalf("lost per-item original sources: %v", got)
	}
	if replay, err := s.CreateCloudAgentRun("user", req, root.ID); err != nil || replay.ID != next.ID {
		t.Fatalf("batch replay lost idempotency: %v", err)
	}
	for _, target := range []string{"done", "running", "recoverable", "foreign", "missing", "failed-one"} {
		decode(`{"runId":"` + root.ID + `","taskIds":["failed-one","` + target + `"]}`)
		if _, err := s.cloudAgentCreationRetryContext("user", &req, root.ID); err == nil {
			t.Fatalf("accepted invalid batch target %s", target)
		}
	}
	decode(`{"runId":"` + root.ID + `","taskId":"failed-one","taskIds":["failed-two"]}`)
	if _, err := s.cloudAgentCreationRetryContext("user", &req, root.ID); err == nil {
		t.Fatal("accepted ambiguous single and batch targets")
	}
}

func TestCreationRetryRestoresOriginalSourceInsteadOfLaterUpload(t *testing.T) {
	for _, taskID := range []string{"", "failed-edit"} {
		t.Run("target-"+taskID, func(t *testing.T) {
			s, db, _ := agentMediaFixture(t)
			root, err := s.CreateCloudAgentRun("user", creationAgentRequest(), "")
			if err != nil {
				t.Fatal(err)
			}
			for _, task := range []model.Task{
				{ID: "original-dog", UserID: "user", AgentRunID: root.ID, Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: `{}`, ResultJSON: `{"images":[{"storageKey":"resource:ref-two"}]}`},
				{ID: "failed-edit", UserID: "user", AgentRunID: root.ID, Type: "canvas_image", Status: model.TaskStatusFailed, InputJSON: `{"referenceImages":[{"id":"ref-two","storageKey":"resource:ref-two","role":"source"}]}`},
			} {
				if task.Status == model.TaskStatusFailed {
					task.ExecutionDiagnosticJSON = `{"submissionOutcome":"not_submitted"}`
				}
				if err := db.Create(&task).Error; err != nil {
					t.Fatal(err)
				}
			}
			run, state := agentInterjectionState(t, s, root.ID)
			state.CreationOutputRefs = map[string]cloudAgentCreationOutputRef{"ref-two": {TaskID: "original-dog", OutputIndex: 1}}
			if err := cloudAgentSave(run, &state); err != nil {
				t.Fatal(err)
			}
			if err := db.Model(run).Updates(map[string]any{"state_json": run.StateJSON, "status": "failed"}).Error; err != nil {
				t.Fatal(err)
			}
			later, err := s.CreateCloudAgentRun("user", creationReferenceRequest(t, "later-upload", "replace", "ref-one"), root.ID)
			if err != nil {
				t.Fatal(err)
			}
			completeCreationReferenceRun(t, db, later.ID)
			req := creationAgentRequest()
			req.SessionID, req.IdempotencyKey, req.Retry = root.SessionID, "retry-original", &CloudAgentCreationRetry{RunID: root.ID, TaskID: taskID}
			next, err := s.CreateCloudAgentRun("user", req, later.ID)
			if err != nil {
				t.Fatal(err)
			}
			if got := creationReferenceIDs(next.Attachments); !reflect.DeepEqual(got, []string{"ref-two"}) {
				t.Fatalf("retry used later upload instead of original source: %v", got)
			}
			replayed, err := s.CreateCloudAgentRun("user", req, later.ID)
			if err != nil || replayed.ID != next.ID {
				t.Fatalf("resolved retry lost idempotency: %+v %v", replayed, err)
			}
		})
	}
}

func TestCreationRetryRequiresFailedOwnedTarget(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	root, err := s.CreateCloudAgentRun("user", creationAgentRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).Update("status", "failed").Error; err != nil {
		t.Fatal(err)
	}
	req := creationAgentRequest()
	req.SessionID, req.Prompt, req.IdempotencyKey, req.Retry = root.SessionID, "重试失败步骤", "retry-click", &CloudAgentCreationRetry{RunID: root.ID}
	next, err := s.CreateCloudAgentRun("user", req, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if next.Retry == nil || next.Retry.RunID != root.ID {
		t.Fatal("retry action missing from durable view")
	}
	task, err := s.repo.TaskForUser("user", next.ID)
	if err != nil || !strings.Contains(task.InputJSON, "原轮用户要求") {
		t.Fatalf("retry lost original intent: %v", err)
	}
	req.SessionID = "other-session"
	if _, err := s.cloudAgentCreationRetryContext("user", &req, root.ID); err == nil {
		t.Fatal("cross-session retry allowed")
	}
	req.SessionID = root.SessionID
	for _, status := range []model.TaskStatus{model.TaskStatusRunning, model.TaskStatusSucceeded, model.TaskStatusFailed} {
		media := model.Task{ID: string(status), UserID: "user", AgentRunID: root.ID, Type: "canvas_image", Status: status, InputJSON: `{}`, ExecutionDiagnosticJSON: `{"submissionOutcome":"not_submitted"}`}
		if err := db.Create(&media).Error; err != nil {
			t.Fatal(err)
		}
		req.Retry.TaskID = media.ID
		_, err := s.cloudAgentCreationRetryContext("user", &req, root.ID)
		if (err == nil) != (status == model.TaskStatusFailed) {
			t.Fatalf("retry status %s: %v", status, err)
		}
	}
}
