package skills

import (
	"encoding/json"
	"gorm.io/gorm"
	"reflect"
	"testing"
	"yingce/backend/internal/model"
)

func TestSkillCurationManagementAvailable(t *testing.T) {
	if _, ok := reflect.TypeOf((*Service)(nil)).MethodByName("UpdateSkillCuration"); !ok {
		t.Fatal("missing platform curation management: skill categories are fixed and cannot be maintained by an administrator")
	}
}

func newCurationTest(t *testing.T) (*Service, *gorm.DB, *model.User) {
	t.Helper()
	svc, db := newSkillLibraryCategoryTestService(t)
	if err := db.AutoMigrate(&model.SkillCurationRoot{}, &model.SkillCurationRootAssignment{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SkillCurationSetting{}, &model.SkillCurationCategory{}, &model.SkillCurationAssignment{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SkillCurationSetting{ID: 1}).Error; err != nil {
		t.Fatal(err)
	}
	actor := &model.User{ID: "curator", Role: model.UserRoleAdmin, Status: model.UserStatusActive, Username: "curator"}
	if err := db.Create(actor).Error; err != nil {
		t.Fatal(err)
	}
	return svc, db, actor
}

func TestSkillCurationDisabledSnapshot(t *testing.T) {
	svc, db, actor := newCurationTest(t)
	// Snapshot of the original empty /skills data and fixed category order.
	const original = `{"skills":[],"totalCount":0,"hasMore":false,"nextOffset":0,"page":1,"pageSize":20,"categories":[{"value":"drama","label":"短剧影视"},{"value":"ecommerce","label":"电商营销"},{"value":"creative","label":"创意设计"},{"value":"social","label":"社媒内容"},{"value":"others","label":"其他"}]}`
	if err := db.Create(&model.SkillCurationCategory{ID: "hidden", RootTag: "drama", Name: "Hidden", NormalizedName: "hidden", Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	for _, req := range []SkillListRequest{{}, {PlatformCategoryID: "invalid", PlatformUncategorized: true}} {
		result, err := svc.Skills(actor.ID, req)
		if err != nil {
			t.Fatal(err)
		}
		data, _ := json.Marshal(result)
		if string(data) != original {
			t.Fatalf("legacy response changed:\n%s", data)
		}
	}
	result, err := svc.SkillCuration(actor, false)
	if err != nil {
		t.Fatal(err)
	}
	if result.Enabled || len(result.Categories) != 0 || len(result.Assignments) != 0 {
		t.Fatalf("disabled mode leaked curation: %#v", result)
	}
}

func TestSkillCurationLifecycleAndGuards(t *testing.T) {
	svc, db, actor := newCurationTest(t)
	update := func(req SkillCurationUpdate) *SkillCuration {
		t.Helper()
		state, err := svc.SkillCuration(actor, true)
		if err != nil {
			t.Fatal(err)
		}
		req.ExpectedRevision = &state.Revision
		out, err := svc.UpdateSkillCuration(actor, req, "test-request")
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	on := true
	update(SkillCurationUpdate{Enabled: &on})
	state := update(SkillCurationUpdate{Category: &model.SkillCurationCategory{RootTag: "drama", Name: "Story", SortOrder: 2, Enabled: true}})
	c := state.Categories[0]
	for _, s := range []model.Skill{{ID: "public", Name: "Story", Tag: "drama", Status: 1}, {ID: "other", Name: "Other", Tag: "social", Status: 1}, {ID: "private", Name: "Secret", Tag: "drama", Status: 1, IsPrivate: true, OwnerID: actor.ID}} {
		if err := db.Create(&s).Error; err != nil {
			t.Fatal(err)
		}
	}
	state = update(SkillCurationUpdate{Assignment: &SkillCurationAssignmentInput{SkillID: "public", CategoryIDs: []string{c.ID}}})
	list, err := svc.Skills(actor.ID, SkillListRequest{PlatformCategoryID: c.ID})
	if err != nil || list.TotalCount != 1 {
		t.Fatalf("filtered: %#v %v", list, err)
	}
	list, err = svc.Skills(actor.ID, SkillListRequest{PlatformUncategorized: true})
	if err != nil || list.TotalCount != 1 {
		t.Fatalf("uncategorized: %#v %v", list, err)
	}
	for _, id := range []string{"other", "private"} {
		_, err := svc.UpdateSkillCuration(actor, SkillCurationUpdate{ExpectedRevision: &state.Revision, Assignment: &SkillCurationAssignmentInput{SkillID: id, CategoryIDs: []string{c.ID}}}, "")
		if err == nil {
			t.Fatalf("accepted invalid assignment: %s", id)
		}
	}
	stale := int64(0)
	if _, err := svc.UpdateSkillCuration(actor, SkillCurationUpdate{ExpectedRevision: &stale, Enabled: &on}, ""); appErrorStatus(err) != 409 {
		t.Fatalf("stale update: %v", err)
	}
	c.Name = "Renamed"
	c.SortOrder = -1
	c.Enabled = false
	state = update(SkillCurationUpdate{Category: &c})
	public, err := svc.SkillCuration(actor, false)
	if err != nil || len(public.Categories) != 0 || len(public.Assignments) != 0 {
		t.Fatalf("disabled category: %#v %v", public, err)
	}
	var assignments int64
	db.Model(&model.SkillCurationAssignment{}).Count(&assignments)
	if assignments != 1 {
		t.Fatal("disable deleted assignments")
	}
	c.Enabled = true
	update(SkillCurationUpdate{Category: &c})
	off := false
	update(SkillCurationUpdate{Enabled: &off})
	list, err = svc.Skills(actor.ID, SkillListRequest{PlatformCategoryID: c.ID})
	if err != nil || list.TotalCount != 2 {
		t.Fatalf("disabled switch must ignore filters: %#v %v", list, err)
	}
	// A stale in-memory administrator cannot keep writing after revocation.
	db.Model(&model.User{}).Where("id = ?", actor.ID).Update("role", model.UserRoleUser)
	if _, err := svc.UpdateSkillCuration(actor, SkillCurationUpdate{ExpectedRevision: &state.Revision, Enabled: &on}, ""); appErrorStatus(err) != 403 {
		t.Fatalf("revoked administrator: %v", err)
	}
}

func TestSkillCurationAuditFailureRollsBack(t *testing.T) {
	svc, db, actor := newCurationTest(t)
	if err := db.Exec(`CREATE TRIGGER reject_curation_audit BEFORE INSERT ON admin_audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`).Error; err != nil {
		t.Fatal(err)
	}
	revision := int64(0)
	on := true
	if _, err := svc.UpdateSkillCuration(actor, SkillCurationUpdate{ExpectedRevision: &revision, Enabled: &on}, ""); err == nil {
		t.Fatal("audit failure accepted")
	}
	state, err := svc.SkillCuration(actor, true)
	if err != nil || state.Revision != 0 || state.Enabled {
		t.Fatalf("partial commit: %#v %v", state, err)
	}
}

func TestSkillCurationDeletionCleanup(t *testing.T) {
	svc, db, _ := newCurationTest(t)
	if err := db.AutoMigrate(&model.SkillVersion{}, &model.SkillFile{}, &model.BuiltinSkillTombstone{}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"normal", "builtin"} {
		db.Create(&model.Skill{ID: id, Status: 1})
		db.Create(&model.SkillCurationAssignment{SkillID: id, CategoryID: "category"})
	}
	if err := svc.repo.DeleteSkill("normal"); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.DeleteBuiltinSkill("builtin", "admin"); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&model.SkillCurationAssignment{}).Count(&count)
	if count != 0 {
		t.Fatal("deleted skills retain assignments")
	}
}
