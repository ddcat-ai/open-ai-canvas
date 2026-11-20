package app

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func seedGroupedProtocolModels(t *testing.T) (*Service, *gorm.DB, *model.User) {
	t.Helper()
	svc, db, admin := seedBatchProtocolModels(t)
	input := DefaultModelCapabilityConfigForModel("openai-image", "image-provider")
	input.Image.Size.Values = []string{"1:1"}
	input.Image.Size.Presets = []ImageSizePreset{{Tier: "1k", Ratio: "1:1", Size: "1024x1024", Width: 1024, Height: 1024}}
	input.Image.Resolution = ImageResolutionConfig{Supported: true, Values: []string{"1k"}, Default: "1k"}
	input.Image.Quality.Supported = false
	input.Image.TransparentBackground.Supported = false
	input.Image.MaxOutputs = 1
	config, err := NormalizeModelCapabilityConfigForModel("image", "openai-image", "image-provider", input, svc.protocolRegistry())
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "b").Updates(map[string]any{
		"capability": "image", "protocol": model.ChannelInterfaceOpenAIImage, "capability_config_json": string(encoded),
		"provider_model_key": "image-provider", "display_name": "保留展示名", "description": "保留备注", "sort_order": 8,
	}).Error; err != nil {
		t.Fatal(err)
	}
	return svc, db, admin
}

func mixedProtocolGroups() []ChannelModelProtocolGroup {
	return []ChannelModelProtocolGroup{
		{ModelIDs: []string{"a"}, Protocol: "openai-response"},
		{ModelIDs: []string{"b"}, Protocol: "gemini-image"},
	}
}

func groupedProtocolRows(t *testing.T, svc *Service) []model.ChannelModel {
	t.Helper()
	rows, err := svc.repo.ChannelModelsByIDs([]string{"a", "b"})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestGroupedProtocolPreservesModelAndPricing(t *testing.T) {
	for _, acrossChannels := range []bool{false, true} {
		t.Run(fmt.Sprintf("acrossChannels=%t", acrossChannels), func(t *testing.T) {
			svc, db, admin := seedGroupedProtocolModels(t)
			if acrossChannels {
				if err := db.Create(&model.ModelChannel{ID: "second", Scope: model.ChannelScopeSystem, Enabled: true}).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Model(&model.ChannelModel{}).Where("id = ?", "b").Update("channel_id", "second").Error; err != nil {
					t.Fatal(err)
				}
			}
			before := groupedProtocolRows(t, svc)
			var count int
			var err error
			if acrossChannels {
				count, err = svc.UpdateAdminAllChannelModelsProtocolGroups(admin, mixedProtocolGroups())
			} else {
				count, err = svc.UpdateAdminChannelModelsProtocolGroups(admin, "channel", mixedProtocolGroups())
			}
			if err != nil || count != 2 {
				t.Fatalf("updated=%d err=%v", count, err)
			}
			after := groupedProtocolRows(t, svc)
			for i := range before {
				want := model.ChannelInterfaceOpenAIResponse
				if after[i].ID == "b" {
					want = model.ChannelInterfaceGeminiImage
				}
				if after[i].Protocol != want {
					t.Fatalf("model %s protocol=%s want=%s", after[i].ID, after[i].Protocol, want)
				}
				// Only protocol, normalized capabilities and their version/timestamp
				// can change. DeepEqual also checks cost fields hidden from JSON.
				after[i].Protocol = before[i].Protocol
				after[i].CapabilityConfigJSON = before[i].CapabilityConfigJSON
				after[i].CapabilityVersion = before[i].CapabilityVersion
				after[i].UpdatedAt = before[i].UpdatedAt
				if !reflect.DeepEqual(after[i], before[i]) {
					t.Fatalf("model or price metadata changed: before=%+v after=%+v", before[i], after[i])
				}
			}
		})
	}
}

func TestGroupedProtocolInvalidGroupRejectsEntireRequest(t *testing.T) {
	for _, test := range []struct {
		name     string
		protocol string
		want     string
	}{
		{"unknown", "missing-protocol", "有效"},
		{"wrong capability", "openai-response", "不匹配"},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc, _, admin := seedGroupedProtocolModels(t)
			before := groupedProtocolRows(t, svc)
			groups := mixedProtocolGroups()
			groups[1].Protocol = test.protocol
			if count, err := svc.UpdateAdminAllChannelModelsProtocolGroups(admin, groups); count != 0 || err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("updated=%d err=%v", count, err)
			}
			if !reflect.DeepEqual(before, groupedProtocolRows(t, svc)) {
				t.Fatal("failed second group partially changed models or prices")
			}
		})
	}
}

