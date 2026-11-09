package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
	"yingce/backend/internal/protocol"
)

// Logical selection and direct system-channel selection must
// produce the same native Gemini request, without bypassing task admission.
func TestProtocolTextMultimodalGeminiTaskRouting(t *testing.T) {
	t.Setenv("AI_MODE", "live")
	t.Setenv("TEXT_API_KEY", "")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	svc, db, channel, channelModel := textVisionFixtureWithDB(t, 1)
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	svc.dataDir = t.TempDir()
	svc.coordinator = platform.NewCoordinatorWithRedis(nil, "protocol-text-multimodal")
	svc.platform = platform.New(svc.repo, svc.coordinator, platformHost{svc: svc})
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc.pluginRuntime = center
	userID := testGroupUserID(svc)
	if err := db.Create(&model.CreditAccount{UserID: userID, AvailableMicrocredits: 1_000_000}).Error; err != nil {
		t.Fatal(err)
	}
	picture := mediaTestPNG(t)
	if err := os.MkdirAll(filepath.Join(svc.dataDir, "resources"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(svc.dataDir, "resources", "reference.png"), picture, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Resource{ID: "text-image", UserID: userID, Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Provider: "local", ObjectKey: "reference.png", Size: int64(len(picture))}).Error; err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var bodies []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1beta/models/provider-text:generateContent" {
			t.Errorf("unexpected upstream request: %s %s", r.Method, r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		mu.Lock()
		bodies = append(bodies, body)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"role":"model","parts":[{"text":"recognized"}]}}]}`))
	}))
	defer server.Close()
	if err := db.Model(&channel).Updates(map[string]any{"base_url": server.URL, "api_key": "fixture-key", "api_format": "openai"}).Error; err != nil {
		t.Fatal(err)
	}
	channelModel.Protocol = model.ChannelInterfaceType("gemini-generate-content")
	if err := db.Model(&channelModel).Update("protocol", channelModel.Protocol).Error; err != nil {
		t.Fatal(err)
	}
	profile, err := normalizedChannelModelCapability(&channelModel, center.registrySnapshot())
	if err != nil {
		t.Fatal(err)
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(profile, "text")
	if err != nil {
		t.Fatal(err)
	}
	specJSON, err := json.Marshal(spec)
	if err != nil {
		t.Fatal(err)
	}
	logical := model.LogicalModel{ID: "logical-vision", Code: "logical-vision", Name: "Vision", Capability: "text", Enabled: true, ActiveRevisionID: "vision-revision", PricePolicy: "channel", BillingMode: "fixed_request"}
	revision := model.LogicalModelRevision{ID: logical.ActiveRevisionID, LogicalModelID: logical.ID, Version: 1, CapabilitySpecJSON: string(specJSON), DefaultOptionsJSON: `{}`}
	route := model.LogicalModelRoute{ID: "vision-route", LogicalModelRevisionID: revision.ID, ChannelModelID: channelModel.ID, Enabled: true, Weight: 1}
	for _, row := range []any{&logical, &revision, &route} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	const prompt = "Describe the product image."
	for _, tc := range []struct {
		name     string
		frontend bool
	}{
		{name: "frontend_models_on_logical", frontend: true},
		{name: "frontend_models_off_direct", frontend: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			features := defaultFeatureAvailability()
			features.FrontendModelsEnabled = tc.frontend
			saveAdmissionFeatures(t, svc, features)
			config := map[string]any{}
			logicalID := logical.ID
			if !tc.frontend {
				logicalID = ""
				config["channelId"], config["model"] = channel.ID, channelModel.ModelKey
			}
			input := map[string]any{"mode": "text", "prompt": prompt, "config": config, "textOptions": map[string]any{"stream": false}, "referenceImages": []any{map[string]any{"storageKey": "resource:text-image", "mimeType": "image/png"}}}
			task, err := svc.CreateTask(userID, CreateTaskRequest{Type: "canvas_text", Prompt: prompt, LogicalModelID: logicalID, Input: input})
			if err != nil {
				t.Fatalf("task admission: %v", err)
			}
			if task.LogicalModelID != logicalID {
				t.Fatalf("logical model = %q, want %q", task.LogicalModelID, logicalID)
			}
			stored, err := svc.repo.TaskForUser(userID, task.ID)
			if err != nil {
				t.Fatal(err)
			}
			result, _, err := svc.processTask(context.Background(), *stored)
			if err != nil || result["text"] != "recognized" {
				t.Fatalf("actual task provider result = %#v, err = %v", result, err)
			}
			var orders int64
			if err := db.Model(&model.BillingOrder{}).Where("task_id = ?", task.ID).Count(&orders).Error; err != nil {
				t.Fatal(err)
			}
			if orders != 1 {
				t.Fatalf("billing orders = %d, want one", orders)
			}
		})
	}
	// Reject at actual admission before reserving any additional credits or
	// dispatching the provider, regardless of which catalog selected the channel.
	profile.Text.References.MaxImages = 0
	if err := db.Model(&channelModel).Update("capability_config_json", mustEncodeModelCapabilityConfig(t, profile)).Error; err != nil {
		t.Fatal(err)
	}
	rejectedSpec, err := CapabilitySpecFromModelCapabilityConfig(profile, "text")
	if err != nil {
		t.Fatal(err)
	}
	rejectedSpecJSON, err := json.Marshal(rejectedSpec)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&revision).Update("capability_spec_json", string(rejectedSpecJSON)).Error; err != nil {
		t.Fatal(err)
	}
	svc.routeCatalog = nil
	for _, frontend := range []bool{true, false} {
		features := defaultFeatureAvailability()
		features.FrontendModelsEnabled = frontend
		saveAdmissionFeatures(t, svc, features)
		config, logicalID := map[string]any{}, logical.ID
		if !frontend {
			logicalID = ""
			config["channelId"], config["model"] = channel.ID, channelModel.ModelKey
		}
		input := map[string]any{"mode": "text", "prompt": prompt, "config": config, "referenceImages": []any{map[string]any{"storageKey": "resource:text-image", "mimeType": "image/png"}}}
		if _, err := svc.CreateTask(userID, CreateTaskRequest{Type: "canvas_text", Prompt: prompt, LogicalModelID: logicalID, Input: input}); err == nil {
			t.Fatalf("non-vision model accepted image input with frontend models=%v", frontend)
		}
	}
	var orders, tasks int64
	if err := db.Model(&model.BillingOrder{}).Count(&orders).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Count(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	if orders != 2 || tasks != 2 {
		t.Fatalf("rejected admission created work: orders=%d tasks=%d, want two successful tasks only", orders, tasks)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(bodies) != 2 {
		t.Fatalf("upstream calls = %d, want exactly one per mode", len(bodies))
	}
	for _, body := range bodies {
		assertProtocolTextMultimodalGeminiContents(t, body, prompt, base64.StdEncoding.EncodeToString(picture))
	}
	if !reflect.DeepEqual(bodies[0], bodies[1]) {
		t.Fatalf("same channel and input produced different requests: logical=%#v direct=%#v", bodies[0], bodies[1])
	}
}

func assertProtocolTextMultimodalGeminiContents(t *testing.T, body any, prompt, imageBase64 string) {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	want := []any{map[string]any{"role": "user", "parts": []any{
		map[string]any{"text": prompt},
		map[string]any{"inlineData": map[string]any{"mimeType": "image/png", "data": imageBase64}},
	}}}
	if !reflect.DeepEqual(decoded["contents"], want) {
		t.Fatalf("Gemini contents must contain a scalar text part and exactly one native image part: got %#v, want %#v", decoded["contents"], want)
	}
}

// Bootstrap must replace the old text=array mapping from the
// installed official artifact, even when an administrator disabled the plugin.
func TestProtocolTextMultimodalOfficialPackageRefresh(t *testing.T) {
	packagePath := filepath.Join("..", "..", "..", "plugin-packages", "google-gemini-generate-content.yingce-plugin")
	data, err := os.ReadFile(packagePath)
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := protocol.ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	stale := pkg.Manifest
	stale.Metadata.Enabled = false
	stale.Contributes.Providers[0].Create.Body = map[string]any{"contents": []any{map[string]any{"role": "user", "parts": []any{map[string]any{"text": map[string]any{"$ref": "request.messages.0.content"}}}}}}
	staleRaw, err := json.Marshal(stale)
	if err != nil {
		t.Fatal(err)
	}
	records, err := json.Marshal([]pluginRegistryRecord{{ID: stale.Metadata.ID, Raw: staleRaw, Source: PluginOriginOfficial, FileName: filepath.Base(packagePath), PackageSHA256: "stale-multimodal-mapping"}})
	if err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dataDir, "plugin_registry.json"), records, 0o600); err != nil {
		t.Fatal(err)
	}
	center, err := newPluginRuntime(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range center.list() {
		if item.Manifest.ID == stale.Metadata.ID {
			found = true
			if item.Status != "disabled" || item.SHA256 == "" || item.SHA256 == "stale-multimodal-mapping" {
				t.Fatalf("refresh did not preserve disabled state and replace package hash: %#v", item)
			}
		}
	}
	if !found {
		t.Fatal("refreshed official Gemini plugin is missing")
	}
	registry := center.registrySnapshot()
	if registry.IsCapability("gemini-generate-content", protocol.CapabilityText) {
		t.Fatal("refresh unexpectedly enabled the disabled provider")
	}
	// Disabled providers intentionally resolve to an unavailable adapter. Only
	// after asserting bootstrap preserved that state, explicitly enable this
	// isolated fixture to exercise the refreshed installed mapping.
	if _, err := center.setEnabled(stale.Metadata.ID, true); err != nil {
		t.Fatal(err)
	}
	adapter, ok := center.registrySnapshot().Resolve("gemini-generate-content")
	if !ok {
		t.Fatal("installed Gemini adapter is missing")
	}
	input := canvasGenerationInput{Mode: "text", Prompt: "Describe the product image.", Config: providerConfig{Model: "provider-text", InterfaceType: "gemini-generate-content"}, ReferenceImages: []providerMedia{{DataURL: "data:image/png;base64,aW1hZ2U=", MimeType: "image/png"}}}
	spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
	if err != nil {
		t.Fatal(err)
	}
	assertProtocolTextMultimodalGeminiContents(t, spec.Body, input.Prompt, "aW1hZ2U=")
}
