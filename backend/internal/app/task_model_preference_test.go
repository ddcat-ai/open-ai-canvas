package app

import (
	"encoding/json"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func preferredImageFailoverFixture(t *testing.T, mode string) (*Service, *model.Task, *model.RouteAttempt, model.ChannelModel) {
	t.Helper()
	s, db, run, state := commerceImageRecoveryFixture(t)
	var stored map[string]any
	if err := json.Unmarshal([]byte(run.StateJSON), &stored); err != nil {
		t.Fatal(err)
	}
	stored["request"].(map[string]any)["mediaSettings"].(map[string]any)["image"].(map[string]any)["selectionMode"] = mode
	raw, _ := json.Marshal(stored)
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", run.ID).Update("state_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", state.MediaTaskID).Update("status", model.TaskStatusRunning).Error; err != nil {
		t.Fatal(err)
	}
	task, err := s.repo.TaskForUser("user", state.MediaTaskID)
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.createDirectTaskAttempt(task)
	if err != nil {
		t.Fatal(err)
	}
	s.finishTaskRouteAttempt(first, task, providerHTTPError{StatusCode: 400})
	original, err := s.repo.ChannelModelByKey("image-channel", "image-test")
	if err != nil {
		t.Fatal(err)
	}
	return s, task, first, *original
}

func addPreferredFallback(t *testing.T, s *Service, original model.ChannelModel, id, channelID, key string, price int64) model.ChannelModel {
	t.Helper()
	if _, err := s.repo.SystemChannel(channelID); err != nil {
		if err := s.repo.Create(&model.ModelChannel{ID: channelID, Scope: model.ChannelScopeSystem, Enabled: true}); err != nil {
			t.Fatal(err)
		}
	}
	candidate := original
	candidate.ID, candidate.ChannelID, candidate.ModelKey, candidate.DisplayName, candidate.PriceTiers = id, channelID, key, key, nil
	for _, row := range []any{&candidate, &model.ChannelModelPriceTier{ID: id + "-tier", ChannelModelID: id, SelectorKey: "{}", SelectorJSON: "{}", BillingMode: original.BillingMode, UnitPriceMicrocredits: price, PriceConfigured: true, Enabled: true}} {
		if err := s.repo.Create(row); err != nil {
			t.Fatal(err)
		}
	}
	return candidate
}

func TestPreferredImageFallbackNeverRevisitsOriginalModelOnSameChannel(t *testing.T) {
	s, task, first, original := preferredImageFailoverFixture(t, "preferred")
	addPreferredFallback(t, s, original, "second", original.ChannelID, "second-image", 1)
	next, err := s.nextRouteAttemptAfterFailure(task, first, providerHTTPError{StatusCode: 400})
	if err != nil || next == nil {
		t.Fatalf("missing second model: %+v %v", next, err)
	}
	s.finishTaskRouteAttempt(next, task, providerHTTPError{StatusCode: 400})
	if repeated, err := s.nextRouteAttemptAfterFailure(task, next, providerHTTPError{StatusCode: 400}); err != nil || repeated != nil {
		t.Fatalf("must not repeat already rejected original model: %+v %v", repeated, err)
	}
}

func TestPreferredImageFallbackDoesNotRepeatContentRejection(t *testing.T) {
	s, task, first, original := preferredImageFailoverFixture(t, "preferred")
	addPreferredFallback(t, s, original, "other", "other-channel", "other-image", 1)
	first.FailureMessage = "content_policy_violation"
	if err := s.repo.SaveRouteAttempt(first); err != nil {
		t.Fatal(err)
	}
	if next, err := s.nextRouteAttemptAfterFailure(task, first, providerHTTPError{StatusCode: 400}); err != nil || next != nil {
		t.Fatalf("content rejection must require revised prompt: %+v %v", next, err)
	}
}

func TestPreferredImageFallbackPreservesReferenceRequirements(t *testing.T) {
	s, task, first, original := preferredImageFailoverFixture(t, "preferred")
	var profile ModelCapabilityConfig
	if err := json.Unmarshal([]byte(original.CapabilityConfigJSON), &profile); err != nil {
		t.Fatal(err)
	}
	profile.Image.References.MaxImages = 0
	original.CapabilityConfigJSON = mustEncodeModelCapabilityConfig(t, &profile)
	addPreferredFallback(t, s, original, "no-refs", "other-channel", "other-image", 1)
	if next, err := s.nextRouteAttemptAfterFailure(task, first, providerHTTPError{StatusCode: 400}); err != nil || next != nil {
		t.Fatalf("must not drop reference requirements: %+v %v", next, err)
	}
}

