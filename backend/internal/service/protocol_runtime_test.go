package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/protocol"
)

func TestPluginViewIncludesDocumentationForEveryOfficialProtocol(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	plugins := center.list()
	pluginsByID := make(map[string]PluginView, len(plugins))
	for _, plugin := range plugins {
		pluginsByID[plugin.Manifest.ID] = plugin
	}
	packages, err := filepath.Glob(filepath.Join("..", "..", "..", "plugin-packages", "*.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	bundledCount := len(bundledWorkflowPluginManifests())
	packageIDs := make(map[string]bool, len(packages))
	for _, packagePath := range packages {
		data, err := os.ReadFile(packagePath)
		if err != nil {
			t.Fatal(err)
		}
		pkg, err := protocol.ParsePluginPackage(data)
		if err != nil {
			t.Fatal(err)
		}
		packageIDs[pkg.Manifest.Metadata.ID] = true
	}
	for _, manifest := range bundledPaymentPluginManifests() {
		if !packageIDs[manifest.Metadata.ID] {
			bundledCount++
		}
	}
	if len(plugins) != len(packages)+bundledCount {
		t.Fatalf("plugin views = %d, official packages plus bundled plugins = %d", len(plugins), len(packages)+bundledCount)
	}
	for _, packagePath := range packages {
		data, err := os.ReadFile(packagePath)
		if err != nil {
			t.Fatal(err)
		}
		pkg, err := protocol.ParsePluginPackage(data)
		if err != nil {
			t.Fatalf("parse %s: %v", filepath.Base(packagePath), err)
		}
		plugin, ok := pluginsByID[pkg.Manifest.Metadata.ID]
		if !ok {
			t.Errorf("fresh runtime did not install official plugin %q", pkg.Manifest.Metadata.ID)
			continue
		}
		expectedSource := PluginOriginOfficial
		if isSystemPaymentPluginID(plugin.Manifest.ID) {
			expectedSource = PluginOriginSystem
		}
		if plugin.Source != expectedSource {
			t.Errorf("plugin %q source = %q, want %s", plugin.Manifest.ID, plugin.Source, expectedSource)
		}
		expected := strings.TrimSpace(string(pkg.Files["README.md"])) + "\n\n---\n\n" + strings.TrimSpace(string(pkg.Files["docs/interface.md"]))
		if strings.TrimSpace(plugin.Manifest.Documentation) != expected {
			t.Errorf("freshly installed plugin %q did not expose its complete packaged documentation", plugin.Manifest.ID)
		}
		if !strings.Contains(plugin.Manifest.Documentation, "## Manifest 完整接口定义") {
			t.Errorf("freshly installed plugin %q has no embedded full manifest contract", plugin.Manifest.ID)
		}
	}
}

func TestPluginRuntimeRefreshesExistingOfficialPackageDocumentation(t *testing.T) {
	packagePath := filepath.Join("..", "..", "..", "plugin-packages", "openai-images.yingce-plugin")
	packageData, err := os.ReadFile(packagePath)
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := protocol.ParsePluginPackage(packageData)
	if err != nil {
		t.Fatal(err)
	}
	stale := pkg.Manifest
	stale.Metadata.Documentation = "# OpenAI Images\n\n旧版本摘要。"
	stale.Metadata.Enabled = false
	staleRaw, err := json.Marshal(stale)
	if err != nil {
		t.Fatal(err)
	}
	registryData, err := json.Marshal([]pluginRegistryRecord{{
		ID: pkg.Manifest.Metadata.ID, Raw: staleRaw, Source: PluginOriginOfficial,
		FileName: filepath.Base(packagePath), PackageSHA256: "stale-package-hash",
	}})
	if err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dataDir, "plugin_registry.json"), registryData, 0o600); err != nil {
		t.Fatal(err)
	}

	center, err := newPluginRuntime(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, plugin := range center.list() {
		if plugin.Manifest.ID != pkg.Manifest.Metadata.ID {
			continue
		}
		expected := strings.TrimSpace(string(pkg.Files["README.md"])) + "\n\n---\n\n" + strings.TrimSpace(string(pkg.Files["docs/interface.md"]))
		if strings.TrimSpace(plugin.Manifest.Documentation) != expected {
			t.Fatal("existing official plugin kept stale documentation instead of importing the rebuilt package")
		}
		if plugin.Status != "disabled" {
			t.Fatalf("official plugin enabled state was not preserved during refresh: %s", plugin.Status)
		}
		if plugin.SHA256 == "" || plugin.SHA256 == "stale-package-hash" {
			t.Fatalf("official plugin package hash was not refreshed: %q", plugin.SHA256)
		}
		return
	}
	t.Fatal("refreshed OpenAI Images plugin is missing")
}

func TestBundledWorkflowPluginsControlAvailability(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{pluginRuntime: center}
	if err := svc.RequireWorkflowPluginForInterface("runninghub-workflow-image"); err == nil {
		t.Fatal("bundled RunningHub plugin was enabled by default")
	}
	if _, err := center.setEnabled(WorkflowPluginRunningHub, true); err != nil {
		t.Fatal(err)
	}
	if err := svc.RequireWorkflowPluginForInterface("runninghub-workflow-image"); err != nil {
		t.Fatalf("enabled RunningHub plugin rejected: %v", err)
	}
	if _, err := center.setEnabled(WorkflowPluginRunningHub, false); err != nil {
		t.Fatal(err)
	}
	if err := svc.RequireWorkflowPluginForInterface("runninghub-workflow-video"); err == nil {
		t.Fatal("disabled RunningHub plugin remained available")
	}
	if got := svc.WorkflowPluginStatuses()[WorkflowPluginRunningHub]; got != "disabled" {
		t.Fatalf("RunningHub status = %q, want disabled", got)
	}
}

func TestBundledProviderCatalogExposesUpstreamOperation(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	catalog := (&Service{pluginRuntime: center}).PluginProviderCatalog(string(protocol.SurfaceAdminSystemChannel), string(protocol.CapabilityVideo), false)
	for _, item := range catalog {
		if item.ID != "xai-video" {
			continue
		}
		if item.Create != "POST /v1/videos/generations" || strings.Contains(item.Create, "__host__") {
			t.Fatalf("xAI catalog create operation = %q", item.Create)
		}
		return
	}
	t.Fatal("xAI bundled provider missing from administrator catalog")
}

func TestPluginRuntimeIsTheProtocolSourceOfTruth(t *testing.T) {
	dataDir := t.TempDir()
	center, err := newPluginRuntime(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if got := center.registrySnapshot().List("", "", false); len(got) == 0 {
		t.Fatal("bundled providers were not reconciled into the unified plugin registry")
	}
	if _, err := center.install([]byte(`{"apiVersion":"yingce.plugin/v1"}`), "legacy.json"); err == nil {
		t.Fatal("bare JSON manifest was accepted by the upload runtime")
	}
	manifest := []byte(`{"apiVersion":"yingce.plugin/v1","id":"uploaded-runtime","version":"1.0.0","name":"Uploaded Runtime","author":"Test","documentation":"# Uploaded Runtime","contributes":{"providers":[{"id":"uploaded-runtime","label":"Uploaded Runtime","capabilities":["video"],"scopes":["canvas"],"create":{"method":"POST","path":"/tasks","fields":{"prompt":"request.prompt"}},"response":{"statusPaths":["status"]}}]}}`)
	plugin, err := center.install(testPluginPackage(t, manifest), "uploaded-runtime.yingce-plugin")
	if err != nil {
		t.Fatal(err)
	}
	if plugin.Status != "enabled" || !center.registrySnapshot().IsCapability("uploaded-runtime", protocol.CapabilityVideo) {
		t.Fatalf("installed plugin was not activated: %#v", plugin)
	}
	updatedManifest := []byte(`{"apiVersion":"yingce.plugin/v1","id":"uploaded-runtime","version":"2.0.0","name":"Uploaded Runtime v2","author":"Test","documentation":"# Uploaded Runtime v2","contributes":{"providers":[{"id":"uploaded-runtime","label":"Uploaded Runtime v2","capabilities":["video"],"scopes":["canvas"],"create":{"method":"POST","path":"/tasks","fields":{"prompt":"request.prompt"}},"response":{"statusPaths":["status"]}}]}}`)
	updated, err := center.install(testPluginPackage(t, updatedManifest), "uploaded-runtime-v2.yingce-plugin")
	if err != nil || updated.Manifest.Version != "2.0.0" || updated.Manifest.Name != "Uploaded Runtime v2" {
		t.Fatalf("plugin update = %#v, err = %v", updated, err)
	}
	if _, err := center.setEnabled("uploaded-runtime", false); err != nil {
		t.Fatal(err)
	}
	if _, ok := center.registrySnapshot().Resolve("uploaded-runtime"); !ok {
		t.Fatal("disabled plugin was removed from registry snapshot instead of being represented as unavailable")
	}
	if center.registrySnapshot().IsCapability("uploaded-runtime", protocol.CapabilityVideo) {
		t.Fatal("disabled plugin remained selectable")
	}
	if err := center.uninstall("uploaded-runtime"); err != nil {
		t.Fatal(err)
	}
	if _, ok := center.registrySnapshot().Resolve("uploaded-runtime"); ok {
		t.Fatal("uninstalled plugin remained selectable")
	}
}

func TestPluginRuntimeDropsRemovedOfficialProtocol(t *testing.T) {
	staleManifest := json.RawMessage(`{"apiVersion":"yingce.plugin/v2","id":"removed-official-protocol","version":"1.0.0","name":"Removed Official Protocol","author":"Test","documentation":"# Removed\n\n## 影策运行时合同","contributes":{"providers":[{"id":"removed-official-protocol","label":"Removed","capabilities":["video"],"scopes":["canvas"],"create":{"method":"POST","path":"/tasks","body":{"prompt":{"$ref":"request.prompt"}}},"response":{"status":"pending"}}]}}`)
	registryData, err := json.Marshal([]pluginRegistryRecord{{ID: "removed-official-protocol", Raw: staleManifest, Source: PluginOriginOfficial}})
	if err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dataDir, "plugin_registry.json"), registryData, 0o600); err != nil {
		t.Fatal(err)
	}
	center, err := newPluginRuntime(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := center.registrySnapshot().Resolve("removed-official-protocol"); ok {
		t.Fatal("removed official protocol survived bootstrap")
	}
}

func TestPluginRuntimeRejectsPersistedUploadedPaymentProvider(t *testing.T) {
	manifest := json.RawMessage(`{"apiVersion":"yingce.plugin/v1","id":"uploaded-payment-provider","version":"1.0.0","name":"Uploaded Payment Provider","author":"Test","enabled":true,"runtime":{"backend":"host:untrusted-payment"},"contributes":{"paymentProviders":[{"id":"untrusted-payment","label":"Untrusted Payment","icon":"brand:untrusted","checkoutMode":"redirect","expiryPolicy":{"defaultMinutes":30,"minMinutes":5,"maxMinutes":1440}}]}}`)
	registryData, err := json.Marshal([]pluginRegistryRecord{{ID: "uploaded-payment-provider", Raw: manifest, Source: "uploaded"}})
	if err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dataDir, "plugin_registry.json"), registryData, 0o600); err != nil {
		t.Fatal(err)
	}
	center, err := newPluginRuntime(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, plugin := range center.list() {
		if plugin.Manifest.ID != "uploaded-payment-provider" {
			continue
		}
		if plugin.Status != "invalid" || !strings.Contains(plugin.Error, "系统宿主适配器") {
			t.Fatalf("persisted uploaded payment plugin = %#v", plugin)
		}
		return
	}
	t.Fatal("persisted uploaded payment plugin was not retained as invalid")
}

