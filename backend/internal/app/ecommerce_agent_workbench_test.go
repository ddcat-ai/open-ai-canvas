package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
)

func TestEcommerceWorkbenchDirectionsWithBuiltinKnowledge(t *testing.T) {
	svc, db := mockEcommerceAgentService(t)
	if err := db.AutoMigrate(&model.EcommerceCreativeRecommendation{}); err != nil {
		t.Fatal(err)
	}
	project, err := svc.CreateEcommerceProject("owner")
	if err != nil {
		t.Fatal(err)
	}
	response, err := svc.RecommendEcommerceCreativeDirectionsContext(context.Background(), "owner", EcommerceCreativeDirectionsRequest{ProjectID: project.ID, ProductName: "耳机", Platform: "douyin", Count: 30})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Directions) != 4 || len(response.Evidence) == 0 || response.RetrievalStatus != "ready" {
		t.Fatalf("invalid legacy response: %+v", response)
	}
	selected, err := svc.SelectEcommerceCreativeDirection("owner", response.RecommendationID, response.Directions[2].ID)
	if err != nil {
		t.Fatal(err)
	}
	if selected.PlanningContext["engine"] != "ecommerce-agent" || selected.PlanningContext["knowledgeContext"] == nil {
		t.Fatalf("wrong strategy: %+v", selected)
	}
	if _, err := svc.RecommendEcommerceCreativeDirectionsContext(context.Background(), "other", EcommerceCreativeDirectionsRequest{ProjectID: project.ID}); err == nil {
		t.Fatal("cross-owner project accepted")
	}
	if _, err := svc.SelectEcommerceCreativeDirection("other", response.RecommendationID, response.Directions[2].ID); err == nil {
		t.Fatal("cross-owner selection accepted")
	}
	if p := ecommerceWorkbenchPlatform(EcommerceDraft{Platform: "unknown-market", Ratio: "9:16"}); p.Label != "unknown-market" || p.ForbidTextOnMain {
		t.Fatalf("unknown platform borrowed other rules: %+v", p)
	}
	if p := ecommerceWorkbenchPlatform(EcommerceDraft{Platform: "douyin"}); p.Label != "抖音电商" || p.ForbidTextOnMain {
		t.Fatalf("Douyin did not use its own platform profile: %+v", p)
	}
	if p := ecommerceWorkbenchPlatform(EcommerceDraft{Platform: "amazon"}); !p.ForbidTextOnMain {
		t.Fatal("Amazon rules were lost")
	}
}

func TestEcommerceWorkbenchDirectionsTaskSnapshotReceiptAndOwner(t *testing.T) {
	t.Setenv("AI_MODE", "live")
	t.Setenv("TEXT_API_KEY", "")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	svc, db, _, _ := ecommerceCreationTestService(t)
	if err := db.AutoMigrate(&model.EcommerceCreativeRecommendation{}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("REDIS_URL", "")
	svc.coordinator, _ = platform.NewCoordinator("sqlite")
	svc.platform = platform.New(svc.repo, svc.coordinator, platformHost{svc: svc})
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		raw, _ := json.Marshal(body)
		if !strings.Contains(string(raw), "四套反差强烈的整套详情页视觉方向") || strings.Contains(string(raw), "untrusted") || strings.Contains(string(raw), "later-edit") {
			t.Error("wrong snapshot or contract")
		}
		p, _ := ecommerceagent.PlatformFor("淘宝")
		answer := ecommerceagent.Analysis{Brief: ecommerceagent.Brief{Category: "蓝色耳机"}, Recommendations: ecommerceagent.MockStyleRecommendations(ecommerceagent.Brief{Category: "耳机"}, p, "detail", 10, "3:4")}
		encoded, _ := json.Marshal(answer)
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": string(encoded)}}}})
	}))
	defer upstream.Close()
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": upstream.URL + "/v1", "api_key": "fixture-key", "api_format": "openai"}).Error; err != nil {
		t.Fatal(err)
	}
	project, _ := svc.CreateEcommerceProject("user")
	draft := EcommerceDraft{ProductName: "蓝色耳机", Platform: "taobao", Language: "zh-CN", Count: 10, ImageType: "detail", Ratio: "3:4"}
	encoded, _ := json.Marshal(draft)
	if err := db.Model(project).Update("draft_json", string(encoded)).Error; err != nil {
		t.Fatal(err)
	}
	req := creationTextRequest()
	req.Input["metadata"] = map[string]any{"source": "ecommerce-agent", "stage": "creative-directions", "ecommerceProjectId": project.ID, "ecommerceDraft": map[string]any{"productName": "untrusted"}}
	req.Input["textOptions"] = map[string]any{"stream": false}
	task, err := svc.CreateTask("user", req)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := svc.EcommerceProject("user", project.ID)
	if err != nil {
		t.Fatal(err)
	}
	var restoredDraft EcommerceDraft
	_ = json.Unmarshal([]byte(restored.DraftJSON), &restoredDraft)
	if restoredDraft.DirectionsTaskID != task.ID {
		t.Fatal("receipt lost before browser saved it")
	}
	if _, err := svc.repo.EcommerceDirectionsTask("other", project.ID, project.CreatedAt); err == nil {
		t.Fatal("other owner received task")
	}
	if _, err := svc.prepareEcommerceWorkbenchTask("other", req.Input, "prompt"); err == nil {
		t.Fatal("cross-owner task accepted")
	}
	if err := db.Model(project).Update("draft_json", `{"productName":"later-edit"}`).Error; err != nil {
		t.Fatal(err)
	}
	storedTask, _ := svc.repo.TaskForUser("user", task.ID)
	result, _, err := svc.processTask(context.Background(), *storedTask)
	if err != nil {
		t.Fatal(err)
	}
	var response EcommerceCreativeDirectionsResponse
	if err := json.Unmarshal([]byte(stringValue(result["text"])), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Directions) != 4 {
		t.Fatal("missing durable directions")
	}
	selection, err := svc.SelectEcommerceCreativeDirection("user", response.RecommendationID, response.Directions[0].ID)
	if err != nil || selection.PlanningContext["imageCount"] != float64(10) {
		t.Fatalf("invalid stored selection: %+v %v", selection, err)
	}
	var orders, runs int64
	db.Model(&model.BillingOrder{}).Where("task_id = ?", task.ID).Count(&orders)
	db.Model(&model.EcommerceAgentRun{}).Count(&runs)
	if calls != 1 || orders != 1 || runs != 0 {
		t.Fatalf("duplicate work: %d %d %d", calls, orders, runs)
	}
	input := canvasGenerationInput{Metadata: map[string]any{"stage": "creative-directions", "ecommerceAgentAdapter": "workbench-v1", "ecommerceProjectId": project.ID, "ecommerceDraft": draft}}
	if err := svc.validateEcommerceWorkbenchResult("user", input, map[string]any{"text": `{}`}); err == nil {
		t.Fatal("incomplete result accepted")
	}
}

