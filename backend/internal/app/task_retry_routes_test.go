package app

import (
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"strings"
	"testing"
	"yingce/backend/internal/model"
)

func retryRouteFixture(t *testing.T) (*Service, *gorm.DB, model.Task) {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-1")
	for _, line := range []struct {
		id, label string
		price     int64
	}{{"cheap", "特惠", 100}, {"stable", "稳定", 200}, {"other", "其他模型", 300}} {
		display := "Same Model"
		if line.id == "other" {
			display = "Different Model"
		}
		for _, row := range []any{
			&model.ModelChannel{ID: line.id, Scope: model.ChannelScopeSystem, Enabled: true, BaseURL: "https://example.com/v1", APIKey: "private-" + line.id},
			&model.ChannelModel{ID: line.id + "-model", ChannelID: line.id, ModelKey: "gpt-image-1", DisplayName: display, ChannelLabel: line.label, Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, Enabled: true, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, profile)},
			&model.ChannelModelPriceTier{ID: line.id + "-tier", ChannelModelID: line.id + "-model", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: line.price, PriceConfigured: true, Enabled: true, PriceVersion: 1},
		} {
			if err := db.Create(row).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	input := map[string]any{"mode": "image", "prompt": "original prompt", "referenceImages": []any{map[string]any{"storageKey": "resource:original", "mimeType": "image/png"}}, "config": map[string]any{"channelId": "cheap", "model": "gpt-image-1", "size": "1024x1024", "quality": "medium", "count": "1"}}
	raw, _ := json.Marshal(input)
	task := model.Task{ID: "failed-image", UserID: "user", Type: "canvas_image", Status: model.TaskStatusFailed, Prompt: "original prompt", InputJSON: string(raw), RouteRun: 3}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	return s, db, task
}

func TestTaskRetryRoutesMissingUnauthorizedAndActiveTasks(t *testing.T) {
	s, db, task := retryRouteFixture(t)
	for _, tc := range []struct{ user, id string }{{"user", "missing"}, {"another-user", task.ID}} {
		_, quoteErr := s.TaskRetryRoutes(tc.user, tc.id)
		_, retryErr := s.RetryTaskOnRoute(tc.user, tc.id, TaskRetryRouteRequest{})
		for _, err := range []error{quoteErr, retryErr} {
			var appErr *AppError
			if !errors.As(err, &appErr) || appErr.Status != 404 {
				t.Fatalf("missing or unauthorized task returned %v", err)
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				t.Fatalf("missing task lost its diagnostic cause: %v", err)
			}
		}
	}
	if err := db.Model(&task).Update("status", model.TaskStatusRunning).Error; err != nil {
		t.Fatal(err)
	}
	_, err := s.TaskRetryRoutes("user", task.ID)
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Status != 400 {
		t.Fatalf("active task returned %v", err)
	}
}

func TestTaskRetryRoutesQuoteAndAtomicRetry(t *testing.T) {
	s, db, task := retryRouteFixture(t)
	routes, err := s.TaskRetryRoutes("user", task.ID)
	if err != nil || len(routes) != 1 {
		t.Fatalf("routes = %+v: %v", routes, err)
	}
	route := routes[0]
	if route.ChannelID != "stable" || route.Label != "稳定" || route.AmountMicrocredits != 200 {
		t.Fatalf("quote = %+v", route)
	}
	raw, _ := json.Marshal(routes)
	if strings.Contains(string(raw), "private-") || strings.Contains(string(raw), "example.com") {
		t.Fatal("public quote leaked connection")
	}
	var count int64
	db.Model(&model.BillingOrder{}).Count(&count)
	if count != 0 {
		t.Fatal("quote reserved credits")
	}
	req := TaskRetryRouteRequest{ChannelID: route.ChannelID, ModelKey: route.ModelKey, RouteRun: route.RouteRun, PriceVersion: route.PriceVersion, ApprovedAmountMicrocredits: &route.AmountMicrocredits}
	wrong := int64(100)
	stale := req
	stale.ApprovedAmountMicrocredits = &wrong
	if _, err := s.RetryTaskOnRoute("user", task.ID, stale); err == nil {
		t.Fatal("unapproved higher price accepted")
	}
	missing := req
	missing.ApprovedAmountMicrocredits = nil
	if _, err := s.RetryTaskOnRoute("user", task.ID, missing); err == nil {
		t.Fatal("missing approval accepted")
	}
	retried, err := s.RetryTaskOnRoute("user", task.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	if retried.ID != task.ID || retried.RouteRun != 4 || retried.Status != model.TaskStatusQueued {
		t.Fatalf("retry identity = %+v", retried)
	}
	stored, err := s.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(stored.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	config := input["config"].(map[string]any)
	if config["channelId"] != "stable" || input["prompt"] != "original prompt" || input["referenceImages"].([]any)[0].(map[string]any)["storageKey"] != "resource:original" || config["size"] != "1024x1024" {
		t.Fatalf("retry lost original input: %#v", input)
	}
	// Exercise the same server-side credential resolution used by the worker.
	if err := db.Model(&model.ModelChannel{}).Where("id IN ?", []string{"cheap", "stable"}).Update("base_url", "https://8.8.8.8/v1").Error; err != nil {
		t.Fatal(err)
	}
	var execution canvasGenerationInput
	if err := json.Unmarshal([]byte(stored.InputJSON), &execution); err != nil {
		t.Fatal(err)
	}
	resolved, err := s.resolveProviderConfig(execution.Config)
	if err != nil || resolved.APIKey != "private-stable" || resolved.BaseURL != "https://8.8.8.8/v1" {
		t.Fatal("worker did not resolve selected group's credential", err)
	}
	order, err := s.repo.BillingOrder(stored.BillingOrderID)
	if err != nil || order.AmountMicrocredits != 200 || !order.ChargeLimitSet || order.ChargeLimitMicrocredits != 200 {
		t.Fatalf("wrong charge: %+v %v", order, err)
	}
	if _, err := s.RetryTaskOnRoute("user", task.ID, req); err == nil {
		t.Fatal("double retry accepted")
	}
	// Even after the new attempt fails, a delayed submission from the previous quote stays invalid.
	db.Model(&model.Task{}).Where("id = ?", task.ID).Update("status", model.TaskStatusFailed)
	if _, err := s.RetryTaskOnRoute("user", task.ID, req); err == nil {
		t.Fatal("stale retry generation accepted")
	}
	// The repository fence also rejects a caller holding an old prepared task, rolling back its reservation.
	if _, err := s.repo.RetryTaskWithBilling("user", &task, nil, 100); err == nil {
		t.Fatal("repository accepted stale attempt")
	}
	db.Model(&model.BillingOrder{}).Count(&count)
	if count != 1 {
		t.Fatalf("duplicate bill count = %d", count)
	}
}

func TestTaskRetryRoutesRejectUnsafeOrIncompatibleSelection(t *testing.T) {
	s, db, task := retryRouteFixture(t)
	if _, err := s.TaskRetryRoutes("other-user", task.ID); err == nil {
		t.Fatal("cross-user access")
	}
	req := TaskRetryRouteRequest{ChannelID: "other", ModelKey: "gpt-image-1", RouteRun: task.RouteRun}
	if _, err := s.RetryTaskOnRoute("user", task.ID, req); err == nil {
		t.Fatal("different model accepted")
	}
	for _, update := range []map[string]any{{"media_recovery_json": "{}"}, {"agent_run_id": "agent"}, {"stage": "submission_unknown"}, {"status": model.TaskStatusRunning}} {
		if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(update).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := s.TaskRetryRoutes("user", task.ID); err == nil {
			t.Fatalf("unsafe task accepted: %v", update)
		}
		db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"media_recovery_json": "", "agent_run_id": "", "stage": "", "status": model.TaskStatusFailed})
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "stable-model").Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	routes, err := s.TaskRetryRoutes("user", task.ID)
	if err != nil || len(routes) != 0 {
		t.Fatalf("disabled line visible: %+v %v", routes, err)
	}
}

func TestTaskRetryRoutesRefreshPriceAndRespectGroupVisibility(t *testing.T) {
	s, db, task := retryRouteFixture(t)
	routes, err := s.TaskRetryRoutes("user", task.ID)
	if err != nil || len(routes) != 1 {
		t.Fatalf("quote = %+v, %v", routes, err)
	}
	quote := routes[0]
	request := TaskRetryRouteRequest{ChannelID: quote.ChannelID, ModelKey: quote.ModelKey, RouteRun: quote.RouteRun, PriceVersion: quote.PriceVersion, ApprovedAmountMicrocredits: &quote.AmountMicrocredits}
	if err := db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", "stable-tier").Updates(map[string]any{"unit_price_microcredits": 300, "price_version": 2}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.RetryTaskOnRoute("user", task.ID, request); err == nil {
		t.Fatal("old price quote accepted")
	}
	fresh, err := s.TaskRetryRoutes("user", task.ID)
	if err != nil || len(fresh) != 1 || fresh[0].AmountMicrocredits != 300 {
		t.Fatalf("fresh quote = %+v, %v", fresh, err)
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	_, err = s.CreateUserGroup(admin, UserGroupRequest{Code: "restricted", Name: "Restricted", RatioBasisPoints: 10000, PointsPerCNY: CreditScale, ChannelIDs: []string{"cheap"}})
	if err != nil {
		t.Fatal(err)
	}
	group := "restricted"
	if _, err := s.UpdateUser(admin, "user", UpdateUserRequest{UserGroup: &group}); err != nil {
		t.Fatal(err)
	}
	routes, err = s.TaskRetryRoutes("user", task.ID)
	if err != nil || len(routes) != 0 {
		t.Fatalf("private group route visible: %+v, %v", routes, err)
	}
	request.PriceVersion, request.ApprovedAmountMicrocredits = fresh[0].PriceVersion, &fresh[0].AmountMicrocredits
	if _, err := s.RetryTaskOnRoute("user", task.ID, request); err == nil {
		t.Fatal("forged inaccessible channel accepted")
	}
	var count int64
	db.Model(&model.BillingOrder{}).Count(&count)
	if count != 0 {
		t.Fatal("rejected retry reserved credits")
	}
}

func TestTaskRetryRoutesFilterUnsupportedReferenceCount(t *testing.T) {
	s, db, task := retryRouteFixture(t)
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	refs := make([]any, 100)
	for index := range refs {
		refs[index] = map[string]any{"storageKey": "resource:original"}
	}
	input["referenceImages"] = refs
	raw, _ := json.Marshal(input)
	if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Update("input_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	routes, err := s.TaskRetryRoutes("user", task.ID)
	if err != nil || len(routes) != 0 {
		t.Fatalf("incompatible reference count offered: %+v, %v", routes, err)
	}
}

func TestTaskRetryRoutesVideoPreservesDurationAndPricesChosenLine(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	target, err := s.repo.ChannelModelByKey("channel", "seedance-test")
	if err != nil {
		t.Fatal(err)
	}
	target.ID, target.ChannelID, target.ChannelLabel = "video-alternate-model", "video-alternate", "标准"
	for _, item := range []any{
		&model.ModelChannel{ID: "video-alternate", Scope: model.ChannelScopeSystem, Enabled: true}, target,
		&model.ChannelModelPriceTier{ID: "video-alternate-tier", ChannelModelID: target.ID, SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "per_second", UnitPriceMicrocredits: 20, Enabled: true, PriceConfigured: true},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	task := model.Task{ID: "failed-video", UserID: "user", Type: "canvas_video", Operation: "image_to_video", Status: model.TaskStatusFailed, InputJSON: `{"mode":"video","prompt":"keep video prompt","referenceImages":[{"storageKey":"resource:ref-one"}],"config":{"channelId":"channel","model":"seedance-test","videoSeconds":"5","size":"16:9","vquality":"720p","videoGenerateAudio":"true"}}`}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	routes, err := s.TaskRetryRoutes("user", task.ID)
	if err != nil || len(routes) != 1 || routes[0].AmountMicrocredits != 100 {
		t.Fatalf("video quote = %+v, %v", routes, err)
	}
	quote := routes[0]
	_, err = s.RetryTaskOnRoute("user", task.ID, TaskRetryRouteRequest{ChannelID: quote.ChannelID, ModelKey: quote.ModelKey, RouteRun: quote.RouteRun, PriceVersion: quote.PriceVersion, ApprovedAmountMicrocredits: &quote.AmountMicrocredits})
	if err != nil {
		t.Fatal(err)
	}
	stored, err := s.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(stored.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if input.Config.VideoSeconds != "5" || input.Config.Size != "16:9" || input.Config.VideoGenerateAudio != "true" || input.Config.ChannelID != "video-alternate" || len(input.ReferenceImages) != 1 {
		t.Fatal("video retry changed duration, framing or references")
	}
}
