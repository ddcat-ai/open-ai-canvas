package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestCommerceImageRepairOnlyForContentRejection(t *testing.T) {
	for _, tc := range []struct {
		name, code, message string
		want                bool
	}{
		{"content", "upstream_400", "prompt may violate our content policies", true},
		{"content_policy", "upstream_400", "request blocked by content policy", true},
		{"parameter", "upstream_400", "invalid image size", false},
		{"authentication", "upstream_403", "access forbidden", false},
		{"rate_limit", "upstream_429", "too many requests", false},
		{"accounts", "upstream_503", "No available compatible accounts", false},
		{"service", "upstream_502", "Upstream service temporarily unavailable", false},
		{"access_blocked", "upstream_403", "request blocked by gateway security policy", false},
		{"mentions_safety", "upstream_400", "invalid parameter: safety setting is unsupported", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db, run, state := commerceImageRecoveryFixture(t)
			id := cloudAgentCommerceTaskID("user", state.CommercePlan, "scene", state.Request.SessionID)
			failCommerceImage(t, s, db, id)
			if err := db.Model(&model.Task{}).Where("id = ?", id).Update("error", tc.message).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.RouteAttempt{}).Where("task_id = ?", id).Updates(map[string]any{"failure_code": tc.code, "failure_message": tc.message}).Error; err != nil {
				t.Fatal(err)
			}
			task, _ := s.repo.TaskForUser("user", id)
			got, err := s.cloudAgentCommerceImageCanRepair(run, &state, task)
			if err != nil || got != tc.want {
				t.Fatalf("repair=%v want=%v err=%v", got, tc.want, err)
			}
		})
	}
}

func TestCommerceRetryUnchangedPromptAndSubmissionSafety(t *testing.T) {
	for _, tc := range []struct {
		name, dispatch, message string
		includePrompt, wantErr  bool
	}{
		{"service_same_prompt", "rejected_no_job", "No available compatible accounts", true, false},
		{"content_same_prompt", "rejected_no_job", "prompt may violate our content policies", true, true},
		{"content_no_prompt", "rejected_no_job", "prompt may violate our content policies", false, true},
		{"unknown_without_prompt", "submission_unknown", "Upstream service temporarily unavailable", false, true},
		{"accepted_without_prompt", "accepted", "failed after acceptance", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db, _, state := commerceImageRecoveryFixture(t)
			id := cloudAgentCommerceTaskID("user", state.CommercePlan, "scene", state.Request.SessionID)
			failCommerceImage(t, s, db, id)
			if err := db.Model(&model.Task{}).Where("id = ?", id).Update("error", tc.message).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.RouteAttempt{}).Where("task_id = ?", id).Updates(map[string]any{"dispatch_state": tc.dispatch, "failure_message": tc.message}).Error; err != nil {
				t.Fatal(err)
			}
			args := map[string]any{"mode": "image", "commercePlanId": state.CommercePlan.PlanID, "commerceItemId": "scene", "retryFailedTaskId": id}
			if tc.includePrompt {
				args["retryPrompt"] = state.CommercePlan.Items[1].Prompt
			}
			raw, _ := json.Marshal(args)
			call := cloudAgentCall{ID: "retry-original"}
			call.Function.Name, call.Function.Arguments = "generate_media", string(raw)
			_, _, err := s.cloudAgentResolvedMediaCall("user", &state, call)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err=%v wantErr=%v", err, tc.wantErr)
			}
			if tc.name == "service_same_prompt" && err != nil && strings.Contains(err.Error(), "修复提示词") {
				t.Fatal("service rejection was incorrectly treated as a prompt rejection")
			}
		})
	}
}

func TestCloudAgentMediaRetryPolicyRequiresConfirmedSubmissionOutcome(t *testing.T) {
	for _, tc := range []struct {
		name, dispatch, status, providerID, diagnostic string
		wantErr                                        bool
	}{
		{name: "known_rejection", dispatch: "rejected_no_job", status: "failed"},
		{name: "known_no_output", dispatch: "failed_no_output", status: "failed"},
		{name: "selected_not_sent", dispatch: "not_sent", status: "selected"},
		{name: "failed_not_sent", dispatch: "not_sent", status: "failed"},
		{name: "unrecorded", wantErr: true},
		{name: "preparation_rejected", diagnostic: `{"submissionOutcome":"not_submitted"}`},
		{name: "diagnostic_unknown", diagnostic: `{"submissionOutcome":"unknown"}`, wantErr: true},
		{name: "diagnostic_contradiction", diagnostic: `{"submissionOutcome":"not_submitted","taskSubmitted":true}`, wantErr: true},
		{name: "unknown_502", dispatch: "submission_unknown", status: "failed", wantErr: true},
		{name: "accepted", dispatch: "accepted", status: "failed", wantErr: true},
		{name: "provider_id", dispatch: "rejected_no_job", status: "failed", providerID: "provider-task", wantErr: true},
		{name: "dispatching", dispatch: "not_sent", status: "dispatching", wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db, _ := agentMediaFixture(t)
			task := &model.Task{ID: "retry-source", UserID: "user", Type: "canvas_image", Status: model.TaskStatusFailed, RouteRun: 1, Error: "Upstream service temporarily unavailable (HTTP 502)", ExecutionDiagnosticJSON: tc.diagnostic}
			if tc.dispatch != "" {
				if err := db.Create(&model.RouteAttempt{ID: "retry-route", TaskID: task.ID, RouteRun: 1, Status: tc.status, DispatchState: tc.dispatch, ProviderRequestID: tc.providerID, FailureCode: "upstream_502"}).Error; err != nil {
					t.Fatal(err)
				}
			}
			policy, err := s.cloudAgentMediaRetryPolicy("user", task)
			if (err != nil) != tc.wantErr || policy.RequiresPromptChange {
				t.Fatalf("policy=%+v err=%v wantErr=%v", policy, err, tc.wantErr)
			}
		})
	}
}

