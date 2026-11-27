package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestSharedMediaToolsQuoteResolvesChannelFPSDefaults(t *testing.T) {
	for _, policy := range []string{VideoProcessingFPSKeepSource, VideoProcessingFPSUserSelect} {
		t.Run(policy, func(t *testing.T) {
			s, db, _, profile := sharedMediaToolFixture(t, "enhance")
			profile.Video.Processing.FPSPolicy = policy
			if policy == VideoProcessingFPSKeepSource {
				profile.Video.Processing.FPSOptions = nil
			}
			if err := db.Model(&model.ChannelModel{}).Where("id = ?", "processing-cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, profile)).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", "processing-tier").Update("selector_json", `{"operation":"enhance","vquality":"1080p","fpsBand":"le30"}`).Error; err != nil {
				t.Fatal(err)
			}
			quote, err := s.QuoteChannelModel("user", ChannelModelQuoteRequest{ChannelID: "channel", ModelKey: "processing", Intent: ModelRequestIntent{Capability: "video", Operation: "enhance", Inputs: map[string]int{"video": 1}, Options: map[string]any{"videoSeconds": 13, "vquality": "1080p"}}})
			if err != nil {
				t.Fatalf("省略帧率的合法增强报价失败: %v", err)
			}
			if quote.Quantity != 13 {
				t.Fatalf("报价丢失源视频时长: %+v", quote)
			}
		})
	}
}
