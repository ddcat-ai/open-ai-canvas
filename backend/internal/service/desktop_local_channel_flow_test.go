package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestModelChannelAllowLocalDefaultsFalseAfterAutoMigrate(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ModelChannel{}); err != nil {
		t.Fatal(err)
	}
	channel := model.ModelChannel{ID: "legacy-channel", Name: "Legacy", BaseURL: "https://example.com", Scope: model.ChannelScopeSystem, Enabled: true}
	if err := db.Omit("AllowLocalChannel").Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	var stored model.ModelChannel
	if err := db.First(&stored, "id = ?", channel.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.AllowLocalChannel {
		t.Fatal("legacy row must migrate with allowLocalChannel=false")
	}
}

func TestSystemChannelAllowLocalSaveRequiresCapabilityAndPatchPreservesOmission(t *testing.T) {
	requested := true
	closed := &Service{}
	_, err := closed.channelFromRequest(ChannelRequest{Name: "Local", BaseURL: "http://127.0.0.1:8000", AllowLocalChannel: &requested}, model.ModelChannel{Scope: model.ChannelScopeSystem})
	if err == nil {
		t.Fatal("server capability=false must reject saving allowLocalChannel=true")
	}
	if _, err := closed.channelFromRequest(ChannelRequest{Name: "Forged", BaseURL: "https://8.8.8.8", AllowLocalChannel: &requested}, model.ModelChannel{Scope: model.ChannelScopeSystem}); err == nil {
		t.Fatal("server capability=false must reject persisting a forged allowLocalChannel=true flag even for a public Base URL")
	}

	open := &Service{runtimeCapabilities: RuntimeCapabilities{desktopLocalChannels: true}}
	channel, err := open.channelFromRequest(ChannelRequest{Name: "Local", BaseURL: "http://127.0.0.1:8000", AllowLocalChannel: &requested}, model.ModelChannel{Scope: model.ChannelScopeSystem})
	if err != nil {
		t.Fatalf("channelFromRequest() error = %v", err)
	}
	if !channel.AllowLocalChannel || channel.BaseURL != "http://127.0.0.1:8000" {
		t.Fatalf("stored channel = %#v", channel)
	}

	merged := mergeChannelRequest(ChannelRequest{Enabled: boolPtr(false)}, channel)
	if merged.AllowLocalChannel == nil || !*merged.AllowLocalChannel {
		t.Fatal("PATCH omitting allowLocalChannel must preserve stored true")
	}
}

func TestPublicSystemChannelHidesLocalAddressAndLocalFlagFromOrdinaryUsers(t *testing.T) {
	channel := model.ModelChannel{
		ID: "system-local", Scope: model.ChannelScopeSystem, Enabled: true, Name: "Desktop Local",
		BaseURL: "http://127.0.0.1:8000", APIKey: "secret", AllowLocalChannel: true,
	}
	admin := publicChannel(channel, true, nil)
	if admin.BaseURL != channel.BaseURL || !admin.AllowLocalChannel {
		t.Fatalf("admin channel = %#v", admin)
	}
	user := publicChannel(channel, false, nil)
	if user.BaseURL != "/api/ai/system/system-local" || user.APIKey != "system" || user.AllowLocalChannel {
		t.Fatalf("ordinary user channel leaked local configuration: %#v", user)
	}
}

func TestCustomModelCatalogConsumesAllowLocalChannelAndServerCapability(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"local-model"}]}`))
	}))
	defer upstream.Close()
	actor := &model.User{ID: "user-1"}
	input := ChannelModelsRequest{BaseURL: upstream.URL, APIKey: "test-key", APIFormat: "openai", AllowLocalChannel: true}

	closed := &Service{}
	if _, err := closed.FetchChannelModelCatalog(context.Background(), actor, input); err == nil {
		t.Fatal("model catalog must reject forged allowLocalChannel=true when server capability=false")
	}

	open := &Service{runtimeCapabilities: RuntimeCapabilities{desktopLocalChannels: true}}
	catalog, err := open.FetchChannelModelCatalog(context.Background(), actor, input)
	if err != nil {
		t.Fatalf("FetchChannelModelCatalog() error = %v", err)
	}
	if len(catalog) != 1 || catalog[0].ID != "local-model" {
		t.Fatalf("catalog = %#v", catalog)
	}
}

func TestCustomModelCatalogPreservesPublicCapabilityMetadataWithoutCompatibilityIDs(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[
			{"id":"image-fast","display_name":"Image Fast","model_type":"image"},
			{"id":"image-quality","display_name":"Image Quality","model_type":"image"},
			{"id":"omni","capability_id":"omni-flash","display_name":"Omni Flash","model_type":"video","supports_images":false,"min_images":0,"max_images":0,"default_parameters":{"aspect_ratio":"16:9","duration_seconds":"10"},"options":{"aspect_ratio":[{"value":"16:9"},{"value":"9:16"}],"duration_seconds":[{"value":"8"},{"value":"10"}]},"compatibility_map":[{"parameters":{"aspect_ratio":"9:16","duration_seconds":"10"},"model_id":"omni_portrait_10s"}]},
			{"id":"veo-lite","display_name":"Veo Lite","model_type":"video"},
			{"id":"veo-fast","display_name":"Veo Fast","model_type":"video"},
			{"id":"veo-quality","display_name":"Veo Quality","model_type":"video"}
		]}`))
	}))
	defer upstream.Close()

	svc := &Service{runtimeCapabilities: RuntimeCapabilities{desktopLocalChannels: true}}
	catalog, err := svc.FetchChannelModelCatalog(context.Background(), &model.User{ID: "user-1"}, ChannelModelsRequest{
		BaseURL: upstream.URL, APIKey: "test-key", APIFormat: "openai", AllowLocalChannel: true,
	})
	if err != nil {
		t.Fatalf("FetchChannelModelCatalog() error = %v", err)
	}
	if len(catalog) != 6 {
		t.Fatalf("catalog length = %d; want 6", len(catalog))
	}
	var omni *ChannelModelCatalogItem
	for index := range catalog {
		if catalog[index].ID == "omni" {
			omni = &catalog[index]
			break
		}
	}
	if omni == nil {
		t.Fatal("catalog is missing public omni capability")
	}
	if omni.DisplayName != "Omni Flash" || omni.ModelType != "video" {
		t.Fatalf("omni metadata = %#v", omni)
	}
	if omni.DefaultParameters.AspectRatio != "16:9" || omni.DefaultParameters.DurationSeconds != "10" {
		t.Fatalf("omni defaults = %#v", omni.DefaultParameters)
	}
	if got := optionValues(omni.Options.DurationSeconds); len(got) != 2 || got[0] != "8" || got[1] != "10" {
		t.Fatalf("omni duration options = %#v", got)
	}
	encoded, err := json.Marshal(catalog)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "omni_portrait_10s") || strings.Contains(string(encoded), "compatibility") {
		t.Fatalf("ordinary catalog exposed compatibility IDs: %s", encoded)
	}
}

