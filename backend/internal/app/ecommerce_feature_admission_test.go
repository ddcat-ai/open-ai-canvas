package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func ecommerceCreationTestService(t *testing.T) (*Service, *gorm.DB, string, CreationGuard) {
	t.Helper()
	s, db, id, guard := creationTestService(t)
	features := defaultFeatureAvailability()
	features.EcommerceEnabled, features.EcommerceVideoEnabled, features.SiteAssistantEnabled = true, true, true
	features.ImageWorkbenchEnabled, features.VideoWorkbenchEnabled = true, true
	saveAdmissionFeatures(t, s, features)
	return s, db, id, guard
}

func saveAdmissionFeatures(t *testing.T, s *Service, value FeatureAvailability) {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: string(encoded)}); err != nil {
		t.Fatal(err)
	}
}

func TestEcommerceFeatureAliasesAndJSONSchema(t *testing.T) {
	s, _ := newFeatureAvailabilityTestService(t)
	features := defaultFeatureAvailability()
	features.EcommerceEnabled, features.EcommerceVideoEnabled, features.SiteAssistantEnabled = true, true, true
	saveAdmissionFeatures(t, s, features)
	for _, feature := range []string{FeatureEcommerce, FeatureEcommerceVideo, FeatureSiteAssistant} {
		if enabled, err := s.FeatureEnabled(feature); err != nil || !enabled {
			t.Fatalf("feature %q = %v, %v", feature, enabled, err)
		}
	}
	if _, err := s.FeatureEnabled("Ecommerce"); err == nil {
		t.Fatal("feature names must use the canonical case")
	}
	public, err := s.FeatureAvailability()
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(public)
	if err != nil {
		t.Fatal(err)
	}
	var schema map[string]any
	if err := json.Unmarshal(encoded, &schema); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"ecommerceEnabled", "ecommerceVideoEnabled", "siteAssistantEnabled"} {
		if value, ok := schema[field].(bool); !ok || !value {
			t.Fatalf("field %s = %#v", field, schema[field])
		}
	}
}

func TestEcommerceTaskAdmissionUsesOwnedProjectAndMediaKind(t *testing.T) {
	s, db, _, _ := ecommerceCreationTestService(t)
	project, err := s.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	foreign := &model.EcommerceProject{ID: "foreign-commerce", UserID: "other", DraftJSON: "{}", PlanJSON: "{}", Revision: 1}
	if err := db.Create(foreign).Error; err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, taskType, mode, projectID, source, metadataProject, want string
		ecommerce, image, video, ecommerceVideo                        bool
	}{
		{name: "project_without_source", taskType: "canvas_text", projectID: project.ID, want: "电商创作"},
		{name: "untrusted_source", taskType: "canvas_text", source: "ecommerce-agent", ecommerce: true, want: "必须关联"},
		{name: "foreign_project", taskType: "canvas_image", metadataProject: foreign.ID, ecommerce: true, image: true, want: "项目不存在"},
		{name: "image_disabled", taskType: "canvas_image", projectID: project.ID, ecommerce: true, want: "生图"},
		{name: "image_enabled", taskType: "canvas_image", projectID: project.ID, ecommerce: true, image: true},
		{name: "video_as_text_type", taskType: "canvas_text", mode: "video", projectID: project.ID, ecommerce: true, video: true, want: "电商视频"},
		{name: "new_video_disabled", taskType: "canvas_video", projectID: project.ID, ecommerce: true, video: true, want: "电商视频"},
		{name: "old_video_disabled", taskType: "canvas_video", projectID: project.ID, ecommerce: true, ecommerceVideo: true, want: "视频暂未开放"},
		{name: "video_enabled", taskType: "canvas_video", projectID: project.ID, ecommerce: true, video: true, ecommerceVideo: true},
		{name: "planning_without_media", taskType: "canvas_text", projectID: project.ID, ecommerce: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			features := defaultFeatureAvailability()
			features.EcommerceEnabled, features.ImageWorkbenchEnabled = tc.ecommerce, tc.image
			features.VideoWorkbenchEnabled, features.EcommerceVideoEnabled = tc.video, tc.ecommerceVideo
			saveAdmissionFeatures(t, s, features)
			input := map[string]any{"mode": tc.mode, "metadata": map[string]any{"source": tc.source, "ecommerceProjectId": tc.metadataProject}}
			err := s.requireTaskGenerationFeatures("user", tc.projectID, tc.taskType, "", "", input)
			if tc.want == "" && err != nil || tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)) {
				t.Fatalf("admission = %v, want %q", err, tc.want)
			}
		})
	}
}

