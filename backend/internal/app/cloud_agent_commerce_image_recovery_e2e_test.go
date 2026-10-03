package app

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestCreationImageAgentSwitchesChannelsReplansOnlyFailureAndFinishesWholeSet(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("REDIS_URL", "")
	s, db, pixels := cloudAgentVisionFixture(t)
	s = New(s.repo, s.dataDir)
	t.Cleanup(func() { _ = s.Close() })
	plan := commerceFixturePlan()
	plan.StyleBible = "Soft blue studio with gentle daylight; preserve the actual product"
	plan.ProductFacts[0].SourceIDs = []string{"ref-one"}
	plan.Items[0].AttachmentResourceIDs = []string{"ref-one"}
	plan.Items[0].Specs = map[string]any{"size": "1024x1024"}
	for _, id := range []string{"scene", "steps"} {
		item := plan.Items[0]
		item.ID, item.Title, item.Prompt = id, id, "Original "+id+" direction"
		plan.Items = append(plan.Items, item)
	}
	var mu sync.Mutex
	var imageRequests []string
	modelSteps := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "/images/") {
			prompt := stringField(body, "prompt")
			mu.Lock()
			imageRequests = append(imageRequests, r.URL.Path+"\n"+prompt)
			mu.Unlock()
			if strings.Contains(prompt, "Original scene direction") {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":{"message":"prompt may violate our content policies"}}`))
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"b64_json": base64.StdEncoding.EncodeToString(pixels)}}})
			return
		}
		mu.Lock()
		modelSteps++
		step := modelSteps
		mu.Unlock()
		var lastTool map[string]any
		for _, message := range creationMaps(body["messages"]) {
			if message["role"] == "tool" {
				lastTool = nil
				if err := json.Unmarshal([]byte(stringField(message, "content")), &lastTool); err != nil {
					t.Errorf("decode tool result: %v", err)
				}
			}
		}
		t.Logf("Agent step %d: complete=%v failedItems=%v error=%v", step, lastTool["complete"], lastTool["failedItems"], lastTool["error"])
		if step > 8 {
			t.Error("Agent did not finish the image recovery flow")
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		message := map[string]any{"content": "三张图片已全部生成。"}
		name := ""
		var args any
		if step == 1 {
			name, args = "commerce_plan_submit", plan
		} else if failures := creationMaps(lastTool["failedItems"]); len(failures) > 0 && failures[0]["action"] == "rewrite_prompt" {
			name = "generate_media"
			args = map[string]any{"mode": "image", "commercePlanId": plan.PlanID, "commerceItemId": failures[0]["commerceItemId"], "retryFailedTaskId": failures[0]["retryFailedTaskId"], "retryPrompt": "Neutral cosmetic still life beside a soft blue folded towel with gentle daylight"}
		} else if lastTool["complete"] != true {
			name, args = "commerce_plan_wait", map[string]any{"commercePlanId": plan.PlanID}
		}
		if name != "" {
			raw, _ := json.Marshal(args)
			message = map[string]any{"content": "", "tool_calls": []any{map[string]any{"id": name + "-" + strconv.Itoa(step), "type": "function", "function": map[string]any{"name": name, "arguments": string(raw)}}}}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": message}}})
	}))
	t.Cleanup(upstream.Close)
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "image-test")
	for _, channelID := range []string{"primary", "backup"} {
		for _, row := range []any{
			&model.ModelChannel{ID: channelID, Scope: model.ChannelScopeSystem, Enabled: true, Name: channelID, BaseURL: upstream.URL + "/" + channelID + "/v1", APIKey: "test-only"},
			&model.ChannelModel{ID: channelID + "-image", ChannelID: channelID, ModelKey: "image-test", DisplayName: "Same image model", Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, capability), BillingMode: "fixed_request", PriceConfigured: true, Enabled: true},
			&model.ChannelModelPriceTier{ID: channelID + "-tier", ChannelModelID: channelID + "-image", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true},
		} {
			if err := db.Create(row).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": upstream.URL, "api_key": "test-only"}).Error; err != nil {
		t.Fatal(err)
	}
	stop := make(chan struct{})
	t.Cleanup(func() { close(stop) })
	go func() {
		for {
			select {
			case <-stop:
				return
			default:
				_ = s.ProcessNextTask()
				time.Sleep(10 * time.Millisecond)
			}
		}
	}()
	req := creationAgentRequest()
	req.Prompt, req.PermissionMode = "生成三张统一浅蓝风格商品图", "auto"
	req.Attachments = []CloudAgentAttachment{{ResourceID: "ref-one", StorageKey: "resource:ref-one", Kind: "image", Role: "product", Name: "商品图"}}
	req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "primary", ChannelModelKey: "image-test"}, ParameterMode: "manual", Size: "1024x1024"}}
	req.Budget.MaxCredits, req.Budget.MaxGenerationTasks = 10, 10
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	view := waitCloudAgentStatus(t, s, root.ID, "completed")
	if view.Approval != nil {
		t.Fatal("silent repair requested another approval")
	}
	run, _ := s.repo.CloudAgent("user", root.ID)
	state, _ := cloudAgentDecode(run)
	if state.CommerceBatch != nil {
		t.Fatal("completed run still has an unsettled batch")
	}
	for _, item := range plan.Items {
		task, _, err := cloudAgentCommerceLatestTask(s.repo, "user", &state, item.ID)
		if err != nil || task == nil || task.Status != model.TaskStatusSucceeded {
			t.Fatalf("item %s not delivered: %+v %v", item.ID, task, err)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if len(imageRequests) != 5 || modelSteps != 4 {
		t.Fatalf("expected three originals, one channel retry, one prompt repair and four Agent steps: images=%d steps=%d", len(imageRequests), modelSteps)
	}
	primaryRejected, backupRejected, repaired := false, false, false
	for _, request := range imageRequests {
		if !strings.Contains(request, plan.StyleBible) || !strings.Contains(request, "1024x1024") {
			t.Fatal("upstream retry lost the shared style or dimensions")
		}
		primaryRejected = primaryRejected || strings.HasPrefix(request, "/primary/") && strings.Contains(request, "Original scene direction")
		backupRejected = backupRejected || strings.HasPrefix(request, "/backup/") && strings.Contains(request, "Original scene direction")
		repaired = repaired || strings.Contains(request, "Neutral cosmetic still life") && !strings.Contains(request, "Original scene direction")
	}
	if !primaryRejected || !backupRejected || !repaired {
		t.Fatal("missing channel retry followed by Agent prompt repair")
	}
}