func TestCloudAgentMediaRetryPolicyProtectsOwnershipResultsAndBilling(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	for _, scenario := range []string{"image", "video", "audio", "foreign", "running", "success", "cancelled", "provider_id", "cancel_pending", "result_recovery", "billing_uncertain", "billing_missing"} {
		t.Run(scenario, func(t *testing.T) {
			task := &model.Task{ID: scenario, UserID: "user", Type: "canvas_image", Status: model.TaskStatusFailed, ExecutionDiagnosticJSON: `{"submissionOutcome":"not_submitted"}`}
			switch scenario {
			case "video", "audio":
				task.Type = "canvas_" + scenario
			case "foreign":
				task.UserID = "other"
			case "running":
				task.Status = model.TaskStatusRunning
			case "success":
				task.Status = model.TaskStatusSucceeded
			case "cancelled":
				task.Status = model.TaskStatusCancelled
			case "provider_id":
				task.ProviderRequestID = "provider-task"
			case "cancel_pending":
				task.ProviderCancelStatus = model.ProviderCancelStatusRequested
			case "result_recovery":
				task.MediaRecoveryJSON = `{}`
			case "billing_uncertain":
				task.BillingOrderID = "uncertain-order"
				if err := db.Create(&model.BillingOrder{ID: task.BillingOrderID, UserID: "user", Status: model.BillingStatusUncertain}).Error; err != nil {
					t.Fatal(err)
				}
			case "billing_missing":
				task.BillingOrderID = "missing-order"
			}
			_, err := s.cloudAgentMediaRetryPolicy("user", task)
			wantErr := scenario != "image" && scenario != "video" && scenario != "audio"
			if (err != nil) != wantErr {
				t.Fatalf("err=%v wantErr=%v", err, wantErr)
			}
		})
	}
}

func TestCloudAgentMediaRetryPolicyChecksAllAttemptsAndLatestReason(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	task := &model.Task{ID: "mixed-routes", UserID: "user", Type: "canvas_image", Status: model.TaskStatusFailed, RouteRun: 1}
	for i, message := range []string{"prompt may violate our content policies", "No available compatible accounts"} {
		if err := db.Create(&model.RouteAttempt{ID: message, TaskID: task.ID, RouteRun: 1, AttemptNumber: i + 1, Status: "failed", DispatchState: "rejected_no_job", FailureMessage: message}).Error; err != nil {
			t.Fatal(err)
		}
	}
	policy, err := s.cloudAgentMediaRetryPolicy("user", task)
	if err != nil || policy.RequiresPromptChange {
		t.Fatalf("account outage must not inherit earlier content failure: %+v %v", policy, err)
	}
	if err := db.Model(&model.RouteAttempt{}).Where("task_id = ? AND attempt_number = 1", task.ID).Update("dispatch_state", "submission_unknown").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.cloudAgentMediaRetryPolicy("user", task); err == nil {
		t.Fatal("a later rejection cannot clear an earlier unknown submission")
	}
}

