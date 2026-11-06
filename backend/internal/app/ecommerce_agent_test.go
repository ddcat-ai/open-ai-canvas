package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func mockEcommerceAgentService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	t.Setenv("AI_MODE", "mock")
	t.Setenv("TEXT_API_KEY", "")
	t.Setenv("IMAGE_API_KEY", "")
	db, err := gorm.Open(sqlite.Dialector{DriverName: "sqlite", DSN: "file:" + newID() + "?mode=memory&cache=shared"}, &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&model.SystemSetting{}, &model.ModelChannel{}, &model.ChannelModel{}, &model.Resource{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.BillingOrder{}, &model.EcommerceProject{}, &model.EcommerceAgentAnalysis{}, &model.EcommerceAgentRun{}, &model.EcommerceAgentPage{}, &model.EcommerceAgentCanvasVersion{}, &model.User{}, &model.UserGroup{}, &model.UserGroupChannel{}, &model.EcommerceKnowledgeSource{}, &model.EcommerceKnowledgeEntry{}); err != nil {
		t.Fatal(err)
	}
	if err = db.Create(&model.User{ID: "owner", Username: "owner"}).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Create(&model.CreditAccount{UserID: "owner", AvailableMicrocredits: 1_000_000}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"ecommerceEnabled":true,"imageWorkbenchEnabled":true}`}).Error; err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db), dataDir: t.TempDir(), activeCancels: make(map[string]context.CancelFunc)}, db
}

func TestEcommerceAgentVisionFailureFallsBackWithoutCaching(t *testing.T) {
	svc, db := mockEcommerceAgentService(t)
	t.Setenv("AI_MODE", "live")
	t.Setenv("TEXT_API_KEY", "")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []map[string]any{{"message": map[string]string{"content": "not JSON"}}}})
	}))
	defer upstream.Close()
	channel := model.ModelChannel{ID: "vision-fallback-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "Vision fallback", BaseURL: upstream.URL + "/v1", APIKey: "fixture-key", APIFormat: "openai"}
	selected := model.ChannelModel{ID: "vision-fallback-model", ChannelID: channel.ID, ModelKey: "vision-fixture", ProviderModelKey: "vision-fixture", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, Enabled: true, PriceConfigured: true}
	profile := DefaultModelCapabilityConfigForModel(string(selected.Protocol), selected.ModelKey)
	profile.Text.References.MaxImages = 1
	selected.CapabilityConfigJSON = mustEncodeModelCapabilityConfig(t, profile)
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveChannelModel(&selected); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ecommerceAgentSettingKey, ValueJSON: `{"channelModelId":"vision-fallback-model","channelId":"vision-fallback-channel","modelKey":"vision-fixture"}`}); err != nil {
		t.Fatal(err)
	}
	image, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/N3sAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	resourceDir := filepath.Join(svc.dataDir, "resources")
	if err := os.MkdirAll(resourceDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(resourceDir, "product.png"), image, 0600); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Resource{ID: "product", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Provider: "local", ObjectKey: "product.png", Size: int64(len(image))}).Error; err != nil {
		t.Fatal(err)
	}
	req := mockEcommerceRequest()
	req.FileInfoList = []ecommerceagent.FileInfo{{URL: "/api/resources/product/file"}}
	for i := 0; i < 2; i++ {
		analysis, err := svc.AnalyzeEcommerceAgent(context.Background(), "owner", req)
		if err != nil {
			t.Fatal(err)
		}
		if analysis.Brief.Confidence != 0 || !strings.Contains(strings.Join(analysis.Brief.VisualRisks, " "), "未核验商品图") || len(analysis.Recommendations) < 4 {
			t.Fatalf("unsafe fallback: %+v", analysis)
		}
	}
	if calls < 4 {
		t.Fatalf("fallback analysis was cached after vision failure: calls=%d", calls)
	}
}

func TestEcommerceAgentLiveTextUsesAdminChannelWithoutEnvKey(t *testing.T) {
	svc, db := mockEcommerceAgentService(t)
	t.Setenv("AI_MODE", "live")
	t.Setenv("TEXT_API_KEY", "")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer fixture-key" {
			t.Errorf("text channel request path=%q auth=%q", r.URL.Path, r.Header.Get("Authorization"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []map[string]any{{"message": map[string]string{"content": `{"category":"耳机"}`}}}})
	}))
	defer upstream.Close()
	channel := model.ModelChannel{ID: "agent-text-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "Agent text", BaseURL: upstream.URL + "/v1", APIKey: "fixture-key", APIFormat: "openai"}
	selected := model.ChannelModel{ID: "agent-text-model", ChannelID: channel.ID, ModelKey: "gpt-4o-mini", ProviderModelKey: "gpt-4o-mini", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, Enabled: true, PriceConfigured: true}
	profile := DefaultModelCapabilityConfigForModel(string(selected.Protocol), selected.ModelKey)
	profile.Text.References.MaxImages = 1
	selected.CapabilityConfigJSON = mustEncodeModelCapabilityConfig(t, profile)
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveChannelModel(&selected); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ecommerceAgentSettingKey, ValueJSON: `{"channelModelId":"agent-text-model","channelId":"agent-text-channel","modelKey":"gpt-4o-mini"}`}); err != nil {
		t.Fatal(err)
	}
	cfg, err := svc.ecommerceConfiguredText("owner", ecommerceConfig())
	if err != nil {
		t.Fatal(err)
	}
	if err := cfg.validate(); err != nil {
		t.Fatal(err)
	}
	if cfg.TextProvider == nil || cfg.TextProvider.Model != "gpt-4o-mini" || cfg.TextProvider.APIKey != "fixture-key" {
		t.Fatalf("admin text channel was not selected: %+v", cfg.TextProvider)
	}
	var result struct {
		Category string `json:"category"`
	}
	if err := svc.ecommerceChatJSON(context.Background(), cfg, "text-test", "system", "describe", []string{"data:image/png;base64,aGVsbG8="}, &result); err != nil || result.Category != "耳机" {
		t.Fatalf("admin text channel response=%+v err=%v", result, err)
	}
}

func TestEcommerceAgentLiveImageUsesConfiguredChannelModel(t *testing.T) {
	svc, db := mockEcommerceAgentService(t)
	t.Setenv("AI_MODE", "live")
	t.Setenv("ECOMMERCE_PROMOTION_CHANNEL_ID", "image-channel")
	channel := model.ModelChannel{ID: "image-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "Image fixture", BaseURL: "https://example.com/v1", APIKey: "fixture-key", APIFormat: "openai"}
	selected := model.ChannelModel{ID: "image-model", ChannelID: channel.ID, ModelKey: "gpt-image-2", ProviderModelKey: "gpt-image-2", Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, Enabled: true, PriceConfigured: true}
	profile := DefaultModelCapabilityConfigForModel(string(selected.Protocol), selected.ModelKey)
	encodedProfile, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	selected.CapabilityConfigJSON = string(encodedProfile)
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveChannelModel(&selected); err != nil {
		t.Fatal(err)
	}
	req := mockEcommerceRequest()
	req.ModelKey = selected.ModelKey
	cfg, err := svc.ecommerceLiveImageConfig(req, ecommerceConfig())
	if err != nil || cfg.ImageProvider == nil || cfg.ImageProvider.ChannelID != channel.ID || cfg.ImageProvider.CapabilityConfig == nil {
		t.Fatalf("live image channel=%+v err=%v", cfg.ImageProvider, err)
	}
	req.ModelKey = "gpt-image-2-1K"
	if _, err := svc.ecommerceLiveImageConfig(req, ecommerceConfig()); err == nil {
		t.Fatal("unconfigured model alias was accepted")
	}
}

func mockEcommerceRequest() ecommerceagent.Request {
	return ecommerceagent.Request{FileInfoList: []ecommerceagent.FileInfo{{URL: "https://example.invalid/product.png"}}, Query: "蓝牙耳机外观", Platform: "Amazon", Language: "英语", GenerateType: 200, ImageCount: 5, SelectedRecommendationID: "r4", ModelKey: "gpt-image-2-1K", Channel: "promotion", IdempotencyKey: "mock-e2e"}
}

func TestEcommerceAgentMockFullChainAndReplay(t *testing.T) {
	svc, _ := mockEcommerceAgentService(t)
	req := mockEcommerceRequest()
	events := make([]ecommerceagent.Event, 0)
	view, err := svc.GenerateEcommerceAgent(context.Background(), "owner", req, func(e ecommerceagent.Event) error { events = append(events, e); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if view.Run.Status != "completed" || view.Run.SuccessPages != 5 || len(view.Pages) != 5 || view.PosterCanvas == nil {
		t.Fatalf("view=%+v", view)
	}
	if len(events) != 10 || events[0].Event != "workflow_started" || events[1].Event != "node_finished" || events[2].Event != "node_finished" || events[8].Event != "node_finished" || events[9].Event != "message" {
		t.Fatalf("event order=%v", events)
	}
	images := 0
	for _, object := range view.PosterCanvas.Objects {
		if object.Type == "image" {
			images++
		}
		if object.Type == "i-text" && object.Top < 1224 {
			t.Fatalf("Amazon hero contains text: %+v", object)
		}
	}
	if images != 5 {
		t.Fatalf("images=%d", images)
	}
	account, _ := svc.repo.CreditAccount("owner")
	if account.AvailableMicrocredits != 840_000 || account.ReservedMicrocredits != 0 {
		t.Fatalf("account=%+v", account)
	}
	replayed := make([]ecommerceagent.Event, 0)
	other, err := svc.GenerateEcommerceAgent(context.Background(), "owner", req, func(e ecommerceagent.Event) error { replayed = append(replayed, e); return nil })
	if err != nil || other.Run.ID != view.Run.ID || len(replayed) != 7 {
		t.Fatalf("replay=%+v events=%d err=%v", other, len(replayed), err)
	}
	account, _ = svc.repo.CreditAccount("owner")
	if account.AvailableMicrocredits != 840_000 {
		t.Fatal("replay deducted credit")
	}
}

func TestEcommerceAgentDisconnectRefundsUndeliveredPages(t *testing.T) {
	svc, _ := mockEcommerceAgentService(t)
	req := mockEcommerceRequest()
	req.IdempotencyKey = "disconnect"
	var runID string
	completed := 0
	_, err := svc.GenerateEcommerceAgent(context.Background(), "owner", req, func(e ecommerceagent.Event) error {
		if e.Event == "workflow_started" {
			runID = e.TaskID
		}
		if e.Event == "iteration_completed" {
			completed++
			if completed == 3 {
				return errors.New("client disconnected")
			}
		}
		return nil
	})
	if err == nil || runID == "" {
		t.Fatalf("disconnect err=%v run=%q", err, runID)
	}
	view, err := svc.EcommerceAgentTask("owner", runID)
	if err != nil {
		t.Fatal(err)
	}
	if view.Run.SuccessPages != 3 || view.Run.Status != "failed" {
		t.Fatalf("run=%+v", view.Run)
	}
	account, _ := svc.repo.CreditAccount("owner")
	if account.AvailableMicrocredits != 904_000 || account.ReservedMicrocredits != 0 {
		t.Fatalf("partial refund=%+v", account)
	}
}

func TestEcommerceAgentCancelRecordsRemainingPagesAndRefunds(t *testing.T) {
	svc, _ := mockEcommerceAgentService(t)
	req := mockEcommerceRequest()
	req.IdempotencyKey = "cancel-partial"
	var runID string
	completed := 0
	_, err := svc.GenerateEcommerceAgent(context.Background(), "owner", req, func(e ecommerceagent.Event) error {
		if e.Event == "workflow_started" {
			runID = e.TaskID
		}
		if e.Event == "iteration_completed" {
			completed++
			if completed == 2 {
				if _, cancelErr := svc.CancelEcommerceAgent("owner", runID); cancelErr != nil {
					return cancelErr
				}
			}
		}
		return nil
	})
	if err == nil || runID == "" {
		t.Fatalf("cancel err=%v run=%q", err, runID)
	}
	view, err := svc.EcommerceAgentTask("owner", runID)
	if err != nil {
		t.Fatal(err)
	}
	if view.Run.Status != "cancelled" || view.Run.ErrorCode != "CANCELLED" || len(view.Pages) != 5 || view.Run.SuccessPages < 2 || view.Run.SuccessPages >= 5 {
		t.Fatalf("cancelled run=%+v pages=%+v", view.Run, view.Pages)
	}
	for _, page := range view.Pages {
		if page.Status != "completed" && (page.Status != "failed" || page.Error != "CANCELLED") {
			t.Fatalf("unfinished page missing cancellation: %+v", page)
		}
	}
	account, _ := svc.repo.CreditAccount("owner")
	wantAvailable := int64(1_000_000 - view.Run.SuccessPages*32_000)
	if account.AvailableMicrocredits != wantAvailable || account.ReservedMicrocredits != 0 {
		t.Fatalf("partial cancellation account=%+v want available=%d", account, wantAvailable)
	}
}

func TestEcommerceAgentTimeoutRecordsAllPagesAndRefunds(t *testing.T) {
	svc, _ := mockEcommerceAgentService(t)
	t.Setenv("GENERATE_TIMEOUT_MS", "1000")
	req := mockEcommerceRequest()
	req.IdempotencyKey = "timeout-before-render"
	var runID string
	_, err := svc.GenerateEcommerceAgent(context.Background(), "owner", req, func(e ecommerceagent.Event) error {
		if e.Event == "workflow_started" {
			runID = e.TaskID
			time.Sleep(1100 * time.Millisecond)
		}
		return nil
	})
	if err == nil || runID == "" {
		t.Fatalf("timeout err=%v run=%q", err, runID)
	}
	view, err := svc.EcommerceAgentTask("owner", runID)
	if err != nil {
		t.Fatal(err)
	}
	if view.Run.Status != "failed" || view.Run.ErrorCode != "MODEL_TIMEOUT" || view.Run.SuccessPages != 0 || len(view.Pages) != 5 {
		t.Fatalf("timeout run=%+v pages=%+v", view.Run, view.Pages)
	}
	for _, page := range view.Pages {
		if page.Status != "failed" || page.Error != "MODEL_TIMEOUT" {
			t.Fatalf("unfinished page missing timeout: %+v", page)
		}
	}
	account, _ := svc.repo.CreditAccount("owner")
	if account.AvailableMicrocredits != 1_000_000 || account.ReservedMicrocredits != 0 {
		t.Fatalf("timeout refund=%+v", account)
	}
}
