package app

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestModelEditorDisplayGroupAssignment(t *testing.T) {
	svc, db, admin := displayGroupFixture(t)
	view := manualDisplayGroupDraft(t, svc, admin)
	target := "new-group"
	view.Groups = append(view.Groups, ModelDisplayGroup{ID: target, Name: "New First Level", ModelIDs: []string{}})
	if err := svc.SaveAdminModelDisplayGroups(admin, ModelDisplayGroupsRequest{Groups: view.Groups, ExpectedSnapshot: view.Snapshot}); err != nil {
		t.Fatal(err)
	}
	view, _ = svc.AdminModelDisplayGroups(admin)
	enabled := true
	req := ChannelModelRequest{ModelKey: "created", ProviderModelKey: "upstream-created", DisplayName: "Legacy Name", ChannelLabel: "Standard", Capability: "text", Protocol: string(model.ChannelInterfaceChatCompletion),
		CapabilityConfig: DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "created"),
		PriceTiers:       []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", UnitPriceMicrocredits: 300000, PriceConfigured: true, Enabled: &enabled}}, Enabled: &enabled,
		DisplayGroupID: &target, DisplayGroupSnapshot: view.Snapshot}
	item, err := svc.SaveAdminChannelModel(admin, "a", "", req)
	if err != nil {
		t.Fatal(err)
	}
	saved, _ := svc.AdminModelDisplayGroups(admin)
	if !reflect.DeepEqual(saved.Groups[2].ModelIDs, []string{item.ID}) {
		t.Fatal("new model not persisted in destination")
	}
	catalog, err := svc.ModelCatalog(nil)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, channel := range catalog.Channels {
		for _, member := range channel.Models {
			if member.ID == item.ID {
				found = true
				if member.DisplayGroup == nil || member.DisplayGroup.Name != "New First Level" || member.ModelKey != "created" {
					t.Fatal("catalog lost group or route")
				}
			}
		}
	}
	if !found {
		t.Fatal("assigned model missing from catalog")
	}
	// A stale editor must not change pricing, model identity, or group membership.
	req.ChannelLabel = "Changed"
	req.PriceTiers[0].UnitPriceMicrocredits = 900000
	if _, err := svc.SaveAdminChannelModel(admin, "a", item.ID, req); err == nil {
		t.Fatal("stale editor accepted")
	}
	unchanged, _ := svc.repo.ChannelModelByID("a", item.ID)
	if unchanged.ChannelLabel != "Standard" || unchanged.PriceVersion != item.PriceVersion {
		t.Fatal("stale save mutated model")
	}
	missing := "missing"
	req.DisplayGroupID, req.DisplayGroupSnapshot = &missing, saved.Snapshot
	if _, err := svc.SaveAdminChannelModel(admin, "a", item.ID, req); err == nil {
		t.Fatal("missing group accepted")
	}
	// Fail after writing groups and audit: the outer transaction must roll both back.
	req.DisplayGroupID = &saved.Groups[0].ID
	if err := db.Callback().Update().Before("gorm:update").Register("test:group_model_failure", func(tx *gorm.DB) {
		if tx.Statement.Table == "channel_models" {
			tx.AddError(errors.New("injected model failure"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	var auditBefore, auditAfter int64
	db.Model(&model.AdminAuditEvent{}).Count(&auditBefore)
	if _, err := svc.SaveAdminChannelModel(admin, "a", item.ID, req); err == nil {
		t.Fatal("injected failure ignored")
	}
	db.Callback().Update().Remove("test:group_model_failure")
	rolledBack, _ := svc.AdminModelDisplayGroups(admin)
	db.Model(&model.AdminAuditEvent{}).Count(&auditAfter)
	if rolledBack.Snapshot != saved.Snapshot || auditBefore != auditAfter {
		t.Fatal("partial group/audit write")
	}
	if _, err := svc.SaveAdminChannelModel(admin, "a", item.ID, req); err != nil {
		t.Fatal(err)
	}
	moved, _ := svc.AdminModelDisplayGroups(admin)
	want := append(append([]string{}, saved.Groups[0].ModelIDs...), item.ID)
	if !reflect.DeepEqual(moved.Groups[0].ModelIDs, want) || len(moved.Groups[2].ModelIDs) != 0 {
		t.Fatal("reassignment lost members/order")
	}
	req.DisplayGroupSnapshot = moved.Snapshot
	if _, err := svc.SaveAdminChannelModel(admin, "a", item.ID, req); err != nil {
		t.Fatal(err)
	}
	moved, _ = svc.AdminModelDisplayGroups(admin)
	if !reflect.DeepEqual(moved.Groups[0].ModelIDs, want) {
		t.Fatal("same-group save changed order")
	}
	// The ordinary model form omits grouping fields; editing a model must preserve its group.
	req.DisplayGroupID = nil
	req.DisplayGroupSnapshot = ""
	if _, err := svc.SaveAdminChannelModel(admin, "a", item.ID, req); err != nil {
		t.Fatal(err)
	}
	moved, _ = svc.AdminModelDisplayGroups(admin)
	if !reflect.DeepEqual(moved.Groups[0].ModelIDs, want) {
		t.Fatal("ordinary model edit changed membership")
	}
	ungrouped := ""
	req.DisplayGroupID, req.DisplayGroupSnapshot = &ungrouped, moved.Snapshot
	if _, err := svc.SaveAdminChannelModel(admin, "a", item.ID, req); err != nil {
		t.Fatal(err)
	}
	moved, _ = svc.AdminModelDisplayGroups(admin)
	if !reflect.DeepEqual(moved.Groups[0].ModelIDs, saved.Groups[0].ModelIDs) {
		t.Fatal("ungrouping altered other members")
	}
}

func displayGroupFixture(t *testing.T) (*Service, *gorm.DB, *model.User) {
	t.Helper()
	svc, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.AdminAuditEvent{}, &model.BillingOrder{}); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	for i, id := range []string{"a", "b"} {
		if err := db.Create(&model.ModelChannel{ID: id, Scope: model.ChannelScopeSystem, Enabled: true, Name: id, SortOrder: i, BaseURL: "https://example.invalid", APIKey: "synthetic", ModelsJSON: `[]`}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.ModelChannel{ID: "personal", Scope: model.ChannelScopeUser, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	enabled := true
	for _, item := range []struct{ channel, key, name string }{{"a", "first", "Family"}, {"a", "other", "Other"}, {"b", "variant", "Family"}} {
		_, err := svc.SaveAdminChannelModel(admin, item.channel, "", ChannelModelRequest{
			ModelKey: item.key, ProviderModelKey: "provider-" + item.key, DisplayName: item.name, ChannelLabel: "same label", Capability: "text", Protocol: string(model.ChannelInterfaceChatCompletion),
			CapabilityConfig: DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), item.key),
			PriceTiers:       []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", UnitPriceMicrocredits: 300000, PriceConfigured: true, Enabled: &enabled}}, Enabled: &enabled,
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.ChannelModel{ID: "private-model", ChannelID: "personal", ModelKey: "private"}).Error; err != nil {
		t.Fatal(err)
	}
	return svc, db, admin
}

// Build an explicit administrator draft. Production must never infer these groups from names.
func manualDisplayGroupDraft(t *testing.T, svc *Service, admin *model.User) *ModelDisplayGroupsView {
	t.Helper()
	view, err := svc.AdminModelDisplayGroups(admin)
	if err != nil {
		t.Fatal(err)
	}
	if view.Initialized || len(view.Groups) != 0 {
		t.Fatal("fresh catalog automatically created groups")
	}
	view.Groups = []ModelDisplayGroup{{ID: "family", Name: "Family", ModelIDs: []string{}}, {ID: "other", Name: "Other", ModelIDs: []string{}}}
	for _, member := range view.Models {
		index := 0
		if member.ModelKey == "other" {
			index = 1
		}
		view.Groups[index].ModelIDs = append(view.Groups[index].ModelIDs, member.ID)
	}
	return view
}

func TestModelDisplayGroupsFreshCatalogDoesNotCreateDirectories(t *testing.T) {
	svc, db, admin := displayGroupFixture(t)
	view, err := svc.AdminModelDisplayGroups(admin)
	if err != nil {
		t.Fatal(err)
	}
	if view.Initialized || len(view.Groups) != 0 || len(view.Models) != 3 {
		t.Fatal("models must start ungrouped")
	}
	catalog, err := svc.ModelCatalog(nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, channel := range catalog.Channels {
		for _, member := range channel.Models {
			if member.DisplayGroup != nil {
				t.Fatal("legacy name created a directory")
			}
		}
	}
	var count int64
	db.Model(&model.SystemSetting{}).Where("key = ?", repository.ModelDisplayGroupsKey).Count(&count)
	if count != 0 {
		t.Fatal("read initialized groups")
	}
}

func TestModelDisplayGroupsPreviewAndSavePreserveRoutes(t *testing.T) {
	svc, db, admin := displayGroupFixture(t)
	view := manualDisplayGroupDraft(t, svc, admin)
	if view.Initialized || len(view.Groups) != 2 || len(view.Models) != 3 || view.Groups[0].Name != "Family" || len(view.Groups[0].ModelIDs) != 2 {
		t.Fatalf("bad preview: %#v", view)
	}
	var count int64
	db.Model(&model.SystemSetting{}).Where("key = ?", repository.ModelDisplayGroupsKey).Count(&count)
	if count != 0 {
		t.Fatal("preview mutated settings")
	}
	before, err := svc.ModelCatalog(nil)
	if err != nil {
		t.Fatal(err)
	}
	for ci := range before.Channels {
		for mi := range before.Channels[ci].Models {
			before.Channels[ci].Models[mi].DisplayGroup = nil
		}
	}
	groups := []ModelDisplayGroup{view.Groups[1], view.Groups[0]}
	groups[1].Name = "Renamed Family"
	ids := groups[1].ModelIDs
	groups[1].ModelIDs = []string{ids[1], ids[0]}
	req := ModelDisplayGroupsRequest{Groups: groups, ExpectedSnapshot: view.Snapshot}
	if err := svc.SaveAdminModelDisplayGroups(admin, req); err != nil {
		t.Fatal(err)
	}
	if err := svc.SaveAdminModelDisplayGroups(admin, req); err == nil {
		t.Fatal("stale writer overwrote saved groups")
	}
	after, err := svc.ModelCatalog(nil)
	if err != nil {
		t.Fatal(err)
	}
	for ci, channel := range after.Channels {
		for mi, item := range channel.Models {
			if item.DisplayGroup == nil {
				t.Fatal("missing group projection")
			}
			if item.DisplayName == "Family" && (item.DisplayGroup.Name != "Renamed Family" || item.DisplayGroup.ID != view.Groups[0].ID || item.DisplayGroup.Order != 1) {
				t.Fatalf("bad group %#v", item.DisplayGroup)
			}
			after.Channels[ci].Models[mi].DisplayGroup = nil
			// Default sale pricing now records its explicit source on grouped models.
			before.Channels[ci].Models[mi].MultiplierSource = after.Channels[ci].Models[mi].MultiplierSource
			// Statistics are recomputed on each read and do not describe routing changes.
			after.Channels[ci].Models[mi].Availability = nil
			before.Channels[ci].Models[mi].Availability = nil
		}
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("group save changed routing, display source, capability or pricing")
	}
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "b").Update("sort_order", -1).Error; err != nil {
		t.Fatal(err)
	}
	reordered, err := svc.ModelCatalog(nil)
	if err != nil {
		t.Fatal(err)
	}
	if reordered.Channels[0].ID != "b" || reordered.Channels[0].Models[0].DisplayGroup.MemberOrder != 0 || reordered.Channels[0].Models[0].DisplayGroup.Order != 1 {
		t.Fatal("channel order changed saved group order")
	}
	saved, err := svc.AdminModelDisplayGroups(admin)
	if err != nil {
		t.Fatal(err)
	}
	if !saved.Initialized || !reflect.DeepEqual(saved.Groups, groups) {
		t.Fatal("group readback mismatch")
	}
}

func TestModelDisplayGroupsMembershipValidationAndPermissions(t *testing.T) {
	svc, _, admin := displayGroupFixture(t)
	view := manualDisplayGroupDraft(t, svc, admin)
	for _, actor := range []*model.User{nil, {ID: "user", Role: model.UserRoleUser}} {
		if _, err := svc.AdminModelDisplayGroups(actor); err == nil {
			t.Fatal("unauthorized read")
		}
		if err := svc.SaveAdminModelDisplayGroups(actor, ModelDisplayGroupsRequest{Groups: view.Groups, ExpectedSnapshot: view.Snapshot}); err == nil {
			t.Fatal("unauthorized write")
		}
	}
	for _, groups := range [][]ModelDisplayGroup{
		nil,
		{{ID: "g", Name: " "}},
		{{ID: "g", Name: "one"}, {ID: "g", Name: "two"}},
		{{ID: "g1", Name: "same"}, {ID: "g2", Name: " same "}},
		{{ID: "g", Name: "valid", ModelIDs: []string{"missing"}}},
		{{ID: "g", Name: "valid", ModelIDs: []string{"private-model"}}},
		{{ID: "g1", Name: "one", ModelIDs: view.Groups[0].ModelIDs}, {ID: "g2", Name: "two", ModelIDs: view.Groups[0].ModelIDs}},
	} {
		if err := svc.SaveAdminModelDisplayGroups(admin, ModelDisplayGroupsRequest{Groups: groups, ExpectedSnapshot: view.Snapshot}); err == nil {
			t.Fatalf("accepted invalid groups: %#v", groups)
		}
	}
	if err := svc.SaveAdminModelDisplayGroups(admin, ModelDisplayGroupsRequest{Groups: []ModelDisplayGroup{}, ExpectedSnapshot: view.Snapshot}); err != nil {
		t.Fatal(err)
	}
	catalog, err := svc.ModelCatalog(nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, channel := range catalog.Channels {
		for _, member := range channel.Models {
			if member.DisplayGroup == nil || member.DisplayGroup.ID != "" {
				t.Fatal("cleared groups did not expose ungrouped members")
			}
		}
	}
}

func TestModelDisplayGroupsCatalogChangesAndDeletedMembers(t *testing.T) {
	svc, db, admin := displayGroupFixture(t)
	view := manualDisplayGroupDraft(t, svc, admin)
	id := view.Groups[0].ModelIDs[0]
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", id).Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.SaveAdminModelDisplayGroups(admin, ModelDisplayGroupsRequest{Groups: view.Groups, ExpectedSnapshot: view.Snapshot}); err == nil {
		t.Fatal("accepted stale catalog snapshot")
	}
	var count int64
	db.Model(&model.SystemSetting{}).Where("key = ?", repository.ModelDisplayGroupsKey).Count(&count)
	if count != 0 {
		t.Fatal("failed first save left a placeholder")
	}
	view = manualDisplayGroupDraft(t, svc, admin)
	if len(view.Groups[0].ModelIDs) != 2 {
		t.Fatal("disabled model membership lost")
	}
	if err := svc.SaveAdminModelDisplayGroups(admin, ModelDisplayGroupsRequest{Groups: view.Groups, ExpectedSnapshot: view.Snapshot}); err != nil {
		t.Fatal(err)
	}
	newModel := model.ChannelModel{ID: "new", ChannelID: "a", ModelKey: "new", DisplayName: "Family", Capability: "text", Enabled: true}
	newModel.Protocol = model.ChannelInterfaceChatCompletion
	capabilities, err := json.Marshal(DefaultModelCapabilityConfigForModel(string(newModel.Protocol), newModel.ModelKey))
	if err != nil {
		t.Fatal(err)
	}
	newModel.CapabilityConfigJSON = string(capabilities)
	if err := db.Create(&newModel).Error; err != nil {
		t.Fatal(err)
	}
	updated, _ := svc.AdminModelDisplayGroups(admin)
	if len(updated.Models) != 4 || len(updated.Groups[0].ModelIDs) != 2 {
		t.Fatal("new model was silently assigned by name")
	}
	catalog, err := svc.ModelCatalog(nil)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, channel := range catalog.Channels {
		for _, member := range channel.Models {
			if member.ID == "new" {
				found = true
				if member.DisplayGroup == nil || member.DisplayGroup.ID != "" {
					t.Fatal("new model not ungrouped")
				}
			}
		}
	}
	if !found {
		t.Fatal("new model missing from catalog")
	}
	if err := db.Delete(&model.ChannelModel{}, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	updated, _ = svc.AdminModelDisplayGroups(admin)
	if len(updated.Groups[0].ModelIDs) != 1 {
		t.Fatal("deleted membership not filtered")
	}
	if err := svc.SaveAdminModelDisplayGroups(admin, ModelDisplayGroupsRequest{Groups: updated.Groups, ExpectedSnapshot: updated.Snapshot}); err != nil {
		t.Fatal(err)
	}
}

func TestModelDisplayGroupsInlineLabels(t *testing.T) {
	svc, db, admin := displayGroupFixture(t)
	view := manualDisplayGroupDraft(t, svc, admin)
	id := view.Groups[0].ModelIDs[0]
	before, err := svc.repo.ChannelModelByID("a", id)
	if err != nil {
		t.Fatal(err)
	}
	for _, labels := range []map[string]string{{"private-model": "Private"}, {id: strings.Repeat("字", 81)}, {"missing": "Missing"}} {
		if err := svc.SaveAdminModelDisplayGroups(admin, ModelDisplayGroupsRequest{Groups: view.Groups, ExpectedSnapshot: view.Snapshot, MemberLabels: labels}); err == nil {
			t.Fatal("invalid label mutation accepted")
		}
	}
	req := ModelDisplayGroupsRequest{Groups: view.Groups, ExpectedSnapshot: view.Snapshot, MemberLabels: map[string]string{id: " Standard "}}
	if err := svc.SaveAdminModelDisplayGroups(admin, req); err != nil {
		t.Fatal(err)
	}
	after, err := svc.repo.ChannelModelByID("a", id)
	if err != nil {
		t.Fatal(err)
	}
	if after.ChannelLabel != "Standard" || after.PriceVersion != before.PriceVersion || after.CapabilityVersion != before.CapabilityVersion || after.ModelKey != before.ModelKey || after.ProviderModelKey != before.ProviderModelKey || !reflect.DeepEqual(after.PriceTiers, before.PriceTiers) {
		t.Fatal("label update altered model contract or pricing")
	}
	if err := svc.SaveAdminModelDisplayGroups(admin, req); err == nil {
		t.Fatal("stale label save accepted")
	}
	saved, _ := svc.AdminModelDisplayGroups(admin)
	req.ExpectedSnapshot = saved.Snapshot
	req.MemberLabels[id] = ""
	if err := svc.SaveAdminModelDisplayGroups(admin, req); err != nil {
		t.Fatal(err)
	}
	cleared, _ := svc.repo.ChannelModelByID("a", id)
	if cleared.ChannelLabel != "" {
		t.Fatal("label clear failed")
	}
	saved, _ = svc.AdminModelDisplayGroups(admin)
	if err := db.Migrator().DropTable(&model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	req.ExpectedSnapshot = saved.Snapshot
	req.MemberLabels[id] = "Must Roll Back"
	req.Groups[0].Name = "Must Roll Back"
	if err := svc.SaveAdminModelDisplayGroups(admin, req); err == nil {
		t.Fatal("audit failure ignored")
	}
	rolledBack, _ := svc.AdminModelDisplayGroups(admin)
	if rolledBack.Snapshot != saved.Snapshot {
		t.Fatal("group or label partially saved")
	}
}

func TestModelDisplayGroupsAtomicAuditAndMalformedConfig(t *testing.T) {
	svc, db, admin := displayGroupFixture(t)
	view := manualDisplayGroupDraft(t, svc, admin)
	if err := db.Migrator().DropTable(&model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if err := svc.SaveAdminModelDisplayGroups(admin, ModelDisplayGroupsRequest{Groups: view.Groups, ExpectedSnapshot: view.Snapshot}); err == nil {
		t.Fatal("save succeeded without audit")
	}
	retry, err := svc.AdminModelDisplayGroups(admin)
	if err != nil || retry.Initialized || retry.Snapshot != view.Snapshot {
		t.Fatal("failed transaction changed groups")
	}
	for _, raw := range []string{`{`, `{"groups":null}`} {
		if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: repository.ModelDisplayGroupsKey, ValueJSON: raw}); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.AdminModelDisplayGroups(admin); err == nil {
			t.Fatal("malformed config ignored")
		}
		if _, err := svc.ModelCatalog(nil); err == nil {
			t.Fatal("catalog hid invalid saved config")
		}
	}
	// Public catalog never exposes provider credentials in grouping data.
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "synthetic") || strings.Contains(string(encoded), "example.invalid") {
		t.Fatal("credentials leaked")
	}
}
