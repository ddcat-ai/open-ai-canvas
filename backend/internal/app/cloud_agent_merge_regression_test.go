package app

import (
	"encoding/json"
	"errors"
	"testing"

	"yingce/backend/internal/model"
)

func TestCreationSessionRejectsOtherSurfaceBeforeAdmission(t *testing.T) {
	for _, surface := range []string{"canvas", "creation"} {
		t.Run(surface, func(t *testing.T) {
			s, db, _, _ := creationTestService(t)
			if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
				t.Fatal(err)
			}
			session, err := s.CreateCloudAgentSession("user", CloudAgentSessionRequest{Surface: surface})
			if err != nil {
				t.Fatal(err)
			}
			req := creationAgentRequest()
			if surface == "creation" {
				req = agentTestRequest()
			}
			req.SessionID = session.ID
			if _, err := s.CreateCloudAgentRun("user", req, ""); err == nil {
				t.Fatal("a run was admitted to another surface's session")
			}
			var count int64
			if err := db.Model(&model.Task{}).Where("operation = ?", cloudAgentOperation).Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("cross-surface admission created tasks: count=%d err=%v", count, err)
			}
		})
	}
}

func TestCloudAgentResolvedImageOptionsSurviveJSONRoundTrip(t *testing.T) {
	requested := map[string]any{"imageParameters": map[string]any{"count": float64(1)}}
	resolved := map[string]any{"capabilityOptions": map[string]any{"count": 1}}
	if err := validateCloudAgentResolvedMediaOptions(requested, resolved); err != nil {
		t.Fatalf("JSON numeric representation changed approved options: %v", err)
	}
	resolved["capabilityOptions"].(map[string]any)["count"] = 2
	if err := validateCloudAgentResolvedMediaOptions(requested, resolved); err == nil {
		t.Fatal("a different output count bypassed approval validation")
	}
	requested = map[string]any{"imageParameters": map[string]any{"size": "1024x1024"}}
	resolved = map[string]any{"capabilityOptions": map[string]any{"size": "1:1"}, "config": map[string]any{"imageParameters": map[string]any{"size": "1024x1024"}}}
	if err := validateCloudAgentResolvedMediaOptions(requested, resolved); err != nil {
		t.Fatalf("declared pixel/ratio mapping changed approved options: %v", err)
	}
	requested["imageParameters"].(map[string]any)["size"] = "2048x2048"
	if err := validateCloudAgentResolvedMediaOptions(requested, resolved); err == nil {
		t.Fatal("unapproved pixel size bypassed approval validation")
	}
}

func TestCloudAgentPiInspectionReattachmentPreservesExistingImageFrame(t *testing.T) {
	inspection := cloudAgentImageInspection{Receipt: map[string]any{"nodeId": "image-node"}, ImageURL: "resource:owned-image"}
	state := cloudAgentRuntime{PiInspectedImages: map[string]cloudAgentImageInspection{"read-image": inspection}}
	canonical := canonicalAgentRequest{Messages: []map[string]any{
		{"role": "tool", "tool_call_id": "read-image", "content": `{"nodeId":"image-node"}`},
		{"role": "user", "content": cloudAgentImageContentParts(inspection)},
	}}
	before, _ := json.Marshal(canonical.Messages)
	cloudAgentPiAttachInspectedImages(&state, &canonical)
	after, _ := json.Marshal(canonical.Messages)
	if string(before) != string(after) {
		t.Fatal("an existing image frame was duplicated")
	}
}

func TestCloudAgentImageRouteRejectionPreservesUnknownSubmission(t *testing.T) {
	for _, tc := range []struct {
		name, runID, providerID, want string
		err                           error
	}{
		{"confirmed rejection", "agent-run", "", "rejected_no_job", providerHTTPError{StatusCode: 400}},
		{"unknown submission", "agent-run", "", "submission_unknown", errors.New("connection closed")},
		{"accepted task", "agent-run", "upstream-task", "accepted", providerHTTPError{StatusCode: 400}},
		{"ordinary image", "", "", "submission_unknown", providerHTTPError{StatusCode: 400}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, _, _, _ := creationTestService(t)
			task := &model.Task{ID: "image-task", UserID: "user", Type: "canvas_image", AgentRunID: tc.runID, ProviderRequestID: tc.providerID}
			attempt := &model.RouteAttempt{ID: "image-attempt", TaskID: task.ID, DispatchState: "submission_unknown"}
			if err := s.repo.Create(attempt); err != nil {
				t.Fatal(err)
			}
			s.finishTaskRouteAttempt(attempt, task, tc.err)
			if attempt.DispatchState != tc.want {
				t.Fatalf("dispatch=%s, want %s", attempt.DispatchState, tc.want)
			}
			if tc.want != "rejected_no_job" {
				if next, err := s.nextRouteAttemptAfterFailure(task, attempt, tc.err); err != nil || next != nil {
					t.Fatalf("uncertain or accepted submission was retried: next=%v err=%v", next, err)
				}
			}
		})
	}
}

func TestCloudAgentImageChannelFailoverPreservesSpecs(t *testing.T) {
	s, db, run, state := commerceImageRecoveryFixture(t)
	original, err := s.repo.ChannelModelByKey("image-channel", "image-test")
	if err != nil {
		t.Fatal(err)
	}
	backup := *original
	backup.ID, backup.ChannelID, backup.PriceTiers = "backup-model", "backup-channel", nil
	for _, row := range []any{
		&model.ModelChannel{ID: backup.ChannelID, Scope: model.ChannelScopeSystem, Enabled: true},
		&backup,
		&model.ChannelModelPriceTier{ID: "backup-tier", ChannelModelID: backup.ID, SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true},
	} {
		if err := s.repo.Create(row); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Model(&model.Task{}).Where("id = ?", state.MediaTaskID).Update("status", model.TaskStatusRunning).Error; err != nil {
		t.Fatal(err)
	}
	task, err := s.repo.TaskForUser("user", state.MediaTaskID)
	if err != nil {
		t.Fatal(err)
	}
	originalPrompt, originalOrder := task.Prompt, task.BillingOrderID
	first, err := s.createDirectTaskAttempt(task)
	if err != nil {
		t.Fatal(err)
	}
	s.finishTaskRouteAttempt(first, task, providerHTTPError{StatusCode: 400})
	next, err := s.switchTaskToNextImageChannel(task, []model.RouteAttempt{*first})
	if err != nil || next == nil {
		var input map[string]any
		_ = json.Unmarshal([]byte(task.InputJSON), &input)
		intent := ModelRequestIntentFromTaskInput(input, task.Type, task.Operation)
		matched, matchErr := s.channelModelMatchesIntent(&backup, &intent)
		t.Fatalf("same model backup unavailable: next=%v err=%v matches=%v matchErr=%v intent=%+v run=%s", next, err, matched, matchErr, intent, run.ID)
	}
	if task.Prompt != originalPrompt || task.BillingOrderID != originalOrder || task.ChannelModelID != backup.ID {
		t.Fatal("image failover changed the prompt, billing identity or selected public model")
	}
	if next.AttemptNumber != 2 || next.ChannelID != backup.ChannelID {
		t.Fatalf("direct attempt identity lost: number=%d channel=%s", next.AttemptNumber, next.ChannelID)
	}
}
