package app

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestCreationCompetitorThenProductReachesOrderedImageUpstream(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("REDIS_URL", "")
	s, db, scenePixels := cloudAgentVisionFixture(t)
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{B: 255, A: 255})
	var product bytes.Buffer
	_ = png.Encode(&product, img)
	if err := os.WriteFile(filepath.Join(s.dataDir, "resources", "ref-two.png"), product.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", "ref-two").Update("size", product.Len()).Error; err != nil {
		t.Fatal(err)
	}
	s = New(s.repo, s.dataDir)
	t.Cleanup(func() { _ = s.Close() })
	plan := commerceFixturePlan()
	plan.Site, plan.Language, plan.Intent = "JP", "ja-JP", "参考竞品场景，使用新商品生成日本站场景图"
	plan.ProductFacts[0].Claim, plan.ProductFacts[0].SourceIDs = "Blue product", []string{"ref-two"}
	plan.Items[0].Prompt = "Keep the scene and composition from @图片1; replace its product with the exact product from @图片2"
	plan.Items[0].TargetCopy, plan.Items[0].ChineseReviewCopy = "Before\nAfter\n2枚使い", "Before\nAfter\n双幅搭配"
	plan.Items[0].AttachmentResourceIDs = []string{"ref-one", "ref-two"}
	plan.References = []cloudAgentCreationReference{{ResourceID: "ref-one", Role: "competitor", Usage: "preserve scene and composition only"}, {ResourceID: "ref-two", Role: "product", Usage: "use this exact replacement product"}}
	var mu sync.Mutex
	var textBodies []map[string]any
	var imageBody map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/images/edits" {
			mu.Lock()
			imageBody = body
			mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"b64_json": base64.StdEncoding.EncodeToString(product.Bytes())}}})
			return
		}
		mu.Lock()
		textBodies = append(textBodies, body)
		step := len(textBodies)
		mu.Unlock()
		pending := map[string]bool{}
		for _, message := range creationMaps(body["messages"]) {
			for _, call := range creationMaps(message["tool_calls"]) {
				pending[stringField(call, "id")] = true
			}
			if message["role"] == "tool" {
				delete(pending, stringField(message, "tool_call_id"))
			}
		}
		if len(pending) > 0 {
			t.Errorf("unpaired tool calls reached upstream: %v", pending)
			w.WriteHeader(400)
			return
		}
		message := map[string]any{"content": "已收到竞品构图，等待用户发送产品图。"}
		if step == 2 || step == 3 {
			candidate := plan
			candidate.Items = append([]cloudAgentCommerceItem(nil), plan.Items...)
			if step == 2 {
				candidate.Items[0].ChineseReviewCopy = ""
			}
			raw, _ := json.Marshal(candidate)
			message = map[string]any{"content": "按图片顺序规划商品替换。", "tool_calls": []any{map[string]any{"id": "plan-" + string(rune('0'+step)), "type": "function", "function": map[string]any{"name": "commerce_plan_submit", "arguments": string(raw)}}}}
		} else if step > 3 {
			message["content"] = "图片任务已成功，竞品场景与新产品按计划配对。"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": message}}})
	}))
	t.Cleanup(upstream.Close)
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "image-test")
	for _, item := range []any{
		&model.ModelChannel{ID: "image-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "图片测试", BaseURL: upstream.URL + "/v1", APIKey: "test-only"},
		&model.ChannelModel{ID: "image-cm", ChannelID: "image-channel", ModelKey: "image-test", Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, capability), BillingMode: "fixed_request", PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "image-tier", ChannelModelID: "image-cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	_ = db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": upstream.URL, "api_key": "test-only"}).Error
	stop := make(chan struct{})
	t.Cleanup(func() { close(stop) })
	go func() {
		for {
			select {
			case <-stop:
				return
			default:
			}
			_ = s.ProcessNextTask()
			time.Sleep(20 * time.Millisecond)
		}
	}()
	req := creationAgentRequest()
	req.Prompt, req.PermissionMode = "参考这张竞品图，稍后我会发送产品图", "request_approval"
	req.Attachments = []CloudAgentAttachment{{ResourceID: "ref-one", StorageKey: "resource:ref-one", Kind: "image", Role: "reference", Name: "竞品"}}
	req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "image-channel", ChannelModelKey: "image-test"}, ParameterMode: "auto"}}
	first, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	waitCloudAgentStatus(t, s, first.ID, "completed")
	req.IdempotencyKey, req.Prompt = "later-product", "现在产品图已上传，把先前图1中的产品换成图2，做日本站场景图"
	req.Attachments = []CloudAgentAttachment{{ResourceID: "ref-two", StorageKey: "resource:ref-two", Kind: "image", Role: "reference", Name: "商品"}}
	child, err := s.CreateCloudAgentRun("user", req, first.ID)
	if err != nil {
		t.Fatal(err)
	}
	waiting := waitCloudAgentStatus(t, s, child.ID, "waiting_approval")
	if waiting.Approval == nil || len(waiting.Attachments) != 2 || waiting.Attachments[0].ResourceID != "ref-one" || waiting.Attachments[0].TurnIndex != 0 || waiting.Attachments[1].ResourceID != "ref-two" || waiting.Attachments[1].TurnIndex != 1 {
		t.Fatalf("lost historical/current reference order: %+v", waiting)
	}
	mu.Lock()
	before := imageBody
	textRaw, _ := json.Marshal(textBodies)
	mu.Unlock()
	if before != nil || !strings.Contains(string(textRaw), "fix_arguments") || !strings.Contains(string(textRaw), base64.StdEncoding.EncodeToString(scenePixels)) || !strings.Contains(string(textRaw), base64.StdEncoding.EncodeToString(product.Bytes())) {
		t.Fatal("argument repair lost pixels or submitted media before approval")
	}
	if err := s.DecideCloudAgentApproval("user", child.ID, waiting.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	waitCloudAgentStatus(t, s, child.ID, "completed")
	mu.Lock()
	defer mu.Unlock()
	images := creationMaps(imageBody["images"])
	if len(images) != 2 || !strings.HasSuffix(stringField(images[0], "image_url"), base64.StdEncoding.EncodeToString(scenePixels)) || !strings.HasSuffix(stringField(images[1], "image_url"), base64.StdEncoding.EncodeToString(product.Bytes())) {
		t.Fatalf("actual image-model inputs reversed or missing: %#v", images)
	}
	prompt := stringField(imageBody, "prompt")
	for _, want := range []string{"@图片1: role=competitor", "@图片2: role=product", "preserve scene and composition only", "use this exact replacement product", "site: JP", "Before\nAfter\n2枚使い"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("actual image-model prompt lost %q", want)
		}
	}
	if strings.Contains(prompt, "双幅搭配") || len(textBodies) != 4 {
		t.Fatalf("review text leaked or model steps repeated: text requests=%d", len(textBodies))
	}
}

