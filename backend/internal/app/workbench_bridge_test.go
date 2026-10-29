package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/workbench"
)

func TestCreateWorkbenchVideoTaskUsesReferenceModeAndPrice(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceMiniMaxVideo), "MiniMax-H3")
	profile.Video.Operations = []string{"text_to_video", "image_to_video", "reference_to_video", "audio_to_video"}
	profile.Video.References.MaxImages = 2
	profile.Video.Resolutions = []string{"480P"}
	profile.Video.DefaultResolution = "480P"
	capabilityJSON, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	for _, record := range []any{
		&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"videoWorkbenchEnabled":true}`},
		&model.ChannelModel{ID: "video-model", ChannelID: "channel", ModelKey: "MiniMax-H3", Capability: "video", Protocol: model.ChannelInterfaceMiniMaxVideo, Enabled: true, CapabilityConfigJSON: string(capabilityJSON)},
		&model.ChannelModelPriceTier{ID: "video-text-price", ChannelModelID: "video-model", SelectorKey: `{"operation":"text_to_video"}`, SelectorJSON: `{"operation":"text_to_video"}`, BillingMode: "fixed_request", UnitPriceMicrocredits: 10, PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "video-image-price", ChannelModelID: "video-model", SelectorKey: `{"operation":"image_to_video"}`, SelectorJSON: `{"operation":"image_to_video"}`, BillingMode: "fixed_request", UnitPriceMicrocredits: 20, PriceConfigured: true, Enabled: true},
		&model.Resource{ID: "video-image", UserID: "user", Kind: "image", Status: model.ResourceStatusReady},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		name, role, operation, price string
	}{
		{name: "text", operation: "text_to_video", price: "video-text-price"},
		{name: "first frame", role: "first_frame", operation: "image_to_video", price: "video-image-price"},
		{name: "reference image", role: "reference", operation: "reference_to_video", price: "video-image-price"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := WorkbenchTaskInput{Kind: WorkbenchKindVideo, Prompt: "Animate the subject", Model: "MiniMax-H3", ChannelID: "channel", Parameters: map[string]any{"resolution": "480P", "ratio": "16:9", "seconds": 15}}
			if tc.role != "" {
				req.References = []workbench.TaskReference{{ResourceID: "video-image", Kind: "image", Role: tc.role}}
			}
			resolved, err := s.workbenchDomain().ResolveTask("user", req)
			if err != nil {
				t.Fatal(err)
			}
			config, err := s.resolveWorkbenchProviderConfig(testGroupUserID(s), req.Kind, resolved.Operation, resolved.Model, resolved.LogicalModelID, resolved.ChannelID, resolved.Parameters, resolved.Input)
			if err != nil || config["priceTierId"] != tc.price {
				t.Fatalf("pre-admission config = %v, error = %v, want price %q", config, err, tc.price)
			}
			task, err := s.CreateWorkbenchTask("user", req, "", "")
			if err != nil {
				t.Fatal(err)
			}
			var input struct {
				Metadata struct {
					Operation string `json:"videoEditOperation"`
				} `json:"metadata"`
			}
			if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
				t.Fatal(err)
			}
			if task.Operation != tc.operation || input.Metadata.Operation != tc.operation {
				t.Fatalf("task operation = %q, input = %+v", task.Operation, input)
			}
			var execution canvasGenerationInput
			var stored model.Task
			if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal([]byte(stored.InputJSON), &execution); err != nil {
				t.Fatal(err)
			}
			for index := range execution.ReferenceImages {
				execution.ReferenceImages[index].URL = "https://media.example/frame.png"
			}
			providerRequest := protocolRequestFromInput(execution)
			if providerRequest.Operation != tc.operation {
				t.Fatalf("provider operation = %q, want %q", providerRequest.Operation, tc.operation)
			}
			if tc.role != "" {
				wantRole := tc.role
				if tc.role == "reference" {
					wantRole = "reference_image"
				}
				if len(providerRequest.Images) != 1 || providerRequest.Images[0].Role != wantRole {
					t.Fatalf("provider images = %+v, want role %q", providerRequest.Images, wantRole)
				}
			}
			var order model.BillingOrder
			if err := db.First(&order, "id = ?", task.BillingOrderID).Error; err != nil || order.PriceTierID != tc.price {
				t.Fatalf("billing price = %q, error = %v, want %q", order.PriceTierID, err, tc.price)
			}
		})
	}
	// An image-to-video-only model must still reject an ordinary reference image.
	profile.Video.Operations = []string{"image_to_video"}
	capabilityJSON, _ = json.Marshal(profile)
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "video-model").Update("capability_config_json", string(capabilityJSON)).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateWorkbenchTask("user", WorkbenchTaskInput{Kind: WorkbenchKindVideo, Prompt: "Animate", Model: "MiniMax-H3", ChannelID: "channel", References: []workbench.TaskReference{{ResourceID: "video-image", Kind: "image", Role: "reference"}}}, "", ""); err == nil {
		t.Fatal("unsupported reference mode must fail admission")
	}
	var count int64
	if err := db.Model(&model.Task{}).Count(&count).Error; err != nil || count != 3 {
		t.Fatalf("task count = %d, error = %v; rejected input must not create a task", count, err)
	}
	if err := db.Model(&model.BillingOrder{}).Count(&count).Error; err != nil || count != 3 {
		t.Fatalf("order count = %d, error = %v; rejected input must not create a billing order", count, err)
	}
}

func TestResolveWorkbenchProviderConfigMapsWorkbenchParameters(t *testing.T) {
	service := &Service{}

	image, err := service.resolveWorkbenchProviderConfig(testGroupUserID(service), WorkbenchKindImage, "image", "image-model", "logical-image", "", map[string]any{
		"size": "1024x1024", "quality": "high", "imageResolution": "2k", "count": 2,
	}, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]any{"model": "image-model", "size": "1024x1024", "quality": "high", "imageResolution": "2k", "count": "2"} {
		if image[key] != want {
			t.Errorf("image config[%q] = %#v, want %#v", key, image[key], want)
		}
	}

	video, err := service.resolveWorkbenchProviderConfig(testGroupUserID(service), WorkbenchKindVideo, "text_to_video", "video-model", "logical-video", "", map[string]any{
		"seconds": 8, "ratio": "9:16", "resolution": "1080P", "generateAudio": true, "watermark": false,
	}, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]any{
		"model": "video-model", "videoSeconds": "8", "size": "9:16", "vquality": "1080P",
		"videoGenerateAudio": "true", "videoWatermark": "false",
	} {
		if video[key] != want {
			t.Errorf("video config[%q] = %#v, want %#v", key, video[key], want)
		}
	}
}