func optionValues(options []ChannelModelCatalogOption) []string {
	values := make([]string, 0, len(options))
	for _, option := range options {
		values = append(values, option.Value)
	}
	return values
}

func TestSystemWorkerRestartReevaluatesStoredLocalFlagAgainstServerCapability(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ModelChannel{}, &model.ChannelModel{}); err != nil {
		t.Fatal(err)
	}
	channel := model.ModelChannel{
		ID: "channel-local", UserID: "admin", Scope: model.ChannelScopeSystem, Enabled: true, Name: "Local",
		BaseURL: "http://127.0.0.1:8000", APIKey: "key", APIFormat: "openai", ModelsJSON: `["text-model"]`, AllowLocalChannel: true,
	}
	channelModel := model.ChannelModel{ID: "model-local", ChannelID: channel.ID, ModelKey: "text-model", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, BillingMode: "fixed_request", Enabled: true, PriceConfigured: true}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&channelModel).Error; err != nil {
		t.Fatal(err)
	}
	repo := repository.New(db)
	open := &Service{repo: repo, runtimeCapabilities: RuntimeCapabilities{desktopLocalChannels: true}}
	resolved, err := open.resolveProviderConfig(providerConfig{ChannelID: channel.ID, Model: "text-model"})
	if err != nil {
		t.Fatalf("desktop resolveProviderConfig() error = %v", err)
	}
	if !resolved.AllowLocalChannel {
		t.Fatal("desktop worker must retain the effective local policy in resolved provider config")
	}
	encoded, err := json.Marshal(resolved)
	if err != nil {
		t.Fatal(err)
	}
	var recovered providerConfig
	if err := json.Unmarshal(encoded, &recovered); err != nil {
		t.Fatal(err)
	}
	closedAfterRestart := &Service{repo: repo, runtimeCapabilities: RuntimeCapabilities{desktopLocalChannels: false}}
	if _, err := closedAfterRestart.resolveProviderConfig(recovered); err == nil {
		t.Fatal("restart with server capability=false must reject a DB/task payload that still carries allowLocalChannel=true")
	}
}

func TestCustomTaskInputRecoveryReevaluatesLocalFlagAgainstServerCapability(t *testing.T) {
	input, err := normalizeTaskInput(map[string]any{
		"mode":   "text",
		"config": providerConfig{BaseURL: "http://127.0.0.1:8000", APIKey: "key", Model: "text-model", AllowLocalChannel: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	var recovered canvasGenerationInput
	if err := json.Unmarshal(encoded, &recovered); err != nil {
		t.Fatal(err)
	}
	if !recovered.Config.AllowLocalChannel {
		t.Fatal("task InputJSON recovery lost allowLocalChannel")
	}
	closed := &Service{}
	if _, err := closed.resolveProviderConfig(recovered.Config); err == nil {
		t.Fatal("recovered custom task must fail closed when server capability=false")
	}
	open := &Service{runtimeCapabilities: RuntimeCapabilities{desktopLocalChannels: true}}
	resolved, err := open.resolveProviderConfig(recovered.Config)
	if err != nil || !resolved.AllowLocalChannel {
		t.Fatalf("desktop recovered config = %#v, error = %v", resolved, err)
	}
}

func TestSystemChannelOutboundClientUsesStoredLocalFlagAndCapability(t *testing.T) {
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer source.Close()
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "false")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "")

	closed := &Service{}
	if _, err := closed.ValidateChannelOutboundURL(source.URL, true, false); err == nil {
		t.Fatal("stored allowLocalChannel=true must remain closed when server capability=false")
	}

	open := &Service{runtimeCapabilities: RuntimeCapabilities{desktopLocalChannels: true}}
	target, err := open.ValidateChannelOutboundURL(source.URL, true, false)
	if err != nil {
		t.Fatalf("ValidateChannelOutboundURL() error = %v", err)
	}
	request, _ := http.NewRequest(http.MethodGet, target.String(), nil)
	response, err := open.OutboundHTTPClientForChannel(time.Second, target, true).Do(request)
	if err != nil {
		t.Fatalf("OutboundHTTPClientForChannel() error = %v", err)
	}
	_ = response.Body.Close()
}

func boolPtr(value bool) *bool { return &value }
