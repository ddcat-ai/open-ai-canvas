package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/ecommercecatalog"
	"yingce/backend/internal/model"
)

type acceptanceProduct struct {
	Name     string
	Request  EcommerceCreativeDirectionsRequest
	Category string
	KB01     string
}

func acceptanceProducts(projectID string) []acceptanceProduct {
	base := func(r EcommerceCreativeDirectionsRequest) EcommerceCreativeDirectionsRequest {
		r.ProjectID, r.Platform, r.Language, r.Region, r.ImageType, r.Count = projectID, "taobao", "zh-CN", "CN", "detail", 6
		return r
	}
	return []acceptanceProduct{
		{"奶瓶", base(EcommerceCreativeDirectionsRequest{ProductName: "婴儿奶瓶", Category: "母婴", Description: "宽口径，透明瓶身，带刻度", Materials: "PPSU"}), "maternal", "kb01-baby-bottle-knowledge"},
		{"耳机", base(EcommerceCreativeDirectionsRequest{ProductName: "蓝牙降噪耳机", Category: "数码", Description: "头戴式，可折叠", Colors: "曜石黑"}), "tech", "kb01-headphone-knowledge"},
		{"女装", base(EcommerceCreativeDirectionsRequest{ProductName: "女士连衣裙", Category: "女装", Description: "A字版型，碎花图案", Materials: "棉"}), "apparel", "kb01-apparel-fashion-knowledge"},
		{"智能家电", base(EcommerceCreativeDirectionsRequest{ProductName: "智能扫地机器人", Category: "智能家电", Description: "圆形机身，顶部按键"}), "appliance", "kb01-smart-appliance-knowledge"},
		{"沙发", base(EcommerceCreativeDirectionsRequest{ProductName: "北欧风沙发", Category: "家居", Description: "三人位，木质扶手", Materials: "实木框架、科技布"}), "home", "kb01-home-furniture-knowledge"},
	}
}

type acceptanceDirection struct {
	Name           string              `json:"name"`
	Mode           string              `json:"mode"`
	Summary        string              `json:"summary"`
	KnowledgeBasis []map[string]string `json:"knowledgeBasis"`
	VisualLock     string              `json:"visualLock"`
	CopyTone       string              `json:"copyTone"`
}

type acceptanceRecord struct {
	Product    string                       `json:"product"`
	Category   string                       `json:"category"`
	Evidence   []EcommerceKnowledgeEvidence `json:"evidence"`
	Knowledge  []map[string]string          `json:"knowledgeContent"`
	Analysis   any                          `json:"productAnalysis"`
	Directions []acceptanceDirection        `json:"directions"`
}

func acceptanceRecordFrom(name string, response *EcommerceCreativeDirectionsResponse) acceptanceRecord {
	record := acceptanceRecord{Product: name, Category: response.ProductCategory, Evidence: response.Evidence}
	for i, direction := range response.Directions {
		strategy := direction.strategy
		basis, _ := strategy["knowledgeBasis"].([]map[string]string)
		skills, _ := strategy["skills"].(map[string]any)
		item := acceptanceDirection{Name: direction.Name, Mode: stringValue(strategy["mode"]), Summary: direction.Summary, KnowledgeBasis: basis, VisualLock: stringValue(strategy["visualLock"])}
		if skills != nil {
			if copy, ok := skills["copywriting"].(interface{ ToJSON() string }); ok {
				var parsed struct{ Tone string }
				_ = json.Unmarshal([]byte(copy.ToJSON()), &parsed)
				item.CopyTone = parsed.Tone
			}
			if i == 0 {
				record.Analysis = skills["productAnalysis"]
			}
		}
		if i == 0 {
			record.Knowledge, _ = strategy["knowledgeContext"].([]map[string]string)
		}
		record.Directions = append(record.Directions, item)
	}
	return record
}

func writeAcceptanceReport(t *testing.T, name string, value any) {
	t.Helper()
	dir := os.Getenv("ECOMMERCE_ACCEPTANCE_DIR")
	if dir == "" {
		return
	}
	raw, _ := json.MarshalIndent(value, "", "  ")
	if err := os.WriteFile(dir+"/"+name, raw, 0o644); err != nil {
		t.Fatal(err)
	}
}

