package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestCreationModelContextIncludesSelectedCapabilitiesAndPrices(t *testing.T) {
	s, _, _ := agentMediaFixture(t)
	state := &cloudAgentRuntime{Request: creationAgentRequest()}
	state.Request.MediaSettings = &CloudAgentCreationMedia{Video: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "seedance-test"}, ParameterMode: "auto"}}
	canonical := canonicalAgentRequest{Messages: []map[string]any{{"role": "user", "content": "make a video"}}}
	request, err := s.buildEnhancedPiRequest(context.Background(), EnhancedPiRequestParams{UserID: "user", RunID: "model-context", ModelID: "text-test", RuntimeState: state, Canonical: &canonical})
	if err != nil {
		t.Fatal(err)
	}
	var facts map[string]any
	if err := json.Unmarshal([]byte(strings.SplitN(request.TurnContext, "\n", 2)[1]), &facts); err != nil {
		t.Fatal(err)
	}
	models, _ := facts["mediaModels"].(map[string]any)
	video, _ := models["video"].(map[string]any)
	if video["modelKey"] != "seedance-test" || video["capabilityConfig"] == nil || video["defaultOptions"] == nil || len(creationMaps(video["priceTiers"])) == 0 {
		t.Fatalf("selected model's executable parameters and prices are missing: %#v", models)
	}
	for _, secret := range []string{"apiKey", "baseUrl", "authorization"} {
		if strings.Contains(strings.ToLower(mustMarshal(models)), strings.ToLower(secret)) {
			t.Fatalf("media context contains credential field %s", secret)
		}
	}
}

func TestCloudAgentSafeModelErrorShowsSpecificPriceFailure(t *testing.T) {
	err := fmt.Errorf("image quote: %w", ModelPriceNotConfigured("指定的模型未配置当前规格的有效价格"))
	if message := cloudAgentSafeToolError(err); message != "指定的模型未配置当前规格的有效价格" {
		t.Fatalf("specific model error was hidden: %s", message)
	}
	if message := cloudAgentSafeToolError(ModelPriceNotConfigured("failure at https://private.invalid?api_key=test")); strings.Contains(message, "private.invalid") || strings.Contains(message, "api_key") {
		t.Fatalf("provider details exposed: %s", message)
	}
}
