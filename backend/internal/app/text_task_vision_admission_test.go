package app

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func textVisionFixture(t *testing.T, maxImages int) (*Service, model.ModelChannel, model.ChannelModel) {
	t.Helper()
	svc, _, channel, channelModel := textVisionFixtureWithDB(t, maxImages)
	return svc, channel, channelModel
}

func textVisionFixtureWithDB(t *testing.T, maxImages int) (*Service, *gorm.DB, model.ModelChannel, model.ChannelModel) {
	t.Helper()
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-model")
	profile.Text.References.MaxImages = maxImages
	return createSystemChannelSelectionFixture(t, "text", model.ChannelInterfaceChatCompletion, profile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("text-tier", `{}`, "provider-text", "fixed_request"),
	})
}

func textTaskWithImage(channelID, modelKey string) map[string]any {
	return map[string]any{
		"mode": "text", "prompt": "描述这张图",
		"referenceImages": []any{map[string]any{"storageKey": "resource:image-1", "mimeType": "image/png"}},
		"config":          map[string]any{"channelId": channelID, "model": modelKey},
	}
}

func assertTextVisionRejected(t *testing.T, err error) {
	t.Helper()
	var argumentErr *modelCapabilityArgumentError
	if !errors.As(err, &argumentErr) || argumentErr.Field != "referenceNodeIds" || argumentErr.Issue != "unsupported_value" {
		t.Fatalf("text task with images on a non-vision model must be rejected with a field error: %#v", err)
	}
	if !strings.Contains(err.Error(), "当前文字模型不支持图片输入，请选择支持看图的文字模型") {
		t.Fatalf("message = %q", err.Error())
	}
}

func TestValidateTaskCapabilityRejectsImagesForNonVisionTextModel(t *testing.T) {
	svc, channel, channelModel := textVisionFixture(t, 0)
	assertTextVisionRejected(t, svc.ValidateTaskCapability(textTaskWithImage(channel.ID, channelModel.ModelKey)))

	plain := textTaskWithImage(channel.ID, channelModel.ModelKey)
	delete(plain, "referenceImages")
	if err := svc.ValidateTaskCapability(plain); err != nil {
		t.Fatalf("text task without images must pass: %v", err)
	}

	vision, visionChannel, visionModel := textVisionFixture(t, 2)
	if err := vision.ValidateTaskCapability(textTaskWithImage(visionChannel.ID, visionModel.ModelKey)); err != nil {
		t.Fatalf("vision text model must accept images: %v", err)
	}
}

func TestValidateTaskCapabilityChecksDeclaredCustomTextCapability(t *testing.T) {
	declared := map[string]any{
		"mode": "text", "prompt": "描述这张图",
		"referenceImages": []any{map[string]any{"dataUrl": "https://example.test/a.png"}},
		"config": map[string]any{"interfaceType": string(model.ChannelInterfaceChatCompletion), "model": "custom-text",
			"capabilityConfig": map[string]any{"version": 1, "text": map[string]any{"references": map[string]any{"maxImages": 0, "promptMaxChars": 32000}}}},
	}
	assertTextVisionRejected(t, (&Service{}).ValidateTaskCapability(declared))
	undeclared := map[string]any{"mode": "text", "prompt": "描述这张图", "referenceImages": declared["referenceImages"], "config": map[string]any{"interfaceType": string(model.ChannelInterfaceChatCompletion), "model": "custom-text"}}
	if err := (&Service{}).ValidateTaskCapability(undeclared); err != nil {
		t.Fatalf("custom channel without a declared capability is not inferred: %v", err)
	}
}

// 准入在预授权之前：被拒的请求不能留下任务或计费订单。
func TestCreateTextTaskWithImagesOnNonVisionModelDoesNotReserveCredits(t *testing.T) {
	svc, db := newMediaRecoveryTestService(t)
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-model")
	capabilityJSON, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	channel := model.ModelChannel{ID: newID(), Scope: model.ChannelScopeSystem, Enabled: true, Name: "System Channel", APIFormat: "legacy"}
	channelModel := model.ChannelModel{ID: newID(), ChannelID: channel.ID, ModelKey: "text-model", ProviderModelKey: "provider-text", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, Enabled: true, CapabilityConfigJSON: string(capabilityJSON)}
	tier := newSelectionPriceTier("text-tier", `{}`, "provider-text", "fixed_request")
	tier.ChannelModelID = channelModel.ID
	for _, item := range []any{&channel, &channelModel, &tier, &model.User{ID: "user-text-vision", Email: "vision@example.com", Username: "vision"}, &model.CreditAccount{UserID: "user-text-vision", AvailableMicrocredits: 1_000_000}} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	_, err = svc.CreateTask("user-text-vision", CreateTaskRequest{Type: "canvas_text", Prompt: "描述这张图", Input: textTaskWithImage(channel.ID, channelModel.ModelKey)})
	// 系统渠道在模型选择阶段就按能力规格拒绝（所选模型不支持当前请求）；无论哪一层拒绝，都必须发生在预授权之前。
	if err == nil {
		t.Fatal("non-vision text model accepted reference images")
	}
	var orders, tasks int64
	db.Model(&model.BillingOrder{}).Count(&orders)
	db.Model(&model.Task{}).Count(&tasks)
	if orders != 0 || tasks != 0 {
		t.Fatalf("rejected admission left orders=%d tasks=%d", orders, tasks)
	}
}
