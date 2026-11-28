package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
	"yingce/backend/internal/protocol"
	"yingce/backend/internal/repository"
)

func requestProtocolTestService(t *testing.T) (*Service, string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(
		&model.User{},
		&model.UserGroup{},
		&model.ModelChannel{},
		&model.ChannelModel{},
		&model.ChannelModelPriceTier{},
		&model.ChannelProtocolSelection{},
		&model.PluginPlatformState{},
		&model.UserPluginState{},
		&model.SystemSetting{},
		&model.AdminAuditEvent{},
		&model.Task{},
		&model.TaskLog{},
		&model.ApiCallLog{},
	); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	center, err := newPluginRuntime(dir)
	if err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db), dataDir: dir, pluginRuntime: center}, dir
}

func editRequestProtocolCheck(t *testing.T, change func(*protocol.Manifest)) RequestProtocolCheck {
	t.Helper()
	check := requestProtocolTestCheck()
	var manifest protocol.Manifest
	if err := json.Unmarshal(check.Manifest, &manifest); err != nil {
		t.Fatal(err)
	}
	change(&manifest)
	var err error
	check.Manifest, err = json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	return check
}

func requestProtocolTestCheck() RequestProtocolCheck {
	return RequestProtocolCheck{
		Manifest: json.RawMessage(`{
			"apiVersion":"yingce.plugin/v2","id":"sample-video","name":"示例视频","version":"1.0.0",
			"runtime":{"backend":"declarative"},
			"contributes":{"providers":[{"id":"sample-video","label":"示例视频","capabilities":["video"],
				"scopes":["admin.system-channel","canvas","creation"],"auth":{"type":"bearer","field":"apiKey"},
				"create":{"method":"POST","path":"/v1/video/generations","contentType":"application/json",
					"body":{"model":{"$ref":"request.model"},"duration":{"$ref":"request.output.duration"},
						"reference_images":{"$map":{"from":{"$ref":"request.images"},"as":"media","in":{"$ref":"media.value"}}}}},
				"poll":{"method":"GET","path":"/v1/video/generations/{{taskId}}"},
				"response":{"taskId":{"$ref":"response.data.task_id"},"status":{"$ref":"response.data.status"},
					"videos":{"$ref":"response.data.data.video_url"},"resultEphemeral":true}
			}]}
		}`),
		Request: protocol.GenerationRequest{
			Model: "sample-model", Duration: 30, Output: protocol.OutputOptions{Duration: 30},
			Images: []protocol.MediaReference{{URL: "https://example.com/reference.png", Kind: "image"}},
		},
		Response: json.RawMessage(`{"data":{"task_id":"existing-task","status":"SUCCESS","data":{"video_url":"https://example.com/result.mp4"}}}`),
		Phase:    "poll", TaskID: "existing-task",
	}
}

func TestRequestProtocolCheckUsesProductionMappings(t *testing.T) {
	svc, _ := requestProtocolTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	result, err := svc.AdminCheckRequestProtocol(context.Background(), admin, requestProtocolTestCheck())
	if err != nil {
		t.Fatal(err)
	}
	body := result.Create.Body.(map[string]any)
	images := body["reference_images"].([]any)
	if len(images) != 1 || images[0] != "https://example.com/reference.png" {
		t.Fatalf("reference image mapping = %#v", body)
	}
	parsed := result.Parsed.(protocol.PollResult)
	if parsed.Status != protocol.StatusSucceeded || parsed.Result.Videos[0].URL != "https://example.com/result.mp4" {
		t.Fatalf("parsed nested result = %#v", parsed)
	}
	if result.Download != nil || result.Poll.Path != "/v1/video/generations/existing-task" {
		t.Fatalf("unexpected download path: %#v", result)
	}
	check := requestProtocolTestCheck()
	check.Response = json.RawMessage(`{"data":{"status":"SUCCESS","data":{}}}`)
	if _, err := svc.AdminCheckRequestProtocol(context.Background(), admin, check); err == nil {
		t.Fatal("success without a media result was accepted")
	}
	if _, err := svc.AdminCheckRequestProtocol(context.Background(), &model.User{Role: model.UserRoleUser}, requestProtocolTestCheck()); err == nil {
		t.Fatal("ordinary user checked an admin protocol")
	}
}