func TestAutoDLPluginPackageLoadsAsOfficialRuntime(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	var plugin *PluginView
	for _, item := range center.list() {
		if item.Manifest.ID == "autodl-comfyui" {
			copy := item
			plugin = &copy
			break
		}
	}
	if plugin == nil || plugin.Status != "enabled" || plugin.Source != PluginOriginOfficial || plugin.Package != protocol.PluginPackageFormat {
		t.Fatalf("official AutoDL plugin = %#v", plugin)
	}
	if !center.registrySnapshot().IsCapability("autodl-comfyui", protocol.CapabilityVideo) {
		t.Fatal("AutoDL package provider was not registered")
	}
	catalog := (&Service{pluginRuntime: center}).PluginProviderCatalog(string(protocol.SurfaceAdminSystemChannel), string(protocol.CapabilityVideo), false)
	var autoDL *PluginProviderCatalogItem
	for index := range catalog {
		if catalog[index].ID == "autodl-comfyui" {
			autoDL = &catalog[index]
		}
		if catalog[index].ID == "autodl-comfyui-plugin" {
			t.Fatal("legacy AutoDL provider ID leaked into administrator catalog")
		}
	}
	if autoDL == nil || len(autoDL.Workflows) == 0 {
		t.Fatalf("AutoDL administrator catalog = %#v", catalog)
	}
	var multiImage *protocol.ManifestWorkflow
	for index := range autoDL.Workflows {
		if autoDL.Workflows[index].ID == "minimax_h3_lightx2v_v5" {
			multiImage = &autoDL.Workflows[index]
			break
		}
	}
	if multiImage == nil || len(multiImage.Operations) != 1 || multiImage.Operations[0] != "reference_to_video" || multiImage.References == nil || multiImage.References.MaxImages == nil || *multiImage.References.MaxImages != 9 {
		t.Fatalf("AutoDL multi-image workflow capability = %#v", multiImage)
	}
}

