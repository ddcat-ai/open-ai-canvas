package app

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestNormalizeTaskInputMakesTypedProviderConfigBillable(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.ChannelModel{}); err != nil {
		t.Fatal(err)
	}
	channelModel := model.ChannelModel{
		ID: "model-1", ChannelID: "channel-1", ModelKey: "text-model", Capability: "text",
		BillingMode: "fixed_request", UnitPriceMicrocredits: 100_000, PriceConfigured: true, Enabled: true,
	}
	if err := db.Create(&channelModel).Error; err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	input, err := normalizeTaskInput(map[string]any{
		"mode":   "text",
		"config": providerConfig{ChannelID: "channel-1", Model: "text-model", APIKey: "system"},
	})
	if err != nil {
		t.Fatal(err)
	}
	order, err := svc.taskBillingOrder("user-1", &model.Task{ID: "task-1", Type: "canvas_text"}, input)
	if err != nil {
		t.Fatal(err)
	}
	if order == nil || order.ChannelID != "channel-1" || order.AmountMicrocredits != 100_000 {
		t.Fatalf("taskBillingOrder() = %#v", order)
	}
}

func TestNormalizeTaskInputStillAllowsSecretProtection(t *testing.T) {
	input, err := normalizeTaskInput(map[string]any{
		"config": providerConfig{BaseURL: "https://example.com", APIKey: "private-key", Model: "text-model"},
	})
	if err != nil {
		t.Fatal(err)
	}
	config, ok := input["config"].(map[string]any)
	if !ok || config["apiKey"] != "private-key" {
		t.Fatalf("normalized config = %#v", input["config"])
	}
	svc := &Service{dataDir: t.TempDir()}
	if err := svc.protectTaskSecrets(input); err != nil {
		t.Fatal(err)
	}
	protected, _ := config["apiKey"].(string)
	if protected == "private-key" || !strings.HasPrefix(protected, encryptedSettingPrefix) {
		t.Fatalf("protected apiKey = %q", protected)
	}
}

func TestTaskInputRejectsInlineMedia(t *testing.T) {
	input, err := normalizeTaskInput(map[string]any{
		"referenceImages": []providerMedia{{DataURL: testReferenceImageDataURL}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !containsInlineMediaDataURL(input) {
		t.Fatal("containsInlineMediaDataURL() = false")
	}
}