func TestRequestProtocolCheckBusinessPaths(t *testing.T) {
	svc, _ := requestProtocolTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	cases := []struct {
		name        string
		change      func(*RequestProtocolCheck)
		edit        func(*protocol.Manifest)
		wantError   string
		wantWarning bool
	}{
		{name: "同步直接返回媒体", change: func(c *RequestProtocolCheck) { c.Phase = "create" }, edit: func(m *protocol.Manifest) { m.Contributes.Providers[0].Poll = nil }},
		{name: "异步创建保留原任务", change: func(c *RequestProtocolCheck) {
			c.Phase = "create"
			c.Response = json.RawMessage(`{"data":{"task_id":"existing-task","status":"queued"}}`)
		}},
		{name: "异步创建缺任务标识", change: func(c *RequestProtocolCheck) {
			c.Phase = "create"
			c.Response = json.RawMessage(`{"data":{"status":"queued"}}`)
		}, wantError: "缺少任务 ID"},
		{name: "异步创建缺查询接口", change: func(c *RequestProtocolCheck) {
			c.Phase = "create"
			c.Response = json.RawMessage(`{"data":{"task_id":"existing-task","status":"queued"}}`)
		}, edit: func(m *protocol.Manifest) { m.Contributes.Providers[0].Poll = nil }, wantError: "尚未配置查询接口"},
		{name: "不允许凭空查询", edit: func(m *protocol.Manifest) { m.Contributes.Providers[0].Poll = nil }, wantError: "没有查询接口"},
		{name: "缺失响应不能校验通过", change: func(c *RequestProtocolCheck) { c.Response = nil }, wantError: "请提供示例响应"},
		{name: "破损响应", change: func(c *RequestProtocolCheck) { c.Response = json.RawMessage("{") }, wantError: "不是有效 JSON"},
		{name: "不支持的响应阶段", change: func(c *RequestProtocolCheck) { c.Phase = "download" }, wantError: "只支持 create 或 poll"},
		{name: "创建响应必须是对象", change: func(c *RequestProtocolCheck) { c.Phase = "create"; c.Response = json.RawMessage("[]") }, wantError: "创建响应解析失败"},
		{name: "查询响应必须是对象", change: func(c *RequestProtocolCheck) { c.Response = json.RawMessage("[]") }, wantError: "查询响应解析失败"},
		{name: "失败响应保留失败语义", change: func(c *RequestProtocolCheck) { c.Response = json.RawMessage(`{"data":{"status":"failed"}}`) }, wantWarning: true},
		{name: "独立下载不发生网络请求", change: func(c *RequestProtocolCheck) { c.Response = json.RawMessage(`{"data":{"status":"SUCCESS"}}`) }, edit: func(m *protocol.Manifest) {
			m.Contributes.Providers[0].Result = &protocol.ManifestOperation{Method: "GET", Path: "/v1/tasks/{{taskId}}/content"}
		}, wantWarning: true},
		{name: "创建参数表达式错误", edit: func(m *protocol.Manifest) {
			m.Contributes.Providers[0].Create.Body = map[string]any{"$notAnOperator": true}
		}, wantError: "请求参数映射失败"},
		{name: "查询动态路径拒绝外域", edit: func(m *protocol.Manifest) { m.Contributes.Providers[0].Poll.PathTemplate = "https://example.com/other" }, wantError: "查询接口映射失败"},
		{name: "下载动态路径拒绝外域", edit: func(m *protocol.Manifest) {
			m.Contributes.Providers[0].Result = &protocol.ManifestOperation{Method: "GET", Path: "/result", PathTemplate: "https://example.com/other"}
		}, wantError: "下载接口映射失败"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			check := editRequestProtocolCheck(t, func(m *protocol.Manifest) {
				if tc.edit != nil {
					tc.edit(m)
				}
			})
			if tc.change != nil {
				tc.change(&check)
			}
			result, err := svc.AdminCheckRequestProtocol(context.Background(), admin, check)
			if tc.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantError) {
					t.Fatalf("error = %v, want %q", err, tc.wantError)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				if tc.wantWarning && len(result.Warnings) == 0 {
					t.Fatal("missing actionable warning")
				}
				if tc.name == "独立下载不发生网络请求" && result.Download.Path != "/v1/tasks/existing-task/content" {
					t.Fatalf("download = %#v", result.Download)
				}
			}
		})
	}
}