func TestEcommerceDisabledWritesKeepHistoryAndManualRetryGate(t *testing.T) {
	s, db, _, _ := ecommerceCreationTestService(t)
	project, err := s.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	task := &model.Task{ID: newID(), UserID: "user", ProjectID: project.ID, Type: "canvas_text", Status: model.TaskStatusFailed, InputJSON: `{"mode":"text","config":{"channelId":"channel","model":"text-test"}}`}
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	saveAdmissionFeatures(t, s, defaultFeatureAvailability())
	checks := []func() error{
		func() error { _, err := s.CreateEcommerceProject("user"); return err },
		func() error {
			_, err := s.SaveEcommerceProject("user", project.ID, SaveEcommerceProjectRequest{})
			return err
		},
		func() error {
			_, err := s.CreateEcommercePlanningTask("user", project.ID, CreateTaskRequest{})
			return err
		},
		func() error {
			_, err := s.RecommendEcommerceCreativeDirections("user", EcommerceCreativeDirectionsRequest{})
			return err
		},
		func() error {
			_, err := s.AnalyzeEcommerceAgent(context.Background(), "user", ecommerceagent.Request{})
			return err
		},
		func() error {
			_, err := s.GenerateEcommerceAgent(context.Background(), "user", ecommerceagent.Request{}, func(ecommerceagent.Event) error { return nil })
			return err
		},
		func() error { _, err := s.RetryTask("user", task.ID); return err },
	}
	for index, check := range checks {
		var denied *AuthError
		if err := check(); !errors.As(err, &denied) || denied.Status != 403 {
			t.Fatalf("write %d = %v", index, err)
		}
	}
	if _, err := s.EcommerceProject("user", project.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.EcommerceProjects("user"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Task("user", task.ID); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{WorkbenchKindImage, WorkbenchKindVideo} {
		if _, err := s.WorkbenchTasks("user", kind, false, 10); err != nil {
			t.Fatalf("history %s: %v", kind, err)
		}
	}
	if _, err := s.EcommerceManagedSkills(&model.User{ID: "admin", Role: model.UserRoleAdmin}); err != nil {
		t.Fatalf("admin configuration was gated: %v", err)
	}
}

func TestEcommerceAcceptedResultPersistenceAndCancellationStayOpen(t *testing.T) {
	s, db, _, _ := ecommerceCreationTestService(t)
	project, err := s.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	task := &model.Task{ID: newID(), UserID: "user", ProjectID: project.ID, Type: "canvas_text", Status: model.TaskStatusQueued, Stage: "等待队列调度", InputJSON: `{}`}
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	saveAdmissionFeatures(t, s, defaultFeatureAvailability())
	platform, _ := ecommerceagent.PlatformFor("淘宝")
	brief := ecommerceagent.Brief{Category: "耳机"}
	analysis := ecommerceagent.Analysis{Brief: brief, Recommendations: ecommerceagent.MockStyleRecommendations(brief, platform, "main", 3, "1:1")}
	if _, err := s.storeEcommerceWorkbenchDirections("user", project.ID, EcommerceDraft{ProductName: "耳机", Category: "数码", Platform: "taobao", ImageType: "main", Count: 3, Ratio: "1:1"}, analysis); err != nil {
		t.Fatalf("accepted result was gated: %v", err)
	}
	if _, err := s.CancelTask(context.Background(), "user", task.ID); err != nil {
		t.Fatalf("queued cancellation was gated: %v", err)
	}
}

type ecommerceQueuedExecutionProbe struct {
	*Service
	calls int
}

func (p *ecommerceQueuedExecutionProbe) processTask(context.Context, model.Task) (map[string]interface{}, []map[string]interface{}, error) {
	p.calls++
	return nil, nil, errors.New("upstream timeout")
}

func TestEcommerceQueuedFeatureCheckPreservesAcceptedWork(t *testing.T) {
	for _, tc := range []struct {
		name, dispatch, requestID string
		uncertain                 bool
		wantCalls                 int
	}{
		{name: "unsent"},
		{name: "uncertain_billing", uncertain: true},
		{name: "accepted", dispatch: "accepted", uncertain: true, wantCalls: 1},
		{name: "unknown", dispatch: "submission_unknown", uncertain: true, wantCalls: 1},
		{name: "provider_id", requestID: "accepted-request", uncertain: true, wantCalls: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db := newMediaRecoveryTestService(t)
			project := &model.EcommerceProject{ID: newID(), UserID: "user", DraftJSON: "{}", PlanJSON: "{}", Revision: 1}
			task := &model.Task{ID: newID(), UserID: "user", ProjectID: project.ID, Type: "canvas_text", Status: model.TaskStatusQueued, InputJSON: `{"mode":"text","config":{"channelId":"system","model":"test"}}`, RouteRun: 1, ProviderRequestID: tc.requestID}
			order := &model.BillingOrder{ID: newID(), UserID: "user", TaskID: task.ID, IdempotencyKey: newID(), Status: model.BillingStatusReserved, AmountMicrocredits: 100, ReservedAmountMicrocredits: 100}
			if tc.name == "uncertain_billing" {
				order.Status = model.BillingStatusUncertain
			}
			if tc.wantCalls > 0 {
				order.ProviderRequestID = "accepted-request"
			}
			task.BillingOrderID = order.ID
			for _, value := range []any{project, task, order, &model.CreditAccount{UserID: "user", AvailableMicrocredits: 900, ReservedMicrocredits: 100}} {
				if err := db.Create(value).Error; err != nil {
					t.Fatal(err)
				}
			}
			if tc.dispatch != "" {
				attempt := &model.RouteAttempt{ID: newID(), TaskID: task.ID, RouteRun: 1, DispatchState: tc.dispatch, ProviderRequestID: "accepted-attempt", Status: "selected", AttemptNumber: 1}
				if err := db.Create(attempt).Error; err != nil {
					t.Fatal(err)
				}
			}
			claimed, err := s.repo.ClaimNextTask("worker", time.Minute)
			if err != nil || claimed == nil {
				t.Fatalf("claim = %v, %v", claimed, err)
			}
			probe := &ecommerceQueuedExecutionProbe{Service: s}
			s.taskRouteExecutor = &taskRouteExecutor{port: probe}
			_ = s.taskWorker().processClaimedTask(claimed, nil)
			stored, err := s.repo.Task(task.ID)
			if err != nil {
				t.Fatal(err)
			}
			if probe.calls != tc.wantCalls || tc.wantCalls == 0 && !strings.Contains(stored.Error, "电商创作") {
				t.Fatalf("worker calls=%d error=%q", probe.calls, stored.Error)
			}
			bill, err := s.repo.BillingOrder(order.ID)
			if err != nil {
				t.Fatal(err)
			}
			wantStatus := model.BillingStatusRefunded
			if tc.uncertain {
				wantStatus = model.BillingStatusUncertain
			}
			if bill.Status != wantStatus {
				t.Fatalf("billing = %s, want %s", bill.Status, wantStatus)
			}
		})
	}
}
