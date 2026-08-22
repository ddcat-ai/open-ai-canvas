package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestChannelFromRequestStoresConnectionWithoutDefaultProtocol(t *testing.T) {
	channel, err := channelFromRequest(ChannelRequest{
		Name:             "混合模型渠道",
		BaseURL:          "https://8.8.8.8/v1",
		APIKey:           "access-key",
		SecretKey:        "secret-key",
		ConcurrencyLimit: intPtr(6),
		Models:           []string{"seedance-2.0"},
	}, model.ModelChannel{})
	if err != nil {
		t.Fatalf("channelFromRequest() error = %v", err)
	}
	if channel.APIFormat != "openai" {
		t.Fatalf("APIFormat = %q, want openai", channel.APIFormat)
	}
	if channel.ConcurrencyLimit != 6 {
		t.Fatalf("ConcurrencyLimit = %d, want 6", channel.ConcurrencyLimit)
	}
	if channel.APIKey != "access-key" || channel.SecretKey != "secret-key" {
		t.Fatal("channel credentials were not stored")
	}
}

func TestMergeChannelRequestSupportsEnabledOnlyPatch(t *testing.T) {
	enabled := false
	req := mergeChannelRequest(ChannelRequest{Enabled: &enabled}, model.ModelChannel{
		Name:        "Video",
		BaseURL:     "https://example.com/v1",
		APIFormat:   "openai",
		ModelsJSON:  `["custom-video"]`,
		HeadersJSON: `[{"name":"User-Agent","value":"Stored Agent"}]`,
	})
	if req.Name != "Video" || req.BaseURL != "https://example.com/v1" || len(req.Models) != 1 || len(req.Headers) != 1 {
		t.Fatalf("mergeChannelRequest() = %#v", req)
	}
}

func TestChannelFromRequestStoresAndClearsHeaders(t *testing.T) {
	request := ChannelRequest{Name: "Headers", BaseURL: "https://example.com/v1", Headers: []OutboundHeader{{Name: "User-Agent", Value: "Custom Agent"}}}
	channel, err := channelFromRequest(request, model.ModelChannel{})
	if err != nil {
		t.Fatal(err)
	}
	if channel.HeadersJSON != `[{"name":"User-Agent","value":"Custom Agent"}]` {
		t.Fatalf("HeadersJSON = %q", channel.HeadersJSON)
	}

	request.Headers = []OutboundHeader{}
	channel, err = channelFromRequest(request, channel)
	if err != nil {
		t.Fatal(err)
	}
	if channel.HeadersJSON != `[]` {
		t.Fatalf("cleared HeadersJSON = %q", channel.HeadersJSON)
	}
}

func TestPublicChannelOnlyReturnsSystemHeadersToAdmin(t *testing.T) {
	channel := model.ModelChannel{ID: "system-1", Scope: model.ChannelScopeSystem, BaseURL: "https://example.com/v1", HeadersJSON: `[{"name":"X-Gateway-Tenant","value":"tenant-a"}]`}
	adminView := publicChannel(channel, true, nil)
	if len(adminView.Headers) != 1 || adminView.Headers[0].Name != "X-Gateway-Tenant" {
		t.Fatalf("admin headers = %#v", adminView.Headers)
	}
	userView := publicChannel(channel, false, nil)
	if len(userView.Headers) != 0 {
		t.Fatalf("user headers = %#v", userView.Headers)
	}
}

func TestChannelFromRequestRejectsInvalidConcurrencyLimit(t *testing.T) {
	for _, limit := range []int{0, 1000} {
		_, err := channelFromRequest(ChannelRequest{Name: "Bad", BaseURL: "https://example.com/v1", ConcurrencyLimit: &limit}, model.ModelChannel{})
		if err == nil {
			t.Fatalf("channelFromRequest() concurrencyLimit = %d, error = nil", limit)
		}
	}
}

func TestRuntimeConcurrencyUsesEnvironmentFallback(t *testing.T) {
	t.Setenv("CANVAS_CHANNEL_CONCURRENCY", "7")
	t.Setenv("CANVAS_WORKER_CONCURRENCY", "9")
	setting := defaultRuntimePolicy().Task
	if setting.ChannelConcurrency != 7 || setting.WorkerConcurrency != 9 {
		t.Fatalf("runtimeConcurrencyFromEnvironment() = %#v", setting)
	}

	useGlobal := true
	channel, err := channelFromRequest(ChannelRequest{Name: "Global", BaseURL: "https://example.com/v1", UseGlobalConcurrency: &useGlobal}, model.ModelChannel{ConcurrencyLimit: 4})
	if err != nil || channel.ConcurrencyLimit != 0 {
		t.Fatalf("global concurrency channel = %#v, error = %v", channel, err)
	}
}

