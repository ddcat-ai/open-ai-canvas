package app

import (
	"encoding/json"
	"testing"
	"yingce/backend/internal/model"
)

func TestSharedMediaToolsLogicalRouteChecksExactFPS(t *testing.T) {
	s, db, args, profile := sharedMediaToolFixture(t, "enhance")
	profile.Video.Processing.FPSOptions = []int{24}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "processing-cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, profile)).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", "processing-tier").Update("selector_json", `{"operation":"enhance","vquality":"1080p","fpsBand":"le30"}`).Error; err != nil {
		t.Fatal(err)
	}
	var second model.ChannelModel
	if err := db.First(&second, "id = ?", "processing-cm").Error; err != nil {
		t.Fatal(err)
	}
	second.ID, second.ModelKey = "second-cm", "processing-30"
	profile.Video.Processing.FPSOptions = []int{30}
	second.CapabilityConfigJSON = mustEncodeModelCapabilityConfig(t, profile)
	if err := db.Create(&second).Error; err != nil {
		t.Fatal(err)
	}
	tier := newSelectionPriceTier("second-tier", `{"operation":"enhance","vquality":"1080p","fpsBand":"le30"}`, "", "per_second")
	tier.ChannelModelID = second.ID
	tier.UnitPriceMicrocredits = 1
	if err := db.Create(&tier).Error; err != nil {
		t.Fatal(err)
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(profile, "video")
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(spec)
	lm := model.LogicalModel{ID: "processing-logical", Code: "processing-logical", Capability: "video", Enabled: true, ActiveRevisionID: "processing-revision", PricePolicy: "channel"}
	for _, row := range []any{&lm, &model.LogicalModelRevision{ID: lm.ActiveRevisionID, LogicalModelID: lm.ID, Version: 1, CapabilitySpecJSON: string(encoded), DefaultOptionsJSON: `{}`}, &model.LogicalModelRoute{ID: "unsupported-first", LogicalModelRevisionID: lm.ActiveRevisionID, ChannelModelID: "processing-cm", Enabled: true, Weight: 1, Priority: 10}, &model.LogicalModelRoute{ID: "supported-second", LogicalModelRevisionID: lm.ActiveRevisionID, ChannelModelID: second.ID, Enabled: true, Weight: 1, Priority: 1}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	features := defaultFeatureAvailability()
	features.FrontendModelsEnabled = true
	if _, err := s.UpdateFeatureAvailability(&model.User{ID: "admin", Role: model.UserRoleAdmin}, features); err != nil {
		t.Fatal(err)
	}
	args.LogicalModelID, args.ChannelID, args.ChannelModelKey = lm.ID, "", ""
	fps := 30
	args.ProcessingParameters.FPS = &fps
	intent := ModelRequestIntent{Capability: "video", Operation: "enhance", Inputs: map[string]int{"video": 1}, Options: map[string]any{"videoSeconds": 13, "vquality": "1080p"}, ProcessingParameters: args.ProcessingParameters}
	quote, err := s.QuoteLogicalModel("user", lm.ID, intent)
	if err != nil || quote.AmountMicrocredits != 13 {
		t.Fatalf("报价没有使用支持精确帧率的渠道及价格: %+v %v", quote, err)
	}
	if _, err := s.QuoteChannelModel("user", ChannelModelQuoteRequest{ChannelID: "channel", ModelKey: "processing", Intent: intent}); err == nil {
		t.Fatal("只允许 24 FPS 的直连渠道接受了 30 FPS 报价")
	}
	run, state := agentMediaRun(t, s, args, "auto")
	req, _, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(args))
	if err != nil {
		t.Fatal(err)
	}
	req.creationPrepare = &creationTaskPreparation{}
	task, err := s.CreateTask("user", req)
	if err != nil {
		t.Fatalf("有支持 30 FPS 的有效路由却选中 24 FPS 路由: %v", err)
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if input["config"].(map[string]any)["channelModelKey"] != second.ModelKey {
		t.Fatalf("任务没有选择支持精确帧率的渠道: %s", task.InputJSON)
	}
	fps = 25
	if _, err := s.QuoteLogicalModel("user", lm.ID, intent); err == nil {
		t.Fatal("不存在支持 25 FPS 的渠道时应拒绝报价")
	}
}