func TestDeclarativeProtocolRuntimeExecutesCreatePollAndDownload(t *testing.T) {
	manifest := []byte(`{
		"apiVersion":"yingce.plugin/v1",
			"id":"test-declarative-video-runtime","version":"1.0.0","name":"Test Declarative Video","author":"Test","documentation":"# Test Declarative Video",
		"contributes":{"providers":[{"id":"test-declarative-video-runtime","label":"Test Declarative Video","capabilities":["video"],"scopes":["canvas"],"create":{"method":"POST","path":"/tasks","fields":{"model":"request.model","prompt":"request.prompt","seconds":"request.duration"}},"poll":{"method":"GET","path":"/tasks/{{taskId}}"},"response":{"taskIdPaths":["id"],"statusPaths":["status"],"resultPaths":["video_url"],"resultKind":"video"}}]}
	}`)
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := center.install(testPluginPackage(t, manifest), "test-declarative-video-runtime.yingce-plugin"); err != nil {
		t.Fatal(err)
	}

	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/tasks":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"task-1","status":"pending"}`))
		case "/v1/tasks/task-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"task-1","status":"succeeded","video_url":"` + server.URL + `/media.mp4"}`))
		case "/media.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	config := providerConfig{BaseURL: server.URL + "/v1", APIKey: "key", Model: "test-model", APIFormat: "openai", InterfaceType: "test-declarative-video-runtime", AllowLocalChannel: true}
	ctx := withProviderOutboundPolicy(context.Background(), config)
	ctx = withProtocolRegistry(ctx, center.registrySnapshot())
	result, err := runDeclarativeProtocolTask(ctx, canvasGenerationInput{Mode: "video", Prompt: "a clip", Config: config})
	if err != nil {
		t.Fatal(err)
	}
	if result["mode"] != "video" {
		t.Fatalf("result = %#v", result)
	}
}

