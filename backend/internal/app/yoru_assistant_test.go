package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestYoruDefaultsFailClosedAndPublicProjection(t *testing.T) {
	svc, _, _, _ := newAppearanceTestService(t)
	setting, err := svc.YoruSettings()
	if err != nil {
		t.Fatal(err)
	}
	if setting.Enabled || !strings.Contains(setting.Knowledge, "/toolbox/image") {
		t.Fatalf("unsafe default: %+v", setting)
	}
	public, err := svc.PublicYoruSettings(nil)
	if err != nil {
		t.Fatal(err)
	}
	if public.Knowledge != "" || public.SystemPrompt != "" || public.LogicalModelID != "" {
		t.Fatalf("private config exposed: %+v", public)
	}
	if _, err := svc.CreateYoruChatTask(&model.User{ID: "user"}, YoruChatRequest{Message: "怎么生成图片？"}); err == nil {
		t.Fatal("disabled assistant created task")
	}
}

func TestYoruAudienceGateDefaultsToAdmin(t *testing.T) {
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	user := &model.User{ID: "user", Role: model.UserRoleUser}
	if !yoruAudienceAllows("admin", admin) || yoruAudienceAllows("admin", user) || yoruAudienceAllows("admin", nil) {
		t.Fatal("admin pilot audience leaked to a regular user or guest")
	}
	if !yoruAudienceAllows("all", user) || yoruAudienceAllows("all", nil) {
		t.Fatal("logged-in audience check is incorrect")
	}
}

