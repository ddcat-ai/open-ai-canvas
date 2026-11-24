package app

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func commonImageEndpointAdapter(t *testing.T, id, path string, fields []protocol.ImageParameter) protocol.Adapter {
	t.Helper()
	manifest := map[string]any{
		"apiVersion": "yingce.plugin/v2", "id": id, "version": "1.0.0", "name": id, "author": "Test", "documentation": "# Fixture",
		"contributes": map[string]any{"providers": []any{map[string]any{
			"id": id, "label": id, "capabilities": []string{"image"}, "scopes": []string{"canvas"}, "imageParameters": fields,
			"create":   map[string]any{"method": "POST", "path": path, "contentType": "application/json", "body": map[string]any{"model": map[string]any{"$ref": "request.model"}}},
			"response": map[string]any{"taskIdPaths": []string{"id"}},
		}}},
	}
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	adapter, err := protocol.LoadManifest(data)
	if err != nil {
		t.Fatal(err)
	}
	return adapter
}

func TestCommonImageMissingDeclarationsUseTargetEncodingAcrossProtocolChanges(t *testing.T) {
	resolution := protocol.ImageParameter{Name: "imageResolution", Label: "分辨率", Type: "string", Binding: "resolution", Values: []any{"2k"}, Default: "2k"}
	for _, shape := range []string{"nil", "empty", "missing-size", "missing-encoding"} {
		for _, pixelsToRatio := range []bool{true, false} {
			for _, mode := range []string{"single", "batch"} {
				t.Run(fmt.Sprintf("%s/pixelsToRatio=%t/%s", shape, pixelsToRatio, mode), func(t *testing.T) {
					sourcePath, targetPath := "/v1/images/generations", "/v1beta/models/fixture:generateContent"
					sourceEncoding, targetEncoding, size, outbound := "pixels", "ratio", "2560x1440", "16:9"
					if !pixelsToRatio {
						sourcePath, targetPath = targetPath, sourcePath
						sourceEncoding, targetEncoding, size, outbound = targetEncoding, sourceEncoding, outbound, size
					}
					fields := []protocol.ImageParameter{{Name: "size", Label: "尺寸", Type: "string", Binding: "aspectRatio", Encoding: sourceEncoding, Values: []any{size}, Default: size}, resolution}
					var targetFields []protocol.ImageParameter
					if shape == "empty" {
						targetFields = []protocol.ImageParameter{}
					}
					if shape == "missing-size" {
						targetFields = []protocol.ImageParameter{resolution}
					}
					if shape == "missing-encoding" {
						sizeField := fields[0]
						sizeField.Encoding = ""
						targetFields = []protocol.ImageParameter{sizeField, resolution}
					}
					source, target := commonImageEndpointAdapter(t, "source-fixture", sourcePath, fields), commonImageEndpointAdapter(t, "target-fixture", targetPath, targetFields)
					registry, err := protocol.NewRegistry(source, target)
					if err != nil {
						t.Fatal(err)
					}
					svc, _, admin := seedBatchUpdates(t)
					svc.pluginRuntime = &pluginRuntime{registry: registry}
					profile := DefaultModelCapabilityConfigForModel("openai-image", "fixture")
					profile.Image.Parameters = fields
					profile.Image.Size.Presets = []ImageSizePreset{{Tier: "2k", Ratio: "16:9", Size: "2560x1440", Width: 2560, Height: 1440}}
					profile.Image.References.MaxImageBytes = 10 * 1024 * 1024
					req := ChannelModelRequest{ModelKey: "fixture", ProviderModelKey: "fixture", Capability: "image", Protocol: "source-fixture", CapabilityConfig: profile, Enabled: batchBool(true),
						PriceTiers: []ChannelModelPriceTierRequest{{Selector: map[string]string{"size": size, "imageResolution": "2k"}, BillingMode: "fixed_request", PriceConfigured: true, UnitPriceMicrocredits: 12345, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 7000}}}}
					saved, err := svc.SaveAdminChannelModel(admin, "channel", "", req)
					if err != nil {
						t.Fatal(err)
					}
					if mode == "single" {
						req.Protocol, req.ExpectedUpdatedAt, req.ExpectedPriceVersion = "target-fixture", saved.UpdatedAt, saved.PriceVersion
						_, err = svc.SaveAdminChannelModel(admin, "channel", saved.ID, req)
					} else {
						_, err = svc.BatchUpdateAdminChannelModels(admin, "channel", []BatchChannelModelUpdate{batchRequest(t, svc, saved.ID, BatchChannelModelChanges{Protocol: batchText("target-fixture")})})
					}
					if err != nil {
						t.Fatal(err)
					}
					item, err := svc.repo.ChannelModelByID("channel", saved.ID)
					if err != nil {
						t.Fatal(err)
					}
					readback, err := normalizedChannelModelCapability(item, registry)
					if err != nil {
						t.Fatal(err)
					}
					if !reflect.DeepEqual(item.PriceTiers[0].Selector, saved.PriceTiers[0].Selector) || item.PriceTiers[0].UnitPriceMicrocredits != 12345 || item.PriceTiers[0].CostPricing.UnitPriceMicrocredits != 7000 {
						t.Fatal("pricing changed")
					}
					if !reflect.DeepEqual(readback.Image.Size.Values, []string{size}) || readback.Image.Size.Default != size || !reflect.DeepEqual(readback.Image.Size.Presets, profile.Image.Size.Presets) || readback.Image.References.MaxImageBytes != 10*1024*1024 {
						t.Fatal("capability or preset changed")
					}
					for _, field := range readback.Image.Parameters {
						if field.Name == "size" && field.Encoding != targetEncoding {
							t.Fatalf("target encoding = %q", field.Encoding)
						}
					}
					quote, err := svc.QuoteChannelModel(testGroupUserID(svc), ChannelModelQuoteRequest{ChannelID: "channel", ModelKey: "fixture", Intent: ModelRequestIntent{Capability: "image", Options: map[string]any{"size": size, "imageResolution": "2k"}}})
					if err != nil || quote.AmountMicrocredits != 12345 {
						t.Fatalf("quote: %#v %v", quote, err)
					}
					config := providerConfig{Model: "fixture", InterfaceType: "target-fixture", Size: size, ImageResolution: "2k"}
					if err := applyImageParameterValues(&config, readback.Image); err != nil {
						t.Fatal(err)
					}
					created, err := target.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(canvasGenerationInput{Mode: "image", Prompt: "fixture", Config: config})})
					if err != nil {
						t.Fatal(err)
					}
					body := created.Body.(map[string]any)
					if pixelsToRatio {
						image := body["generationConfig"].(map[string]any)["imageConfig"].(map[string]any)
						if image["aspectRatio"] != outbound || image["imageSize"] != "2K" {
							t.Fatalf("wrong ratio body: %#v", body)
						}
					} else if body["size"] != outbound || body["resolution"] != nil || body["imageResolution"] != nil {
						t.Fatalf("wrong pixel body: %#v", body)
					}
				})
			}
		}
	}
}

