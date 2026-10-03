package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/platform"
)

func imageFailoverFixture(t *testing.T) (*Service, *gorm.DB, *model.Task, model.ChannelModel) {
	t.Helper()
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-2.5")
	s, db, channel, original := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceOpenAIImage, profile, []model.ChannelModelPriceTier{newSelectionPriceTier("original-tier", `{}`, "original-provider", "fixed_request")})
	if err := db.AutoMigrate(&model.RouteAttempt{}, &model.SystemSetting{}, &model.BillingOrder{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	original.DisplayName = "GPT-Images"
	if err := db.Model(&original).Update("display_name", original.DisplayName).Error; err != nil {
		t.Fatal(err)
	}
	backup := original
	backup.ID, backup.ChannelID, backup.ModelKey = "backup-model", "backup-channel", "gpt-image-2.5-sunburst"
	backup.PriceTiers = nil
	backupChannel := model.ModelChannel{ID: backup.ChannelID, Scope: model.ChannelScopeSystem, Name: "备用渠道", Enabled: true, APIFormat: "legacy"}
	tier := newSelectionPriceTier("backup-tier", `{}`, "backup-provider", "fixed_request")
	tier.ChannelModelID = backup.ID
	for _, row := range []any{&backupChannel, &backup, &tier, &model.CreditAccount{UserID: "user", AvailableMicrocredits: 1_000_000}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	input, err := s.resolveSystemChannelModelSelection(map[string]any{"mode": "image", "prompt": "商品场景图", "config": map[string]any{"channelId": channel.ID, "model": original.ModelKey, "size": "1024x1024", "count": "1"}}, "canvas_image", "image")
	if err != nil {
		t.Fatal(err)
	}
	order, err := s.newBillingOrder("user", "image-task", "image-request", channel.ID, original.ModelKey, "image", "image", 1, tokenBillingEstimate{})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.repo.ReserveBillingOrder(order); err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(input)
	task := &model.Task{ID: "image-task", UserID: "user", Type: "canvas_image", Status: model.TaskStatusRunning, Prompt: "商品场景图", Model: original.ModelKey, InputJSON: string(encoded), BillingOrderID: order.ID, Attempts: 1}
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	return s, db, task, backup
}

func TestImageFailoverDirectChannelRejectionSwitchesOnceWithoutCreatingAnotherTask(t *testing.T) {
	for _, code := range []int{400, 422} {
		t.Run(fmt.Sprint(code), func(t *testing.T) {
			s, db, task, backup := imageFailoverFixture(t)
			first, err := s.createDirectTaskAttempt(task)
			if err != nil {
				t.Fatal(err)
			}
			failure := providerHTTPError{StatusCode: code, Body: `{"error":{"message":"generate image failed"}}`}
			s.finishTaskRouteAttempt(first, task, failure)
			next, err := s.nextRouteAttemptAfterFailure(task, first, failure)
			if err != nil || next == nil || next.ChannelID != backup.ChannelID || next.ChannelModelID != backup.ID {
				t.Fatalf("did not switch direct image channel: next=%+v err=%v", next, err)
			}
			var stored model.Task
			db.First(&stored, "id = ?", task.ID)
			var input canvasGenerationInput
			json.Unmarshal([]byte(stored.InputJSON), &input)
			if stored.ID != "image-task" || stored.Status != model.TaskStatusRunning || input.Prompt != "商品场景图" || input.Config.ChannelID != backup.ChannelID || input.Config.ChannelModelKey != backup.ModelKey || input.Config.Size != "1024x1024" {
				t.Fatalf("task or parameters changed incorrectly: %+v %+v", stored, input.Config)
			}
			var order model.BillingOrder
			db.First(&order, "id = ?", task.BillingOrderID)
			if order.ChannelID != backup.ChannelID || order.AmountMicrocredits != 10 {
				t.Fatalf("billing did not follow fallback: %+v", order)
			}
			s.finishTaskRouteAttempt(next, task, failure)
			last, err := s.nextRouteAttemptAfterFailure(task, next, failure)
			if err != nil || last != nil {
				t.Fatalf("exhausted channels must stop: %+v %v", last, err)
			}
			var tasks, orders int64
			db.Model(&model.Task{}).Count(&tasks)
			db.Model(&model.BillingOrder{}).Count(&orders)
			if tasks != 1 || orders != 1 {
				t.Fatalf("fallback duplicated tasks or bills: %d %d", tasks, orders)
			}
		})
	}
}

func TestImageFailoverEmptyCompletedResultClearsFailedProviderJob(t *testing.T) {
	s, db, task, backup := imageFailoverFixture(t)
	task.ProviderRequestID = "finished-without-images"
	if err := s.repo.UpdateTaskProviderState(task.ID, task.ProviderRequestID, "provider_processing", nil); err != nil {
		t.Fatal(err)
	}
	attempt, _ := s.createDirectTaskAttempt(task)
	_, failure := imageDataURLs(imageResponse{})
	s.finishTaskRouteAttempt(attempt, task, failure)
	if attempt.DispatchState != "failed_no_output" || attempt.ProviderRequestID != "finished-without-images" {
		t.Fatalf("completed empty result lost terminal evidence: %+v", attempt)
	}
	next, err := s.nextRouteAttemptAfterFailure(task, attempt, failure)
	if err != nil || next == nil || next.ChannelID != backup.ChannelID {
		t.Fatalf("empty result did not switch: %+v %v", next, err)
	}
	var stored model.Task
	db.First(&stored, "id = ?", task.ID)
	if task.ProviderRequestID != "" || stored.ProviderRequestID != "" || stored.PollStage != "" {
		t.Fatalf("fallback would poll the previous failed job: memory=%s saved=%+v", task.ProviderRequestID, stored)
	}
}

func TestImageFailoverStopsForUnknownSubmissionCancellationAndHigherQuote(t *testing.T) {
	for _, failure := range []error{context.Canceled, context.DeadlineExceeded, errors.New("connection reset"), providerHTTPError{StatusCode: 524}, &mediaRecoveryError{stage: "download", cause: errors.New("storage unavailable")}} {
		s, _, task, _ := imageFailoverFixture(t)
		attempt, _ := s.createDirectTaskAttempt(task)
		s.finishTaskRouteAttempt(attempt, task, failure)
		if next, err := s.nextRouteAttemptAfterFailure(task, attempt, failure); next != nil || err != nil {
			t.Fatalf("unsafe fallback for %v: %+v %v", failure, next, err)
		}
	}
	s, db, task, _ := imageFailoverFixture(t)
	db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", "backup-tier").Update("unit_price_microcredits", 11)
	attempt, _ := s.createDirectTaskAttempt(task)
	failure := providerHTTPError{StatusCode: 400}
	s.finishTaskRouteAttempt(attempt, task, failure)
	if next, err := s.nextRouteAttemptAfterFailure(task, attempt, failure); next != nil || err != nil {
		t.Fatalf("fallback exceeded original quote: %+v %v", next, err)
	}
	var order model.BillingOrder
	db.First(&order, "id = ?", task.BillingOrderID)
	if order.AmountMicrocredits != 10 || order.ChannelID == "backup-channel" {
		t.Fatalf("unavailable fallback changed billing: %+v", order)
	}
}

func TestImageFailoverRecordsDirectChannelAndRecognizesBusinessFailure(t *testing.T) {
	s, _, task, _ := imageFailoverFixture(t)
	attempt, err := s.createDirectTaskAttempt(task)
	if err != nil || attempt.ChannelID == "" || attempt.ChannelModelID == "" {
		t.Fatalf("direct attempt has no channel identity: %+v %v", attempt, err)
	}
	failure := providerPayloadError{message: "generate image failed"}
	s.finishTaskRouteAttempt(attempt, task, failure)
	if attempt.DispatchState != "rejected_no_job" {
		t.Fatalf("business failure not retryable: %+v", attempt)
	}
	if next, err := s.nextRouteAttemptAfterFailure(task, attempt, failure); next == nil || err != nil {
		t.Fatalf("business failure did not switch: %+v %v", next, err)
	}
}

func TestImageFailoverExecutorRunsBackupProviderAfterHTTPRejection(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	s, db, task, backup := imageFailoverFixture(t)
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{ID: "user", Username: "image-failover", Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	s.coordinator = platform.NewCoordinatorWithRedis(nil, "image-failover-test")
	s.dataDir = t.TempDir()
	var picture bytes.Buffer
	if err := png.Encode(&picture, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input map[string]any
		json.NewDecoder(r.Body).Decode(&input)
		if input["prompt"] != "商品场景图" || input["size"] != "1024x1024" {
			t.Errorf("fallback changed prompt or dimensions: %+v", input)
		}
		calls = append(calls, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		if strings.HasPrefix(r.URL.Path, "/primary/") {
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprint(w, `{"error":{"message":"generate image failed"}}`)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{{"b64_json": base64.StdEncoding.EncodeToString(picture.Bytes())}}})
	}))
	defer server.Close()
	first, err := s.createDirectTaskAttempt(task)
	if err != nil {
		t.Fatal(err)
	}
	for channelID, path := range map[string]string{first.ChannelID: "/primary", backup.ChannelID: "/backup"} {
		if err := db.Model(&model.ModelChannel{}).Where("id = ?", channelID).Updates(map[string]any{"base_url": server.URL + path, "api_key": "test-key"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	result, err := s.routeExecutor().execute(context.Background(), task, first)
	if err != nil || result.err != nil || !result.providerSucceeded || result.result == nil {
		t.Fatalf("actual fallback generation failed: %+v %v; provider: %v", result, err, result.err)
	}
	if len(calls) != 2 || calls[0] != "/primary/v1/images/generations" || calls[1] != "/backup/v1/images/generations" {
		t.Fatalf("unexpected upstream calls: %v", calls)
	}
	attempts, err := s.repo.RouteAttempts(task.ID, task.RouteRun)
	if err != nil || len(attempts) != 2 || attempts[0].DispatchState != "rejected_no_job" || attempts[1].Status != "succeeded" {
		t.Fatalf("fallback attempts not persisted: %+v %v", attempts, err)
	}
}