func TestRequestProtocolRejectsInvalidDefinitions(t *testing.T) {
	cases := []struct {
		name string
		edit func(*protocol.Manifest)
	}{
		{"缺鉴权请求头", func(m *protocol.Manifest) { m.Contributes.Providers[0].Auth = protocol.ManifestAuth{Type: "header"} }},
		{"缺鉴权查询参数", func(m *protocol.Manifest) { m.Contributes.Providers[0].Auth = protocol.ManifestAuth{Type: "query"} }},
		{"未知鉴权驱动", func(m *protocol.Manifest) { m.Contributes.Providers[0].Auth.Type = "unknown" }},
		{"凭据默认值", func(m *protocol.Manifest) {
			m.Configuration.Fields = []protocol.ManifestField{{Name: "apiKey", Type: "secret", Default: "private"}}
		}},
		{"查询参数内置凭据", func(m *protocol.Manifest) {
			m.Contributes.Providers[0].Create.Query = map[string]any{"api_key": "private"}
		}},
		{"不合法路径", func(m *protocol.Manifest) { m.Contributes.Providers[0].Create.Path = "https://example.com/task" }},
		{"空能力", func(m *protocol.Manifest) { m.Contributes.Providers[0].Capabilities = nil }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			check := editRequestProtocolCheck(t, tc.edit)
			if _, _, err := managedRequestProtocol(check.Manifest); err == nil {
				t.Fatal("invalid protocol accepted")
			}
		})
	}
	for _, raw := range [][]byte{nil, []byte("{"), bytes.Repeat([]byte(" "), protocol.PluginManifestMaxBytes+1)} {
		if _, _, err := managedRequestProtocol(raw); err == nil {
			t.Fatal("invalid manifest bytes accepted")
		}
	}
}