// Users cannot choose the analysis models. With the workbench adapter on, the
// recognition stage resolves the administrator's recognition model (or the
// planning model when none is set), and a client-chosen model is refused.
func TestEcommerceWorkbenchAnalysisModelsAreFixedByAdministrator(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	t.Setenv("AI_MODE", "live")
	t.Setenv("TEXT_API_KEY", "")
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": "https://example.com/v1", "api_key": "server-owned"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"planner-test", "vision-test"} {
		profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), key)
		profile.Text.References.MaxImages = 4
		item := model.ChannelModel{ID: "cm-" + key, ChannelID: "channel", ModelKey: key, Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, profile), BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true}
		if err := db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
	}
	save := func(value string) {
		t.Helper()
		if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ecommerceAgentSettingKey, ValueJSON: value}); err != nil {
			t.Fatal(err)
		}
	}
	save(`{"logicalModelId":"","channelModelId":"cm-planner-test","channelId":"channel","modelKey":"planner-test","vision":{"channelModelId":"cm-vision-test","channelId":"channel","modelKey":"vision-test"}}`)
	vision, err := svc.ecommerceVisionText("user", ecommerceConfig())
	if err != nil || vision.TextProvider == nil || vision.TextProvider.ChannelModelKey != "vision-test" || vision.TextProvider.APIKey != "server-owned" {
		t.Fatalf("recognition model = %+v, %v", vision.TextProvider, err)
	}
	planning, err := svc.ecommerceConfiguredText("user", ecommerceConfig())
	if err != nil || planning.TextProvider == nil || planning.TextProvider.ChannelModelKey != "planner-test" {
		t.Fatalf("planning model = %+v, %v", planning.TextProvider, err)
	}
	save(`{"logicalModelId":"","channelModelId":"cm-planner-test","channelId":"channel","modelKey":"planner-test"}`)
	if fallback, err := svc.ecommerceVisionText("user", ecommerceConfig()); err != nil || fallback.TextProvider == nil || fallback.TextProvider.ChannelModelKey != "planner-test" {
		t.Fatalf("recognition did not fall back to the planning model: %+v, %v", fallback.TextProvider, err)
	}
	project, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(EcommerceDraft{ProductName: "蓝色耳机", Platform: "taobao", Language: "zh-CN", Count: 3, ImageType: "main", Ratio: "1:1"})
	if err := db.Model(project).Update("draft_json", string(encoded)).Error; err != nil {
		t.Fatal(err)
	}
	choice := EcommerceAgentModelSelection{ChannelID: "channel", ModelKey: "vision-test"}
	if _, err := svc.RecommendEcommerceCreativeDirectionsContext(context.Background(), "user", EcommerceCreativeDirectionsRequest{ProjectID: project.ID, AgentModel: &choice}); err == nil || !strings.Contains(err.Error(), "后台统一指定") {
		t.Fatalf("client-chosen model accepted: %v", err)
	}
	task := func(stage, modelKey string) error {
		_, err := svc.CreateTask("user", CreateTaskRequest{Type: "canvas_text", Prompt: "analyze", Input: map[string]any{"mode": "text", "prompt": "analyze", "config": map[string]any{"channelId": "channel", "model": modelKey}, "metadata": map[string]any{"source": "ecommerce-agent", "stage": stage, "ecommerceProjectId": project.ID}}})
		return err
	}
	if err := task("planning", "text-test"); err == nil || !strings.Contains(err.Error(), "策划模型已由管理员更新") {
		t.Fatalf("workbench planning accepted a model the administrator did not choose: %v", err)
	}
	if err := task("creative-directions", "text-test"); err == nil || !strings.Contains(err.Error(), "识图模型已由管理员更新") {
		t.Fatalf("workbench recognition accepted a model the administrator did not choose: %v", err)
	}
	if err := task("creative-directions", "planner-test"); err != nil && strings.Contains(err.Error(), "管理员更新") {
		t.Fatalf("recognition refused the planning model it falls back to: %v", err)
	}
}