func evidenceIDs(evidence []EcommerceKnowledgeEvidence) map[string]string {
	ids := map[string]string{}
	for _, item := range evidence {
		ids[item.ID] = item.KnowledgeDomain
	}
	return ids
}

func TestEcommerceKnowledgeDrivesDirectionsForFiveProducts(t *testing.T) {
	t.Setenv("AI_MODE", "disabled")
	svc, db := knowledgeTestService(t)
	// 电商创作默认关闭；验收在管理员已开放的前提下运行。
	if err := db.Create(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"ecommerceEnabled":true}`}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.EnsureBuiltinEcommerceKnowledge(); err != nil {
		t.Fatal(err)
	}
	project, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	records := []acceptanceRecord{}
	for _, product := range acceptanceProducts(project.ID) {
		response, err := svc.RecommendEcommerceCreativeDirections("user", product.Request)
		if err != nil {
			t.Fatalf("%s: %v", product.Name, err)
		}
		record := acceptanceRecordFrom(product.Name, response)
		records = append(records, record)
		ids := evidenceIDs(response.Evidence)
		if response.ProductCategory != product.Category || ids[product.KB01] != "KB01" || ids["kb08-taobao-tmall-rules"] != "KB08" {
			t.Fatalf("%s: category=%s evidence=%v", product.Name, response.ProductCategory, ids)
		}
		hierarchy := map[string]bool{}
		for _, node := range ecommercecatalog.Lineage(ecommercecatalog.ResolveProduct(product.Request.Category, product.Request.ProductName).Node.ID) {
			hierarchy["industry-taxonomy-"+node.ID] = true
			hierarchy["kb19-industry-"+node.ID] = true
		}
		for _, item := range response.Evidence {
			// A correct appliance path includes its broader home/garden parent.
			// Check hierarchy identity rather than treating ancestor names as leaks.
			if item.KnowledgeType == "industry_method" || item.KnowledgeType == "category_taxonomy" {
				if !hierarchy[item.ID] {
					t.Fatalf("%s: unrelated industry hierarchy %s", product.Name, item.ID)
				}
				continue
			}
			// Shared editorial titles can mention both home and appliances. The
			// stored scope, not words in a display title, defines applicability.
			if strings.HasPrefix(item.ID, "kb") {
				stored, err := svc.repo.EcommerceKnowledgeEntryByID(item.ID)
				if err != nil {
					t.Fatal(err)
				}
				if stored.Category != "general" && stored.Category != product.Category {
					t.Fatalf("%s: retrieved knowledge from %s: %s", product.Name, stored.Category, item.ID)
				}
			}
		}
		domains := map[string]bool{}
		for _, domain := range ids {
			domains[domain] = true
		}
		if len(domains) < 8 {
			t.Fatalf("%s: only %d KB domains reached the planner: %v", product.Name, len(domains), ids)
		}
		names, primaries := map[string]bool{}, map[string]bool{}
		for _, direction := range record.Directions {
			if names[direction.Name] || len(direction.KnowledgeBasis) == 0 || !strings.Contains(direction.VisualLock, direction.Name) || !strings.Contains(direction.Summary, "知识方法：") {
				t.Fatalf("%s: incomplete or duplicate direction %+v", product.Name, direction)
			}
			usesProductKB01 := false
			for _, basis := range direction.KnowledgeBasis {
				if ids[basis["id"]] == "" {
					t.Fatalf("%s: basis %s is not retrieved evidence", product.Name, basis["id"])
				}
				usesProductKB01 = usesProductKB01 || basis["id"] == product.KB01
			}
			if !usesProductKB01 {
				t.Fatalf("%s: direction %s does not use product knowledge %s: %v", product.Name, direction.Name, product.KB01, direction.KnowledgeBasis)
			}
			names[direction.Name], primaries[direction.KnowledgeBasis[0]["id"]] = true, true
		}
		if len(names) != 4 || len(primaries) < 3 {
			t.Fatalf("%s: directions share knowledge: %+v", product.Name, record.Directions)
		}
		t.Logf("%s category=%s evidence=%d", product.Name, response.ProductCategory, len(response.Evidence))
		for _, direction := range record.Directions {
			t.Logf("  [%s] %s basis=%v", direction.Mode, direction.Name, direction.KnowledgeBasis)
		}
	}
	writeAcceptanceReport(t, "five-products.json", records)

	// Knowledge changes must change the plan, not only the evidence list.
	admin, _ := svc.repo.User("admin")
	bottle := acceptanceProducts(project.ID)[0]
	before, err := svc.RecommendEcommerceCreativeDirections("user", bottle.Request)
	if err != nil {
		t.Fatal(err)
	}
	beforeRecord := acceptanceRecordFrom("奶瓶-变更前", before)
	primary := beforeRecord.Directions[0].KnowledgeBasis[0]["id"]
	if err := svc.ReviewEcommerceKnowledgeEntry(admin, primary, "rejected"); err != nil {
		t.Fatal(err)
	}
	afterReject, err := svc.RecommendEcommerceCreativeDirections("user", bottle.Request)
	if err != nil {
		t.Fatal(err)
	}
	rejectRecord := acceptanceRecordFrom("奶瓶-驳回主知识后", afterReject)
	if _, still := evidenceIDs(afterReject.Evidence)[primary]; still {
		t.Fatalf("rejected entry %s still retrieved", primary)
	}
	for _, direction := range rejectRecord.Directions {
		for _, basis := range direction.KnowledgeBasis {
			if basis["id"] == primary {
				t.Fatalf("rejected entry %s still used by %s", primary, direction.Name)
			}
		}
	}
	if rejectRecord.Directions[0].VisualLock == beforeRecord.Directions[0].VisualLock && rejectRecord.Directions[0].Summary == beforeRecord.Directions[0].Summary {
		t.Fatalf("rejecting %s did not change direction 1", primary)
	}
	t.Logf("reject %s: summary %q -> %q", primary, beforeRecord.Directions[0].Summary, rejectRecord.Directions[0].Summary)

	// Replace KB01 product knowledge: the analysis skill output and every
	// direction's visual lock must follow the new emphasis.
	replaced := `{"guidance":"视觉策划重点：瓶身握持弧线、奶嘴与旋盖的接合处。常见使用场景：外出携带。注意事项：不写容量与认证。","domain":"KB01"}`
	if err := db.Model(&model.EcommerceKnowledgeEntry{}).Where("id = ?", bottle.KB01).Update("content_json", replaced).Error; err != nil {
		t.Fatal(err)
	}
	afterReplace, err := svc.RecommendEcommerceCreativeDirections("user", bottle.Request)
	if err != nil {
		t.Fatal(err)
	}
	replaceRecord := acceptanceRecordFrom("奶瓶-替换KB01后", afterReplace)
	for _, direction := range replaceRecord.Directions {
		if !strings.Contains(direction.VisualLock, "瓶身握持弧线") || strings.Contains(direction.VisualLock, "刻度清晰可见") {
			t.Fatalf("replaced KB01 knowledge not reflected: %s", direction.VisualLock)
		}
	}

	// Disabling a whole domain source removes it from retrieval and planning.
	if err := svc.SetEcommerceKnowledgeSourceEnabled(admin, "meiye-kb06", false); err != nil {
		t.Fatal(err)
	}
	afterDisable, err := svc.RecommendEcommerceCreativeDirections("user", bottle.Request)
	if err != nil {
		t.Fatal(err)
	}
	disableRecord := acceptanceRecordFrom("奶瓶-停用KB06后", afterDisable)
	// Only rows of the disabled source disappear. Request-dependent built-in
	// methods (source meiye-original) are not database rows and stay active.
	for id := range evidenceIDs(afterDisable.Evidence) {
		if strings.HasPrefix(id, "kb06-") {
			t.Fatalf("entry %s of disabled source meiye-kb06 still retrieved", id)
		}
	}
	writeAcceptanceReport(t, "knowledge-change.json", []acceptanceRecord{beforeRecord, rejectRecord, replaceRecord, disableRecord})
}

// collectStrings flattens every string inside a decoded JSON request body.
func collectStrings(value any, out *strings.Builder) {
	switch v := value.(type) {
	case string:
		out.WriteString(v)
		out.WriteString("\n")
	case []any:
		for _, item := range v {
			collectStrings(item, out)
		}
	case map[string]any:
		for _, item := range v {
			collectStrings(item, out)
		}
	}
}

func TestEcommerceSelectedDirectionFlowsToPlanningAndImageTask(t *testing.T) {
	t.Setenv("AI_MODE", "live")
	t.Setenv("TEXT_API_KEY", "")
	t.Setenv("REDIS_URL", "")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	base, db := knowledgeTestService(t)
	svc := New(base.repo, base.dataDir)
	t.Cleanup(func() { _ = svc.Close() })
	if _, err := svc.EnsureBuiltinEcommerceKnowledge(); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	prompts := map[string]string{}
	textUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		var text strings.Builder
		collectStrings(body, &text)
		prompt := text.String()
		var answer any
		stage := "creative-directions"
		if strings.Contains(prompt, "你正在执行电商 Agent 工作台策划") {
			stage = "planning"
			images := []map[string]any{}
			for i := 1; i <= 3; i++ {
				images = append(images, map[string]any{"id": fmt.Sprintf("main-%d", i), "imageType": "main", "goal": "首屏识别", "theme": "奶瓶主图", "composition": "居中", "mainVisual": "完整奶瓶", "verifiedClaims": "材质：PPSU", "copy": []string{"夜里也从容", "看得见的刻度", "随身带出门"}[i-1], "lighting": "柔光", "fidelity": "保持瓶身与刻度", "prompt": fmt.Sprintf("婴儿奶瓶第%d张主图，柔和窗光，奶油白背景", i), "negativePrompt": "变形"})
			}
			answer = map[string]any{"productSummary": "PPSU 婴儿奶瓶", "confirmedFacts": []string{"材质：PPSU"}, "uncertainFacts": []string{"容量未提供"}, "visualStrategy": "延续选定方向", "qualityChecks": []string{"瓶身刻度保真"}, "images": images}
		} else {
			p, _ := ecommerceagent.PlatformFor("淘宝")
			answer = ecommerceagent.Analysis{Brief: ecommerceagent.Brief{Category: "母婴奶瓶"}, Recommendations: ecommerceagent.MockStyleRecommendations(ecommerceagent.Brief{Category: "奶瓶"}, p, "main", 3, "1:1")}
		}
		mu.Lock()
		prompts[stage] = prompt
		mu.Unlock()
		encoded, _ := json.Marshal(answer)
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": string(encoded)}}}})
	}))
	defer textUpstream.Close()
	var imageRequest map[string]any
	imageUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		_ = json.NewDecoder(r.Body).Decode(&imageRequest)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/N3sAAAAASUVORK5CYII="}]}`))
	}))
	defer imageUpstream.Close()
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": textUpstream.URL + "/v1", "api_key": "fixture-key", "api_format": "openai"}).Error; err != nil {
		t.Fatal(err)
	}
	imageProfile := mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-2"))
	for _, item := range []any{
		&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"ecommerceEnabled":true,"imageWorkbenchEnabled":true}`},
		&model.ModelChannel{ID: "image-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "图片测试", APIFormat: "openai", BaseURL: imageUpstream.URL + "/v1", APIKey: "fixture-key"},
		&model.ChannelModel{ID: "image-model", ChannelID: "image-channel", ModelKey: "gpt-image-2", ProviderModelKey: "gpt-image-2", Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, CapabilityConfigJSON: imageProfile, BillingMode: "fixed_request", UnitPriceMicrocredits: 200, PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "image-tier", ChannelModelID: "image-model", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 200, PriceConfigured: true, Enabled: true},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	project, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	draft := EcommerceDraft{ProductName: "婴儿奶瓶", Category: "母婴", Description: "宽口径，透明瓶身，带刻度", Materials: "PPSU", Platform: "taobao", Language: "zh-CN", Count: 3, ImageType: "main", Ratio: "1:1", ImageModel: "gpt-image-2", Resolution: "1k"}
	saveDraft := func() {
		encoded, _ := json.Marshal(draft)
		if err := db.Model(project).Update("draft_json", string(encoded)).Error; err != nil {
			t.Fatal(err)
		}
	}
	saveDraft()
	runText := func(stage, prompt string) map[string]any {
		t.Helper()
		req := creationTextRequest()
		req.Prompt, req.Input["prompt"] = prompt, prompt
		req.Input["metadata"] = map[string]any{"source": "ecommerce-agent", "stage": stage, "ecommerceProjectId": project.ID}
		req.Input["textOptions"] = map[string]any{"stream": false}
		task, err := svc.CreateEcommercePlanningTask("user", project.ID, req)
		if err != nil {
			t.Fatalf("%s admission: %v", stage, err)
		}
		if err := svc.ProcessNextTask(); err != nil {
			t.Fatalf("%s worker: %v", stage, err)
		}
		stored, err := svc.repo.Task(task.ID)
		if err != nil || stored.Status != model.TaskStatusSucceeded {
			t.Fatalf("%s task = %+v err=%v", stage, stored, err)
		}
		var result map[string]any
		_ = json.Unmarshal([]byte(stored.ResultJSON), &result)
		var input map[string]any
		_ = json.Unmarshal([]byte(stored.InputJSON), &input)
		return map[string]any{"result": result, "input": input, "task": stored}
	}

	// Stage 1: directions. The model receives the short fast-directions prompt;
	// retrieved knowledge is kept out of it and attached to the stored strategy.
	directionsRun := runText("creative-directions", "分析真实商品，并推荐四套完整视觉风格。")
	var response EcommerceCreativeDirectionsResponse
	if err := json.Unmarshal([]byte(stringValue(directionsRun["result"].(map[string]any)["text"])), &response); err != nil || len(response.Directions) != 4 {
		t.Fatalf("directions = %+v err=%v", response, err)
	}
	// The draft is a main-image set: the fast prompt names that content type
	// (detail keeps its own wording) and carries the platform brief.
	if p := prompts["creative-directions"]; !strings.Contains(p, "推荐四套反差强烈的商品主图视觉方向") || strings.Contains(p, "整套详情页") || !strings.Contains(p, "【平台与类型适配】淘宝") || strings.Contains(p, "【已审核知识检索结果") || len([]rune(p)) > 4000 {
		t.Fatalf("directions prompt is not the short fast prompt (%d runes)", len([]rune(p)))
	}
	if trace, _ := directionsRun["input"].(map[string]any)["metadata"].(map[string]any)["ecommerceSkillTrace"].([]any); len(trace) == 0 {
		t.Fatalf("directions task lost the product-analysis skill trace")
	}
	item, err := svc.repo.EcommerceRecommendation("user", response.RecommendationID)
	if err != nil {
		t.Fatal(err)
	}
	var stored []ecommerceStoredDirection
	_ = json.Unmarshal([]byte(item.DirectionsJSON), &stored)
	locks := map[string]string{}
	for _, direction := range stored {
		locks[direction.ID] = stringValue(direction.Strategy["visualLock"])
		if locks[direction.ID] == "" || direction.Strategy["skillTrace"] == nil || direction.Strategy["knowledgeEntryIds"] == nil {
			t.Fatalf("direction %s lacks skill output: %+v", direction.Name, direction.Strategy)
		}
	}

	// Stage 2: the user picks direction 3; planning receives only its lock.
	chosen := response.Directions[2]
	selection, err := svc.SelectEcommerceCreativeDirection("user", response.RecommendationID, chosen.ID)
	if err != nil {
		t.Fatal(err)
	}
	draft.CreativeRecommendationID, draft.CreativeDirectionID = response.RecommendationID, chosen.ID
	saveDraft()
	instruction, _ := json.Marshal(selection.PlanningContext)
	planningRun := runText("planning", "【已选创意方向】"+chosen.Name+"\n知识约束："+string(instruction))
	planningPrompt := prompts["planning"]
	if !strings.Contains(planningPrompt, locks[chosen.ID]) || !strings.Contains(planningPrompt, "【文案 Skill 输出") {
		t.Fatal("planning prompt lacks the selected direction lock or copy skill output")
	}
	// The client text quotes the full planning context, so check the server's
	// own skill block names only the chosen direction.
	block := planningPrompt[strings.Index(planningPrompt, "【视觉策略 Skill 输出"):]
	for id, lock := range locks {
		if id != chosen.ID && strings.Contains(block, lock) {
			t.Fatalf("planning skill block contains unselected direction %s", id)
		}
	}
	planInput := planningRun["input"].(map[string]any)
	metadata, _ := planInput["metadata"].(map[string]any)
	if stringValue(metadata["ecommerceDirectionLock"]) != locks[chosen.ID] || metadata["ecommerceSkillTrace"] == nil {
		t.Fatalf("planning task metadata = %+v", metadata)
	}
	if metadata["ecommerceManagedSkills"] == nil {
		t.Fatal("managed skill routing receipt missing from planning task")
	}
	// The run's drawn layouts close the planning prompt and travel with the task.
	if variation, _ := metadata["ecommerceDesignVariation"].(map[string]any); variation == nil || strings.LastIndex(planningPrompt, "【本轮版式方案·"+ecommerceagent.DesignPlaybookVersion+"】") < strings.Index(planningPrompt, "【视觉策略 Skill 输出") {
		t.Fatalf("planning prompt or task lacks the design variation: %+v", metadata["ecommerceDesignVariation"])
	}
	var plan model.EcommercePlan
	if err := json.Unmarshal([]byte(stringValue(planningRun["result"].(map[string]any)["text"])), &plan); err != nil || len(plan.Images) != 3 {
		t.Fatalf("plan = %+v err=%v", plan, err)
	}
	for _, image := range plan.Images {
		if !strings.Contains(image.Prompt, locks[chosen.ID]) || !strings.Contains(image.Prompt, ecommerceProductAnchor) {
			t.Fatalf("image %s prompt lost the selected lock: %s", image.ID, image.Prompt)
		}
	}

	// Stage 3: the image task created from plan image 1 carries the lock to
	// the provider, is billed once and survives a service restart.
	var account model.CreditAccount
	db.First(&account, "user_id = ?", "user")
	creditsBefore := account.AvailableMicrocredits
	if !strings.Contains(plan.Images[0].Prompt, "本轮已选Skills图片执行约束") {
		t.Fatal("managed skill execution rules did not reach image prompt")
	}
	imageTask, err := svc.CreateWorkbenchTask("user", WorkbenchTaskInput{Kind: WorkbenchKindImage, Prompt: plan.Images[0].Prompt, Model: "gpt-image-2", ChannelID: "image-channel", Parameters: map[string]any{"size": "1024x1024", "count": 1}}, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ProcessNextTask(); err != nil {
		t.Fatalf("%v (cause: %v)", err, errors.Unwrap(err))
	}
	restarted := New(svc.repo, svc.dataDir)
	t.Cleanup(func() { _ = restarted.Close() })
	finished, err := restarted.Task("user", imageTask.ID)
	if err != nil {
		t.Fatal(err)
	}
	storedImage, _ := svc.repo.Task(imageTask.ID)
	var consume []model.CreditLedgerEntry
	db.Where("billing_order_id = ? AND type = ?", storedImage.BillingOrderID, model.CreditLedgerConsume).Find(&consume)
	db.First(&account, "user_id = ?", "user")
	if storedImage.Status != model.TaskStatusSucceeded || len(consume) != 1 || account.AvailableMicrocredits >= creditsBefore {
		t.Fatalf("image task status=%s consume=%d credits %d -> %d", storedImage.Status, len(consume), creditsBefore, account.AvailableMicrocredits)
	}
	providerPrompt := stringValue(imageRequest["prompt"])
	if !strings.Contains(providerPrompt, locks[chosen.ID]) {
		t.Fatalf("provider prompt lost the selected direction: %s", providerPrompt)
	}
	writeAcceptanceReport(t, "selected-direction-chain.json", map[string]any{
		"directions":       response.Directions,
		"selectedId":       chosen.ID,
		"selectedName":     chosen.Name,
		"selectedLock":     locks[chosen.ID],
		"planningSkills":   metadata["ecommerceSkillTrace"],
		"planImagePrompts": plan.Images,
		"imageTask":        map[string]any{"id": storedImage.ID, "status": storedImage.Status, "model": storedImage.Model, "billingOrderId": storedImage.BillingOrderID, "creditsBefore": creditsBefore, "creditsAfter": account.AvailableMicrocredits, "afterRestart": finished},
		"providerRequest":  imageRequest,
	})
}