func TestCreationRetryChecksOriginalBillingBeforeCreatingRun(t *testing.T) {
	for _, tc := range []struct {
		name                                                 string
		status                                               model.BillingStatus
		invalidOwner, invalidTask, missing, noOrder, allowed bool
	}{
		{name: "reserved", status: model.BillingStatusReserved},
		{name: "running", status: model.BillingStatusRunning},
		{name: "uncertain", status: model.BillingStatusUncertain},
		{name: "wrong_user", status: model.BillingStatusRefunded, invalidOwner: true},
		{name: "wrong_task", status: model.BillingStatusSettled, invalidTask: true},
		{name: "missing", missing: true},
		{name: "settled", status: model.BillingStatusSettled, allowed: true},
		{name: "refunded", status: model.BillingStatusRefunded, allowed: true},
		{name: "unbilled_predispatch", noOrder: true, allowed: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db, _ := agentMediaFixture(t)
			s.legacyCloudAgentRootTask = false
			req := creationAgentRequest()
			root, err := s.CreateCloudAgentRun("user", req, "")
			if err != nil {
				t.Fatal(err)
			}
			completeCreationReferenceRun(t, db, root.ID)
			task := model.Task{ID: "failed-source", UserID: "user", AgentRunID: root.ID, Type: "canvas_image", Status: model.TaskStatusFailed, InputJSON: `{}`, ExecutionDiagnosticJSON: `{"submissionOutcome":"not_submitted"}`}
			if !tc.noOrder {
				task.BillingOrderID = "source-bill"
				if !tc.missing {
					order := model.BillingOrder{ID: task.BillingOrderID, TaskID: task.ID, UserID: task.UserID, Status: tc.status, IdempotencyKey: task.ID}
					if tc.invalidOwner {
						order.UserID = "other"
					}
					if tc.invalidTask {
						order.TaskID = "other-task"
					}
					if err := db.Create(&order).Error; err != nil {
						t.Fatal(err)
					}
				}
			}
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}
			_, policyErr := s.cloudAgentMediaRetryPolicy("user", &task)
			if (policyErr == nil) != tc.allowed {
				t.Fatalf("policy allowed=%v want=%v err=%v", policyErr == nil, tc.allowed, policyErr)
			}
			req.SessionID, req.IdempotencyKey = root.SessionID, "billing-retry"
			req.Retry = &CloudAgentCreationRetry{RunID: root.ID, TaskID: task.ID}
			_, err = s.CreateCloudAgentRun("user", req, root.ID)
			if (err == nil) != tc.allowed {
				t.Fatalf("run creation allowed=%v want=%v err=%v", err == nil, tc.allowed, err)
			}
			var count int64
			if err := db.Model(&model.CloudAgentExecution{}).Where("user_id = ?", "user").Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			want := int64(1)
			if tc.allowed {
				want = 2
			}
			if count != want {
				t.Fatalf("run count=%d want=%d", count, want)
			}
		})
	}
}

func TestCreationMediaCarriesModelPreferenceWithoutExpandingAuthorization(t *testing.T) {
	for _, tc := range []struct {
		name, mode, want string
		locked           bool
	}{
		{name: "legacy_unspecified_stays_fixed", want: "fixed"},
		{name: "preferred", mode: "preferred", want: "preferred"},
		{name: "user_fixed", mode: "fixed", want: "fixed"},
		{name: "tool_tightens", mode: "preferred", locked: true, want: "fixed"},
		{name: "tool_cannot_loosen", mode: "fixed", want: "fixed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, _, run, state := commerceImageRecoveryFixture(t)
			choice := state.Request.MediaSettings.Image
			raw := mustMarshal(map[string]any{"selectionMode": tc.mode})
			if err := json.Unmarshal([]byte(raw), choice); err != nil {
				t.Fatal(err)
			}
			var args cloudAgentMediaArgs
			if err := json.Unmarshal([]byte(mustMarshal(map[string]any{"mode": "image", "prompt": "original scene", "requirePreferredModel": tc.locked})), &args); err != nil {
				t.Fatal(err)
			}
			req, _, err := s.prepareCloudAgentCreationMedia(run, &state, args, "preference-test")
			if err != nil {
				t.Fatal(err)
			}
			metadata, _ := req.Input["metadata"].(map[string]any)
			if metadata["modelSelectionMode"] != tc.want || mustMarshal(metadata["preferredModelSelection"]) != mustMarshal(choice.Selection) {
				t.Fatalf("model preference missing or changed: %+v", metadata)
			}
			if req.Model != choice.Selection.ChannelModelKey || req.Prompt != "original scene" {
				t.Fatalf("preference changed original generation: %+v", req)
			}
		})
	}
}

func TestCreationBatchAndCommercePreserveExplicitModelLock(t *testing.T) {
	s, _, run, state := commerceImageRecoveryFixture(t)
	state.Request.MediaSettings.Image.SelectionMode = "preferred"
	call := cloudAgentCall{ID: "locked-batch"}
	call.Function.Name, call.Function.Arguments = "generate_image_batch", `{"items":[{"id":"locked","title":"locked","prompt":"same product","requirePreferredModel":true},{"id":"preferred","title":"preferred","prompt":"same product"}]}`
	batch, err := s.prepareCloudAgentImageBatch(run, &state, call)
	if err != nil {
		t.Fatal(err)
	}
	for index, want := range []string{"fixed", "preferred"} {
		metadata := batch.Items[index].Request.Input["metadata"].(map[string]any)
		if metadata["modelSelectionMode"] != want {
			t.Fatalf("batch item %d lost scope: %+v", index, metadata)
		}
	}
	call.Function.Name, call.Function.Arguments = "generate_media", mustMarshal(map[string]any{"mode": "image", "commercePlanId": state.CommercePlan.PlanID, "commerceItemId": "scene", "requirePreferredModel": true})
	compiled, err := cloudAgentCommerceMediaCall(state.CommercePlan, call)
	if err != nil {
		t.Fatal(err)
	}
	var args cloudAgentMediaArgs
	if err := json.Unmarshal([]byte(compiled.Function.Arguments), &args); err != nil || !args.RequirePreferredModel {
		t.Fatalf("commerce compiler dropped explicit model constraint: %+v %v", args, err)
	}
}
