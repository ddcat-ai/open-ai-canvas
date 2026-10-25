package app

import (
	"encoding/json"
	"reflect"
	"testing"
	"yingce/backend/internal/model"
)

func TestModelDisplayCollectionsMappingAndPricingBoundary(t *testing.T) {
	svc, db, admin := displayGroupFixture(t)
	view := manualDisplayGroupDraft(t, svc, admin)
	ids := view.Groups[0].ModelIDs
	for _, id := range ids {
		config := DefaultModelCapabilityConfigForModel("agnes-video", "video")
		data, _ := json.Marshal(config)
		if err := db.Model(&model.ChannelModel{}).Where("id = ?", id).Updates(map[string]any{"capability": "video", "protocol": "agnes-video", "capability_config_json": string(data)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	view = manualDisplayGroupDraft(t, svc, admin)
	before, err := svc.repo.ChannelModelByID("a", ids[0])
	if err != nil {
		t.Fatal(err)
	}
	view.Groups[0].Collections = []ModelDisplayCollection{{ID: "resolution-collection", Name: "MG", Members: []ModelDisplayCollectionMember{{ModelID: ids[0], Resolution: "480P"}, {ModelID: ids[1], Resolution: "720p"}}}}
	request := ModelDisplayGroupsRequest{Groups: view.Groups, ExpectedSnapshot: view.Snapshot}
	if err := svc.SaveAdminModelDisplayGroups(admin, request); err != nil {
		t.Fatal(err)
	}
	saved, err := svc.AdminModelDisplayGroups(admin)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(saved.Groups[0].Collections, view.Groups[0].Collections) {
		t.Fatal("collection not persisted")
	}
	catalog, err := svc.ModelCatalog(nil)
	if err != nil {
		t.Fatal(err)
	}
	found := 0
	for _, channel := range catalog.Channels {
		for _, member := range channel.Models {
			if member.DisplayGroup != nil && member.DisplayGroup.Collection != nil {
				found++
				if member.DisplayGroup.Collection.Name != "MG" || member.DisplayGroup.Collection.Resolution == "" {
					t.Fatal("missing public mapping")
				}
			}
		}
	}
	if found != 2 {
		t.Fatalf("mapped models = %d", found)
	}
	after, _ := svc.repo.ChannelModelByID("a", ids[0])
	if !reflect.DeepEqual(before, after) {
		t.Fatal("display collection changed original model/pricing")
	}
	if err := svc.SaveAdminModelDisplayGroups(admin, request); err == nil {
		t.Fatal("stale save accepted")
	}

	for _, members := range [][]ModelDisplayCollectionMember{
		{{ModelID: ids[0], Resolution: "480p"}, {ModelID: ids[1], Resolution: "480"}},
		{{ModelID: ids[0], Resolution: ""}},
		{{ModelID: ids[0], Resolution: "9999p"}},
		{{ModelID: "private-model", Resolution: "720p"}},
		{{ModelID: saved.Groups[1].ModelIDs[0], Resolution: "720p"}},
		{{ModelID: ids[0], Resolution: "480p"}, {ModelID: ids[0], Resolution: "720p"}},
	} {
		draft, _ := svc.AdminModelDisplayGroups(admin)
		draft.Groups[0].Collections[0].Members = members
		if err := svc.SaveAdminModelDisplayGroups(admin, ModelDisplayGroupsRequest{Groups: draft.Groups, ExpectedSnapshot: draft.Snapshot}); err == nil {
			t.Fatal("invalid collection accepted")
		}
		unchanged, _ := svc.AdminModelDisplayGroups(admin)
		if unchanged.Snapshot != saved.Snapshot {
			t.Fatal("invalid collection partially saved")
		}
	}
}
