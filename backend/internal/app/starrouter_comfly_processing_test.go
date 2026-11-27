package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestStarRouterComflyProcessingConfigRejectsIncompatibleWorkflow(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, provider := range []string{"starrouter-comfly-video-subtitle-removal", "starrouter-comfly-video-depth", "starrouter-comfly-video-upscale"} {
		t.Run(provider, func(t *testing.T) {
			for _, test := range []struct {
				name string
				edit func(*VideoCapabilityConfig)
			}{
				{"default_operation", func(v *VideoCapabilityConfig) {
					v.Operations = []string{"text_to_video"}
					v.DefaultOperation = "text_to_video"
				}},
				{"extra_operation", func(v *VideoCapabilityConfig) { v.Operations = append(v.Operations, "text_to_video") }},
				{"missing_processing", func(v *VideoCapabilityConfig) { v.Processing = nil }},
				{"output_resolution", func(v *VideoCapabilityConfig) { v.Resolutions = []string{"1080p"}; v.DefaultResolution = "1080p" }},
				{"output_ratio", func(v *VideoCapabilityConfig) { v.Ratios = []string{"16:9"}; v.DefaultRatio = "16:9" }},
				{"output_fps", func(v *VideoCapabilityConfig) {
					v.Processing.FPSPolicy = VideoProcessingFPSUserSelect
					v.Processing.FPSOptions = []int{30}
				}},
			} {
				t.Run(test.name, func(t *testing.T) {
					profile := DefaultModelCapabilityConfigForModel(provider, "alias")
					test.edit(profile.Video)
					if _, err := NormalizeModelCapabilityConfigForModel("video", provider, "alias", profile, center.registrySnapshot()); err == nil {
						t.Fatal("accepted incompatible workflow configuration")
					}
				})
			}
			profile := DefaultModelCapabilityConfigForModel(provider, "alias")
			profile.Video.Processing.MaxSourceSeconds = 60
			if _, err := NormalizeModelCapabilityConfigForModel("video", provider, "alias", profile, center.registrySnapshot()); err != nil {
				t.Fatalf("valid processing budget rejected: %v", err)
			}
		})
	}
}

func TestStarRouterComflyProcessingCapabilitiesAndAdmission(t *testing.T) {
	for _, test := range []struct{ provider, operation string }{
		{"starrouter-comfly-video-subtitle-removal", "remove_subtitles"},
		{"starrouter-comfly-video-depth", "depth"},
		{"starrouter-comfly-video-upscale", "upscale"},
	} {
		t.Run(test.operation, func(t *testing.T) {
			profile := DefaultModelCapabilityConfigForModel(test.provider, "alias")
			if err := validateVideoCapabilityConfig(profile.Video); err != nil {
				t.Fatal(err)
			}
			spec, err := CapabilitySpecFromModelCapabilityConfig(profile, "video")
			if err != nil || len(spec.Operations) != 1 || spec.Operations[0] != test.operation || profile.Video.References.MaxVideoBytes != 100*1024*1024 {
				t.Fatalf("spec=%#v profile=%#v err=%v", spec, profile, err)
			}
			for _, key := range []string{"vquality", "size", "fpsBand"} {
				if _, exists := spec.Options[key]; exists {
					t.Fatalf("unexpected processing option=%s", key)
				}
			}
			selector := skuSelectorForIntent(ModelRequestIntent{Capability: "video", Operation: test.operation, Inputs: map[string]int{"video": 1}})
			if selector["operation"] != test.operation {
				t.Fatalf("selector=%#v", selector)
			}
			s, db, channel, cm := createSystemChannelSelectionFixture(t, "video", model.ChannelInterfaceType(test.provider), profile, []model.ChannelModelPriceTier{
				newSelectionPriceTier(test.operation, `{"operation":"`+test.operation+`"}`, "", "per_second"),
			})
			if err := db.AutoMigrate(&model.Resource{}); err != nil {
				t.Fatal(err)
			}
			center, err := newPluginRuntime(s.dataDir)
			if err != nil {
				t.Fatal(err)
			}
			s.pluginRuntime = center
			published, err := s.repo.ChannelModelByID(channel.ID, cm.ID)
			if err != nil {
				t.Fatal(err)
			}
			public, err := s.sanitizeChannelModel(published)
			if err != nil || !public.Available {
				t.Fatalf("processing model missing from public catalog: %#v err=%v", public, err)
			}
			for _, key := range []string{"vquality", "size", "fpsBand"} {
				if _, exists := public.DefaultOptions[key]; exists {
					t.Fatalf("processing catalog published unsupported default %s", key)
				}
			}
			owner := testGroupUserID(s)
			if err := db.Create(&model.Resource{ID: "source", UserID: owner, Status: "ready", MimeType: "video/mp4", Width: 3840, Height: 2160, Size: 1024, DurationMs: 12_500}).Error; err != nil {
				t.Fatal(err)
			}
			inputFor := func(key string) map[string]any {
				return map[string]any{
					"mode":              "video",
					"config":            map[string]any{"channelId": channel.ID, "model": cm.ModelKey, "videoSeconds": "1", "vquality": "4k", "size": "1:1", "fpsBand": "le120"},
					"capabilityOptions": map[string]any{"videoSeconds": 1, "vquality": "4k", "fpsBand": "le120"},
					"referenceVideos":   []any{map[string]any{"storageKey": key, "durationMs": 1}},
					"metadata":          map[string]any{"videoEditOperation": "enhance", "providerOptions": map[string]any{test.provider: map[string]any{"fps": 120, "input_video": "https://other.example/video.mp4"}}},
				}
			}
			input := inputFor("resource:source")
			admission, err := s.prepareVideoProcessingTask(owner, input)
			if err != nil || admission == nil {
				t.Fatalf("admission=%#v err=%v", admission, err)
			}
			config := input["config"].(map[string]any)
			metadata := input["metadata"].(map[string]any)
			options := metadata["providerOptions"].(map[string]any)
			if config["videoSeconds"] != "13" || metadata["videoEditOperation"] != test.operation || len(options[test.provider].(map[string]any)) != 0 {
				t.Fatalf("input=%#v", input)
			}
			for _, bag := range []map[string]any{config, input["capabilityOptions"].(map[string]any)} {
				for _, key := range []string{"vquality", "fpsBand", "size"} {
					if _, exists := bag[key]; exists {
						t.Fatalf("unexpected parameter=%s", key)
					}
				}
			}
			if _, err := s.prepareVideoProcessingTask("other-user", inputFor("resource:source")); err == nil {
				t.Fatal("accepted foreign source")
			}
			if input["referenceVideos"].([]any)[0].(map[string]any)["bytes"] != int64(1024) {
				t.Fatal("source size must come from owned resource")
			}
			if err := db.Model(&model.Resource{}).Where("id = ?", "source").Update("size", 100*1024*1024+1).Error; err != nil {
				t.Fatal(err)
			}
			if _, err := s.prepareVideoProcessingTask(owner, inputFor("resource:source")); err == nil {
				t.Fatal("accepted oversized resource with omitted client size")
			}
		})
	}
}
