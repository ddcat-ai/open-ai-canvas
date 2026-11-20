package app

import (
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

const batchProtocolTextConfig = `{"version":1,"text":{"streaming":true,"contextWindowTokens":128000,"maxOutputTokens":16384,"references":{"promptMaxChars":32000}}}`

func seedBatchProtocolModels(t *testing.T) (*Service, *gorm.DB, *model.User) {
	t.Helper()
	svc, db, admin := seedRepricingModels(t)
	if err := db.AutoMigrate(&model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id IN ?", []string{"a", "b"}).Update("capability_config_json", batchProtocolTextConfig).Error; err != nil {
		t.Fatal(err)
	}
	return svc, db, admin
}

func TestUpdateAdminChannelModelsProtocolSwitchesWholeSelection(t *testing.T) {
	svc, _, admin := seedBatchProtocolModels(t)
	updated, err := svc.UpdateAdminChannelModelsProtocol(admin, "channel", []string{"a", "b", "a"}, string(model.ChannelInterfaceOpenAIResponse))
	if err != nil || updated != 2 {
		t.Fatalf("updated=%d err=%v", updated, err)
	}
	for _, id := range []string{"a", "b"} {
		item, err := svc.repo.ChannelModelByID("channel", id)
		if err != nil {
			t.Fatal(err)
		}
		if item.Protocol != model.ChannelInterfaceOpenAIResponse || item.PriceVersion != 1 || item.PriceTiers[0].UnitPriceMicrocredits != 9 {
			t.Fatalf("model=%+v", item)
		}
	}
}

func TestUpdateAdminChannelModelsProtocolRejectsWholeBatch(t *testing.T) {
	for _, tt := range []struct {
		name     string
		ids      []string
		protocol string
		nonAdmin bool
	}{
		{name: "capability mismatch", ids: []string{"a", "b"}, protocol: string(model.ChannelInterfaceOpenAIImage)},
		{name: "unknown protocol", ids: []string{"a"}, protocol: "missing-protocol"},
		{name: "missing model", ids: []string{"a", "ghost"}, protocol: string(model.ChannelInterfaceOpenAIResponse)},
		{name: "empty", ids: []string{" "}, protocol: string(model.ChannelInterfaceOpenAIResponse)},
		{name: "not admin", ids: []string{"a"}, protocol: string(model.ChannelInterfaceOpenAIResponse), nonAdmin: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			svc, _, actor := seedBatchProtocolModels(t)
			if tt.nonAdmin {
				actor = &model.User{ID: "user"}
			}
			if count, err := svc.UpdateAdminChannelModelsProtocol(actor, "channel", tt.ids, tt.protocol); err == nil || count != 0 {
				t.Fatalf("count=%d err=%v", count, err)
			}
			item, err := svc.repo.ChannelModelByID("channel", "a")
			if err != nil {
				t.Fatal(err)
			}
			if item.Protocol != model.ChannelInterfaceChatCompletion {
				t.Fatal("partial protocol update")
			}
		})
	}
}

func TestRepriceAdminAllChannelModelsAcrossChannels(t *testing.T) {
	svc, db, admin := seedRepricingModels(t)
	if err := db.Create(&model.ModelChannel{ID: "second", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "b").Update("channel_id", "second").Error; err != nil {
		t.Fatal(err)
	}
	requests := []ChannelModelRepriceRequest{repricingRequest("a", 1_250_000), repricingRequest("b", 1_370_000)}
	if updated, err := svc.RepriceAdminAllChannelModels(admin, requests); err != nil || updated != 2 {
		t.Fatalf("updated=%d err=%v", updated, err)
	}
	for channelID, id := range map[string]string{"channel": "a", "second": "b"} {
		item, err := svc.repo.ChannelModelByID(channelID, id)
		if err != nil {
			t.Fatal(err)
		}
		if item.PriceVersion != 2 || item.PriceTiers[0].UnitPriceMicrocredits != *requestsByID(requests)[id].PriceTiers[0].Prices["unitPriceMicrocredits"] {
			t.Fatalf("model=%+v", item)
		}
	}
}

func TestRepriceAdminAllChannelModelsRejectsNonSystemChannel(t *testing.T) {
	svc, db, admin := seedRepricingModels(t)
	if err := db.Create(&model.ModelChannel{ID: "personal", UserID: admin.ID, Scope: model.ChannelScopeUser, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "b").Update("channel_id", "personal").Error; err != nil {
		t.Fatal(err)
	}
	requests := []ChannelModelRepriceRequest{repricingRequest("a", 1_250_000), repricingRequest("b", 1_370_000)}
	if count, err := svc.RepriceAdminAllChannelModels(admin, requests); err == nil || count != 0 {
		t.Fatalf("count=%d err=%v", count, err)
	}
	item, err := svc.repo.ChannelModelByID("channel", "a")
	if err != nil {
		t.Fatal(err)
	}
	if item.PriceVersion != 1 {
		t.Fatal("partial save")
	}
}

func requestsByID(requests []ChannelModelRepriceRequest) map[string]ChannelModelRepriceRequest {
	result := make(map[string]ChannelModelRepriceRequest, len(requests))
	for _, request := range requests {
		result[request.ModelID] = request
	}
	return result
}

func TestUpdateAdminAllChannelModelsProtocolAcrossChannels(t *testing.T) {
	svc, db, admin := seedBatchProtocolModels(t)
	if err := db.Create(&model.ModelChannel{ID: "second", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "b").Update("channel_id", "second").Error; err != nil {
		t.Fatal(err)
	}
	updated, err := svc.UpdateAdminAllChannelModelsProtocol(admin, []string{"a", "b"}, string(model.ChannelInterfaceOpenAIResponse))
	if err != nil || updated != 2 {
		t.Fatalf("updated=%d err=%v", updated, err)
	}
	for channelID, id := range map[string]string{"channel": "a", "second": "b"} {
		item, err := svc.repo.ChannelModelByID(channelID, id)
		if err != nil {
			t.Fatal(err)
		}
		if item.Protocol != model.ChannelInterfaceOpenAIResponse {
			t.Fatalf("model=%+v", item)
		}
		// 能力参数原样保留：切换协议不重置上下文窗口、输出上限和提示词长度。
		config, err := DecodeModelCapabilityConfig(item.CapabilityConfigJSON)
		if err != nil || config.Text.ContextWindowTokens != 128000 || config.Text.MaxOutputTokens != 16384 || config.Text.References.PromptMaxChars != 32000 {
			t.Fatalf("capability changed: %+v err=%v", config, err)
		}
	}
}

func TestUpdateAdminAllChannelModelsProtocolRejectsNonSystemChannel(t *testing.T) {
	svc, db, admin := seedBatchProtocolModels(t)
	if err := db.Create(&model.ModelChannel{ID: "personal", UserID: admin.ID, Scope: model.ChannelScopeUser, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "b").Update("channel_id", "personal").Error; err != nil {
		t.Fatal(err)
	}
	if count, err := svc.UpdateAdminAllChannelModelsProtocol(admin, []string{"a", "b"}, string(model.ChannelInterfaceOpenAIResponse)); err == nil || count != 0 {
		t.Fatalf("count=%d err=%v", count, err)
	}
	item, err := svc.repo.ChannelModelByID("channel", "a")
	if err != nil {
		t.Fatal(err)
	}
	if item.Protocol != model.ChannelInterfaceChatCompletion {
		t.Fatal("partial protocol update")
	}
}
