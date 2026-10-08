package skills

import (
	"encoding/json"
	"reflect"
	"testing"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestSkillCurationRootManagementAvailable(t *testing.T) {
	if _, ok := reflect.TypeOf(SkillCurationUpdate{}).FieldByName("Root"); !ok {
		t.Fatal("missing root management: U39 only supports the five hard-coded root tags")
	}
}

func TestSkillCurationRootsLifecycle(t *testing.T) {
	svc, db, actor := newCurationTest(t)
	state, err := svc.SkillCuration(actor, true)
	if err != nil {
		t.Fatal(err)
	}
	defaults := model.DefaultSkillCurationRoots()
	if !reflect.DeepEqual(state.Roots, defaults) {
		t.Fatalf("empty table fallback changed: %#v", state.Roots)
	}
	update := func(req SkillCurationUpdate) *SkillCuration {
		t.Helper()
		current, err := svc.SkillCuration(actor, true)
		if err != nil {
			t.Fatal(err)
		}
		req.ExpectedRevision = &current.Revision
		out, err := svc.UpdateSkillCuration(actor, req, "root-test")
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	enabled := true
	update(SkillCurationUpdate{Enabled: &enabled})
	state = update(SkillCurationUpdate{Root: &model.SkillCurationRoot{Name: "New root", IconKey: "landmark", SortOrder: -10, Enabled: true}})
	root := state.Roots[0]
	if len(state.Roots) != 6 || root.Name != "New root" {
		t.Fatalf("root creation/order: %#v", state.Roots)
	}
	state = update(SkillCurationUpdate{Category: &model.SkillCurationCategory{Name: "Child", RootTag: root.ID, Enabled: true}})
	child := state.Categories[0]
	for _, skill := range []model.Skill{{ID: "assigned", Name: "Assigned", Tag: "drama", Status: 1}, {ID: "legacy", Name: "Legacy", Tag: "drama", Status: 1}, {ID: "unknown", Name: "Unknown", Tag: "unknown", Status: 1}, {ID: "private", Name: "Private", Tag: "drama", Status: 1, IsPrivate: true, OwnerID: actor.ID}} {
		if err := db.Create(&skill).Error; err != nil {
			t.Fatal(err)
		}
	}
	state = update(SkillCurationUpdate{Assignment: &SkillCurationAssignmentInput{SkillID: "assigned", RootID: &root.ID, CategoryIDs: []string{child.ID}}})
	for _, req := range []SkillListRequest{{PlatformRootID: root.ID}, {PlatformCategoryID: child.ID}, {PlatformRootID: repository.UnassignedSkillRoot}} {
		list, err := svc.Skills(actor.ID, req)
		if err != nil || list.TotalCount != 1 {
			t.Fatalf("root/child/default list: %#v %v", list, err)
		}
	}
	skill, err := svc.repo.Skill("assigned")
	if err != nil || skill.Tag != "drama" {
		t.Fatal("root assignment changed source tag")
	}
	// Root changes must replace children atomically; reject incompatible old children.
	drama := "drama"
	_, err = svc.UpdateSkillCuration(actor, SkillCurationUpdate{ExpectedRevision: &state.Revision, Assignment: &SkillCurationAssignmentInput{SkillID: "assigned", RootID: &drama, CategoryIDs: []string{child.ID}}}, "")
	if appErrorStatus(err) != 400 {
		t.Fatalf("cross-root update: %v", err)
	}
	current, _ := svc.SkillCuration(actor, true)
	if current.Revision != state.Revision || current.EffectiveRoot(skill) != root.ID {
		t.Fatal("failed change partially committed")
	}
	root.Enabled = false
	root.Name = "Renamed root"
	state = update(SkillCurationUpdate{Root: &root})
	public, err := svc.SkillCuration(actor, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(public.Categories) != 0 || len(public.Assignments) != 0 {
		t.Fatal("disabled root still exposes children")
	}
	list, err := svc.Skills(actor.ID, SkillListRequest{PlatformRootID: repository.UnassignedSkillRoot})
	if err != nil || list.TotalCount != 2 {
		t.Fatalf("disabled root lost skills: %#v %v", list, err)
	}
	root.Enabled = true
	update(SkillCurationUpdate{Root: &root})
	clear := ""
	update(SkillCurationUpdate{Assignment: &SkillCurationAssignmentInput{SkillID: "assigned", RootID: &clear, CategoryIDs: []string{}}})
	list, err = svc.Skills(actor.ID, SkillListRequest{PlatformRootID: "drama"})
	if err != nil || list.TotalCount != 2 {
		t.Fatalf("clear override: %#v %v", list, err)
	}
	off := false
	update(SkillCurationUpdate{Enabled: &off})
	original, err := svc.Skills(actor.ID, SkillListRequest{})
	if err != nil {
		t.Fatal(err)
	}
	filtered, err := svc.Skills(actor.ID, SkillListRequest{PlatformRootID: "does-not-exist"})
	if err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(original)
	b, _ := json.Marshal(filtered)
	if string(a) != string(b) {
		t.Fatal("disabled root filter changed original response")
	}
	public, err = svc.SkillCuration(actor, false)
	if err != nil || len(public.Roots) != 0 || len(public.RootAssignments) != 0 {
		t.Fatalf("disabled mode leaked roots: %#v %v", public, err)
	}
}

func TestSkillCurationRootsValidation(t *testing.T) {
	svc, _, actor := newCurationTest(t)
	revision := int64(0)
	for _, root := range []model.SkillCurationRoot{
		{Name: "Bad icon", IconKey: "https://example.invalid/icon.svg", Enabled: true},
		{Name: "短剧影视", Enabled: true},
		{ID: "unknown", Name: "Unknown", Enabled: true},
	} {
		if _, err := svc.UpdateSkillCuration(actor, SkillCurationUpdate{ExpectedRevision: &revision, Root: &root}, ""); err == nil {
			t.Fatalf("accepted invalid root: %#v", root)
		}
	}
}

func TestSkillCurationRootsDeletionAndPrivateVisibility(t *testing.T) {
	svc, db, actor := newCurationTest(t)
	if err := db.AutoMigrate(&model.SkillVersion{}, &model.SkillFile{}, &model.BuiltinSkillTombstone{}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"normal", "builtin", "private"} {
		db.Create(&model.Skill{ID: id, Tag: "drama", Status: 1, IsPrivate: id == "private", OwnerID: actor.ID})
		db.Create(&model.SkillCurationRootAssignment{SkillID: id, RootID: "social"})
	}
	db.Model(&model.SkillCurationSetting{}).Where("id = 1").Update("enabled", true)
	state, err := svc.SkillCuration(actor, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.RootAssignments) != 2 {
		t.Fatalf("private override exposed: %#v", state.RootAssignments)
	}
	list, err := svc.Skills(actor.ID, SkillListRequest{Scope: "mine", PlatformRootID: "drama"})
	if err != nil || list.TotalCount != 1 || list.Skills[0].SkillID != "private" {
		t.Fatalf("private skill root changed: %#v %v", list, err)
	}
	if err := svc.repo.DeleteSkill("normal"); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.DeleteBuiltinSkill("builtin", actor.ID); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&model.SkillCurationRootAssignment{}).Where("skill_id != ?", "private").Count(&count)
	if count != 0 {
		t.Fatal("deleted root assignment retained")
	}
}
