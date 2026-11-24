package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestEcommerceWorkbenchTasksUseAdminThinkingIntent(t *testing.T) {
	t.Setenv("AI_MODE", "disabled")
	svc, db, _, _ := ecommerceCreationTestService(t)
	project, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	saveEcommerceDirectionsDraft(t, db, project)
	setting := EcommerceOrchestrationSetting{
		Version:  1,
		Vision:   EcommerceOrchestrationRole{Model: EcommerceOrchestrationModel{ChannelModelID: "cm"}, ThinkingLevel: "high"},
		Director: EcommerceOrchestrationRole{Model: EcommerceOrchestrationModel{ChannelModelID: "cm"}, ThinkingLevel: "deep"},
	}
	encoded, err := json.Marshal(setting)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ecommerceOrchestrationSettingKey, ValueJSON: string(encoded)}); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ stage, want string }{
		{"planning", "deep"}, {"product-understanding", "high"}, {"creative-directions", "high"},
	} {
		t.Run(test.stage, func(t *testing.T) {
			req := creationTextRequest()
			req.Input["metadata"] = map[string]any{"source": "ecommerce-agent", "stage": test.stage, "ecommerceProjectId": project.ID}
			req.Input["textOptions"] = map[string]any{"stream": false, "thinkingLevel": "off"}
			task, err := svc.CreateTask("user", req)
			if err != nil {
				t.Fatal(err)
			}
			stored, err := svc.repo.TaskForUser("user", task.ID)
			if err != nil {
				t.Fatal(err)
			}
			var input map[string]any
			if err := json.Unmarshal([]byte(stored.InputJSON), &input); err != nil {
				t.Fatal(err)
			}
			options, _ := input["textOptions"].(map[string]any)
			if options["thinkingLevel"] != test.want || options["stream"] != false {
				t.Fatalf("queued stage did not preserve admin intent and stream setting: %#v", options)
			}
		})
	}
}

func TestEcommerceChatJSONUsesConfiguredStageThinkingLevel(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode request: %v", err)
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{}"}}]}`))
	}))
	defer server.Close()

	svc, _, _, _ := creationTestService(t)
	// 官方插件包在测试进程首次使用时才加载，属于准备阶段，不占用上游请求时限。
	svc.protocolRegistry()
	profile := &ModelCapabilityConfig{Text: &TextCapabilityConfig{Thinking: &TextThinkingConfig{
		Mode: ThinkingModeLevels, Levels: []string{"off", "low", "high"}, Default: ThinkingLevelLow,
		Switch:    ThinkingSwitchConfig{Kind: ThinkingSwitchOmit},
		Intensity: ThinkingIntensityConfig{Kind: ThinkingIntensityEffort},
	}}}
	cfg := ecommerceProviderConfig{
		TextTimeout:       time.Second,
		TextThinkingLevel: "deep",
		TextProvider: &providerConfig{
			BaseURL: server.URL, APIKey: "test-key", Model: "vision-model", InterfaceType: "chat-completion", CapabilityConfig: profile,
		},
	}
	var result map[string]any
	if err := svc.ecommerceChatJSON(context.Background(), cfg, "task", "system", "prompt", nil, &result); err != nil {
		t.Fatal(err)
	}
	if received["reasoning_effort"] != "high" {
		t.Fatalf("stage deep intent was not resolved against the selected model: %#v", received)
	}
}