func TestRequestProtocolNativeReleasesArchiveBatchRebindAndTaskPinning(t *testing.T) {
	allowLoopbackProviderTest(t)
	svc, dir := requestProtocolTestService(t)
	svc.coordinator = platform.NewCoordinatorWithRedis(nil, t.Name())
	admin := &model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := svc.repo.Create(admin); err != nil {
		t.Fatal(err)
	}

	first, err := svc.AdminPublishRequestProtocol(context.Background(), admin, PublishRequestProtocolRequest{
		ID: "native-video", Check: requestProtocolTestCheck(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != "native-video" || first.ProviderID != "native-video" || first.Version != "1.0.0" || first.ReadOnly || first.SHA256 == "" {
		t.Fatalf("first publish = %#v", first)
	}
	if strings.Join(first.Manifest.Permissions, ",") != "generation.run,media.read" {
		t.Fatalf("default permissions = %#v, want [generation.run media.read]", first.Manifest.Permissions)
	}
	var publishedPlugin *PluginView
	for _, view := range svc.pluginRuntime.list() {
		if view.Manifest.ID == "native-video" {
			v := view
			publishedPlugin = &v
			break
		}
	}
	if publishedPlugin == nil {
		t.Fatal("published plugin not visible in plugin center runtime")
	}
	encodedPlugin, err := json.Marshal(publishedPlugin.Manifest)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encodedPlugin), `"permissions":["generation.run","media.read"]`) {
		t.Fatalf("published plugin manifest view permissions = %s", string(encodedPlugin))
	}
	if len(first.Releases) != 1 || !first.Releases[0].Current || first.Releases[0].SHA256 != first.SHA256 {
		t.Fatalf("first releases = %#v", first.Releases)
	}
	// Duplicate publish without expectedSha256 must conflict.
	if _, err := svc.AdminPublishRequestProtocol(context.Background(), admin, PublishRequestProtocolRequest{
		ID: "native-video", Check: requestProtocolTestCheck(),
	}); err == nil {
		t.Fatal("duplicate publish without expectedSha256 succeeded")
	}

	secondCheck := editRequestProtocolCheck(t, func(m *protocol.Manifest) {
		m.Contributes.Providers[0].Poll.Path = "/v2/video/generations/{{taskId}}"
	})
	second, err := svc.AdminPublishRequestProtocol(context.Background(), admin, PublishRequestProtocolRequest{
		ID: "native-video", ExpectedSHA256: first.SHA256, Check: secondCheck,
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.ProviderID != "native-video" || second.Version != "2.0.0" || second.SHA256 == first.SHA256 {
		t.Fatalf("second publish = %#v", second)
	}
	if len(second.Releases) != 2 || second.Releases[0].Version != "2.0.0" || !second.Releases[0].Current || second.Releases[1].Version != "1.0.0" || second.Releases[1].Current {
		t.Fatalf("second releases = %#v", second.Releases)
	}
	if second.Releases[1].Manifest.Contributes.Providers[0].Poll.Path != "/v1/video/generations/{{taskId}}" {
		t.Fatalf("archived v1 manifest changed: %#v", second.Releases[1].Manifest.Contributes.Providers[0].Poll)
	}

	calls := make(chan string, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls <- r.Method + " " + r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"task_id":"existing-task","status":"RUNNING"}}`))
	}))
	defer server.Close()

	channel := &model.ModelChannel{ID: "ch-native", Scope: model.ChannelScopeSystem, Name: "Native", BaseURL: server.URL, APIKey: "secret", Enabled: true}
	if err := svc.repo.Create(channel); err != nil {
		t.Fatal(err)
	}
	cfgBytes, err := json.Marshal(DefaultModelCapabilityConfigForModel("native-video", "demo-video"))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	row := &model.ChannelModel{
		ID: "cm-native", ChannelID: channel.ID, ModelKey: "demo-video", ProviderModelKey: "demo-video",
		Capability: "video", Protocol: "native-video", ProtocolRelease: first.SHA256,
		CapabilityConfigJSON: string(cfgBytes), CapabilityVersion: 1, PriceVersion: 1,
		BillingMode: "fixed_request", PriceConfigured: true, Enabled: true,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := svc.repo.Create(row); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.Create(&model.ChannelModelPriceTier{
		ID: "pt-native", ChannelModelID: row.ID, SelectorKey: "{}", SelectorJSON: "{}",
		ProviderModelKey: "demo-video", BillingMode: "fixed_request", PriceConfigured: true, Enabled: true, PriceVersion: 1,
	}); err != nil {
		t.Fatal(err)
	}

	// Capture a real production protocol binding snapshot pinned to v1.0.0.
	bindingJSON, err := svc.captureTaskProtocolBinding(map[string]any{
		"mode": "video",
		"config": map[string]any{
			"channelId":        channel.ID,
			"channelModelKey":  row.ModelKey,
			"providerModelKey": row.ProviderModelKey,
			"interfaceType":    "native-video",
			"protocolRelease":  first.SHA256,
			"priceRevision":    row.PriceVersion,
			"profileRevision":  row.CapabilityVersion,
		},
	}, row)
	if err != nil {
		t.Fatal(err)
	}
	taskInput, err := json.Marshal(canvasGenerationInput{Mode: "video", Config: providerConfig{
		ChannelID: channel.ID, ChannelModelKey: "demo-video", Model: "demo-video", InterfaceType: "native-video",
	}})
	if err != nil {
		t.Fatal(err)
	}
	task := model.Task{
		ID: "failed-v1", UserID: "owner", Type: "canvas_video", Status: model.TaskStatusFailed,
		ProviderRequestID: "existing-task", InputJSON: string(taskInput), ProtocolBindingJSON: bindingJSON,
	}
	if err := svc.repo.Create(&task); err != nil {
		t.Fatal(err)
	}

	// Batch-upgrade model from v1.0.0 -> v2.0.0 using native protocolRelease.
	currentRow, err := svc.repo.ChannelModelsByIDs([]string{row.ID})
	if err != nil || len(currentRow) != 1 {
		t.Fatalf("load model: %v", err)
	}
	targetProtocol := "native-video"
	targetV2 := second.SHA256
	updated, err := svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{{
		ModelID:           row.ID,
		PriceVersion:      currentRow[0].PriceVersion,
		CapabilityVersion: currentRow[0].CapabilityVersion,
		UpdatedAt:         currentRow[0].UpdatedAt.Format(time.RFC3339Nano),
		Changes:           BatchChannelModelChanges{Protocol: &targetProtocol, ProtocolRelease: &targetV2},
	}})
	if err != nil || updated != 1 {
		t.Fatalf("batch upgrade to v2 failed: updated=%d err=%v", updated, err)
	}
	afterUpgrade, err := svc.repo.ChannelModelsByIDs([]string{row.ID})
	if err != nil || afterUpgrade[0].ProtocolRelease != second.SHA256 {
		t.Fatalf("model did not move to v2 release: %#v err=%v", afterUpgrade, err)
	}

	// Failed v1 task recovery MUST still query v1 endpoint even though model is now on v2.
	recovery, err := svc.queryFailedVideoTask(context.Background(), &task, "owner")
	if err != nil {
		t.Fatal(err)
	}
	if recovery.Recovered || recovery.ProviderStatus != string(protocol.StatusProcessing) {
		t.Fatalf("unexpected recovery result: %#v", recovery)
	}
	if got := <-calls; got != "GET /v1/video/generations/existing-task" {
		t.Fatalf("recovery called %q, want archived v1 endpoint", got)
	}

	// Batch-rollback model from v2.0.0 -> archived v1.0.0.
	targetV1 := first.SHA256
	updated, err = svc.BatchUpdateAdminAllChannelModels(admin, []BatchChannelModelUpdate{{
		ModelID:           row.ID,
		PriceVersion:      afterUpgrade[0].PriceVersion,
		CapabilityVersion: afterUpgrade[0].CapabilityVersion,
		UpdatedAt:         afterUpgrade[0].UpdatedAt.Format(time.RFC3339Nano),
		Changes:           BatchChannelModelChanges{Protocol: &targetProtocol, ProtocolRelease: &targetV1},
	}})
	if err != nil || updated != 1 {
		t.Fatalf("batch rollback to v1 failed: updated=%d err=%v", updated, err)
	}

	// Verify releases and release-scoped bindings survive pluginRuntime restart.
	if _, err := os.Stat(filepath.Join(dir, "plugin_registry.json")); err != nil {
		t.Fatal(err)
	}
	restarted, err := newPluginRuntime(dir)
	if err != nil {
		t.Fatal(err)
	}
	svc.pluginRuntime = restarted
	items, err := svc.AdminRequestProtocols(admin)
	if err != nil {
		t.Fatal(err)
	}
	var found *RequestProtocolView
	for i := range items {
		if items[i].ID == "native-video" {
			found = &items[i]
			break
		}
	}
	if found == nil || len(found.Releases) != 2 {
		t.Fatalf("persisted protocol releases missing after restart: %#v", found)
	}
	if len(found.Releases[0].Bindings) != 0 || len(found.Releases[1].Bindings) != 1 || found.Releases[1].Bindings[0].ModelID != row.ID {
		t.Fatalf("release-scoped bindings = v2:%#v v1:%#v", found.Releases[0].Bindings, found.Releases[1].Bindings)
	}

	// Uninstalling via native plugin center withdraws the plugin while retaining archives;
	// republishing the same ID bumps to v3.0.0 without colliding with v1/v2 archives.
	if err := svc.UninstallPluginForAdmin(admin, "native-video"); err != nil {
		t.Fatal(err)
	}
	third, err := svc.AdminPublishRequestProtocol(context.Background(), admin, PublishRequestProtocolRequest{
		ID: "native-video", Check: secondCheck,
	})
	if err != nil {
		t.Fatal(err)
	}
	if third.Version != "3.0.0" || len(third.Releases) != 3 {
		t.Fatalf("republish after withdraw = version:%s releases:%d", third.Version, len(third.Releases))
	}
}

func TestRequestProtocolConcurrentPublishAndTemplateCopyNamespace(t *testing.T) {
	svc, _ := requestProtocolTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	check := editRequestProtocolCheck(t, func(m *protocol.Manifest) {
		body := m.Contributes.Providers[0].Create.Body.(map[string]any)
		body["seed"] = map[string]any{"$ref": "request.providerOptions.sample-video.seed"}
		body["literal"] = "request.providerOptions.sample-video.seed"
	})
	check.Request.ProviderOptions = map[string]map[string]any{"sample-video": {"seed": 42}}
	request := PublishRequestProtocolRequest{ID: "concurrent", Check: check}
	var wait sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, err := svc.AdminPublishRequestProtocol(context.Background(), admin, request)
			results <- err
		}()
	}
	wait.Wait()
	close(results)
	succeeded, conflicted := 0, 0
	for err := range results {
		if err == nil {
			succeeded++
		} else if strings.Contains(err.Error(), "已存在") || strings.Contains(err.Error(), "已被其他管理员更新") {
			conflicted++
		} else {
			t.Fatal(err)
		}
	}
	if succeeded != 1 || conflicted != 1 {
		t.Fatalf("concurrent publication results: %d success, %d conflict", succeeded, conflicted)
	}
	adapter, ok := svc.protocolRegistry().Resolve("concurrent")
	if !ok {
		t.Fatal("published adapter missing")
	}
	check.Request.ProviderOptions = map[string]map[string]any{"concurrent": {"seed": 42}}
	spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: check.Request})
	if err != nil {
		t.Fatal(err)
	}
	body := spec.Body.(map[string]any)
	if body["seed"] != float64(42) || body["literal"] != "request.providerOptions.sample-video.seed" {
		t.Fatalf("namespace rewrite modified request semantics: %#v", body)
	}
	request.ID = "Bad ID"
	if _, err := svc.AdminPublishRequestProtocol(context.Background(), admin, request); err == nil {
		t.Fatal("invalid protocol ID accepted")
	}
}

func TestRequestProtocolProtectsBuiltInAndForeignPlugins(t *testing.T) {
	svc, _ := requestProtocolTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}

	// Cannot overwrite a built-in official protocol plugin.
	if _, err := svc.AdminPublishRequestProtocol(context.Background(), admin, PublishRequestProtocolRequest{
		ID: "openai-images", Check: requestProtocolTestCheck(),
	}); err == nil || !strings.Contains(err.Error(), "内置插件") {
		t.Fatalf("built-in overwrite error = %v", err)
	}

	// Cannot collide with another uploaded plugin whose provider ID matches our requested ID.
	foreignManifest := editRequestProtocolCheck(t, func(m *protocol.Manifest) {
		m.Metadata.ID = "foreign-pkg"
		m.Contributes.Providers[0].ID = "claimed-provider"
	})
	original, err := packDeclarativeProtocolPlugin(foreignManifest.Manifest)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.pluginRuntime.install(original, "foreign-pkg.yingce-plugin"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AdminPublishRequestProtocol(context.Background(), admin, PublishRequestProtocolRequest{
		ID: "claimed-provider", Check: requestProtocolTestCheck(),
	}); err == nil || !strings.Contains(err.Error(), "已被其他插件占用") {
		t.Fatalf("provider collision error = %v", err)
	}
	// Uploaded plugin with plugin ID != provider ID must remain read-only in studio listing.
	items, err := svc.AdminRequestProtocols(admin)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.ID == "foreign-pkg" && !item.ReadOnly {
			t.Fatal("mismatched uploaded plugin ID/provider ID should be read-only")
		}
	}
}

func TestRequestProtocolRejectsExecutableContributionsAndStoredCredentials(t *testing.T) {
	svc, _ := requestProtocolTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	for _, mutate := range []func(map[string]any){
		func(m map[string]any) { m["runtime"] = map[string]any{"backend": "host:unsafe"} },
		func(m map[string]any) {
			m["contributes"].(map[string]any)["commands"] = []any{map[string]any{"id": "other"}}
		},
		func(m map[string]any) {
			p := m["contributes"].(map[string]any)["providers"].([]any)[0].(map[string]any)
			p["create"].(map[string]any)["headers"] = map[string]any{"Authorization": "Bearer private"}
		},
	} {
		check := requestProtocolTestCheck()
		var manifest map[string]any
		if err := json.Unmarshal(check.Manifest, &manifest); err != nil {
			t.Fatal(err)
		}
		mutate(manifest)
		check.Manifest, _ = json.Marshal(manifest)
		if _, err := svc.AdminCheckRequestProtocol(context.Background(), admin, check); err == nil {
			t.Fatal("unsafe protocol accepted")
		}
	}
}
