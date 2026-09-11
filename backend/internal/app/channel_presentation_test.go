package app

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestChannelPresentationAliasAndPublicOrder(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	svc.dataDir = t.TempDir()
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	for i, id := range []string{"first", "second"} {
		channel := model.ModelChannel{ID: id, Name: "内部" + id, Scope: model.ChannelScopeSystem, Enabled: true, BaseURL: "https://dead.invalid/v1", ModelsJSON: `[]`, CreatedAt: time.Unix(int64(i+1), 0)}
		if err := db.Create(&channel).Error; err != nil {
			t.Fatal(err)
		}
		cm := model.ChannelModel{
			ID: id + "-model", ChannelID: id, ModelKey: id, Enabled: true, PriceConfigured: true, Capability: "image",
			CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel("", id)),
		}
		if err := db.Create(&cm).Error; err != nil {
			t.Fatal(err)
		}
	}
	alias := "  创作精选  "
	updated, err := svc.UpdateSystemChannel(admin, "second", ChannelRequest{PublicAlias: &alias})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != "内部second" || updated.PublicAlias != "创作精选" {
		t.Fatalf("admin alias: %#v", updated)
	}
	if _, err := svc.UpdateSystemChannel(admin, "first", ChannelRequest{SortOrder: intPtr(20)}); err != nil {
		t.Fatal(err)
	}
	adminRows, total, err := svc.repo.AdminSystemChannels("", "all", 1, 0)
	if err != nil || total != 2 || len(adminRows) != 1 || adminRows[0].ID != "second" {
		t.Fatalf("pagination before sort: %v %v %v", adminRows, total, err)
	}
	search, _, err := svc.repo.AdminSystemChannels("精选", "all", 10, 0)
	if err != nil || len(search) != 1 {
		t.Fatalf("alias search: %v %v", search, err)
	}
	catalog, err := svc.publicSystemChannelCatalog(nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog) != 2 || catalog[0].ID != "second" || catalog[0].Name != "创作精选" || catalog[0].DisplayName != "创作精选" {
		t.Fatalf("public catalog: %#v", catalog)
	}
	legacy, err := svc.PublicSystemChannels()
	if err != nil {
		t.Fatal(err)
	}
	if legacy[0].Name != "创作精选" {
		t.Fatalf("public session: %#v", legacy)
	}
	encoded, _ := json.Marshal([]any{catalog[0], legacy[0]})
	if strings.Contains(string(encoded), "内部second") {
		t.Fatal("internal channel name leaked into public payload")
	}
	if _, err := svc.UpdateSystemChannel(admin, "second", ChannelRequest{SortOrder: intPtr(5)}); err != nil {
		t.Fatal(err)
	}
	stored, _ := svc.repo.AdminSystemChannel("second")
	if stored.PublicAlias != "创作精选" {
		t.Fatal("partial sort patch cleared alias")
	}
	alias = "  "
	if _, err := svc.UpdateSystemChannel(admin, "second", ChannelRequest{PublicAlias: &alias, SortOrder: intPtr(0)}); err != nil {
		t.Fatal(err)
	}
	catalog, err = svc.publicSystemChannelCatalog(nil)
	if err != nil || catalog[0].Name != "内部second" {
		t.Fatalf("empty alias fallback: %v %v", catalog, err)
	}
	for _, invalid := range []int{-1, 1000000} {
		if _, err := svc.UpdateSystemChannel(admin, "second", ChannelRequest{SortOrder: &invalid}); err == nil {
			t.Fatal("invalid sort accepted")
		}
	}
	alias = strings.Repeat("字", 81)
	if _, err := svc.UpdateSystemChannel(admin, "second", ChannelRequest{PublicAlias: &alias}); err == nil {
		t.Fatal("long alias accepted")
	}
}

func TestChannelModelSortPreservesConfigurationAndOwnership(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	for _, id := range []string{"channel", "other"} {
		if err := db.Create(&model.ModelChannel{ID: id, Scope: model.ChannelScopeSystem, Enabled: true, Name: id, ModelsJSON: `[]`}).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i, id := range []string{"z", "a", "b"} {
		cm := model.ChannelModel{
			ID: id, ChannelID: "channel", ModelKey: id, ProviderModelKey: "provider-" + id, Enabled: true,
			Capability: "image", PriceConfigured: true, UnitPriceMicrocredits: 123, PriceVersion: 7, CapabilityVersion: 4,
			CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel("", id)),
			CreatedAt:            time.Unix(int64(i), 0),
		}
		if err := db.Create(&cm).Error; err != nil {
			t.Fatal(err)
		}
	}
	var before model.ChannelModel
	if err := db.First(&before, "id = ?", "z").Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.UpdateAdminChannelModelSort(admin, "channel", "z", ChannelModelSortRequest{SortOrder: intPtr(10)}); err != nil {
		t.Fatal(err)
	}
	var after model.ChannelModel
	if err := db.First(&after, "id = ?", "z").Error; err != nil {
		t.Fatal(err)
	}
	after.SortOrder, after.UpdatedAt = before.SortOrder, before.UpdatedAt
	if !reflect.DeepEqual(before, after) {
		t.Fatal("sort changed model business configuration")
	}
	rows, err := svc.repo.ChannelModels("channel", true)
	if err != nil || len(rows) != 3 || rows[0].ID != "a" || rows[1].ID != "b" || rows[2].ID != "z" {
		t.Fatalf("sort and stable tie: %v %v", rows, err)
	}
	channel, _ := svc.repo.AdminSystemChannel("channel")
	if channel.ModelsJSON != `["a","b","z"]` {
		t.Fatalf("legacy models order: %s", channel.ModelsJSON)
	}
	catalog, err := svc.publicSystemChannelCatalog(nil)
	if err != nil || len(catalog) != 1 || catalog[0].Models[2].ModelKey != "z" {
		t.Fatalf("public model order: %v %v", catalog, err)
	}
	for _, tc := range []struct {
		actor       *model.User
		channel, id string
		value       *int
	}{
		{nil, "channel", "z", intPtr(1)},
		{&model.User{ID: "user"}, "channel", "z", intPtr(1)},
		{admin, "other", "z", intPtr(1)},
		{admin, "channel", "missing", intPtr(1)},
		{admin, "channel", "z", nil},
		{admin, "channel", "z", intPtr(-1)},
		{admin, "channel", "z", intPtr(1000000)},
	} {
		if err := svc.UpdateAdminChannelModelSort(tc.actor, tc.channel, tc.id, ChannelModelSortRequest{SortOrder: tc.value}); err == nil {
			t.Fatalf("invalid update accepted: %#v", tc)
		}
	}
	if err := svc.UpdateAdminChannelModelSort(admin, "channel", "z", ChannelModelSortRequest{SortOrder: intPtr(0)}); err != nil {
		t.Fatal(err)
	}
	rows, _ = svc.repo.ChannelModels("channel", true)
	if rows[0].ID != "z" {
		t.Fatal("resetting to zero did not restore creation order")
	}
}