func TestEcommerceWorkbenchLiveDirectionsUseProductImagesAndCache(t *testing.T) {
	svc, db := mockEcommerceAgentService(t)
	t.Setenv("AI_MODE", "live")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	if err := db.AutoMigrate(&model.EcommerceCreativeRecommendation{}, &model.EcommerceKnowledgeSource{}, &model.EcommerceKnowledgeEntry{}); err != nil {
		t.Fatal(err)
	}
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		raw, _ := json.Marshal(body)
		if !strings.Contains(string(raw), "data:image/png;base64,") || !strings.Contains(string(raw), "visualRisks") || !strings.Contains(string(raw), "完整用户需求") || !strings.Contains(string(raw), "四套") {
			t.Error("combined product analysis and direction request lost image or requirements")
		}
		p, _ := ecommerceagent.PlatformFor("淘宝")
		answer := ecommerceagent.Analysis{
			Brief:           ecommerceagent.Brief{Category: "耳机", Confidence: .9, Structure: []string{"头梁"}, Colorway: []string{"蓝色"}},
			Recommendations: ecommerceagent.MockStyleRecommendations(ecommerceagent.Brief{Category: "耳机"}, p, "detail", 10, "3:4"),
		}
		encoded, _ := json.Marshal(answer)
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": string(encoded)}}}})
	}))
	defer upstream.Close()
	channel := model.ModelChannel{ID: "bridge-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "fixture", BaseURL: upstream.URL + "/v1", APIKey: "fixture-key", APIFormat: "openai"}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "fixture")
	profile.Text.References.MaxImages = 1
	if err := svc.repo.SaveChannelModel(&model.ChannelModel{ID: "bridge-model", ChannelID: channel.ID, ModelKey: "fixture", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, profile), Enabled: true, PriceConfigured: true}); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ecommerceAgentSettingKey, ValueJSON: `{"channelModelId":"bridge-model","channelId":"bridge-channel","modelKey":"fixture"}`}); err != nil {
		t.Fatal(err)
	}
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/N3sAAAAASUVORK5CYII=")
	if err := os.MkdirAll(filepath.Join(svc.dataDir, "resources"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(svc.dataDir, "resources", "product.png"), png, 0600); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Resource{ID: "product", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Provider: "local", ObjectKey: "product.png", Size: int64(len(png))}).Error; err != nil {
		t.Fatal(err)
	}
	project, _ := svc.CreateEcommerceProject("owner")
	draft := EcommerceDraft{Ratio: "3:4", References: []EcommerceReference{{ResourceID: "product", Role: "primary"}, {ResourceID: "model-not-product", Role: "model"}, {ResourceID: "style-not-product", Role: "style"}}, LayoutReferences: []EcommerceReference{{ResourceID: "layout-not-product", Role: "style"}}}
	encoded, _ := json.Marshal(draft)
	if err := db.Model(project).Update("draft_json", string(encoded)).Error; err != nil {
		t.Fatal(err)
	}
	request := EcommerceCreativeDirectionsRequest{ProjectID: project.ID, ProductName: "耳机", Platform: "taobao", Language: "zh-CN", ImageType: "detail", Count: 10}
	for i := 0; i < 2; i++ {
		response, err := svc.RecommendEcommerceCreativeDirectionsContext(context.Background(), "owner", request)
		if err != nil || len(response.Directions) != 4 {
			t.Fatalf("recommend failed: %+v %v", response, err)
		}
		selection, err := svc.SelectEcommerceCreativeDirection("owner", response.RecommendationID, response.Directions[0].ID)
		if err != nil {
			t.Fatal(err)
		}
		if selection.PlanningContext["imageCount"] != float64(10) || selection.PlanningContext["contentType"] != "detail" {
			t.Fatalf("content type/count lost: %+v", selection.PlanningContext)
		}
	}
	if calls != 1 {
		t.Fatalf("cached repeat paid twice: %d calls", calls)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	request.Instruction = "changed"
	if _, err := svc.RecommendEcommerceCreativeDirectionsContext(ctx, "owner", request); err == nil {
		t.Fatal("canceled analysis succeeded")
	}
	if calls != 1 {
		t.Fatal("canceled request reached upstream")
	}
}

