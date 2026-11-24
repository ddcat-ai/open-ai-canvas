package app

import (
	"reflect"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestOldModelEditorCannotOverwriteBatchChanges(t *testing.T) {
	svc, _, admin := seedBatchUpdates(t)
	before, err := svc.repo.ChannelModelByID("channel", "a")
	if err != nil {
		t.Fatal(err)
	}
	exported, err := exportChannelModel(*before)
	if err != nil {
		t.Fatal(err)
	}
	req := exported.ChannelModelRequest
	req.ExpectedUpdatedAt, req.ExpectedPriceVersion = before.UpdatedAt, before.PriceVersion
	if _, err := svc.BatchUpdateAdminChannelModels(admin, "channel", []BatchChannelModelUpdate{batchRequest(t, svc, "a", BatchChannelModelChanges{Description: batchText("新批量修改")})}); err != nil {
		t.Fatal(err)
	}
	committed, err := svc.repo.ChannelModelByID("channel", "a")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveAdminChannelModel(admin, "channel", "a", req); err == nil || !strings.Contains(err.Error(), "已被修改") {
		t.Fatalf("stale save: %v", err)
	}
	after, err := svc.repo.ChannelModelByID("channel", "a")
	if err != nil || !reflect.DeepEqual(committed, after) {
		t.Fatalf("rejected save wrote data: %v", err)
	}
	req.ExpectedUpdatedAt, req.ExpectedPriceVersion = committed.UpdatedAt, committed.PriceVersion
	if _, err := svc.SaveAdminChannelModel(admin, "channel", "a", req); err != nil {
		t.Fatalf("fresh editor rejected: %v", err)
	}
	if _, err := svc.SaveAdminChannelModel(admin, "channel", "a", req); err == nil {
		t.Fatal("consumed version reused")
	}
}

func TestOldKeyEditorCannotUndoWebsiteConnection(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	site, err := svc.SaveAdminChannelWebsite(admin, "", ChannelWebsiteRequest{Name: "Website", BaseURL: "http://127.0.0.1:18486/v1", APIFormat: "openai"})
	if err != nil {
		t.Fatal(err)
	}
	key, err := svc.CreateSystemChannel(admin, ChannelRequest{WebsiteID: site.ID, Name: "Key", APIKey: "fixture-key"})
	if err != nil {
		t.Fatal(err)
	}
	req := ChannelRequest{ExpectedUpdatedAt: key.UpdatedAt, Name: "Old editor", BaseURL: key.BaseURL, APIFormat: &key.APIFormat, MediaTransport: &ReferenceMediaTransport{Image: "base64"}}
	if _, err := svc.SaveAdminChannelWebsite(admin, site.ID, ChannelWebsiteRequest{Name: site.Name, BaseURL: "http://127.0.0.1:18486/new", APIFormat: "gemini", ExpectedUpdatedAt: site.UpdatedAt}); err != nil {
		t.Fatal(err)
	}
	committed, err := svc.repo.AdminSystemChannel(key.ID)
	if err != nil {
		t.Fatal(err)
	}
	var sitesBefore int64
	db.Model(&model.ChannelWebsite{}).Count(&sitesBefore)
	if _, err := svc.UpdateSystemChannel(admin, key.ID, req); err == nil || !strings.Contains(err.Error(), "已被修改") {
		t.Fatalf("stale key save: %v", err)
	}
	after, err := svc.repo.AdminSystemChannel(key.ID)
	if err != nil || !reflect.DeepEqual(committed, after) {
		t.Fatalf("rejected key save wrote data: %v", err)
	}
	var sitesAfter int64
	db.Model(&model.ChannelWebsite{}).Count(&sitesAfter)
	if sitesBefore != sitesAfter {
		t.Fatal("stale save created an independent website")
	}
	policy, err := svc.channelMediaTransport(key.ID)
	if err != nil || (policy != nil && policy.Image == "base64") {
		t.Fatalf("stale save changed media policy: %#v %v", policy, err)
	}
}

func TestAgnesExplicitCapabilitySurvivesSaveAndRead(t *testing.T) {
	for _, name := range []string{"agnes-video-2.5", "agnes-video-2.5-flash"} {
		t.Run(name, func(t *testing.T) {
			svc, db := newChannelModelTestService(t)
			admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
			if err := db.Create(&model.ModelChannel{ID: "channel", Scope: model.ChannelScopeSystem, Enabled: true}).Error; err != nil {
				t.Fatal(err)
			}
			profile := DefaultModelCapabilityConfigForModel("agnes-video", name)
			profile.Video.References.MaxImages, profile.Video.Duration.Default = 1, 8
			req := ChannelModelRequest{ModelKey: name, Capability: "video", Protocol: "agnes-video", CapabilityConfig: profile, PriceTiers: []ChannelModelPriceTierRequest{{BillingMode: "per_second", PriceConfigured: true}}}
			saved, err := svc.SaveAdminChannelModel(admin, "channel", "", req)
			if err != nil {
				t.Fatal(err)
			}
			req.ExpectedUpdatedAt, req.ExpectedPriceVersion = saved.UpdatedAt, saved.PriceVersion
			if _, err := svc.SaveAdminChannelModel(admin, "channel", saved.ID, req); err != nil {
				t.Fatal(err)
			}
			items, err := svc.AdminChannelModels(admin, "channel")
			if err != nil || len(items) != 1 {
				t.Fatalf("read: %v", err)
			}
			got, err := DecodeModelCapabilityConfig(items[0].CapabilityConfigJSON)
			if err != nil || got.Video.References.MaxImages != 1 || got.Video.Duration.Default != 8 {
				t.Fatalf("explicit capability lost: %#v %v", got, err)
			}
		})
	}
}