func TestDeclarativeProtocolRecoveryQueriesExistingTaskWithoutCreating(t *testing.T) {
	manifest := []byte(`{
		"apiVersion":"yingce.plugin/v2",
		"id":"test-declarative-video-recovery","version":"1.0.0","name":"Test Declarative Video Recovery","author":"Test","documentation":"# Test Declarative Video Recovery",
		"contributes":{"providers":[{"id":"test-declarative-video-recovery","label":"Test Declarative Video Recovery","capabilities":["video"],"scopes":["canvas"],"create":{"method":"POST","path":"/tasks","body":{"model":{"$ref":"request.model"}}},"poll":{"method":"GET","path":"/videos/{{taskId}}"},"result":{"method":"GET","path":"/videos/{{taskId}}/content"},"response":{"taskId":{"$coalesce":[{"$ref":"response.id"},{"$ref":"taskId"}]},"status":{"$coalesce":[{"$ref":"response.status"},"pending"]}}}]}
	}`)
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := center.install(testPluginPackage(t, manifest), "test-declarative-video-recovery.yingce-plugin"); err != nil {
		t.Fatal(err)
	}

	createCalls := 0
	pollCalls := 0
	downloadCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/tasks":
			createCalls++
			http.Error(w, "recovery must not create", http.StatusConflict)
		case "/v1/videos/existing-task":
			pollCalls++
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"existing-task","status":"completed"}`))
		case "/v1/videos/existing-task/content":
			downloadCalls++
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	config := providerConfig{BaseURL: server.URL + "/v1", APIKey: "key", Model: "test-model", APIFormat: "openai", InterfaceType: "test-declarative-video-recovery", AllowLocalChannel: true}
	ctx := withProviderOutboundPolicy(context.Background(), config)
	ctx = withProtocolRegistry(ctx, center.registrySnapshot())
	adapter, ok := declarativeProtocolAdapterForContext(ctx, config.InterfaceType)
	if !ok {
		t.Fatal("declarative recovery adapter is unavailable")
	}
	result, status, err := queryProtocolAdapterVideoTask(ctx, canvasGenerationInput{Mode: "video", Prompt: "a clip", Config: config}, adapter, "existing-task")
	if err != nil {
		t.Fatal(err)
	}
	if status != string(protocol.StatusSucceeded) || result["mode"] != "video" || createCalls != 0 || pollCalls != 1 || downloadCalls != 1 {
		t.Fatalf("recovery result=%#v status=%q calls=create:%d poll:%d download:%d", result, status, createCalls, pollCalls, downloadCalls)
	}
}

func TestDeclarativeProtocolRuntimeMapsReferenceImageURL(t *testing.T) {
	manifest := []byte(`{
		"apiVersion":"yingce.plugin/v1",
		"id":"test-declarative-reference-image-runtime","version":"1.0.0","name":"Test Declarative Reference Image","author":"Test","documentation":"# Test Declarative Reference Image",
		"contributes":{"providers":[{"id":"test-declarative-reference-image-runtime","label":"Test Declarative Reference Image","capabilities":["video"],"scopes":["canvas"],"create":{"method":"POST","path":"/tasks","fields":{"prompt":"request.prompt","ref_image_0":"request.images.0.url"}},"response":{"statusPaths":["status"],"messagePaths":["msg"]}}]}
	}`)
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := center.install(testPluginPackage(t, manifest), "test-declarative-reference-image-runtime.yingce-plugin"); err != nil {
		t.Fatal(err)
	}

	var createBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/tasks" {
			http.NotFound(w, r)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&createBody); err != nil {
			t.Errorf("decode create body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"failed","msg":"stop after request capture"}`))
	}))
	defer server.Close()

	config := providerConfig{BaseURL: server.URL + "/v1", APIKey: "key", Model: "test-model", APIFormat: "openai", InterfaceType: "test-declarative-reference-image-runtime", AllowLocalChannel: true}
	ctx := withProviderOutboundPolicy(context.Background(), config)
	ctx = withProtocolRegistry(ctx, center.registrySnapshot())
	_, err = runDeclarativeProtocolTask(ctx, canvasGenerationInput{
		Mode: "video", Prompt: "a clip", Config: config,
		ReferenceImages: []providerMedia{{URL: "https://cdn.example/reference.png"}},
	})
	if err == nil || !strings.Contains(err.Error(), "stop after request capture") {
		t.Fatalf("runDeclarativeProtocolTask() error = %v", err)
	}
	if createBody["prompt"] != "a clip" || createBody["ref_image_0"] != "https://cdn.example/reference.png" {
		t.Fatalf("create body = %#v", createBody)
	}
}

func testPluginPackage(t *testing.T, manifest []byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	file, err := writer.Create("manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write(manifest); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