func TestEcommerceWorkbenchPlanningUsesSharedTaskAndSingleOrder(t *testing.T) {
	t.Setenv("AI_MODE", "live")
	t.Setenv("TEXT_API_KEY", "")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	svc, db, _, _ := ecommerceCreationTestService(t)
	t.Setenv("REDIS_URL", "")
	svc.coordinator, _ = platform.NewCoordinator("sqlite")
	svc.platform = platform.New(svc.repo, svc.coordinator, platformHost{svc: svc})
	calls := 0
	plan := model.EcommercePlan{ProductSummary: "蓝色耳机", VisualStrategy: "自然光系列", ConfirmedFacts: []string{}, UncertainFacts: []string{}, QualityChecks: []string{"商品一致"}, Images: []model.EcommercePlanTask{{ID: "image-1", ImageType: "detail", Platform: "taobao", Language: "zh-CN", Goal: "查看外观", Theme: "外观", Composition: "平视", MainVisual: "耳机", Fidelity: "真实外观", Prompt: "blue headphones on a desk", PerformanceAngle: "可见设计｜围绕可见佩戴结构说明日常使用体验", InformationComponent: "标题导语｜左上标题与短说明，采用两级字号和24px安全边距", Copy: "看见设计", ImageModel: "image-model", Ratio: "1:1", Resolution: "2K"}}}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		raw, _ := json.Marshal(body)
		if !strings.Contains(string(raw), "工作台输出合同") || !strings.Contains(string(raw), "服务端已确认方向") || !strings.Contains(string(raw), "productSummary") || strings.Contains(string(raw), "later-edit") {
			t.Error("worker did not use Agent snapshot/schema")
		}
		encoded, _ := json.Marshal(plan)
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": string(encoded)}}}})
	}))
	defer upstream.Close()
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": upstream.URL + "/v1", "api_key": "fixture-key", "api_format": "openai"}).Error; err != nil {
		t.Fatal(err)
	}
	project, _ := svc.CreateEcommerceProject("user")
	draft := EcommerceDraft{ProductName: "蓝色耳机", Platform: "taobao", Language: "zh-CN", Count: 1, ImageType: "detail", ImageModel: "image-model", Ratio: "1:1", Resolution: "2K"}
	encoded, _ := json.Marshal(draft)
	if err := db.Model(project).Update("draft_json", string(encoded)).Error; err != nil {
		t.Fatal(err)
	}
	t.Setenv("AI_MODE", "mock")
	directions, err := svc.RecommendEcommerceCreativeDirectionsContext(context.Background(), "user", EcommerceCreativeDirectionsRequest{ProjectID: project.ID, ProductName: "耳机", Platform: "taobao", Count: 1})
	if err != nil {
		t.Fatal(err)
	}
	selection, err := svc.SelectEcommerceCreativeDirection("user", directions.RecommendationID, directions.Directions[1].ID)
	if err != nil {
		t.Fatal(err)
	}
	draft.CreativeRecommendationID, draft.CreativeDirectionID = selection.RecommendationID, selection.DirectionID
	encoded, _ = json.Marshal(draft)
	if err := db.Model(project).Update("draft_json", string(encoded)).Error; err != nil {
		t.Fatal(err)
	}
	otherProject, _ := svc.CreateEcommerceProject("user")
	if err := db.Model(otherProject).Update("draft_json", string(encoded)).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.prepareEcommerceWorkbenchTask("user", map[string]any{"mode": "text", "metadata": map[string]any{"source": "ecommerce-agent", "stage": "planning", "ecommerceProjectId": otherProject.ID}}, "prompt"); err != nil {
		t.Fatalf("follow-up project could not reuse owner's confirmed direction: %v", err)
	}
	t.Setenv("AI_MODE", "live")
	// The planning task must route to the administrator's planning model;
	// TestEcommerceWorkbenchAnalysisModelsAreFixedByAdministrator covers refusal.
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ecommerceAgentSettingKey, ValueJSON: `{"logicalModelId":"","channelModelId":"cm","channelId":"channel","modelKey":"text-test"}`}); err != nil {
		t.Fatal(err)
	}
	req := creationTextRequest()
	req.Input["metadata"] = map[string]any{"source": "ecommerce-agent", "stage": "planning", "ecommerceProjectId": project.ID, "ecommerceDraft": map[string]any{"productName": "untrusted"}}
	req.Input["textOptions"] = map[string]any{"stream": false}
	req.Prompt = "输出严格 JSON 对象，包含 productSummary 与 images。"
	req.Input["prompt"] = req.Prompt
	task, err := svc.CreateTask("user", req)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(task.Prompt, "untrusted") || !strings.Contains(task.Prompt, "蓝色耳机") {
		t.Fatal("untrusted client draft used")
	}
	// The planning prompt carries the compact direction, not stored knowledge copies.
	selectedJSON, _ := json.Marshal(ecommerceCompactStrategy(selection.PlanningContext))
	if !strings.Contains(task.Prompt, ecommerceagent.WorkbenchDetailPlanningMethod) || !strings.Contains(task.Prompt, string(selectedJSON)) {
		t.Fatal("detail method or confirmed direction missing from planning task")
	}
	if err := db.Model(project).Update("draft_json", `{"productName":"later-edit"}`).Error; err != nil {
		t.Fatal(err)
	}
	storedTask, err := svc.repo.TaskForUser("user", task.ID)
	if err != nil {
		t.Fatal(err)
	}
	result, _, err := svc.processTask(context.Background(), *storedTask)
	if err != nil {
		t.Fatal(err)
	}
	var got model.EcommercePlan
	if err := json.Unmarshal([]byte(stringValue(result["text"])), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Images) != 1 || !strings.Contains(got.Images[0].Prompt, ecommerceProductAnchor) || got.Images[0].Copy != "看见设计" {
		t.Fatalf("invalid legacy plan: %+v", got)
	}
	var orders, runs int64
	db.Model(&model.BillingOrder{}).Where("task_id = ?", task.ID).Count(&orders)
	db.Model(&model.EcommerceAgentRun{}).Count(&runs)
	if calls != 1 || orders != 1 || runs != 0 {
		t.Fatalf("nested generation/billing: calls=%d orders=%d runs=%d", calls, orders, runs)
	}
	metadata := map[string]any{"source": "ecommerce-agent", "stage": "planning", "ecommerceProjectId": project.ID}
	if _, err := svc.prepareEcommerceWorkbenchTask("other", map[string]any{"mode": "text", "metadata": metadata}, "prompt"); err == nil {
		t.Fatal("cross-owner planning accepted")
	}
}