func TestGroupedProtocolPreservesCommonImageConfiguration(t *testing.T) {
	svc, db, admin := seedGroupedProtocolModels(t)
	config, err := NormalizeModelCapabilityConfigForModel("image", "openai-image", "image-provider", DefaultModelCapabilityConfigForModel("openai-image", "image-provider"), svc.protocolRegistry())
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "b").Update("capability_config_json", string(encoded)).Error; err != nil {
		t.Fatal(err)
	}
	before := groupedProtocolRows(t, svc)
	if count, err := svc.UpdateAdminAllChannelModelsProtocolGroups(admin, mixedProtocolGroups()); count != 2 || err != nil {
		t.Fatalf("updated=%d err=%v", count, err)
	}
	after := groupedProtocolRows(t, svc)
	for i, row := range after {
		if !reflect.DeepEqual(row.PriceTiers, before[i].PriceTiers) {
			t.Fatal("protocol change altered pricing")
		}
		if row.ID != "b" {
			continue
		}
		profile, err := DecodeModelCapabilityConfig(row.CapabilityConfigJSON)
		if err != nil || !reflect.DeepEqual(profile.Image.Quality, config.Image.Quality) || !reflect.DeepEqual(profile.Image.Resolution, config.Image.Resolution) || !reflect.DeepEqual(profile.Image.Size.Presets, config.Image.Size.Presets) {
			t.Fatalf("common capabilities changed: %#v %v", profile, err)
		}
	}
}

func TestGroupedProtocolUnmappedPrivateImageFieldRejectsEntireRequest(t *testing.T) {
	svc, db, admin := seedGroupedProtocolModels(t)
	config, err := NormalizeModelCapabilityConfigForModel("image", "openai-image", "image-provider", DefaultModelCapabilityConfigForModel("openai-image", "image-provider"), svc.protocolRegistry())
	if err != nil {
		t.Fatal(err)
	}
	enabled, found := true, false
	for i := range config.Image.Parameters {
		if config.Image.Parameters[i].Name == "outputFormat" {
			config.Image.Parameters[i].Enabled = &enabled
			config.Image.Parameters[i].Default = "png"
			found = true
		}
	}
	if !found {
		t.Fatal("source plugin outputFormat mapping is missing")
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "b").Update("capability_config_json", string(encoded)).Error; err != nil {
		t.Fatal(err)
	}
	before := groupedProtocolRows(t, svc)
	if count, err := svc.UpdateAdminAllChannelModelsProtocolGroups(admin, mixedProtocolGroups()); count != 0 || err == nil || !strings.Contains(err.Error(), "outputFormat") {
		t.Fatalf("updated=%d err=%v", count, err)
	}
	if !reflect.DeepEqual(before, groupedProtocolRows(t, svc)) {
		t.Fatal("unmapped private field partially changed the request")
	}
}

func TestGroupedProtocolLimitsAndDuplicates(t *testing.T) {
	ids := make([]string, 101)
	for i := range ids {
		ids[i] = fmt.Sprintf("model-%03d", i)
	}
	for _, test := range []struct {
		name   string
		groups []ChannelModelProtocolGroup
		valid  bool
	}{
		{"exact total limit", []ChannelModelProtocolGroup{{ids[:50], "openai-response"}, {ids[50:100], "gemini-image"}}, true},
		{"over total limit", []ChannelModelProtocolGroup{{ids[:50], "openai-response"}, {ids[50:], "gemini-image"}}, false},
		{"four groups", []ChannelModelProtocolGroup{{ids[:1], "a"}, {ids[1:2], "b"}, {ids[2:3], "c"}, {ids[3:4], "d"}}, true},
		{"five groups", []ChannelModelProtocolGroup{{ids[:1], "a"}, {ids[1:2], "b"}, {ids[2:3], "c"}, {ids[3:4], "d"}, {ids[4:5], "e"}}, false},
		{"no groups", nil, false},
		{"empty group", []ChannelModelProtocolGroup{{nil, "openai-response"}}, false},
		{"blank protocol", []ChannelModelProtocolGroup{{ids[:1], " "}}, false},
		{"blank id", []ChannelModelProtocolGroup{{[]string{" "}, "openai-response"}}, false},
		{"within group duplicate", []ChannelModelProtocolGroup{{[]string{"a", " a "}, "openai-response"}}, false},
		{"across group duplicate", []ChannelModelProtocolGroup{{[]string{"a"}, "openai-response"}, {[]string{"a"}, "gemini-image"}}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := normalizeChannelModelProtocolGroups(test.groups)
			if (err == nil) != test.valid {
				t.Fatalf("valid=%t err=%v", test.valid, err)
			}
		})
	}
}

func TestGroupedProtocolConcurrentEditRollsBack(t *testing.T) {
	svc, db, admin := seedGroupedProtocolModels(t)
	items := groupedProtocolRows(t, svc)
	channel, err := svc.repo.AdminSystemChannel("channel")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "b").Updates(map[string]any{"description": "concurrent edit", "updated_at": time.Now().Add(time.Minute)}).Error; err != nil {
		t.Fatal(err)
	}
	before := groupedProtocolRows(t, svc)
	count, err := svc.applyChannelModelsProtocol(admin, items, map[string]bool{"a": true, "b": true}, map[string]*model.ModelChannel{"channel": channel}, map[string]string{"a": "openai-response", "b": "gemini-image"})
	if count != 0 || err == nil || !strings.Contains(err.Error(), "其他操作修改") {
		t.Fatalf("updated=%d err=%v", count, err)
	}
	if !reflect.DeepEqual(before, groupedProtocolRows(t, svc)) {
		t.Fatal("CAS conflict left a partial update")
	}
	var audits int64
	if err := db.Model(&model.AdminAuditEvent{}).Count(&audits).Error; err != nil {
		t.Fatal(err)
	}
	if audits != 0 {
		t.Fatal("CAS conflict appended an audit")
	}
}

