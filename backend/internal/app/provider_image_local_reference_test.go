package app

import (
	"context"
	"encoding/base64"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func TestOpenAIImageLocalReferencesWithoutPublicURL(t *testing.T) {
	service, _, imageBytes := cloudAgentVisionFixture(t)
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "")
	input := canvasGenerationInput{
		Mode: "image", Prompt: "Keep the character consistent with @图片1",
		Config:          providerConfig{InterfaceType: string(model.ChannelInterfaceOpenAIImage), Model: "test-image"},
		ReferenceImages: []providerMedia{{ID: "character", StorageKey: "resource:ref-one"}},
	}
	ctx := ensureOfficialProtocolAdapter(context.Background(), input.Config.InterfaceType)
	policy := providerMediaHydrationPolicyFor(ctx, input)
	if policy.requireURL {
		t.Fatal("local OpenAI image references must not require a public URL")
	}
	if err := service.hydrateGenerationMedia("user", &input, policy); err != nil {
		t.Fatal(err)
	}
	want := "data:image/png;base64," + base64.StdEncoding.EncodeToString(imageBytes)
	if input.ReferenceImages[0].DataURL != want || input.ReferenceImages[0].URL != "" {
		t.Fatal("reference did not hydrate from the authorized local resource")
	}
	adapter, ok := declarativeProtocolAdapterForContext(ctx, input.Config.InterfaceType)
	if !ok {
		t.Fatal("OpenAI image adapter is missing")
	}
	request, err := adapter.BuildCreate(ctx, protocol.RequestContext{Request: protocolRequestFromInput(input)})
	if err != nil {
		t.Fatal(err)
	}
	images := creationMaps(request.Body.(map[string]any)["images"])
	if request.Path != "/v1/images/edits" || len(images) != 1 || images[0]["image_url"] != want {
		t.Fatal("image edit request did not retain inline image bytes")
	}
	foreign := canvasGenerationInput{ReferenceImages: []providerMedia{{StorageKey: "resource:ref-one"}}}
	if err := service.hydrateGenerationMedia("other-user", &foreign, policy); err == nil {
		t.Fatal("another user's reference resource was accepted")
	}
}

func TestProtocolRequestLiftsConfigVideoDraftToProviderOptions(t *testing.T) {
	input := canvasGenerationInput{
		Mode:   "video",
		Prompt: "a girl walks",
		Config: providerConfig{InterfaceType: "volcengine-ark-video", Model: "doubao-seedance-2-5-260628", VQuality: "480p", VideoDraft: "true"},
	}
	request := protocolRequestFromInput(input)
	options := request.ProviderOptions["volcengine-ark-video"]
	if options == nil || options["draft"] != true {
		t.Fatalf("ProviderOptions[volcengine-ark-video] = %#v, want draft=true", request.ProviderOptions)
	}
	// 未开启时不得注入，避免覆盖管理员 defaultOptions 的显式配置。
	request = protocolRequestFromInput(canvasGenerationInput{Mode: "video", Prompt: "walk", Config: providerConfig{InterfaceType: "volcengine-ark-video"}})
	if options := request.ProviderOptions["volcengine-ark-video"]; options != nil && options["draft"] == true {
		t.Fatalf("draft must not be injected when config flag is off: %#v", options)
	}
}