func TestEcommerceWorkbenchPlanKeepsSpecializedContracts(t *testing.T) {
	svc, _ := mockEcommerceAgentService(t)
	base := model.EcommercePlan{ProductSummary: "商品外观", VisualStrategy: "一致的光线与排版", ConfirmedFacts: []string{}, UncertainFacts: []string{}, QualityChecks: []string{}, Images: []model.EcommercePlanTask{{ID: "image-1", ImageType: "detail", Platform: "taobao", Language: "zh-CN", Goal: "展示真实商品", Theme: "外观", Composition: "平视", MainVisual: "商品全貌", Fidelity: "真实", PerformanceAngle: "可见设计｜围绕可见结构和场景体验展开", InformationComponent: "标题导语｜左上标题与短说明，采用两级字号和24px安全边距", Prompt: "faithful product", Copy: "看见设计", ImageModel: "image-model", Ratio: "1:1", Resolution: "2K"}}}
	for _, kind := range []string{"detail", "sku", "white", "three-view", "marketing", "set"} {
		t.Run(kind, func(t *testing.T) {
			raw, _ := json.Marshal(base)
			var plan model.EcommercePlan
			_ = json.Unmarshal(raw, &plan)
			draft := EcommerceDraft{ImageType: kind, Count: 1, Platform: "taobao", Language: "zh-CN", ImageModel: "chosen-model", Ratio: "3:4", Resolution: "4K"}
			if kind != "set" {
				plan.Images[0].ImageType = kind
			}
			if kind == "sku" {
				draft.Skus = []EcommerceSku{{ID: "sku-real", Count: 1}}
				plan.Images[0].SkuID = "sku-real"
			}
			input := canvasGenerationInput{Metadata: map[string]any{"ecommerceAgentAdapter": "workbench-v1", "stage": "planning", "ecommerceDraft": draft}}
			raw, _ = json.Marshal(plan)
			result := map[string]any{"text": string(raw)}
			if err := svc.validateEcommerceWorkbenchResult("owner", input, result); err != nil {
				t.Fatal(err)
			}
			var got model.EcommercePlan
			_ = json.Unmarshal([]byte(stringValue(result["text"])), &got)
			if got.Images[0].ImageModel != draft.ImageModel || got.Images[0].Ratio != draft.Ratio || got.Images[0].Resolution != draft.Resolution {
				t.Fatal("selected generation settings changed")
			}
			if !strings.Contains(got.Images[0].Prompt, ecommerceagent.LayoutSafetyRule) {
				t.Fatal("image plan lost layout safety after server normalization")
			}
			if (kind == "white" || kind == "three-view") && got.Images[0].Copy != "" {
				t.Fatal("pure product image kept copy")
			}
			if kind == "detail" && (len(got.QualityChecks) < 3 || !strings.Contains(strings.Join(got.QualityChecks, " "), "人工核对")) {
				t.Fatal("detail plan lost post-generation review guidance")
			}
			if kind == "sku" {
				plan.Images[0].SkuID = "invented"
			} else {
				draft.Count = 2
				input.Metadata["ecommerceDraft"] = draft
			}
			raw, _ = json.Marshal(plan)
			if err := svc.validateEcommerceWorkbenchResult("owner", input, map[string]any{"text": string(raw)}); err == nil {
				t.Fatal("invalid count/SKU accepted")
			}
		})
	}
	for _, copy := range []string{"镜头：85mm 微距", "构图采用左侧留白", "将标题放在画面右侧"} {
		t.Run("reject internal copy: "+copy, func(t *testing.T) {
			plan := base
			plan.Images = append([]model.EcommercePlanTask(nil), base.Images...)
			plan.Images[0].Copy = copy
			raw, _ := json.Marshal(plan)
			input := canvasGenerationInput{Metadata: map[string]any{"ecommerceAgentAdapter": "workbench-v1", "stage": "planning", "ecommerceDraft": EcommerceDraft{ImageType: "detail", Count: 1, Platform: "taobao", Language: "zh-CN", ImageModel: "chosen-model", Ratio: "3:4", Resolution: "4K"}}}
			if err := svc.validateEcommerceWorkbenchResult("owner", input, map[string]any{"text": string(raw)}); err == nil || !strings.Contains(err.Error(), "消费者文案") {
				t.Fatalf("internal production direction accepted as copy: %v", err)
			}
		})
	}
	missingPerformance := base
	missingPerformance.Images = append([]model.EcommercePlanTask(nil), base.Images...)
	missingPerformance.Images[0].PerformanceAngle = ""
	raw, _ := json.Marshal(missingPerformance)
	input := canvasGenerationInput{Metadata: map[string]any{"ecommerceAgentAdapter": "workbench-v1", "stage": "planning", "ecommerceDraft": EcommerceDraft{ImageType: "detail", Count: 1, Platform: "taobao", Language: "zh-CN", ImageModel: "chosen-model", Ratio: "3:4", Resolution: "4K"}}}
	if err := svc.validateEcommerceWorkbenchResult("owner", input, map[string]any{"text": string(raw)}); err == nil || !strings.Contains(err.Error(), "性能/体验角度") {
		t.Fatalf("detail plan without a performance angle accepted: %v", err)
	}
	base.ReferenceSummary = "按来源逐屏分析"
	base.Images[0].ReferenceScreen = &model.EcommerceReferenceScreen{SourceResourceID: "layout", ScreenIndex: 1, Top: 0, Bottom: 1, Content: "商品介绍", Layout: "左图右文", Visual: "真实商品", ResourceID: "injected-crop"}
	draft := EcommerceDraft{ImageType: "detail", Count: 5, Platform: "taobao", Language: "zh-CN", ImageModel: "chosen", Ratio: "3:4", Resolution: "2K", ReferenceMode: "detail", LayoutReferences: []EcommerceReference{{ResourceID: "layout", Role: "style"}}}
	input = canvasGenerationInput{Metadata: map[string]any{"ecommerceAgentAdapter": "workbench-v1", "stage": "planning", "ecommerceDraft": draft}}
	raw, _ = json.Marshal(base)
	result := map[string]any{"text": string(raw)}
	if err := svc.validateEcommerceWorkbenchResult("owner", input, result); err != nil {
		t.Fatal(err)
	}
	var got model.EcommercePlan
	_ = json.Unmarshal([]byte(stringValue(result["text"])), &got)
	if len(got.Images) != 1 || got.Images[0].ReferenceScreen.ResourceID != "" {
		t.Fatal("actual screen count or crop ownership lost")
	}
	base.Images[0].ReferenceScreen.SourceResourceID = "not-owned-layout"
	raw, _ = json.Marshal(base)
	if err := svc.validateEcommerceWorkbenchResult("owner", input, map[string]any{"text": string(raw)}); err == nil {
		t.Fatal("unknown layout source accepted")
	}
}

