package app

// 覆盖：声明式视频插件的分离式回查（detachedPolling）与 Token 计费结算，
// 以及本次改动涉及的「按插件声明 / 模型能力判断」各处。

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

const detachedVideoTestManifest = `{
  "apiVersion": "yingce.plugin/v1",
  "id": "vendor-video-detached-test",
  "name": "Vendor Detached Video Test",
  "version": "1.0.0",
  "runtime": {"backend": "declarative"},
  "contributes": {"providers": [{
    "id": "vendor-video-detached-test",
    "label": "Vendor Detached Video",
    "capabilities": ["video"],
    "scopes": ["admin.system-channel", "canvas"],
    "baseUrl": "https://vendor.example.com",
    "detachedPolling": true,
    "auth": {"type": "bearer", "field": "apiKey"},
    "create": {"method": "POST", "path": "/v1/videos", "fields": {"model": "request.model", "prompt": "request.prompt"}},
    "poll": {"method": "GET", "path": "/v1/videos/{{taskId}}"},
    "response": {"taskIdPaths": ["task.id"], "statusPaths": ["task.status"], "resultPaths": ["task.video_url"], "resultKind": "video"}
  }]}
}`

// vendorImageTestManifest 是声明式图片插件的内联 manifest：size(binding=aspectRatio) /
// imageResolution(1K,2K) / count(max=1) / transparentBackground，用于验证默认图片画像完全由声明推导。
const vendorImageTestManifest = `{
  "apiVersion": "yingce.plugin/v1",
  "id": "vendor-image-banana",
  "name": "Vendor Banana Image Test",
  "version": "1.0.0",
  "runtime": {"backend": "declarative"},
  "contributes": {"providers": [{
    "id": "vendor-image-banana",
    "label": "Vendor Banana Image",
    "capabilities": ["image"],
    "scopes": ["admin.system-channel", "canvas"],
    "baseUrl": "https://vendor.example.com",
    "auth": {"type": "bearer", "field": "apiKey"},
    "create": {"method": "POST", "path": "/v1/images/generations"},
    "imageParameters": [
      {"name": "size", "label": "Size", "type": "string", "binding": "aspectRatio"},
      {"name": "imageResolution", "label": "Resolution", "type": "string", "binding": "resolution", "values": ["1K", "2K"], "default": "1K"},
      {"name": "count", "label": "Count", "type": "integer", "binding": "imageCount", "min": 1, "max": 1, "step": 1, "default": 1},
      {"name": "transparentBackground", "label": "Transparent background", "type": "boolean", "binding": "transparentBackground", "default": false}
    ]
  }]}
}`

// vendorVideoTestManifestTemplate 是声明式视频插件的 manifest 模板：声明 detachedPolling + poll，不声明 cancel。
const vendorVideoTestManifestTemplate = `{
  "apiVersion": "yingce.plugin/v1",
  "id": "__ID__",
  "name": "Vendor Video Test",
  "version": "1.0.0",
  "runtime": {"backend": "declarative"},
  "contributes": {"providers": [{
    "id": "__ID__",
    "label": "Vendor Video",
    "capabilities": ["video"],
    "scopes": ["admin.system-channel", "canvas"],
    "baseUrl": "https://vendor.example.com",
    "detachedPolling": true,
    "auth": {"type": "bearer", "field": "apiKey"},
    "create": {"method": "POST", "path": "/v1/videos", "fields": {"model": "request.model", "prompt": "request.prompt"}},
    "poll": {"method": "GET", "path": "/v1/videos/{{taskId}}"},
    "response": {"taskIdPaths": ["task.id"], "statusPaths": ["task.status"], "resultPaths": ["task.video_url"], "resultKind": "video"}
  }]}
}`

func vendorVideoTestManifest(id string) string {
	return strings.ReplaceAll(vendorVideoTestManifestTemplate, "__ID__", id)
}

func detachedVideoTestAdapter(t *testing.T) protocol.Adapter {
	t.Helper()
	adapters, err := protocol.LoadInstalledProviders([]byte(detachedVideoTestManifest), nil)
	if err != nil || len(adapters) != 1 {
		t.Fatalf("load detached video adapter: count=%d error=%v", len(adapters), err)
	}
	return adapters[0]
}

