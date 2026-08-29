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

func TestPluginViewIncludesDocumentationForEveryBundledProtocol(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	plugins := center.list()
	if len(plugins) != len(protocol.Builtins().List("", "", true))+2 {
		t.Fatalf("plugin views = %d, builtins plus workflow plugins = %d", len(plugins), len(protocol.Builtins().List("", "", true))+2)
	}
	for _, plugin := range plugins {
		if plugin.Source != "bundled" {
			continue
		}
		document := strings.TrimSpace(plugin.Manifest.Documentation)
		if document == "" || !strings.Contains(document, "## 影策运行时合同") {
			t.Errorf("bundled plugin %q has no complete documentation in PluginView", plugin.Manifest.ID)
		}
	}
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

func TestPluginRuntimeDropsRemovedBundledProtocol(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "autodl-comfyui.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := protocol.ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	registryData, err := json.Marshal([]pluginRegistryRecord{{ID: "autodl-comfyui", Raw: pkg.ManifestRaw, Source: "bundled"}})
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
	if _, ok := center.registrySnapshot().Resolve("autodl-comfyui"); ok {
		t.Fatal("removed bundled AutoDL protocol survived bootstrap")
	}
}

func TestAutoDLPluginPackageInstallsThroughUploadRuntime(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "autodl-comfyui.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	plugin, err := center.install(data, "autodl-comfyui.yingce-plugin")
	if err != nil {
		t.Fatal(err)
	}
	if plugin.Status != "enabled" || plugin.Manifest.ID != "autodl-comfyui" || plugin.Package != protocol.PluginPackageFormat {
		t.Fatalf("installed AutoDL plugin = %#v", plugin)
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