func TestPreferredVideoFallbackPreservesApprovedInputAndDoesNotRepeatUnknownSubmission(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	s.routeHealthBlocked = map[string]time.Time{}
	args := cloudAgentMediaArgs{Mode: "video", Prompt: "商品演示", AttachmentResourceIDs: []string{"ref-one"}, Duration: 12, Size: "9:16"}
	choice := CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "seedance-test"}, SelectionMode: "preferred", ParameterMode: "manual", Size: "9:16", DurationSeconds: 12}
	run, state := creationMediaRun(t, s, "preferred-video", args, choice, "auto")
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)
	if state.MediaTaskID == "" {
		t.Fatal("video task not created")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", state.MediaTaskID).Update("status", model.TaskStatusRunning).Error; err != nil {
		t.Fatal(err)
	}
	task, err := s.repo.TaskForUser("user", state.MediaTaskID)
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.createDirectTaskAttempt(task)
	if err != nil {
		t.Fatal(err)
	}
	original, err := s.repo.ChannelModelByKey("channel", "seedance-test")
	if err != nil {
		t.Fatal(err)
	}
	candidate := addPreferredFallback(t, s, *original, "video-backup", "video-backup-channel", "other-video", 1)
	var before map[string]any
	_ = json.Unmarshal([]byte(task.InputJSON), &before)
	s.finishTaskRouteAttempt(first, task, providerHTTPError{StatusCode: 429})
	next, err := s.nextRouteAttemptAfterFailure(task, first, providerHTTPError{StatusCode: 429})
	if err != nil || next == nil || task.Model != candidate.ModelKey {
		t.Fatalf("video rejection did not select compatible backup: %+v %v", next, err)
	}
	var after map[string]any
	_ = json.Unmarshal([]byte(task.InputJSON), &after)
	beforeConfig, afterConfig := before["config"].(map[string]any), after["config"].(map[string]any)
	if mustMarshal(before["referenceImages"]) != mustMarshal(after["referenceImages"]) || beforeConfig["size"] != afterConfig["size"] || beforeConfig["videoSeconds"] != afterConfig["videoSeconds"] {
		t.Fatal("video fallback changed references, ratio or duration")
	}
	addPreferredFallback(t, s, *original, "third-video", "third-channel", "third-video", 1)
	s.finishTaskRouteAttempt(next, task, providerHTTPError{StatusCode: 500})
	if third, err := s.nextRouteAttemptAfterFailure(task, next, providerHTTPError{StatusCode: 500}); err != nil || third != nil || next.DispatchState != "submission_unknown" {
		t.Fatalf("unknown video submission retried: %+v %v", third, err)
	}
}

func TestPreferredImageFallbackUsesCompatibleModelAndReportsActualModel(t *testing.T) {
	s, task, first, original := preferredImageFailoverFixture(t, "preferred")
	// Another model on the same channel must remain eligible; attempts are per model.
	candidate := addPreferredFallback(t, s, original, "other-image", original.ChannelID, "compatible-image", 1)
	prompt, orderID := task.Prompt, task.BillingOrderID
	var before map[string]any
	_ = json.Unmarshal([]byte(task.InputJSON), &before)
	next, err := s.nextRouteAttemptAfterFailure(task, first, providerHTTPError{StatusCode: 400})
	if err != nil || next == nil || next.ChannelModelID != candidate.ID {
		t.Fatalf("compatible preferred fallback missing: %+v %v", next, err)
	}
	stored, err := s.repo.TaskForUser(task.UserID, task.ID)
	if err != nil || stored.Model != candidate.ModelKey || task.Model != candidate.ModelKey || stored.Prompt != prompt || stored.BillingOrderID != orderID {
		t.Fatalf("fallback identity or displayed model incorrect: %+v %v", stored, err)
	}
	var after map[string]any
	_ = json.Unmarshal([]byte(stored.InputJSON), &after)
	if mustMarshal(before["referenceImages"]) != mustMarshal(after["referenceImages"]) || mustMarshal(before["capabilityOptions"]) != mustMarshal(after["capabilityOptions"]) {
		t.Fatal("fallback changed approved references or specifications")
	}
	order, err := s.repo.BillingOrder(orderID)
	if err != nil || order.Model != candidate.ModelKey || order.AmountMicrocredits > order.ChargeLimitMicrocredits {
		t.Fatalf("fallback billing did not retain authorization: %+v %v", order, err)
	}
}