func TestYoruCreatesRepeatedBillableRoutedTextTasks(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	actor := &model.User{ID: "user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	spec, err := CapabilitySpecFromModelCapabilityConfig(DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test"), "text")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	logical, err := svc.SaveAdminLogicalModel(admin, "", LogicalModelRequest{Code: "yoru-text", Name: "小夜测试文本", Capability: "text", Enabled: true, PricePolicy: "channel", BillingMode: "fixed_request", CapabilitySpec: spec, DefaultOptions: map[string]any{}, Routes: []LogicalRouteRequest{{ChannelModelID: "cm", Enabled: true, Priority: 100, Weight: 1}}})
	if err != nil {
		t.Fatal(err)
	}
	settings := defaultYoruSettings()
	settings.Enabled = true
	settings.Audience = "all"
	settings.LogicalModelID = logical.ID
	if _, err := svc.UpdateYoruSettings(admin, settings); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateTask(actor.ID, CreateTaskRequest{Type: "canvas_text", Operation: "yoru_assistant", Prompt: "untrusted request", LogicalModelID: logical.ID, Input: map[string]any{"mode": "text", "config": map[string]any{}}}); err == nil {
		t.Fatal("public task request bypassed the frontend model gate")
	}
	task, err := svc.CreateYoruChatTask(actor, YoruChatRequest{Message: "怎么生成图片？", History: []YoruMessage{{Role: "user", Content: "你好"}, {Role: "assistant", Content: "你好呀"}}, Page: "/create"})
	if err != nil {
		t.Fatal(err)
	}
	var persisted model.Task
	if err := db.First(&persisted, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.Type != "canvas_text" || persisted.LogicalModelID != logical.ID || persisted.ChannelModelID != "cm" || persisted.AuthorizedChargeMicrocredits <= 0 {
		t.Fatalf("task route or charge: %+v", persisted)
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(persisted.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	history, _ := input["textHistory"].([]any)
	if len(history) != 3 {
		t.Fatalf("multiturn context lost: %#v", history)
	}
	context, _ := history[0].(map[string]any)
	if !strings.Contains(context["content"].(string), "/toolbox/image") || !strings.Contains(context["content"].(string), "当前页面：/create") {
		t.Fatalf("site knowledge or page context missing: %#v", context)
	}
	second, err := svc.CreateYoruChatTask(actor, YoruChatRequest{Message: "视频在哪里？"})
	if err != nil || second.BillingOrderID == "" || second.BillingOrderID == task.BillingOrderID {
		t.Fatalf("second paid call was blocked or reused a charge: %+v %v", second, err)
	}
}

func TestYoruReusesPublishedDirectTextModelAndExistingBilling(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	admin := &model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	actor := &model.User{ID: "user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	setting := defaultYoruSettings()
	setting.Enabled, setting.Audience, setting.ModelMode = true, "all", "direct"
	setting.ChannelModelID = "cm"
	setting.DailyCalls, setting.MaxChargeMicrocredits, setting.MaxDailyMicrocredits = 1, 100, 100 // Legacy saved limits must be ignored.
	updated, err := svc.UpdateYoruSettings(admin, setting)
	if err != nil {
		t.Fatal(err)
	}
	if updated.DailyCalls != 0 || updated.MaxChargeMicrocredits != 0 || updated.MaxDailyMicrocredits != 0 {
		t.Fatalf("legacy Yoru caps remained active: %+v", updated)
	}
	public, err := svc.PublicYoruSettings(actor)
	if err != nil || !public.Enabled || public.ChannelModelID != "" {
		t.Fatalf("public model selection: %+v %v", public, err)
	}
	task, err := svc.CreateYoruChatTask(actor, YoruChatRequest{Message: "你好，小夜", History: []YoruMessage{{Role: "user", Content: "你好"}}, Page: "/create"})
	if err != nil {
		t.Fatal(err)
	}
	var saved model.Task
	if err := db.First(&saved, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if saved.LogicalModelID != "" || saved.Model != "text-test" || saved.BillingOrderID == "" || saved.AuthorizedChargeMicrocredits <= 0 {
		t.Fatalf("direct model did not use existing billable task path: %+v", saved)
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(saved.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	config, _ := input["config"].(map[string]any)
	if config["channelId"] != "channel" || config["model"] != "text-test" || config["priceTierId"] != "tier" {
		t.Fatalf("system model was not resolved server-side: %#v", config)
	}
	second, err := svc.CreateYoruChatTask(actor, YoruChatRequest{Message: "再次发送"})
	if err != nil || second.BillingOrderID == "" || second.BillingOrderID == saved.BillingOrderID {
		t.Fatalf("repeat call did not use a new billable task: %+v %v", second, err)
	}
	var count int64
	if err := db.Model(&model.Task{}).Where("operation = ?", "yoru_assistant").Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("unexpected billable task count: count=%d err=%v", count, err)
	}
	if err := db.Model(&model.CreditAccount{}).Where("user_id = ?", actor.ID).Update("available_microcredits", 0).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateYoruChatTask(actor, YoruChatRequest{Message: "余额不足时重试"}); err == nil {
		t.Fatal("wallet admission allowed a paid task without available credits")
	}
}

func TestYoruDirectModelRejectsDisabledChannelModel(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	setting := defaultYoruSettings()
	setting.Enabled, setting.ChannelModelID = true, "cm"
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateYoruSettings(admin, setting); err == nil {
		t.Fatal("disabled direct model was accepted")
	}
}

func TestYoruAdminSettingsRequireModelAndRejectGuests(t *testing.T) {
	svc, _, _, _ := newAppearanceTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	setting := defaultYoruSettings()
	setting.Enabled = true
	if _, err := svc.UpdateYoruSettings(admin, setting); err == nil {
		t.Fatal("enabled assistant accepted missing model selection")
	}
	setting.Enabled = false
	setting.AllowGuests = true
	if _, err := svc.UpdateYoruSettings(admin, setting); err == nil {
		t.Fatal("guest model calls accepted without wallet")
	}
	setting.AllowGuests = false
	setting.SystemPrompt = "private instructions"
	if _, err := svc.UpdateYoruSettings(admin, setting); err != nil {
		t.Fatal(err)
	}
	public, err := svc.PublicYoruSettings(admin)
	if err != nil || public.SystemPrompt != "" {
		t.Fatalf("private instructions exposed: %+v %v", public, err)
	}
}
