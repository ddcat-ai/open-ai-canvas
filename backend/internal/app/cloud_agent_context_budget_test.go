package app

import (
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestCloudAgentContextBudgetKeepsModelWindowAndOutputSeparate(t *testing.T) {
	budget := cloudAgentContextBudgetFor(1_000_000, 64_000, "channel-model")
	if budget.ContextWindowTokens != 1_000_000 || budget.MaxOutputTokens != 64_000 {
		t.Fatalf("budget = %#v", budget)
	}
	if budget.InputBudgetTokens <= 900_000 || budget.CompactAtTokens >= budget.InputBudgetTokens {
		t.Fatalf("input budget did not preserve large model window: %#v", budget)
	}
	if budget.Source != "channel-model" {
		t.Fatalf("source = %q", budget.Source)
	}
}

func TestCloudAgentContextBudgetUsesChannelModelCapability(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test")
	capability.Text.ContextWindowTokens = 1_000_000
	capability.Text.MaxOutputTokens = 64_000
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, capability)).Error; err != nil {
		t.Fatal(err)
	}

	budget := s.cloudAgentContextBudgetForRequest(CloudAgentRequest{ChannelID: "channel", ChannelModelKey: "text-test"})
	if budget.Source != "channel-model" || budget.ContextWindowTokens != 1_000_000 || budget.MaxOutputTokens != 64_000 {
		t.Fatalf("channel capability budget = %#v", budget)
	}
	if budget.InputBudgetTokens <= 900_000 {
		t.Fatalf("channel capability did not expose the large window: %#v", budget)
	}
}

func TestCloudAgentContextBudgetUsesLogicalRouteSafeIntersection(t *testing.T) {
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test")
	first := *capability.Text
	first.ContextWindowTokens = 1_000_000
	first.MaxOutputTokens = 64_000
	second := first
	second.ContextWindowTokens = 512_000
	second.MaxOutputTokens = 32_000

	s := &Service{
		repo:            repository.New(nil),
		routeCatalogTTL: time.Hour,
		routeCatalog: &routeCatalogSnapshot{LoadedAt: time.Now(), Models: map[string]cachedLogicalModel{
			"logical-text": {
				Routes: []cachedLogicalRoute{
					{CapabilitySpec: CapabilitySpec{Capability: "text"}, ChannelModel: model.ChannelModel{Capability: "text", CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, &ModelCapabilityConfig{Version: 1, Text: &first})}},
					{CapabilitySpec: CapabilitySpec{Capability: "text"}, ChannelModel: model.ChannelModel{Capability: "text", CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, &ModelCapabilityConfig{Version: 1, Text: &second})}},
				},
			},
		}},
	}

	budget := s.cloudAgentContextBudgetForRequest(CloudAgentRequest{LogicalModelID: "logical-text"})
	if budget.Source != "logical-route-intersection" || budget.ContextWindowTokens != 512_000 || budget.MaxOutputTokens != 32_000 {
		t.Fatalf("logical route intersection = %#v", budget)
	}
}

func TestCloudAgentEstimatedTokensIsConservativeForChinese(t *testing.T) {
	english := cloudAgentEstimatedTokens([]byte(strings.Repeat("word ", 1000)))
	chinese := cloudAgentEstimatedTokens([]byte(strings.Repeat("中文", 1000)))
	if chinese <= english {
		t.Fatalf("Chinese estimate = %d, English estimate = %d", chinese, english)
	}
}

func TestFitCloudAgentModelContextUsesTokenBudget(t *testing.T) {
	request := canonicalAgentRequest{Messages: []map[string]any{{"role": "user", "content": strings.Repeat("中文", 5000)}}}
	if err := fitCloudAgentModelContext(&request, 1_000); err == nil {
		t.Fatal("expected token budget error")
	}
	if err := fitCloudAgentModelContext(&request, 20_000); err != nil {
		t.Fatalf("large token budget should pass: %v", err)
	}
}
