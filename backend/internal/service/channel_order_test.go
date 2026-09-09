package service

import (
	"infinite-canvas/backend/internal/model"
	"testing"
)

func TestVisualChannelOrderAtomicSnapshotAndPermissions(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	for _, id := range []string{"a", "b", "c"} {
		if err := db.Create(&model.ModelChannel{ID: id, Name: id, Scope: model.ChannelScopeSystem, Enabled: true}).Error; err != nil {
			t.Fatal(err)
		}
	}
	rows, err := svc.AdminChannelOrder(admin, "")
	if err != nil {
		t.Fatal(err)
	}
	original := []string{}
	for _, row := range rows {
		original = append(original, row.ID)
	}
	req := ChannelOrderRequest{IDs: []string{"c", "a", "b"}, ExpectedIDs: original}
	if err := svc.SaveAdminChannelOrder(nil, "", req); err == nil {
		t.Fatal("nonadmin accepted")
	}
	if err := svc.SaveAdminChannelOrder(admin, "", req); err != nil {
		t.Fatal(err)
	}
	if err := svc.SaveAdminChannelOrder(admin, "", req); err == nil {
		t.Fatal("stale snapshot accepted")
	}
	bad := ChannelOrderRequest{IDs: []string{"c", "c", "b"}, ExpectedIDs: []string{"c", "a", "b"}}
	if err := svc.SaveAdminChannelOrder(admin, "", bad); err == nil {
		t.Fatal("duplicate accepted")
	}
	after, _ := svc.AdminChannelOrder(admin, "")
	if after[0].ID != "c" || after[1].ID != "a" {
		t.Fatal("failed save changed order")
	}
	for _, id := range []string{"m1", "m2"} {
		if err := db.Create(&model.ChannelModel{ID: id, ChannelID: "a", ModelKey: id, Enabled: true, PriceVersion: 7, CapabilityVersion: 4, UnitPriceMicrocredits: 123}).Error; err != nil {
			t.Fatal(err)
		}
	}
	models, _ := svc.AdminChannelOrder(admin, "a")
	expected := []string{models[0].ID, models[1].ID}
	if err := svc.SaveAdminChannelOrder(admin, "a", ChannelOrderRequest{IDs: []string{expected[1], expected[0]}, ExpectedIDs: expected}); err != nil {
		t.Fatal(err)
	}
	var stored []model.ChannelModel
	db.Find(&stored)
	for _, item := range stored {
		if item.PriceVersion != 7 || item.CapabilityVersion != 4 || item.UnitPriceMicrocredits != 123 || !item.Enabled {
			t.Fatal("model configuration changed")
		}
	}
	if err := svc.SaveAdminChannelOrder(admin, "b", ChannelOrderRequest{IDs: expected, ExpectedIDs: expected}); err == nil {
		t.Fatal("cross-channel accepted")
	}
}