func TestPreferredImageFallbackPrioritizesSameModelAndBoundsAttempts(t *testing.T) {
	s, task, first, original := preferredImageFailoverFixture(t, "preferred")
	addPreferredFallback(t, s, original, "different", "a-different", "another-image", 1)
	same := addPreferredFallback(t, s, original, "same", "z-same", original.ModelKey, 1)
	next, err := s.nextRouteAttemptAfterFailure(task, first, providerHTTPError{StatusCode: 400})
	if err != nil || next == nil || next.ChannelModelID != same.ID {
		t.Fatalf("same-model route was not preferred: %+v %v", next, err)
	}
	s.finishTaskRouteAttempt(next, task, providerHTTPError{StatusCode: 400})
	third, err := s.nextRouteAttemptAfterFailure(task, next, providerHTTPError{StatusCode: 400})
	if err != nil || third == nil || third.AttemptNumber != 3 {
		t.Fatalf("compatible fallback after same-model rejection missing: %+v %v", third, err)
	}
	addPreferredFallback(t, s, original, "fourth", "fourth-channel", "fourth-image", 1)
	s.finishTaskRouteAttempt(third, task, providerHTTPError{StatusCode: 400})
	if fourth, err := s.nextRouteAttemptAfterFailure(task, third, providerHTTPError{StatusCode: 400}); err != nil || fourth != nil {
		t.Fatalf("fallback exceeded bounded attempts: %+v %v", fourth, err)
	}
}

func TestPreferredImageFallbackDoesNotExpandAuthorization(t *testing.T) {
	for _, tc := range []struct {
		name, mode, dispatch string
		price                int64
		fixedInput           bool
	}{
		{"fixed model", "fixed", "rejected_no_job", 1, false},
		{"unknown submission", "preferred", "submission_unknown", 1, false},
		{"accepted submission", "preferred", "accepted", 1, false},
		{"above approved price", "preferred", "rejected_no_job", 2, false},
		{"explicit tool constraint", "preferred", "rejected_no_job", 1, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, task, first, original := preferredImageFailoverFixture(t, tc.mode)
			addPreferredFallback(t, s, original, "other", "other-channel", "other-image", tc.price)
			first.DispatchState = tc.dispatch
			if err := s.repo.SaveRouteAttempt(first); err != nil {
				t.Fatal(err)
			}
			if tc.fixedInput {
				var input map[string]any
				_ = json.Unmarshal([]byte(task.InputJSON), &input)
				input["metadata"].(map[string]any)["modelSelectionMode"] = "fixed"
				task.InputJSON = mustMarshal(input)
			}
			if next, err := s.nextRouteAttemptAfterFailure(task, first, providerHTTPError{StatusCode: 400}); err != nil || next != nil {
				t.Fatalf("unsafe model fallback: %+v %v", next, err)
			}
		})
	}
}