func TestGroupedProtocolRequiresAdminInService(t *testing.T) {
	svc, _, _ := seedGroupedProtocolModels(t)
	before := groupedProtocolRows(t, svc)
	for _, actor := range []*model.User{nil, {ID: "ordinary", Role: model.UserRoleUser}} {
		if count, err := svc.UpdateAdminChannelModelsProtocolGroups(actor, "channel", mixedProtocolGroups()); count != 0 || err == nil {
			t.Fatalf("single-channel authorization count=%d err=%v", count, err)
		}
		if count, err := svc.UpdateAdminAllChannelModelsProtocolGroups(actor, mixedProtocolGroups()); count != 0 || err == nil {
			t.Fatalf("cross-channel authorization count=%d err=%v", count, err)
		}
	}
	if !reflect.DeepEqual(before, groupedProtocolRows(t, svc)) {
		t.Fatal("unauthorized service call changed models")
	}
}

func TestGroupedProtocolMemoryAndAuditShareTransaction(t *testing.T) {
	for _, failAt := range []string{"", "memory", "audit"} {
		t.Run("failure="+failAt, func(t *testing.T) {
			svc, db, admin := seedGroupedProtocolModels(t)
			if err := db.Create(&model.ChannelWebsite{ID: "site", Scope: model.ChannelScopeSystem, Name: "test", BaseURL: "https://example.invalid"}).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Update("website_id", "site").Error; err != nil {
				t.Fatal(err)
			}
			if failAt == "memory" {
				if err := db.Exec(`CREATE TRIGGER fail_protocol_memory BEFORE INSERT ON channel_protocol_selections WHEN NEW.channel_model_id = 'b' BEGIN SELECT RAISE(ABORT, 'test memory unavailable'); END`).Error; err != nil {
					t.Fatal(err)
				}
			}
			if failAt == "audit" {
				if err := db.Exec(`CREATE TRIGGER fail_protocol_audit BEFORE INSERT ON admin_audit_events BEGIN SELECT RAISE(ABORT, 'test audit unavailable'); END`).Error; err != nil {
					t.Fatal(err)
				}
			}
			before := groupedProtocolRows(t, svc)
			count, err := svc.UpdateAdminChannelModelsProtocolGroups(admin, "channel", mixedProtocolGroups())
			var memories []model.ChannelProtocolSelection
			var audits []model.AdminAuditEvent
			if queryErr := db.Order("channel_model_id").Find(&memories).Error; queryErr != nil {
				t.Fatal(queryErr)
			}
			if queryErr := db.Find(&audits).Error; queryErr != nil {
				t.Fatal(queryErr)
			}
			if failAt != "" {
				if count != 0 || err == nil || !strings.Contains(err.Error(), "test "+failAt+" unavailable") {
					t.Fatalf("count=%d err=%v", count, err)
				}
				if len(memories) != 0 || len(audits) != 0 || !reflect.DeepEqual(before, groupedProtocolRows(t, svc)) {
					t.Fatal("failed transaction left model, price, protocol memory or audit changes")
				}
				return
			}
			if count != 2 || err != nil || len(memories) != 2 || len(audits) != 1 {
				t.Fatalf("count=%d err=%v memories=%+v audits=%+v", count, err, memories, audits)
			}
			wantProtocols := map[string]string{"a": "openai-response", "b": "gemini-image"}
			wantCapabilities := map[string]string{"a": "text", "b": "image"}
			wantProviders := map[string]string{"a": "a", "b": "image-provider"}
			for _, memory := range memories {
				if memory.WebsiteID != "site" || memory.ActorID != admin.ID || memory.Protocol != wantProtocols[memory.ChannelModelID] || memory.Capability != wantCapabilities[memory.ChannelModelID] || memory.ProviderModelKey != wantProviders[memory.ChannelModelID] {
					t.Fatalf("incorrect memory=%+v", memory)
				}
			}
			var metadata struct {
				ChannelID string `json:"channelId"`
				Models    []struct {
					ModelID  string `json:"modelId"`
					ModelKey string `json:"modelKey"`
					Protocol string `json:"protocol"`
				} `json:"models"`
			}
			if err := json.Unmarshal([]byte(audits[0].MetadataJSON), &metadata); err != nil {
				t.Fatal(err)
			}
			if audits[0].Action != "channel_model.batch_protocol" || metadata.ChannelID != "channel" || len(metadata.Models) != 2 {
				t.Fatalf("audit=%+v", audits[0])
			}
			for _, row := range metadata.Models {
				if row.Protocol != wantProtocols[row.ModelID] || row.ModelKey != row.ModelID {
					t.Fatalf("audit target=%+v", row)
				}
			}
		})
	}
}