func TestEcommerceWorkbenchPlanningEnforcesProductClaimEvidence(t *testing.T) {
	svc, _ := mockEcommerceAgentService(t)
	base := model.EcommercePlan{
		ProductSummary: "商品外观", VisualStrategy: "统一光线与排版", ConfirmedFacts: []string{}, UncertainFacts: []string{}, QualityChecks: []string{},
		Images: []model.EcommercePlanTask{{
			ID: "image-1", ImageType: "detail", Platform: "taobao", Language: "zh-CN", Goal: "呈现商品", Theme: "外观", Composition: "平视构图", MainVisual: "商品全貌", Fidelity: "保留真实外观", Prompt: "faithful product", PerformanceAngle: "可见设计｜围绕可见外观组织画面", InformationComponent: "标题导语｜左上标题和短说明采用两级字号，保留手机端安全边距", Copy: "看见设计", ImageModel: "image-model", Ratio: "1:1", Resolution: "2K",
		}},
	}
	tests := []struct {
		name, copy, prompt, specifications string
		uncertain                          []string
		wantReject                         bool
	}{
		// Advertising red lines are removed from the page (the callout line is
		// dropped) and listed after the marker; the paid plan still succeeds.
		{name: "unverified certification", copy: "看见设计\nCE认证", wantReject: true},
		{name: "unverified health claim", copy: "看见设计\n无毒安心", wantReject: true},
		// Inferred product information stays and is listed for seller review.
		{name: "inferred specification", copy: "看见设计\n续航24小时"},
		{name: "inferred function", copy: "看见设计\n主动降噪"},
		{name: "seller supplied specification", copy: "续航24小时", specifications: "续航24小时"},
		{name: "internal visual exploration", prompt: "以抽象光影和轮廓线进行内部视觉探索，不还原或暗示真实内部结构、零件或功能。", uncertain: []string{"内部结构尚未确认，仅用于内部视觉探索，等待人工审阅"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			plan := base
			plan.Images = append([]model.EcommercePlanTask(nil), base.Images...)
			if tc.copy != "" {
				plan.Images[0].Copy = tc.copy
			}
			if tc.prompt != "" {
				plan.Images[0].Prompt = tc.prompt
			}
			if tc.uncertain != nil {
				plan.UncertainFacts = tc.uncertain
			}
			draft := EcommerceDraft{ImageType: "detail", Count: 1, Platform: "taobao", Language: "zh-CN", ImageModel: "chosen-model", Ratio: "1:1", Resolution: "2K", Specifications: tc.specifications}
			input := canvasGenerationInput{Metadata: map[string]any{"ecommerceAgentAdapter": "workbench-v1", "stage": "planning", "ecommerceDraft": draft}}
			raw, err := json.Marshal(plan)
			if err != nil {
				t.Fatal(err)
			}
			result := map[string]any{"text": string(raw)}
			err = svc.validateEcommerceWorkbenchResult("owner", input, result)
			if tc.wantReject {
				var got model.EcommercePlan
				_ = json.Unmarshal([]byte(stringValue(result["text"])), &got)
				claim := strings.Split(tc.copy, "\n")[1]
				if err != nil || len(got.Images) != 1 || strings.Contains(got.Images[0].Copy, claim) || got.Images[0].Copy != "看见设计" || !strings.Contains(got.Images[0].Prompt, ecommerceUnverifiedClaimMarker) {
					t.Fatalf("unsupported claim was not removed: err=%v images=%+v", err, got.Images)
				}
				return
			}
			if err != nil {
				t.Fatalf("supported fact or internal visual exploration was rejected: %v", err)
			}
			if strings.HasPrefix(tc.name, "inferred") {
				var got model.EcommercePlan
				_ = json.Unmarshal([]byte(stringValue(result["text"])), &got)
				claim := strings.Split(tc.copy, "\n")[1]
				if got.Images[0].Copy != tc.copy || !strings.Contains(strings.Join(got.QualityChecks, "\n"), "发布前请商家核对") {
					t.Fatalf("inferred product information was not kept for review: copy=%q checks=%v claim=%s", got.Images[0].Copy, got.QualityChecks, claim)
				}
			}
		})
	}
}

func TestEcommerceDetailRhythmRejectsRepetitiveNinePagePlans(t *testing.T) {
	draft := EcommerceDraft{ImageType: "detail", Count: 9}
	base := model.EcommercePlan{Images: make([]model.EcommercePlanTask, 9)}
	for index := range base.Images {
		angle := "可见设计｜围绕可见结构说明实际操作关系，不推断性能结果"
		if index%2 == 1 {
			angle = "场景体验｜以不同使用场景回应日常选择，不承诺未证实效果"
		}
		composition := fmt.Sprintf("不同机位构图%d", index)
		if index < 2 {
			composition = "可见局部微距特写"
		}
		base.Images[index] = model.EcommercePlanTask{
			Goal: fmt.Sprintf("购买目标%d", index), Theme: fmt.Sprintf("主题%d", index),
			Composition: composition, MainVisual: "真实可见商品", PerformanceAngle: angle, InformationComponent: "标题导语｜左上标题与短说明，采用两级字号和24px安全边距",
			Prompt: "商业摄影画面",
		}
	}
	if err := validateEcommerceDetailRhythm(draft, base); err != nil {
		t.Fatalf("valid nine-page story rejected: %v", err)
	}
	copyPlan := func() model.EcommercePlan {
		plan := base
		plan.Images = append([]model.EcommercePlanTask(nil), base.Images...)
		return plan
	}
	repetitive := copyPlan()
	for index := range repetitive.Images {
		repetitive.Images[index].PerformanceAngle = "同一体验角度"
	}
	if err := validateEcommerceDetailRhythm(draft, repetitive); err == nil {
		t.Fatal("repetitive performance angles accepted")
	}
	noCloseups := copyPlan()
	for index := range noCloseups.Images {
		noCloseups.Images[index].Composition = "完整商品居中展示"
	}
	if err := validateEcommerceDetailRhythm(draft, noCloseups); err == nil {
		t.Fatal("nine-page plan without closeups accepted")
	}
}