func TestReplayModelChoiceQuotesRemainingBudgetWithoutChargingOrMutatingInputs(t *testing.T) {
	for _, tc := range []struct {
		name, selectionMode, dispatch string
		remaining                     int64
		wantAlternative, wantErr      bool
	}{
		{"more_expensive_within_remaining", "preferred", "rejected_no_job", 3, true, false},
		{"over_remaining", "preferred", "rejected_no_job", 1, false, false},
		{"fixed", "fixed", "rejected_no_job", 3, false, false},
		{"unknown", "preferred", "submission_unknown", 3, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, task, attempt, original := preferredImageFailoverFixture(t, "preferred")
			candidate := addPreferredFallback(t, s, original, "replay-other", original.ChannelID, "replay-image", 2)
			task.Status = model.TaskStatusFailed
			attempt.DispatchState = tc.dispatch
			if err := s.repo.SaveRouteAttempt(attempt); err != nil {
				t.Fatal(err)
			}
			if tc.dispatch == "rejected_no_job" {
				if err := s.repo.RefundBillingOrder(task.BillingOrderID, "test provider rejection"); err != nil {
					t.Fatal(err)
				}
			}
			var input map[string]any
			if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
				t.Fatal(err)
			}
			req := CreateTaskRequest{Type: task.Type, Operation: task.Operation, Prompt: task.Prompt, Model: task.Model, IdempotencyKey: "next-attempt", Input: input}
			beforeInput := mustMarshal(req.Input)
			beforeTasks, _ := s.repo.Tasks(task.UserID, 100, "", false)
			beforeAccount, _ := s.repo.CreditAccount(task.UserID)
			selected, err := s.chooseCloudAgentReplayModel(task.UserID, task, req, &CloudAgentCreationMediaChoice{SelectionMode: tc.selectionMode}, tc.remaining)
			if (err != nil) != tc.wantErr {
				t.Fatalf("selection err=%v wantErr=%v", err, tc.wantErr)
			}
			if tc.wantAlternative && selected.Model != candidate.ModelKey || !tc.wantAlternative && selected.Model != req.Model {
				t.Fatalf("unexpected replay model=%s original=%s", selected.Model, req.Model)
			}
			if selected.Prompt != req.Prompt || selected.IdempotencyKey != req.IdempotencyKey || mustMarshal(req.Input) != beforeInput || mustMarshal(selected.Input["referenceImages"]) != mustMarshal(input["referenceImages"]) {
				t.Fatal("quote changed original request, references or submission identity")
			}
			afterTasks, _ := s.repo.Tasks(task.UserID, 100, "", false)
			afterAccount, _ := s.repo.CreditAccount(task.UserID)
			if len(afterTasks) != len(beforeTasks) || afterAccount.AvailableMicrocredits != beforeAccount.AvailableMicrocredits || afterAccount.ReservedMicrocredits != beforeAccount.ReservedMicrocredits {
				t.Fatal("candidate quote created a task or changed credits")
			}
		})
	}
}

func TestPreferredImageFallbackDoesNotLowerExplicitQuality(t *testing.T) {
	s, task, first, original := preferredImageFailoverFixture(t, "preferred")
	var profile ModelCapabilityConfig
	if err := json.Unmarshal([]byte(original.CapabilityConfigJSON), &profile); err != nil {
		t.Fatal(err)
	}
	profile.Image.Quality = ImageQualityConfig{Supported: true, Values: []string{"low"}, Default: "low"}
	original.CapabilityConfigJSON = mustEncodeModelCapabilityConfig(t, &profile)
	addPreferredFallback(t, s, original, "lower-quality", "other-channel", "low-only-image", 1)
	var input map[string]any
	_ = json.Unmarshal([]byte(task.InputJSON), &input)
	input["config"].(map[string]any)["quality"] = "high"
	task.InputJSON = mustMarshal(input)
	if next, err := s.nextRouteAttemptAfterFailure(task, first, providerHTTPError{StatusCode: 400}); err != nil || next != nil {
		t.Fatalf("explicit high quality was dropped during fallback: %+v %v", next, err)
	}
}

func TestPreferredImageFallbackDoesNotIgnoreEarlierUnknownSubmission(t *testing.T) {
	s, task, first, original := preferredImageFailoverFixture(t, "preferred")
	addPreferredFallback(t, s, original, "other", "other-channel", "other-image", 1)
	first.DispatchState = "submission_unknown"
	if err := s.repo.SaveRouteAttempt(first); err != nil {
		t.Fatal(err)
	}
	last := model.RouteAttempt{ID: "later-rejection", TaskID: task.ID, RouteRun: task.RouteRun, AttemptNumber: 2, Status: "failed", DispatchState: "rejected_no_job", ChannelID: original.ChannelID, ChannelModelID: original.ID}
	if err := s.repo.CreateRouteAttempt(&last); err != nil {
		t.Fatal(err)
	}
	if next, err := s.nextRouteAttemptAfterFailure(task, &last, providerHTTPError{StatusCode: 400}); err != nil || next != nil {
		t.Fatalf("later rejection cannot erase earlier submission uncertainty: %+v %v", next, err)
	}
}
