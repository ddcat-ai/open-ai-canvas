package app

import (
	"context"
	"encoding/json"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
	"yingce/backend/internal/repository"
)

func imageBillingService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.New(sqlite.Config{DriverName: "sqlite", DSN: "file:" + newID() + "?mode=memory&cache=shared"}), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ModelChannel{}, &model.ChannelModel{}, &model.ChannelModelPriceTier{}, &model.User{}, &model.UserGroup{}, &model.UserGroupChannel{}, &model.SystemSetting{}, &model.BillingOrder{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	ensureTestUsers(t, db, "image-user")
	s := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	if err := db.Create(&model.ModelChannel{ID: "image-channel", Name: "Official Ark", Scope: model.ChannelScopeSystem, Enabled: true, ModelsJSON: `[]`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ChannelModel{ID: "image-model", ChannelID: "image-channel", ModelKey: seedream55Model, ProviderModelKey: seedream55Model, Capability: "image", Protocol: model.ChannelInterfaceVolcengineArkImage, Enabled: true, PriceConfigured: true, PriceCurrency: "credits"}).Error; err != nil {
		t.Fatal(err)
	}
	pricing := &model.ImagePricing{InputPriceMicrocredits: 50_000, OutputTiers: []model.ImagePriceTier{{MaxPixels: 2_610_000, UnitPriceMicrocredits: 130_000}, {MaxPixels: 4_630_000, UnitPriceMicrocredits: 230_000}}}
	tier := model.ChannelModelPriceTier{ID: "image-tier", ChannelModelID: "image-model", SelectorKey: "{}", SelectorJSON: "{}", Resolution: "*", ProviderModelKey: seedream55Model, BillingMode: "image_usage", ImagePricing: pricing, PriceConfigured: true, Enabled: true, PriceVersion: 1}
	if err := db.Create(&tier).Error; err != nil {
		t.Fatal(err)
	}
	return s, db
}

func TestImageBillingQuoteAndOrderShareSnapshot(t *testing.T) {
	s, _ := imageBillingService(t)
	intent := ModelRequestIntent{Capability: "image", Inputs: map[string]int{"image": 3}, Options: map[string]any{"count": 1}}
	order, err := s.newBillingOrderWithPriceTier("image-user", "", "test-image", "image-channel", seedream55Model, "image", "test", 1, tokenBillingEstimate{}, "image-tier", intent)
	if err != nil {
		t.Fatal(err)
	}
	if order.AmountMicrocredits != 380_000 || order.ImageInputImages != 3 || order.ImageMaxOutputImages != 1 || order.ImagePricing == nil {
		t.Fatalf("order=%#v", order)
	}
	quote := quoteFromOrder("", order, tokenBillingEstimate{})
	if quote.AmountMicrocredits != order.AmountMicrocredits || !quote.Estimated || quote.ImageUsage.InputImages != 3 {
		t.Fatalf("quote=%#v", quote)
	}
	if _, err := s.newBillingOrder("image-user", "", "test-image-missing", "image-channel", seedream55Model, "image", "test", 1, tokenBillingEstimate{}); err == nil {
		t.Fatal("missing request intent accepted")
	}
}

func TestImageBillingProviderUsageRecordedBeforeDownload(t *testing.T) {
	s, db := imageBillingService(t)
	order := &model.BillingOrder{ID: "image-order", UserID: "image-user", IdempotencyKey: "usage-before-download", Capability: "image", BillingMode: "image_usage", Status: model.BillingStatusRunning}
	if err := db.Create(order).Error; err != nil {
		t.Fatal(err)
	}
	ctx := context.WithValue(context.Background(), providerAnalyticsKey{}, providerAnalyticsContext{Service: s, BillingOrderID: order.ID})
	result := &protocol.Result{Images: []protocol.MediaReference{{URL: "https://unreachable.invalid/image.png", Metadata: map[string]any{"size": "1536x1536"}}}, Usage: map[string]any{"input_images": float64(1), "generated_images": float64(1)}}
	request := protocol.GenerationRequest{Images: []protocol.MediaReference{{URL: "https://example.com/input.png"}}}
	if err := recordProtocolImageUsage(ctx, canvasGenerationInput{Mode: "image"}, request, result); err != nil {
		t.Fatal(err)
	}
	result.Images[0].URL = ""
	result.Images[0].DataURL = "data:image/png;base64,!invalid!"
	if _, err := finishProtocolAdapterResult(ctx, canvasGenerationInput{Mode: "image"}, protocol.UnavailableAdapter{}, request, "", result, videoPollPolicy{}); err == nil {
		t.Fatal("invalid image download unexpectedly succeeded")
	}
	saved, err := s.repo.BillingOrder(order.ID)
	if err != nil || saved.ImageUsage == nil || saved.ImageUsage.Outputs[0].Width != 1536 {
		t.Fatalf("saved=%#v err=%v", saved, err)
	}
	result.Usage["generated_images"] = float64(2)
	if err := recordProtocolImageUsage(ctx, canvasGenerationInput{Mode: "image"}, request, result); err == nil {
		t.Fatal("mismatched provider count accepted")
	}
}

func TestImageBillingSeedream55InputAndLayerReservation(t *testing.T) {
	input := canvasGenerationInput{Mode: "image", Config: providerConfig{Model: seedream55Model, InterfaceType: string(model.ChannelInterfaceVolcengineArkImage), Size: "1024x1024", Count: "1"}}
	if err := validateSeedream55Input(input); err != nil {
		t.Fatal(err)
	}
	body, err := volcengineArkImageBody(input)
	if err != nil || body["size"] != "1024x1024" {
		t.Fatalf("low tier resized: %#v err=%v", body, err)
	}
	input.Config.Count = "2"
	if validateSeedream55Input(input) == nil {
		t.Fatal("unsupported batch accepted")
	}
	inputs, outputs, err := imageBillingReservation(ModelRequestIntent{Capability: "image", Inputs: map[string]int{"image": 1}, Options: map[string]any{"layerDecomposition": true, "maxImages": 10}})
	if err != nil || inputs != 1 || outputs != 10 {
		t.Fatalf("reservation=%d/%d err=%v", inputs, outputs, err)
	}
	if _, _, err := imageBillingReservation(ModelRequestIntent{Capability: "image", Inputs: map[string]int{"image": 2}, Options: map[string]any{"layerDecomposition": true}}); err == nil {
		t.Fatal("multiple layer inputs accepted")
	}
	encoded, err := json.Marshal(quoteFromOrder("", &model.BillingOrder{BillingMode: "image_usage", ImageInputImages: 1, ImageMaxOutputImages: 10}, tokenBillingEstimate{}))
	if err != nil || len(encoded) == 0 {
		t.Fatal(err)
	}
}

func TestImageBillingOfficialCapabilityKeepsLowResolutionPresets(t *testing.T) {
	s, _ := imageBillingService(t)
	defaults := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceVolcengineArkImage), seedream55Model)
	config, err := NormalizeModelCapabilityConfigForModel("image", string(model.ChannelInterfaceVolcengineArkImage), seedream55Model, defaults, s.protocolRegistry())
	if err != nil {
		t.Fatal(err)
	}
	if config.Image.MaxOutputs != 1 || config.Image.References.MaxImages != 10 || len(config.Image.Size.Presets) != 24 {
		t.Fatalf("image capability=%#v", config.Image)
	}
	names := map[string]bool{}
	for _, parameter := range config.Image.Parameters {
		names[parameter.Name] = true
	}
	if !names["imageResolution"] || !names["layerDecomposition"] || !names["maxImages"] {
		t.Fatalf("parameters=%#v", config.Image.Parameters)
	}
}