func TestFetchAdminChannelModelsReaddsDeletedModel(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"model-a"}]}`))
	}))
	defer upstream.Close()

	svc, db := newChannelModelTestService(t)
	svc.runtimeCapabilities = RuntimeCapabilities{desktopLocalChannels: true}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "channel-1", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true, Name: "Test", BaseURL: upstream.URL + "/v1", APIKey: "key", APIFormat: "openai", ModelsJSON: `[]`, AllowLocalChannel: true}
	deleted := model.ChannelModel{ID: "deleted-model", ChannelID: channel.ID, ModelKey: "model-a", DisplayName: "model-a", BillingMode: "fixed_request", PriceVersion: 1}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&deleted).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&deleted).Error; err != nil {
		t.Fatal(err)
	}

	result, err := svc.FetchAdminChannelModels(context.Background(), admin, channel.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Added != 1 {
		t.Fatalf("Added = %d, want 1", result.Added)
	}
	var active model.ChannelModel
	if err := db.First(&active, "channel_id = ? AND model_key = ?", channel.ID, "model-a").Error; err != nil {
		t.Fatal(err)
	}
	if active.ID == deleted.ID || active.Enabled || active.PriceConfigured {
		t.Fatalf("re-added model = %#v", active)
	}
	var total int64
	if err := db.Unscoped().Model(&model.ChannelModel{}).Where("channel_id = ? AND model_key = ?", channel.ID, "model-a").Count(&total).Error; err != nil {
		t.Fatal(err)
	}
	if total != 2 {
		t.Fatalf("model history count = %d, want 2", total)
	}
}

func TestSaveAdminChannelModelRejectsActiveDuplicateKey(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "channel-1", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true, Name: "Test", BaseURL: "https://example.com/v1", APIKey: "key", APIFormat: "openai", ModelsJSON: `[]`}
	items := []model.ChannelModel{
		{ID: "model-a", ChannelID: channel.ID, ModelKey: "model-a", DisplayName: "Model A", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, BillingMode: "fixed_request", Enabled: true, PriceVersion: 1},
		{ID: "model-b", ChannelID: channel.ID, ModelKey: "model-b", DisplayName: "Model B", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, BillingMode: "fixed_request", Enabled: true, PriceVersion: 1},
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&items).Error; err != nil {
		t.Fatal(err)
	}
	enabled := true
	_, err := svc.SaveAdminChannelModel(admin, channel.ID, items[0].ID, ChannelModelRequest{ModelKey: "model-b", DisplayName: "Duplicate", Capability: "text", Protocol: string(model.ChannelInterfaceChatCompletion), BillingMode: "fixed_request", Enabled: &enabled})
	var authErr *AuthError
	if !errors.As(err, &authErr) || authErr.Status != http.StatusBadRequest || authErr.Message != "该渠道已存在模型 model-b，请直接编辑已有模型" {
		t.Fatalf("SaveAdminChannelModel() error = %#v", err)
	}
}

func TestResolveProviderConfigMapsSKUToProviderModel(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	svc.dataDir = t.TempDir()
	channel := model.ModelChannel{
		ID: "channel-1", Scope: model.ChannelScopeSystem, Enabled: true, Name: "Seedance",
		BaseURL: "https://ark.cn-beijing.volces.com/api/v3", APIKey: "test-key", APIFormat: "openai", ModelsJSON: `["seedance-2-5-480p"]`,
	}
	if err := svc.encryptSystemChannelSecrets(&channel); err != nil {
		t.Fatal(err)
	}
	item := model.ChannelModel{
		ID: "model-1", ChannelID: channel.ID, ModelKey: "seedance-2-5-480p", ProviderModelKey: "doubao-seedance-2-5",
		Capability: "video", Protocol: model.ChannelInterfaceVolcengineArkVideo, Enabled: true,
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}

	config, err := svc.resolveProviderConfig(providerConfig{ChannelID: channel.ID, Model: item.ModelKey})
	if err != nil {
		t.Fatal(err)
	}
	if config.ChannelModelKey != item.ModelKey || config.Model != item.ProviderModelKey {
		t.Fatalf("resolved config = %#v", config)
	}
}

func TestValidateTaskCapabilityFixesSingleResolutionSKU(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	video := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceVolcengineArkVideo), "doubao-seedance-2-5").Video
	video.References.MaxVideos = 0
	video.Resolutions = []string{"480p"}
	video.DefaultResolution = "480p"
	encoded, err := json.Marshal(&ModelCapabilityConfig{Version: 1, Video: video})
	if err != nil {
		t.Fatal(err)
	}
	channelModel := model.ChannelModel{
		ID: "model-480p", ChannelID: "channel-1", ModelKey: "doubao-seedance-2-5-480p", ProviderModelKey: "doubao-seedance-2-5",
		Capability: "video", Protocol: model.ChannelInterfaceVolcengineArkVideo, Enabled: true, CapabilityConfigJSON: string(encoded),
	}
	if err := db.Create(&channelModel).Error; err != nil {
		t.Fatal(err)
	}
	input := map[string]any{
		"mode": "video",
		"config": map[string]any{
			"channelId": "channel-1", "model": channelModel.ModelKey, "vquality": "auto", "videoSeconds": "6", "size": "16:9",
			"videoGenerateAudio": "true", "videoWatermark": "false",
		},
	}
	if err := svc.ValidateTaskCapability(input); err != nil {
		t.Fatal(err)
	}
	config := input["config"].(map[string]any)
	if got := config["vquality"]; got != "480p" {
		t.Fatalf("vquality = %#v, want 480p", got)
	}
}

func newChannelModelTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ModelChannel{}, &model.ChannelModel{}, &model.IDSequence{}); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db)}, db
}

func intPtr(value int) *int { return &value }
