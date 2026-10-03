package app

import (
	"errors"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestDeletedAgentSessionCannotBeContinuedOrReplayed(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	req := creationAgentRequest()
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", run.ID).Update("status", "completed").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.AgentSession{}).Where("id = ?", run.SessionID).Update("status", "deleted").Error; err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ name, parent, session, key string }{
		{name: "replay", key: req.IdempotencyKey},
		{name: "new run", session: run.SessionID, key: "new-root-run"},
		{name: "parent", parent: run.ID, key: "new-turn"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			next := req
			next.SessionID, next.IdempotencyKey = tc.session, tc.key
			_, err := s.CreateCloudAgentRun("user", next, tc.parent)
			var appErr *AppError
			if !errors.As(err, &appErr) || appErr.Status != 404 {
				t.Fatalf("deleted session accepted: err=%v", err)
			}
		})
	}
	var count int64
	if err := db.Model(&model.Task{}).Where("operation = ?", "cloud_agent").Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("deleted session created tasks: count=%d err=%v", count, err)
	}
}

func TestDeletedAgentSessionRejectsAdmittedRootTask(t *testing.T) {
	for _, billed := range []bool{false, true} {
		t.Run(map[bool]string{false: "control carrier", true: "legacy billed root"}[billed], func(t *testing.T) {
			s, db, _, _ := creationTestService(t)
			if err := db.Create(&model.AgentSession{ID: "deleted-session", UserID: "user", Surface: "creation", Status: "deleted"}).Error; err != nil {
				t.Fatal(err)
			}
			task := &model.Task{ID: "late-root", UserID: "user", Operation: "cloud_agent", Status: model.TaskStatusQueued, InputJSON: `{"cloudAgent":{"request":{"sessionId":"deleted-session"}}}`}
			var err error
			if billed {
				err = s.repo.CreateTaskWithCreditReservation(task, &model.BillingOrder{ID: "late-order", UserID: "user", TaskID: task.ID, AmountMicrocredits: 100}, 10)
			} else {
				err = s.repo.CreateTaskWithActiveLimit(task, 10)
			}
			if err == nil {
				t.Fatal("task admission accepted a deleted Agent session")
			}
			var count int64
			if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("late root task was persisted: count=%d err=%v", count, err)
			}
			if err := db.Model(&model.BillingOrder{}).Where("id = ?", "late-order").Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("late admission reserved credits: count=%d err=%v", count, err)
			}
		})
	}
}

func TestAgentSessionDeleteSerializesWithRootAdmission(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	for _, sessionID := range []string{"race-a", "race-b", "race-c", "race-d"} {
		if err := db.Create(&model.AgentSession{ID: sessionID, UserID: "user", Surface: "creation", Status: "active"}).Error; err != nil {
			t.Fatal(err)
		}
		task := &model.Task{ID: sessionID, UserID: "user", Operation: "cloud_agent", Status: model.TaskStatusTextReplay, InputJSON: `{"cloudAgent":{"request":{"sessionId":"` + sessionID + `"}}}`}
		start := make(chan struct{})
		admitted, deleted := make(chan error, 1), make(chan error, 1)
		go func() { <-start; admitted <- s.repo.CreateTaskWithActiveLimit(task, 10) }()
		go func() { <-start; deleted <- s.repo.DeleteAgentSession("user", sessionID) }()
		close(start)
		admissionErr, deleteErr := <-admitted, <-deleted
		var session model.AgentSession
		if err := db.First(&session, "id = ?", sessionID).Error; err != nil {
			t.Fatal(err)
		}
		var count int64
		if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if deleteErr == nil {
			if !errors.Is(admissionErr, repository.ErrAgentSessionUnavailable) || session.Status != "deleted" || count != 0 {
				t.Fatalf("deleted session admitted a root: admission=%v status=%s tasks=%d", admissionErr, session.Status, count)
			}
		} else if admissionErr != nil || !errors.Is(deleteErr, repository.ErrAgentSessionBusy) || session.Status != "active" || count != 1 {
			t.Fatalf("admitted root disappeared from history: admission=%v deletion=%v status=%s tasks=%d", admissionErr, deleteErr, session.Status, count)
		}
	}
}