func TestRepairEcommercePerformanceAngleFilesNearMisses(t *testing.T) {
	for _, tc := range []struct{ angle, want string }{
		{"可见设计｜围绕可见杯柄展开", "可见设计｜围绕可见杯柄展开"},
		{"选购决策：适合新手家长", "选购决策：适合新手家长"},
		{"选购决策角度：说明为什么适合新手", "选购决策｜说明为什么适合新手"},
		{"已证实性能/可见设计角度：刻度清楚", "已证实性能｜已证实性能/可见设计角度：刻度清楚"},
		{"【场景体验】周末出门", "场景体验｜周末出门"},
		{"场景体验 在户外野餐时使用", "场景体验｜在户外野餐时使用"},
		{"可见设计|宽口径方便冲调", "可见设计｜宽口径方便冲调"},
		{"使用情境：通勤路上", "场景体验｜使用情境：通勤路上"},
		{"场景：夜间喂养", "场景体验｜场景：夜间喂养"},
		{"可见结构：宽口径", "可见设计｜可见结构：宽口径"},
		{"外观：圆润瓶身", "可见设计｜外观：圆润瓶身"},
		{"操作步骤：三步冲调", "实际操作｜操作步骤：三步冲调"},
		{"信任背书：家长关心的细节", "选购决策｜信任背书：家长关心的细节"},
		{"购买疑问解答：如何清洗", "选购决策｜购买疑问解答：如何清洗"},
		{"性能/体验利益：刻度清晰", "已证实性能｜性能/体验利益：刻度清晰"},
	} {
		for _, fallback := range []bool{false, true} {
			if got := repairEcommercePerformanceAngle(tc.angle, fallback); got != tc.want {
				t.Errorf("repair(%q, %v) = %q, want %q", tc.angle, fallback, got, tc.want)
			}
		}
	}
	// Without a recognisable label a detail draft keeps rejecting the angle,
	// while a detail page inside a set is filed under 可见设计.
	loose := "围绕可见结构说明实际使用动作，不推断性能结果"
	if got := repairEcommercePerformanceAngle(loose, false); got != loose {
		t.Fatalf("strict repair invented a category: %q", got)
	}
	if got := repairEcommercePerformanceAngle(loose, true); got != "可见设计｜"+loose {
		t.Fatalf("fallback repair = %q", got)
	}
	if got := repairEcommercePerformanceAngle("", true); got != ecommerceDefaultPerformanceAngle || repairEcommercePerformanceAngle("", false) != "" {
		t.Fatalf("empty angle repair = %q", got)
	}
}

func ecommerceWorkbenchTestPage(id, kind, angle, component, copy string) model.EcommercePlanTask {
	return model.EcommercePlanTask{ID: id, ImageType: kind, Platform: "taobao", Language: "zh-CN", Goal: "购买目标" + id, Theme: "外观", Composition: "平视构图" + id, MainVisual: "商品全貌", Fidelity: "保留真实外观", PerformanceAngle: angle, InformationComponent: component, Prompt: "faithful product", Copy: copy, ImageModel: "image-model", Ratio: "1:1", Resolution: "2K"}
}

func validateEcommerceWorkbenchTestPlan(t *testing.T, svc *Service, draft EcommerceDraft, images ...model.EcommercePlanTask) (model.EcommercePlan, error) {
	t.Helper()
	plan := model.EcommercePlan{ProductSummary: "商品外观", VisualStrategy: "一致的光线与排版", ConfirmedFacts: []string{}, UncertainFacts: []string{}, QualityChecks: []string{}, Images: images}
	raw, _ := json.Marshal(plan)
	result := map[string]any{"text": string(raw)}
	input := canvasGenerationInput{Metadata: map[string]any{"ecommerceAgentAdapter": "workbench-v1", "stage": "planning", "ecommerceDraft": draft}}
	err := svc.validateEcommerceWorkbenchResult("owner", input, result)
	var got model.EcommercePlan
	_ = json.Unmarshal([]byte(stringValue(result["text"])), &got)
	return got, err
}

func TestEcommerceWorkbenchRepairsDetailAnglesInsideSetPlans(t *testing.T) {
	svc, _ := mockEcommerceAgentService(t)
	page := ecommerceWorkbenchTestPage
	set := EcommerceDraft{ImageType: "set", Count: 4, Platform: "taobao", Language: "zh-CN", ImageModel: "chosen-model", Ratio: "1:1", Resolution: "2K"}
	got, err := validateEcommerceWorkbenchTestPlan(t, svc, set,
		page("image-1", "main", "", "", "看见设计"),
		page("image-2", "detail", "围绕可见结构说明实际使用动作", "左侧标题", "看见设计"),
		page("image-3", "detail", "使用情境：通勤路上", "", "看见设计"),
		page("image-4", "detail", "", "", "看见设计"),
	)
	if err != nil {
		t.Fatalf("a set plan with loosely labelled detail pages was rejected: %v", err)
	}
	want := []string{"", "可见设计｜围绕可见结构说明实际使用动作", "场景体验｜使用情境：通勤路上", ecommerceDefaultPerformanceAngle}
	for i, image := range got.Images {
		if image.PerformanceAngle != want[i] {
			t.Fatalf("set page %d angle = %q, want %q", i+1, image.PerformanceAngle, want[i])
		}
	}

	component := "标题导语｜左上标题与短说明，采用两级字号和24px安全边距"
	detail := set
	detail.ImageType, detail.Count = "detail", 2
	got, err = validateEcommerceWorkbenchTestPlan(t, svc, detail,
		page("image-1", "detail", "选购决策角度：说明为什么适合新手", component, "看见设计"),
		page("image-2", "detail", "已证实性能/可见设计角度：刻度清楚", component, "看见设计"),
	)
	if err != nil || got.Images[0].PerformanceAngle != "选购决策｜说明为什么适合新手" || !strings.HasPrefix(got.Images[1].PerformanceAngle, "已证实性能｜") {
		t.Fatalf("near-miss detail labels were not repaired: %v %+v", err, got.Images)
	}
	if _, err := validateEcommerceWorkbenchTestPlan(t, svc, detail, page("image-1", "detail", "围绕可见结构说明实际使用动作", component, "看见设计"), page("image-2", "detail", "可见设计｜看见结构", component, "看见设计")); err == nil || !strings.Contains(err.Error(), "缺少策划分类") {
		t.Fatalf("a detail draft accepted an angle without a category: %v", err)
	}
	if _, err := validateEcommerceWorkbenchTestPlan(t, svc, detail, page("image-1", "detail", "可见设计｜看见结构", "左侧标题", "看见设计"), page("image-2", "detail", "可见设计｜看见结构", component, "看见设计")); err == nil || !strings.Contains(err.Error(), "信息组件") {
		t.Fatalf("a detail draft accepted a page without an information component: %v", err)
	}
}