func TestImageBillingCostUsesIndependentSnapshotAndIsPrivate(t *testing.T) {
	s, db := imageBillingService(t)
	var tier model.ChannelModelPriceTier
	if err := db.First(&tier, "id = ?", "image-tier").Error; err != nil {
		t.Fatal(err)
	}
	tier.CostPricing = model.CreditCostPricing{Configured: true, ImagePricing: &model.ImagePricing{InputPriceMicrocredits: 10_000, OutputTiers: []model.ImagePriceTier{{UnitPriceMicrocredits: 20_000}}}}
	if err := db.Save(&tier).Error; err != nil {
		t.Fatal(err)
	}
	intent := ModelRequestIntent{Capability: "image", Inputs: map[string]int{"image": 1}, Options: map[string]any{"count": 1}}
	order, err := s.newBillingOrderWithPriceTier("image-user", "", "cost-snapshot", "image-channel", seedream55Model, "image", "test", 1, tokenBillingEstimate{}, tier.ID, intent)
	if err != nil {
		t.Fatal(err)
	}
	order.Status = model.BillingStatusSettled
	order.ImageUsage = &model.ImageBillingUsage{InputImages: 1, Outputs: []model.ImageOutputUsage{{Width: 1536, Height: 1536}}}
	order.MultiplierBasisPoints = 20_000
	cost, err := billingCreditCost(*order)
	if err != nil || cost == nil || *cost != 30_000 {
		t.Fatalf("cost=%v err=%v", cost, err)
	}
	raw, err := json.Marshal(order)
	if err != nil {
		t.Fatal(err)
	}
	var public map[string]any
	if err := json.Unmarshal(raw, &public); err != nil {
		t.Fatal(err)
	}
	if public["costPricing"] != nil || public["costImagePricing"] != nil {
		t.Fatal("internal cost exposed")
	}
}