func TestCommonImagePixelConfigurationUsesRatioTransportWithoutLosingLimits(t *testing.T) {
	adapter := imageParameterTestAdapter(t, "google-gemini-image", "gemini-image")
	registry, err := protocol.NewRegistry(adapter)
	if err != nil {
		t.Fatal(err)
	}
	profile := DefaultModelCapabilityConfigForModel("openai-image", "fixture")
	maximum := 4.0
	profile.Image.Size = ImageSizeConfig{Parameter: "size", Values: []string{"2752x1536"}, Default: "2752x1536", DefaultTier: "2k", Presets: []ImageSizePreset{{Tier: "2k", Ratio: "16:9", Size: "2752x1536", Width: 2752, Height: 1536}}}
	profile.Image.Parameters = []protocol.ImageParameter{
		{Name: "size", Type: "string", Values: []any{"2752x1536"}, Default: "2752x1536", Encoding: "pixels"},
		{Name: "imageResolution", Type: "string", Values: []any{"2k"}, Default: "2k"},
		{Name: "count", Type: "integer", Max: &maximum, Default: 1},
	}
	profile.Image.MaxOutputs = 4
	resolved, err := NormalizeModelCapabilityConfigForModel("image", "gemini-image", "fixture", profile, registry)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Image.MaxOutputs != 4 || resolved.Image.Size.Parameter != "size" || !reflect.DeepEqual(resolved.Image.Size.Values, []string{"2752x1536"}) {
		t.Fatalf("configured limits changed: %#v", resolved.Image)
	}
	config := providerConfig{Model: "fixture", InterfaceType: "gemini-image", Size: "2752x1536", ImageResolution: "2k", Count: "1"}
	if err := applyImageParameterValues(&config, resolved.Image); err != nil {
		t.Fatal(err)
	}
	spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(canvasGenerationInput{Mode: "image", Prompt: "fixture", Config: config})})
	if err != nil {
		t.Fatal(err)
	}
	body := spec.Body.(map[string]any)
	image := body["generationConfig"].(map[string]any)["imageConfig"].(map[string]any)
	if image["aspectRatio"] != "16:9" || image["imageSize"] != "2K" {
		t.Fatalf("ratio transport: %#v", body)
	}
}
