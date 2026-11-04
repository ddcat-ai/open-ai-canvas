package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestCloudAgentVideoOperationFollowsModelContract(t *testing.T) {
	i2v := []string{"text_to_video", "image_to_video"}
	r2v := []string{"text_to_video", "reference_to_video"}
	all := []string{"text_to_video", "image_to_video", "reference_to_video", "audio_to_video"}
	for _, tc := range []struct {
		name                  string
		operations            []string
		defaultOperation      string
		images, videos, audio int
		want                  string
	}{
		{name: "no_reference", operations: all, want: "text_to_video"},
		{name: "image_prefers_reference_mode", operations: all, images: 2, want: "reference_to_video"},
		{name: "image_reference_only_model", operations: r2v, images: 1, want: "reference_to_video"},
		{name: "image_first_frame_only_model_keeps_old_behavior", operations: i2v, images: 1, want: "image_to_video"},
		{name: "default_operation_wins_when_it_fits", operations: all, defaultOperation: "image_to_video", images: 1, want: "image_to_video"},
		{name: "default_operation_ignored_when_it_does_not_fit", operations: all, defaultOperation: "text_to_video", images: 1, want: "reference_to_video"},
		{name: "video_needs_reference_mode", operations: i2v, videos: 1, want: ""},
		{name: "video_reference", operations: r2v, videos: 1, images: 1, want: "reference_to_video"},
		{name: "audio_prefers_audio_mode", operations: all, audio: 1, want: "audio_to_video"},
		{name: "audio_falls_back_to_reference_mode", operations: r2v, audio: 1, want: "reference_to_video"},
		// 逻辑模型未声明操作表示不限制，不能因此从目录消失或被拒绝。
		{name: "unrestricted_model_without_reference", want: "text_to_video"},
		{name: "unrestricted_model_with_image", images: 1, want: "reference_to_video"},
		{name: "unrestricted_model_with_video", videos: 1, want: "reference_to_video"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := cloudAgentVideoOperation(tc.operations, tc.defaultOperation, tc.images, tc.videos, tc.audio); got != tc.want {
				t.Fatalf("operation = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestCloudAgentVideoCatalogMatchesOnlyFiltersVideoIntent(t *testing.T) {
	if !cloudAgentVideoCatalogMatches(nil, []string{"image_to_video"}, "") {
		t.Fatal("no intent must not filter")
	}
	image := &ModelRequestIntent{Capability: "image", Inputs: map[string]int{"video": 1}}
	if !cloudAgentVideoCatalogMatches(image, []string{"image_to_video"}, "") {
		t.Fatal("non-video intent must not filter")
	}
	video := &ModelRequestIntent{Capability: "video", Inputs: map[string]int{"video": 1}}
	if cloudAgentVideoCatalogMatches(video, []string{"text_to_video", "image_to_video"}, "") {
		t.Fatal("a model without reference_to_video cannot take a reference video")
	}
	if !cloudAgentVideoCatalogMatches(video, nil, "") {
		t.Fatal("a logical model without declared operations is unrestricted")
	}
}

// 回归 #932：只支持 reference_to_video 的模型原来会因硬编码 image_to_video 被目录过滤掉、提交时被拒。
func TestCloudAgentReferenceOnlyVideoModelIsListedAndResolved(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	config := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceVolcengineArkVideo), "reference-only")
	config.Video.Operations = []string{"text_to_video", "reference_to_video"}
	config.Video.DefaultOperation = "text_to_video"
	if err := db.Create(&model.ChannelModel{ID: "reference-only", ChannelID: "channel", ModelKey: "reference-only", Capability: "video", Protocol: model.ChannelInterfaceVolcengineArkVideo, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, config), BillingMode: "per_second", PriceConfigured: true, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ChannelModelPriceTier{ID: "reference-only-tier", ChannelModelID: "reference-only", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "per_second", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	intent, err := s.cloudAgentModelIntent("user", "agent-canvas", `{"mode":"video","referenceNodeIds":["hero","cat"]}`)
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := s.cloudAgentModelList(testGroupUserID(s), intent)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(catalog)
	if !strings.Contains(string(encoded), `"channelModelKey":"reference-only"`) {
		t.Fatalf("reference-only model missing from catalog: %s", encoded)
	}
	a.ChannelModelKey = "reference-only"
	refs := map[string]any{"referenceImages": []any{map[string]any{}, map[string]any{}}}
	if operation, err := s.resolveCloudAgentMediaOperation(a, refs); err != nil || operation != "reference_to_video" {
		t.Fatalf("operation = %q, %v", operation, err)
	}
	a.VideoStartFrameNodeID = "hero"
	if operation, err := s.resolveCloudAgentMediaOperation(a, refs); err != nil || operation != "image_to_video" {
		t.Fatalf("explicit frames must stay image_to_video: %q, %v", operation, err)
	}
}