func TestEcommerceWorkbenchListingMainImagesNeedNoCopy(t *testing.T) {
	svc, _ := mockEcommerceAgentService(t)
	page := func(id, kind, copy string) model.EcommercePlanTask {
		image := ecommerceWorkbenchTestPage(id, kind, "", "", copy)
		image.Platform, image.Language = "amazon", "en"
		return image
	}
	pair := EcommerceDraft{ImageType: "set", Count: 2, Platform: "amazon", Language: "en", ImageModel: "chosen-model", Ratio: "1:1", Resolution: "2K", TypeOptions: map[string]string{"distribution": "主图 1 张、副图 1 张"}}
	got, err := validateEcommerceWorkbenchTestPlan(t, svc, pair, page("image-1", "main", ""), page("image-2", "secondary", "Made for slow mornings"))
	if err != nil || got.Images[0].Copy != "" || got.Images[1].Copy != "Made for slow mornings" {
		t.Fatalf("Amazon 主副图 with an empty listing main copy = %v %+v", err, got.Images)
	}
	if got, err := validateEcommerceWorkbenchTestPlan(t, svc, pair, page("image-1", "main", "Everyday Mug"), page("image-2", "secondary", "Made for slow mornings")); err != nil || got.Images[0].Copy != "" {
		t.Fatalf("listing main copy was not cleared like the web does: %v %+v", err, got.Images)
	}
	if _, err := validateEcommerceWorkbenchTestPlan(t, svc, pair, page("image-1", "main", ""), page("image-2", "secondary", "")); err == nil || !strings.Contains(err.Error(), "缺少可直接上图的文案") {
		t.Fatalf("a secondary image without copy was accepted: %v", err)
	}
	for _, draft := range []EcommerceDraft{
		{ImageType: "main", Count: 1, Platform: "ebay"},
		{ImageType: "single", Count: 1, Platform: "walmart", TypeOptions: map[string]string{"purpose": "商品主图"}},
	} {
		draft.Language, draft.ImageModel, draft.Ratio, draft.Resolution = "en", "chosen-model", "1:1", "2K"
		if _, err := validateEcommerceWorkbenchTestPlan(t, svc, draft, page("image-1", draft.ImageType, "")); err != nil {
			t.Fatalf("%s/%s listing main image without copy rejected: %v", draft.Platform, draft.ImageType, err)
		}
	}
	shelf := pair
	shelf.Platform = "taobao"
	if _, err := validateEcommerceWorkbenchTestPlan(t, svc, shelf, page("image-1", "main", ""), page("image-2", "secondary", "日常好物")); err == nil || !strings.Contains(err.Error(), "缺少可直接上图的文案") {
		t.Fatalf("a Taobao main image without copy was accepted: %v", err)
	}
}

func TestEcommerceDetailDirectionsPromptStaysShortAndPlatformRouted(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	t.Setenv("AI_MODE", "mock")
	project, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	for _, platform := range []string{"taobao", "xiaohongshu", "douyin", "amazon", "pdd", "1688", "dewu"} {
		draft := EcommerceDraft{ProductName: "宽口径防胀气婴儿奶瓶", Category: "母婴", Description: strings.Repeat("透明瓶身带清晰刻度，宽口径方便冲调与清洗，硅胶奶嘴柔软。", 4), Claims: "防胀气设计；宽口径；带刻度", Materials: "PPSU", Colors: "奶白色", Specifications: "240ml", Instruction: strings.Repeat("做一套温暖可信的详情页，突出夜间喂养与外出携带。", 4), Platform: platform, Language: "zh-CN", ImageType: "detail", Count: 9, Ratio: "3:4"}
		raw, _ := json.Marshal(draft)
		if err := db.Model(project).Update("draft_json", string(raw)).Error; err != nil {
			t.Fatal(err)
		}
		input := map[string]any{"mode": "text", "metadata": map[string]any{"source": "ecommerce-agent", "stage": "creative-directions", "ecommerceProjectId": project.ID}}
		prompt, err := svc.prepareEcommerceWorkbenchTask("user", input, "分析真实商品")
		if err != nil {
			t.Fatal(err)
		}
		if n := len([]rune(prompt)); n > 4000 || !strings.Contains(prompt, "推荐四套反差强烈的整套详情页视觉方向") || !strings.Contains(prompt, "label 以该路线名开头") || !strings.Contains(prompt, "母婴、食品、宠物不用电音赛博或赛博霓虹") {
			t.Fatalf("%s detail directions prompt has %d runes or lacks the route rule:\n%s", platform, n, prompt)
		}
		for _, route := range ecommerceagent.PlatformGuideFor(platform).Routes {
			if !strings.Contains(prompt, route) {
				t.Fatalf("%s directions prompt lacks the platform route %s", platform, route)
			}
		}
	}
}
