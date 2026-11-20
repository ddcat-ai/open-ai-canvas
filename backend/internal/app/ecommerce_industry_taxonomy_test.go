package app

import (
	"testing"
	"yingce/backend/internal/model"
)

func TestIndustryDictionaryInstallsOnceAndPreservesAdministratorChoices(t *testing.T) {
	svc, db := knowledgeTestService(t)
	report, err := svc.EnsureIndustryTaxonomyKnowledge()
	if err != nil {
		t.Fatal(err)
	}
	if report.Shipped != 64292 || report.Inserted != 64292 {
		t.Fatalf("incomplete dictionary %+v", report)
	}
	if err := svc.repo.ReviewEcommerceKnowledgeEntry("industry-taxonomy-hg-11-7-29", "rejected"); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SetEcommerceKnowledgeSourceStatus(industryTaxonomySourceID, "disabled"); err != nil {
		t.Fatal(err)
	}
	again, err := svc.EnsureIndustryTaxonomyKnowledge()
	if err != nil || !again.AlreadyInstalled || again.Inserted != 0 {
		t.Fatalf("repeat initialization %+v %v", again, err)
	}
	var count int64
	db.Model(&model.EcommerceKnowledgeEntry{}).Where("source_id = ?", industryTaxonomySourceID).Count(&count)
	if count != 64292 {
		t.Fatal(count)
	}
	entry, _ := svc.repo.EcommerceKnowledgeEntryByID("industry-taxonomy-hg-11-7-29")
	if entry.ReviewStatus != "rejected" {
		t.Fatal("review overwritten")
	}
	source, _ := svc.repo.EcommerceKnowledgeSource(industryTaxonomySourceID)
	if source.Status != "disabled" {
		t.Fatal("source reenabled")
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	page, err := svc.EcommerceIndustryCategories(admin, "", "", 1, 50)
	if err != nil || page["total"] != 26 {
		t.Fatalf("root browser: %+v %v", page, err)
	}
}
