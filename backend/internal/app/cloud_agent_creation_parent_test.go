package app

import (
	"errors"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestCreationAgentContinuationRejectsStaleParent(t *testing.T) {
	for _, latestStatus := range []string{"running", "completed"} {
		t.Run(latestStatus, func(t *testing.T) {
			s, db, request, parent := parentBusyTestRun(t, "creation")
			if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", parent.ID).Update("status", "completed").Error; err != nil {
				t.Fatal(err)
			}
			edited := request
			edited.IdempotencyKey, edited.Prompt = "edited-cup", "把杯身文字修改为 IGO"
			latest, err := s.CreateCloudAgentRun("user", edited, parent.ID)
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", latest.ID).Update("status", latestStatus).Error; err != nil {
				t.Fatal(err)
			}
			for _, staleParent := range []string{parent.ID, ""} {
				next := request
				next.IdempotencyKey, next.Prompt, next.SessionID = "stale-continue-"+staleParent, "继续啊", latest.SessionID
				_, err := s.CreateCloudAgentRun("user", next, staleParent)
				var failure *AppError
				reason := "agent_session_stale_parent"
				if latestStatus == "running" {
					reason = "canvas_agent_busy"
				}
				if !errors.As(err, &failure) || failure.Status != 409 || string(failure.Reason) != reason || failure.Retryable {
					t.Fatalf("stale parent admitted another branch or ambiguous rejection: %+v", err)
				}
				assertParentBusyTaskCount(t, s, db, 2)
			}
			// A previously accepted request keeps its exact identity even after
			// the session advanced. The guard must not turn replay into a fork.
			replay, err := s.CreateCloudAgentRun("user", edited, parent.ID)
			if err != nil || replay.ID != latest.ID {
				t.Fatalf("accepted request replay changed: %+v %v", replay, err)
			}
			if latestStatus == "completed" {
				next := request
				next.IdempotencyKey, next.Prompt = "fresh-continue", "继续啊"
				continued, err := s.CreateCloudAgentRun("user", next, latest.ID)
				if err != nil || continued.ParentID != latest.ID {
					t.Fatalf("current parent was rejected: %+v %v", continued, err)
				}
				assertParentBusyTaskCount(t, s, db, 3)
			}
		})
	}
}

func TestCreationAgentRecoveredReceiptKeepsIdentityAndInterjection(t *testing.T) {
	forEachRetryDispatchDatabase(t, func(t *testing.T, s *Service, db *gorm.DB) {
		s.disablePiRuntime, s.legacyCloudAgentRootTask = true, false
		capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test")
		for _, row := range []any{
			&model.User{ID: "user", Username: "continuation-test", Role: model.UserRoleUser, Status: model.UserStatusActive},
			&model.ModelChannel{ID: "channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "test"},
			&model.ChannelModel{ID: "cm", ChannelID: "channel", ModelKey: "text-test", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, capability), BillingMode: "fixed_request", PriceConfigured: true, Enabled: true},
			&model.ChannelModelPriceTier{ID: "tier", ChannelModelID: "cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true},
			&model.CreditAccount{UserID: "user", AvailableMicrocredits: 10000},
		} {
			if err := db.Create(row).Error; err != nil {
				t.Fatal(err)
			}
		}
		request := creationAgentRequest()
		parent, err := s.CreateCloudAgentRun("user", request, "")
		if err != nil {
			t.Fatal(err)
		}
		completeCreationReferenceRun(t, db, parent.ID)
		request.IdempotencyKey, request.Prompt = "lost-edited-receipt", "将杯身文字修改为 IGO"
		accepted, err := s.CreateCloudAgentRun("user", request, parent.ID)
		if err != nil {
			t.Fatal(err)
		}
		// The first response was lost. Recover its exact key before sending
		// the user's next instruction to the already accepted execution.
		replayed, err := s.CreateCloudAgentRun("user", request, parent.ID)
		if err != nil || replayed.ID != accepted.ID || replayed.ParentID != parent.ID {
			t.Fatalf("receipt recovery forked the execution: %+v %v", replayed, err)
		}
		for range 2 {
			if _, err := s.InterjectCloudAgent("user", replayed.ID, "continue-after-recovery", "继续完成刚才的 IGO 改字"); err != nil {
				t.Fatal(err)
			}
		}
		_, state := agentInterjectionState(t, s, replayed.ID)
		if state.Request.Prompt != request.Prompt || len(state.PendingInterjections) != 1 || state.PendingInterjections[0].Text != "继续完成刚才的 IGO 改字" {
			t.Fatalf("recovered instruction lost or duplicated: prompt=%q pending=%+v", state.Request.Prompt, state.PendingInterjections)
		}
		assertParentBusyTaskCount(t, s, db, 2)
	})
}

func TestCanvasAgentStillAllowsExplicitCompletedParentBranch(t *testing.T) {
	s, db, request, parent := parentBusyTestRun(t, "canvas")
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", parent.ID).Update("status", "completed").Error; err != nil {
		t.Fatal(err)
	}
	next := request
	next.IdempotencyKey = "canvas-child"
	child, err := s.CreateCloudAgentRun("user", next, parent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", child.ID).Update("status", "completed").Error; err != nil {
		t.Fatal(err)
	}
	next.IdempotencyKey = "canvas-explicit-branch"
	if _, err := s.CreateCloudAgentRun("user", next, parent.ID); err != nil {
		t.Fatalf("creation-only guard changed canvas branching: %v", err)
	}
}