func TestCreationFailedMediaToolFlushesNativeHistoryBeforeContinuation(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("REDIS_URL", "")
	s, db, _ := cloudAgentVisionFixture(t)
	s = New(s.repo, s.dataDir)
	t.Cleanup(func() { _ = s.Close() })
	var mu sync.Mutex
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		mu.Lock()
		calls++
		step := calls
		mu.Unlock()
		pending := map[string]bool{}
		for _, message := range creationMaps(body["messages"]) {
			for _, call := range creationMaps(message["tool_calls"]) {
				pending[stringField(call, "id")] = true
			}
			if message["role"] == "tool" {
				delete(pending, stringField(message, "tool_call_id"))
			}
		}
		if len(pending) > 0 {
			t.Errorf("failed tool was not paired on continuation: %v", pending)
			w.WriteHeader(400)
			return
		}
		message := map[string]any{"content": "上一轮图片模型未配置有效价格，未创建图片任务。"}
		if step == 1 {
			if err := db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", "image-tier").Update("enabled", false).Error; err != nil {
				t.Error(err)
				w.WriteHeader(500)
				return
			}
			message["tool_calls"] = []any{map[string]any{"id": "failed-media-call", "type": "function", "function": map[string]any{"name": "generate_media", "arguments": `{"mode":"image","prompt":"Create an image"}`}}}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": message}}})
	}))
	t.Cleanup(upstream.Close)
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "image-test")
	for _, item := range []any{
		&model.ModelChannel{ID: "image-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "图片测试", BaseURL: upstream.URL + "/v1", APIKey: "test-only"},
		&model.ChannelModel{ID: "image-cm", ChannelID: "image-channel", ModelKey: "image-test", Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, capability), BillingMode: "fixed_request", PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "image-tier", ChannelModelID: "image-cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	_ = db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": upstream.URL, "api_key": "test-only"}).Error
	stop := make(chan struct{})
	t.Cleanup(func() { close(stop) })
	go func() {
		for {
			select {
			case <-stop:
				return
			default:
			}
			_ = s.ProcessNextTask()
			time.Sleep(20 * time.Millisecond)
		}
	}()
	req := creationAgentRequest()
	req.Prompt, req.PermissionMode = "生成图片", "request_approval"
	req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "image-channel", ChannelModelKey: "image-test"}, ParameterMode: "auto"}}
	first, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	waitCloudAgentStatus(t, s, first.ID, "failed")
	deadline := time.Now().Add(5 * time.Second)
	flushed := false
	for time.Now().Before(deadline) {
		snapshot, err := s.repo.CloudAgentPiSession("user", first.ID)
		if err == nil && strings.Contains(snapshot.SessionJSONL, `"role":"toolResult"`) && strings.Contains(snapshot.SessionJSONL, "failed-media-call") {
			flushed = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !flushed {
		t.Fatal("failed run did not persist the native tool result")
	}
	mu.Lock()
	before := calls
	mu.Unlock()
	if before != 1 {
		t.Fatalf("terminal failure made another model call: %d", before)
	}
	req.IdempotencyKey, req.Prompt = "explain-failure", "解释刚才的错误"
	req.MediaSettings = nil
	second, err := s.CreateCloudAgentRun("user", req, first.ID)
	if err != nil {
		t.Fatal(err)
	}
	waitCloudAgentStatus(t, s, second.ID, "completed")
	mu.Lock()
	defer mu.Unlock()
	if calls != 2 {
		t.Fatalf("continuation duplicated the failed generation or model call: %d", calls)
	}
}