// TestDeclarativeDetachedVideoPollingReturnsTaskToScheduling 验证声明 detachedPolling 的视频插件
// 提交成功后不在 worker 内等待，而是带上游任务 ID 退回调度；恢复后回查仍未完成继续退回，
// 回查完成后按插件声明的结果映射出片。
func TestDeclarativeDetachedVideoPollingReturnsTaskToScheduling(t *testing.T) {
	allowLoopbackProviderTest(t)
	adapter := detachedVideoTestAdapter(t)
	if !adapter.Metadata().DetachedPolling || adapter.Metadata().Poll == "" {
		t.Fatalf("adapter metadata must declare detached polling: %#v", adapter.Metadata())
	}
	createCalls, pollCalls := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/videos":
			createCalls++
			_, _ = w.Write([]byte(`{"task":{"id":"upstream-1","status":"queued"}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/videos/upstream-1":
			pollCalls++
			if pollCalls == 1 {
				_, _ = w.Write([]byte(`{"task":{"id":"upstream-1","status":"processing"}}`))
				return
			}
			_, _ = w.Write([]byte(`{"task":{"id":"upstream-1","status":"succeeded","video_url":"http://` + r.Host + `/result.mp4"}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/result.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("fake-mp4"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	input := canvasGenerationInput{
		Mode:   "video",
		Prompt: "a clip",
		Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "wan3-0-video-wan", InterfaceType: adapter.Metadata().ID, VideoSeconds: "5"},
	}
	ctx := context.Background()
	policy := fastVideoPollPolicy()

	// 第一次：提交成功 → 退回调度，不带结果。
	result, err := runProtocolAdapterTaskWithPolicy(ctx, input, adapter, policy)
	var pending providerStatePendingError
	if !errors.As(err, &pending) || !pending.Detached || pending.TaskID != "upstream-1" {
		t.Fatalf("first run result=%#v error=%v, want detached pending for upstream-1", result, err)
	}
	if createCalls != 1 || pollCalls != 0 {
		t.Fatalf("first run create=%d poll=%d, want 1 and 0", createCalls, pollCalls)
	}

	// 第二次：恢复同一上游任务 → 回查一次仍未完成 → 再次退回调度，且不重复提交。
	resumeCtx := context.WithValue(ctx, providerAnalyticsKey{}, providerAnalyticsContext{TaskID: "task-1", ProviderRequestID: "upstream-1"})
	result, err = runProtocolAdapterTaskWithPolicy(resumeCtx, input, adapter, policy)
	if !errors.As(err, &pending) || !pending.Detached || pending.TaskID != "upstream-1" {
		t.Fatalf("resume result=%#v error=%v, want detached pending", result, err)
	}
	if createCalls != 1 || pollCalls != 1 {
		t.Fatalf("resume create=%d poll=%d, want 1 and 1", createCalls, pollCalls)
	}

	// 第三次：回查完成 → 出片。
	result, err = runProtocolAdapterTaskWithPolicy(resumeCtx, input, adapter, policy)
	if err != nil {
		t.Fatalf("completion error = %v", err)
	}
	if createCalls != 1 || pollCalls != 2 {
		t.Fatalf("completion create=%d poll=%d, want 1 and 2", createCalls, pollCalls)
	}
	if result == nil || result["mode"] != "video" {
		t.Fatalf("completion result = %#v, want mode=video", result)
	}
}

// TestDetachedVideoTokenOrderSettlesFromFormulaSnapshot 验证分离式回查的视频任务在
// 上游不回 usage 时，订单仍能按提交时记录的公式快照结算（不挂「待核对」）。
func TestDetachedVideoTokenOrderSettlesFromFormulaSnapshot(t *testing.T) {
	svc, db, channel, channelModel, profile := newVideoTokenQuoteFixture(t)
	if err := db.AutoMigrate(&model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	if profile.Video == nil {
		t.Fatal("fixture video profile missing")
	}
	intent := ModelRequestIntent{Capability: "video", Options: map[string]any{"vquality": "720p", "size": "16:9", "videoSeconds": 5}}
	input := quoteInput(intent, channelModel.ModelKey)
	input["config"].(map[string]any)["channelId"] = channel.ID
	resolved, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), input, "canvas_video", "")
	if err != nil {
		t.Fatal(err)
	}
	order, err := svc.taskBillingOrder("quote-user", &model.Task{ID: "detached-video", Type: "canvas_video"}, resolved)
	if err != nil {
		t.Fatal(err)
	}
	if order.VideoFormulaTokens <= 0 || order.BillingMode != "token" {
		t.Fatalf("detached video order has no token formula snapshot: %#v", order)
	}
	if err := svc.repo.ReserveBillingOrder(order); err != nil {
		t.Fatal(err)
	}
	if err := svc.SettleBilling(order.ID, "upstream-1"); err != nil {
		t.Fatalf("settle detached video order: %v", err)
	}
	settled, err := svc.repo.BillingOrder(order.ID)
	if err != nil {
		t.Fatal(err)
	}
	if settled.Status != model.BillingStatusSettled || settled.UsageSource != "video_formula" {
		t.Fatalf("settled = %#v, want settled by video_formula", settled)
	}
	_ = db
}

// TestImageCapabilityDefaultsFollowPluginDeclaration 验证图片能力默认值读插件 imageParameters 声明，
// 未声明时保留按协议名的内置画像。
func TestImageCapabilityDefaultsFollowPluginDeclaration(t *testing.T) {
	defaults := DefaultImageCapabilityConfig("agnes-image", "agnes-image")
	if defaults == nil {
		t.Fatal("missing declared image defaults")
	}
	// agnes-image 插件声明 size(binding=aspectRatio) / imageResolution(1k,2k,4k) / count。
	if defaults.Size.Parameter != "size" || !defaults.Resolution.Supported || len(defaults.Resolution.Values) != 3 {
		t.Fatalf("declared image defaults not applied: %#v", defaults)
	}
	adapter, ok := loadOfficialFallbackRegistry().Resolve("agnes-image")
	if !ok {
		t.Fatal("agnes-image plugin missing")
	}
	wantOutputs := 0
	for _, parameter := range adapter.Metadata().ImageParameters {
		if parameter.Binding == "imageCount" && parameter.Max != nil {
			wantOutputs = int(*parameter.Max)
		}
	}
	if wantOutputs == 0 || defaults.MaxOutputs != wantOutputs {
		t.Fatalf("declared imageCount max not applied: maxOutputs=%d, want %d", defaults.MaxOutputs, wantOutputs)
	}
	// 没有插件声明的协议保持内置画像（gemini-image 的 aspect_ratio + 最多 4 张）。
	builtin := DefaultImageCapabilityConfig(string(model.ChannelInterfaceGeminiImage), "gemini-2.5-flash-image")
	if builtin.Size.Parameter != "aspect_ratio" || builtin.MaxOutputs != 4 || !builtin.ResolutionUsesQuality {
		t.Fatalf("builtin gemini image defaults changed: %#v", builtin)
	}
	// vendor 图片协议：按插件 manifest 声明的 imageParameters 生成默认值。
	vendorAdapters, err := protocol.LoadInstalledProviders([]byte(vendorImageTestManifest), nil)
	if err != nil || len(vendorAdapters) == 0 {
		t.Fatalf("load vendor image adapters: count=%d error=%v", len(vendorAdapters), err)
	}
	vendorRegistry, err := protocol.NewRegistry(vendorAdapters...)
	if err != nil {
		t.Fatal(err)
	}
	declared, ok := pluginDeclaredImageCapabilityDefaults("vendor-image-banana", vendorRegistry)
	if !ok || !declared.Resolution.Supported || !containsCapabilityString(declared.Resolution.Values, "1K") {
		t.Fatalf("vendor declared resolution missing: %#v", declared)
	}
	if declared.Size.Parameter != "size" || declared.MaxOutputs != 1 || !declared.TransparentBackground.Supported {
		t.Fatalf("vendor declared parameters not projected: %#v", declared)
	}
}

// TestDeclaredImageDefaultsPassAuthorValidation 用真实插件 manifest 验证：插件只声明 aspectRatio 绑定、
// 没有 values / default 时，生成的默认图片画像不能留下空 size.default，必须通过已有的能力校验。
func TestDeclaredImageDefaultsPassAuthorValidation(t *testing.T) {
	for _, protocolID := range []string{"agnes-image", "cangyuan-midjourney-v7"} {
		profile, ok := pluginDeclaredImageCapabilityDefaults(protocolID)
		if !ok || profile == nil {
			t.Fatalf("%s declared image defaults missing", protocolID)
		}
		if strings.TrimSpace(profile.Size.Default) == "" {
			t.Fatalf("%s default image size is empty: %#v", protocolID, profile.Size)
		}
		if len(profile.Size.Values) == 0 {
			t.Fatalf("%s default image size values are empty", protocolID)
		}
		if !containsCapabilityString(profile.Size.Values, profile.Size.Default) && profile.Size.AllowCustom {
			t.Fatalf("%s default %q must be one of the declared values or allow custom", protocolID, profile.Size.Default)
		}
		if err := validateImageCapabilityConfig(profile); err != nil {
			t.Fatalf("%s declared defaults rejected by author validation: %v", protocolID, err)
		}
	}
}

// TestLegacyImageResolutionTiersFollowPluginDeclaration 验证旧 quality→分辨率投影先读插件声明的分辨率档，
// 未安装插件时仍用写死的名单（grok-image = 1k/2k）。
func TestLegacyImageResolutionTiersFollowPluginDeclaration(t *testing.T) {
	declared := legacyImageResolutionTiers("km-kemei-seedream")
	if !declared["1k"] || !declared["1.5k"] || !declared["2k"] || declared["4k"] {
		t.Fatalf("declared resolution tiers = %#v", declared)
	}
	builtin := legacyImageResolutionTiers(string(model.ChannelInterfaceGrokImage))
	if !builtin["1k"] || !builtin["2k"] || builtin["4k"] {
		t.Fatalf("builtin grok-image tiers = %#v", builtin)
	}
	if tiers := legacyImageResolutionTiers("vendor-video"); len(tiers) != 0 {
		t.Fatalf("video protocol must not declare image resolution tiers: %#v", tiers)
	}
}

// TestAdminModelTestVideoSecondsFollowsCapability 验证后台测试时长读 video.duration.default（Veo 8 秒），
// 没有声明时保持 6 秒 / 即梦 5 秒内置行为。
func TestAdminModelTestVideoSecondsFollowsCapability(t *testing.T) {
	veo := &VideoCapabilityConfig{Duration: VideoDurationConfig{Selection: "enum", Values: []int{4, 6, 8}, Default: 8}}
	if text, value := videoTestSeconds(6, veo); text != "8" || value != 8 {
		t.Fatalf("veo test seconds = %q/%d, want 8", text, value)
	}
	if text, value := videoTestSeconds(6, nil); text != "6" || value != 6 {
		t.Fatalf("undeclared test seconds = %q/%d, want 6", text, value)
	}
	if text, value := videoTestSeconds(5, nil); text != "5" || value != 5 {
		t.Fatalf("jimeng builtin test seconds = %q/%d, want 5", text, value)
	}
}

// TestStyleAssetMatchesDeclaredCapability 验证画风资产可以按模型声明的能力匹配，而不只按模型名。
func TestStyleAssetMatchesDeclaredCapability(t *testing.T) {
	declaration := styleModelDeclaration{Capability: "image", Protocol: "vendor-image-banana", PromptFamily: "gemini-image"}
	if !styleAssetSupportsDeclaration([]string{"nano-banana-pro-unified"}, "nano-banana-pro-unified", declaration) {
		t.Fatal("model key match regressed")
	}
	if !styleAssetSupportsDeclaration([]string{"image"}, "nano-banana-pro-unified", declaration) {
		t.Fatal("capability match missing")
	}
	if !styleAssetSupportsDeclaration([]string{"gemini-image"}, "nano-banana-pro-unified", declaration) {
		t.Fatal("prompt family match missing")
	}
	if styleAssetSupportsDeclaration([]string{"midjourney"}, "nano-banana-pro-unified", declaration) {
		t.Fatal("unrelated base model must be skipped")
	}
	if styleAssetSupportsModel([]string{"image"}, "nano-banana-pro-unified") {
		t.Fatal("legacy helper must keep name-only matching")
	}
}

// TestProtocolRequiresSecretKeyFollowsManifest 验证第二把密钥按插件声明的 auth.secretField 判断：
// 即梦插件声明 secretKey 仍要求 AK/SK，没有声明的协议不再被拦。
func TestProtocolRequiresSecretKeyFollowsManifest(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{pluginRuntime: center}
	for _, protocolID := range []string{"volcengine-jimeng-image", "volcengine-jimeng-video"} {
		if !svc.protocolRequiresSecretKey(protocolID) {
			t.Fatalf("%s plugin declares auth.secretField but the requirement was dropped", protocolID)
		}
	}
	for _, protocolID := range []string{"chat-completion", "openai-image"} {
		if svc.protocolRequiresSecretKey(protocolID) {
			t.Fatalf("%s must not require a second secret key", protocolID)
		}
	}
}

// TestWorkflowPluginDetectionFollowsDeclarations 验证工作流插件按 contributes.workflows 声明识别，
// 并保留内置的 RunningHub 映射。
func TestWorkflowPluginDetectionFollowsDeclarations(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{pluginRuntime: center}
	for _, interfaceType := range []string{"runninghub-workflow-image", "runninghub-workflow-video", "runninghub-workflow-audio"} {
		pluginID, ok := svc.workflowPluginIDForInterfaceFor(interfaceType)
		if !ok || pluginID != WorkflowPluginRunningHub {
			t.Fatalf("workflow plugin lookup %s = %q/%v", interfaceType, pluginID, ok)
		}
		if !svc.isWorkflowProviderInterfaceDeclared(interfaceType) {
			t.Fatalf("%s must stay a workflow interface", interfaceType)
		}
	}
	for _, interfaceType := range []string{"vendor-video", "chat-completion"} {
		if svc.isWorkflowProviderInterfaceDeclared(interfaceType) {
			t.Fatalf("%s must not be treated as a workflow plugin", interfaceType)
		}
	}
}

// TestProviderCancellationFollowsDeclarations 验证取消能力：内置的 Veo / 方舟行为不变；
// 协议名不再作为通用判断；声明式视频插件声明 detachedPolling + poll 但没有 cancel，
// 因此取消行为不变；同时声明 cancel 的插件才满足可取消条件。
func TestProviderCancellationFollowsDeclarations(t *testing.T) {
	if !supportsProviderCancellation(string(model.ChannelInterfaceGeminiVeo)) {
		t.Fatal("builtin gemini-veo cancellation regressed")
	}
	if !supportsProviderCancellation(string(model.ChannelInterfaceVolcengineArkVideo)) {
		t.Fatal("builtin ark video cancellation regressed")
	}
	if supportsProviderCancellation("vendor-video") {
		t.Fatal("plugin protocol must not be cancellable by protocol name")
	}

	for _, name := range []string{"vendor-video", "vendor-video-flow"} {
		adapters, err := protocol.LoadInstalledProviders([]byte(vendorVideoTestManifest(name)), nil)
		if err != nil || len(adapters) == 0 {
			t.Fatalf("load %s adapters: count=%d error=%v", name, len(adapters), err)
		}
		for _, adapter := range adapters {
			metadata := adapter.Metadata()
			if !metadata.DetachedPolling || strings.TrimSpace(metadata.Poll) == "" {
				t.Fatalf("%s/%s missing detachedPolling+poll declaration: %#v", name, metadata.ID, metadata)
			}
			if strings.TrimSpace(metadata.Cancel) != "" {
				t.Fatalf("%s/%s must not declare cancel", name, metadata.ID)
			}
		}
	}

	withoutCancel := cancellationTestAdapter(t, detachedVideoTestManifest)
	metadata := withoutCancel.Metadata()
	if metadata.DetachedPolling && metadata.Cancel != "" && metadata.Poll != "" {
		t.Fatal("detached polling without a cancel operation must not be cancellable")
	}
	withCancel := cancellationTestAdapter(t, strings.Replace(detachedVideoTestManifest, `"poll": {"method": "GET"`, `"cancel": {"method": "POST", "path": "/v1/videos/{{taskId}}/cancel"}, "poll": {"method": "GET"`, 1))
	metadata = withCancel.Metadata()
	if !metadata.DetachedPolling || metadata.Cancel == "" || metadata.Poll == "" {
		t.Fatalf("declared cancel+poll must make the protocol cancellable: %#v", metadata)
	}
}

func cancellationTestAdapter(t *testing.T, manifest string) protocol.Adapter {
	t.Helper()
	adapters, err := protocol.LoadInstalledProviders([]byte(manifest), nil)
	if err != nil || len(adapters) != 1 {
		t.Fatalf("load adapter: count=%d error=%v", len(adapters), err)
	}
	return adapters[0]
}

// TestImageResumeFollowsPluginPollDeclaration 验证图片任务可续跑先看插件声明的 poll，
// 没装插件时保留即梦 / RunningHub 内置名单。
func TestImageResumeFollowsPluginPollDeclaration(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{pluginRuntime: center}
	if !svc.imageProviderSupportsTaskResume("volcengine-jimeng-image") {
		t.Fatal("jimeng image plugin declares poll and must stay resumable")
	}
	if !svc.imageProviderSupportsTaskResume("runninghub-workflow-image") {
		t.Fatal("builtin RunningHub workflow must stay resumable")
	}
	if svc.imageProviderSupportsTaskResume("vendor-image-not-installed") {
		t.Fatal("unknown protocol must not be resumable")
	}
}

// TestVideoDefaultMinReferenceDurationFollowsProtocol 验证方舟视频与 newapi-channel-1/2 的默认视频能力里
// 参考视频最短 2 秒：原来按 Seedance 模型名判断，改成读能力字段后默认值必须补上，行为才不变。
func TestVideoDefaultMinReferenceDurationFollowsProtocol(t *testing.T) {
	for _, protocol := range []model.ChannelInterfaceType{
		model.ChannelInterfaceVolcengineArkVideo,
		model.ChannelInterfaceVolcengineArkAgentPlanVideo,
		model.ChannelInterfaceNewAPIChannel1,
		model.ChannelInterfaceNewAPIChannel2,
	} {
		config := DefaultModelCapabilityConfigForModel(string(protocol), "seedance-test")
		if config == nil || config.Video == nil || config.Video.References.MinVideoDuration != 2 {
			t.Fatalf("%s default minVideoDurationSeconds != 2: %#v", protocol, config)
		}
	}
	for _, protocol := range []model.ChannelInterfaceType{model.ChannelInterfaceGeminiVeo, "vendor-video"} {
		config := DefaultModelCapabilityConfigForModel(string(protocol), "veo-lite-flow")
		if config == nil || config.Video == nil || config.Video.References.MinVideoDuration != 0 {
			t.Fatalf("%s must not impose a minimum reference duration: %#v", protocol, config)
		}
	}
}

// TestCapabilityConfigKeepsAudioAndPromptFamily 验证 audio / promptFamily / minVideoDurationSeconds
// 经过归一化与保存（序列化 + 反序列化）后都还在；没有声明 audio 时序列化结果里不出现 audio。
func TestCapabilityConfigKeepsAudioAndPromptFamily(t *testing.T) {
	base := DefaultModelCapabilityConfigForModel("vendor-video", "wan3-0-video-wan")
	if base == nil || base.Video == nil {
		t.Fatal("video capability default missing")
	}
	base.Video.References.MinVideoDuration = 2
	input := &ModelCapabilityConfig{
		Version:      1,
		PromptFamily: "  seedance-video  ",
		Video:        base.Video,
		Audio: &AudioCapabilityConfig{
			References: AudioReferenceConfig{MaxAudios: -3, MaxImages: 2},
			Voices: []AudioCapabilityOption{
				{Value: "  alloy  ", Label: "  Alloy  "},
				{Value: "   ", Label: "空值项"},
			},
			Formats:       []AudioCapabilityOption{},
			VoiceInput:    "  free  ",
			ProviderNotes: true,
		},
	}
	normalized, err := NormalizeModelCapabilityConfigForModel("video", "vendor-video", "wan3-0-video-wan", input)
	if err != nil || normalized == nil {
		t.Fatalf("normalize video config: %#v %v", normalized, err)
	}
	if normalized.PromptFamily != "seedance-video" {
		t.Fatalf("promptFamily lost or not trimmed: %q", normalized.PromptFamily)
	}
	if normalized.Video == nil || normalized.Video.References.MinVideoDuration != 2 {
		t.Fatalf("minVideoDurationSeconds lost: %#v", normalized.Video)
	}
	audio := normalized.Audio
	if audio == nil {
		t.Fatal("audio declaration dropped by normalization")
	}
	if audio.References.MaxAudios != 0 || audio.References.MaxImages != 2 {
		t.Fatalf("audio references not clamped: %#v", audio.References)
	}
	if len(audio.Voices) != 1 || audio.Voices[0].Value != "alloy" || audio.Voices[0].Label != "Alloy" {
		t.Fatalf("audio voices not cleaned: %#v", audio.Voices)
	}
	if audio.Formats != nil {
		t.Fatalf("empty audio formats must stay unset: %#v", audio.Formats)
	}
	if audio.VoiceInput != "free" || !audio.ProviderNotes {
		t.Fatalf("audio voiceInput/providerNotes lost: %#v", audio)
	}

	// 保存路径：序列化入库，再读回仍完整。
	encoded, err := json.Marshal(normalized)
	if err != nil {
		t.Fatal(err)
	}
	saved := string(encoded)
	for _, key := range []string{`"audio"`, `"promptFamily"`, `"minVideoDurationSeconds"`} {
		if !strings.Contains(saved, key) {
			t.Fatalf("saved capability JSON missing %s: %s", key, saved)
		}
	}
	reloaded, err := DecodeModelCapabilityConfig(saved)
	if err != nil || reloaded == nil || reloaded.Audio == nil || reloaded.Audio.References.MaxImages != 2 || reloaded.PromptFamily != "seedance-video" {
		t.Fatalf("capability JSON round trip lost fields: %#v %v", reloaded, err)
	}

	// 没有声明 audio 时，序列化结果里不出现 audio。
	withoutAudio := &ModelCapabilityConfig{Version: 1, PromptFamily: "veo-video", Video: base.Video}
	plain, err := NormalizeModelCapabilityConfigForModel("video", "vendor-video", "veo-lite-flow", withoutAudio)
	if err != nil || plain == nil {
		t.Fatalf("normalize without audio: %#v %v", plain, err)
	}
	plainJSON, err := json.Marshal(plain)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(plainJSON), `"audio"`) {
		t.Fatalf("undeclared audio must not be serialized: %s", plainJSON)
	}

	// 音频能力：声明了 audio 就保存，没声明仍返回 nil（与原来的“音频无能力合同”一致）。
	audioOnly := &ModelCapabilityConfig{Version: 1, Audio: &AudioCapabilityConfig{References: AudioReferenceConfig{MaxAudios: 3, MaxImages: 1}}}
	normalizedAudio, err := NormalizeModelCapabilityConfigForModel("audio", "doubao-streaming-tts", "", audioOnly)
	if err != nil || normalizedAudio == nil || normalizedAudio.Audio == nil || normalizedAudio.Audio.References.MaxAudios != 3 {
		t.Fatalf("audio capability dropped on save: %#v %v", normalizedAudio, err)
	}
	if empty, err := NormalizeModelCapabilityConfigForModel("audio", "doubao-streaming-tts", "", &ModelCapabilityConfig{Version: 1}); err != nil || empty != nil {
		t.Fatalf("audio without declaration must stay empty: %#v %v", empty, err)
	}
}

// TestCapabilityConfigKeepsNewVideoFields 验证新增能力字段在 JSON 往返中保持前后端一致的名字。
func TestCapabilityConfigKeepsNewVideoFields(t *testing.T) {
	raw := `{"version":1,"promptFamily":"seedance-video","video":{"references":{"minVideoDurationSeconds":2},"duration":{"default":8}}}`
	decoded, err := DecodeModelCapabilityConfig(raw)
	if err != nil || decoded == nil || decoded.Video == nil {
		t.Fatalf("decode capability config: %#v %v", decoded, err)
	}
	if decoded.PromptFamily != "seedance-video" || decoded.Video.References.MinVideoDuration != 2 {
		t.Fatalf("new capability fields lost: %#v", decoded)
	}
	if decoded.Video.Duration.Default != 8 {
		t.Fatalf("video duration lost: %#v", decoded.Video.Duration)
	}
}
