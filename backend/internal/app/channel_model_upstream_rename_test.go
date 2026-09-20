package app

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

// 模型级上游键重命名后，任务请求必须使用新键；价格档中与旧值相同的上游键属于
// “跟随模型默认”的隐式固化，保存时必须级联跟随（见 SaveAdminChannelModel）。
func upstreamRenameFixture(t *testing.T) (*Service, *model.User, *model.ModelChannel) {
	t.Helper()
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "channel-1", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true, Name: "model-gateway", BaseURL: "https://example.com/v1", APIKey: "key", APIFormat: "openai", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	return svc, admin, &channel
}

func TestSaveAdminChannelModelCascadesUpstreamKeyToMatchingTiers(t *testing.T) {
	svc, admin, channel := upstreamRenameFixture(t)
	enabled := true
	first, err := svc.SaveAdminChannelModel(admin, channel.ID, "", ChannelModelRequest{
		ModelKey: "deepseek-v4-flash", ProviderModelKey: "deepseek-v4-flash", DisplayName: "deepseek-v4-flash",
		Capability: "text", Protocol: string(model.ChannelInterfaceChatCompletion),
		CapabilityConfig: DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "deepseek-v4-flash"),
		PriceTiers: []ChannelModelPriceTierRequest{
			{Selector: map[string]string{}, ProviderModelKey: "deepseek-v4-flash", BillingMode: "fixed_request", PriceConfigured: true, Enabled: &enabled},
			{Selector: map[string]string{"operation": "text_generation"}, ProviderModelKey: "deepseek-v4-flash-preview", BillingMode: "fixed_request", PriceConfigured: true, Enabled: &enabled},
		},
		Enabled: &enabled,
	})
	if err != nil {
		t.Fatalf("initial save failed: %v", err)
	}

	// 管理端表单会把已存档位键原样回传（统一价格档的上游键字段不可见），重命名顶层上游键。
	renamed, err := svc.SaveAdminChannelModel(admin, channel.ID, first.ID, ChannelModelRequest{
		ModelKey: "deepseek-v4.1-flash", ProviderModelKey: "deepseek-v4.1-flash", DisplayName: "deepseek-v4.1-flash",
		Capability: "text", Protocol: string(model.ChannelInterfaceChatCompletion),
		CapabilityConfig: DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "deepseek-v4.1-flash"),
		PriceTiers: []ChannelModelPriceTierRequest{
			{Selector: map[string]string{}, ProviderModelKey: "deepseek-v4-flash", BillingMode: "fixed_request", PriceConfigured: true, Enabled: &enabled},
			{Selector: map[string]string{"operation": "text_generation"}, ProviderModelKey: "deepseek-v4-flash-preview", BillingMode: "fixed_request", PriceConfigured: true, Enabled: &enabled},
		},
		Enabled: &enabled,
	})
	if err != nil {
		t.Fatalf("rename save failed: %v", err)
	}
	if len(renamed.PriceTiers) != 2 {
		t.Fatalf("price tiers = %#v, want 2", renamed.PriceTiers)
	}
	for _, tier := range renamed.PriceTiers {
		if tier.ProviderModelKey == "deepseek-v4-flash" {
			t.Fatalf("tier %s still carries the retired upstream key deepseek-v4-flash; it must follow the model rename", tier.ID)
		}
	}
	// 管理员显式配置的其他上游 SKU 不能被级联覆盖。
	keptDistinct := false
	for _, tier := range renamed.PriceTiers {
		if tier.ProviderModelKey == "deepseek-v4-flash-preview" {
			keptDistinct = true
		}
	}
	if !keptDistinct {
		t.Fatalf("distinct tier upstream key must survive the rename: %#v", renamed.PriceTiers)
	}
}

func TestRenamedUpstreamKeyReachesSystemChannelRequests(t *testing.T) {
	svc, admin, channel := upstreamRenameFixture(t)
	enabled := true
	first, err := svc.SaveAdminChannelModel(admin, channel.ID, "", ChannelModelRequest{
		ModelKey: "deepseek-v4-flash", ProviderModelKey: "deepseek-v4-flash", DisplayName: "deepseek-v4-flash",
		Capability: "text", Protocol: string(model.ChannelInterfaceChatCompletion),
		CapabilityConfig: DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "deepseek-v4-flash"),
		PriceTiers:       []ChannelModelPriceTierRequest{{ProviderModelKey: "deepseek-v4-flash", BillingMode: "fixed_request", PriceConfigured: true, Enabled: &enabled}},
		Enabled:          &enabled,
	})
	if err != nil {
		t.Fatalf("initial save failed: %v", err)
	}
	if _, err := svc.SaveAdminChannelModel(admin, channel.ID, first.ID, ChannelModelRequest{
		ModelKey: "deepseek-v4.1-flash", ProviderModelKey: "deepseek-v4.1-flash", DisplayName: "deepseek-v4.1-flash",
		Capability: "text", Protocol: string(model.ChannelInterfaceChatCompletion),
		CapabilityConfig: DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "deepseek-v4.1-flash"),
		PriceTiers:       []ChannelModelPriceTierRequest{{ProviderModelKey: "deepseek-v4-flash", BillingMode: "fixed_request", PriceConfigured: true, Enabled: &enabled}},
		Enabled:          &enabled,
	}); err != nil {
		t.Fatalf("rename save failed: %v", err)
	}

	// 用户在画布 Agent 选中新模型发起任务；config 形状与 cloud_agent.go 组装一致。
	resolved, err := svc.resolveSystemChannelModelSelection(map[string]any{
		"config": map[string]any{"channelId": channel.ID, "model": "deepseek-v4.1-flash", "channelModelKey": "deepseek-v4.1-flash"},
	}, "canvas_text", "")
	if err != nil {
		t.Fatalf("resolveSystemChannelModelSelection() error = %v", err)
	}
	config := resolved["config"].(map[string]any)
	if got := config["providerModelKey"]; got != "deepseek-v4.1-flash" {
		t.Fatalf("providerModelKey = %v, want deepseek-v4.1-flash (user-selected model must reach the upstream request)", got)
	}
}
