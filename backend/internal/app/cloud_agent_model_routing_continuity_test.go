package app

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCreationPlannerAndMediaChoicesStayIndependent(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	if err := db.Create(&model.ModelChannel{ID: "image-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "图片测试"}).Error; err != nil {
		t.Fatal(err)
	}
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "image-test")
	if err := db.Create(&model.ChannelModel{ID: "image-cm", ChannelID: "image-channel", ModelKey: "image-test", Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, capability), BillingMode: "fixed_request", PriceConfigured: true, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ChannelModelPriceTier{ID: "image-tier", ChannelModelID: "image-cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	req := creationAgentRequest()
	req.IdempotencyKey = "independent-planner-image-video"
	req.PermissionMode = "request_approval"
	req.Budget.MaxCredits, req.Budget.MaxGenerationTasks, req.Budget.MaxVideoSeconds = 10, 2, 24
	req.MediaSettings = &CloudAgentCreationMedia{
		Image: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "image-channel", ChannelModelKey: "image-test"}, ParameterMode: "auto"},
		Video: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "seedance-test"}, ParameterMode: "manual", DurationSeconds: 6},
	}
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	if state.Request.Model != "text-test" || state.Request.ChannelModelKey != "text-test" {
		t.Fatalf("text planner route changed: %+v", state.Request)
	}
	for _, tc := range []struct{ mode, wantType, wantOperation, wantModel, wantChannel string }{
		{"image", "canvas_image", "text_to_image", "image-test", "image-channel"},
		{"video", "canvas_video", "text_to_video", "seedance-test", "channel"},
	} {
		request, _, err := s.prepareCloudAgentCreationMedia(run, &state, cloudAgentMediaArgs{Mode: tc.mode, Prompt: "拍摄日本站园艺接头"}, tc.mode+"-call")
		if err != nil {
			t.Fatalf("%s admission: %v", tc.mode, err)
		}
		config, _ := request.Input["config"].(map[string]any)
		if request.Type != tc.wantType || request.Operation != tc.wantOperation || request.Model != tc.wantModel || config["channelId"] != tc.wantChannel || config["model"] != tc.wantModel {
			t.Fatalf("%s worker route: type=%s operation=%s model=%s config=%v", tc.mode, request.Type, request.Operation, request.Model, config)
		}
	}
}

func TestJapaneseSiteEnglishCopyKeepsMarketAndLanguageSeparate(t *testing.T) {
	plan := commerceFixturePlan()
	plan.Site, plan.Language, plan.Intent = "JP", "en", "亚马逊日本站园艺套图，不包含白底图；画面英文文案由用户提供"
	plan.Items[0].Prompt = "Garden drip irrigation lifestyle image"
	plan.Items[0].TargetCopy, plan.Items[0].ChineseReviewCopy = "For garden irrigation", "适用于园艺灌溉"
	req := creationAgentRequest()
	req.Prompt = "亚马逊日本站园艺套图，英文画面文案由我提供"
	req.Attachments = []CloudAgentAttachment{{ResourceID: "product-1", Kind: "image", Role: "product"}}
	if err := validateCloudAgentCommercePlan(req, &plan); err != nil {
		t.Fatalf("JP/en plan rejected: %v", err)
	}
	call := cloudAgentCall{ID: "jp-english-item"}
	call.Function.Name, call.Function.Arguments = "generate_media", `{"mode":"image","commercePlanId":"plan-1","commerceItemId":"hero"}`
	compiled, err := cloudAgentCommerceMediaCall(&plan, call)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"site: JP", "language: en", "For garden irrigation"} {
		if !strings.Contains(compiled.Function.Arguments, want) {
			t.Fatalf("compiled JP/en item lost %q: %s", want, compiled.Function.Arguments)
		}
	}
	if strings.Contains(compiled.Function.Arguments, "site: US") {
		t.Fatal("English copy was silently converted to US market")
	}
}
