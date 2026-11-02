package app

import (
	"errors"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/ecommercecatalog"
	"yingce/backend/internal/ecommerceskills"
	"yingce/backend/internal/model"
)

func TestEcommerceUpgradeShipsKnowledgeSkillsAndIndustryWithoutModels(t *testing.T) {
	svc, db := knowledgeTestService(t)
	for _, record := range []any{&model.ChannelModelPriceTier{}, &model.ChannelModel{}, &model.ModelChannel{}} {
		if err := db.Unscoped().Where("1 = 1").Delete(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.EnsureBundledEcommerceKnowledge(); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.EnsureBuiltinEcommerceKnowledge(); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.EnsureIndustryTaxonomyKnowledge(); err != nil {
		t.Fatal(err)
	}
	stats, err := svc.EcommerceKnowledgeStats()
	if err != nil {
		t.Fatal(err)
	}
	domains := stats["domainCoverage"].(map[string]int64)
	for _, domain := range []string{"KB01", "KB10", "KB11", "KB12", "KB13", "KB14", "KB15", "KB16", "KB17", "KB18", "KB19"} {
		if domains[domain] == 0 {
			t.Fatalf("upgrade omitted %s", domain)
		}
	}
	coverage, err := svc.EcommerceIndustryCoverage()
	if err != nil || coverage["indexedNodes"] != int64(ecommercecatalog.Metadata().Nodes) {
		t.Fatalf("industry data incomplete: %+v %v", coverage, err)
	}
	items, err := svc.EcommerceManagedSkills(&model.User{ID: "admin", Role: model.UserRoleAdmin})
	if err != nil || len(items) != len(ecommerceskills.ManagedCatalog()) {
		t.Fatalf("skills missing: %d, %v", len(items), err)
	}
	for _, item := range items {
		if !item.Enabled || item.Instructions == "" {
			t.Fatalf("skill not ready: %s", item.ID)
		}
	}
}

func TestBundledEcommerceKnowledgeInitializesAndPreservesAdministratorEdits(t *testing.T) {
	svc, db := knowledgeTestService(t)
	report, err := svc.EnsureBundledEcommerceKnowledge()
	if err != nil {
		t.Fatal(err)
	}
	if report.SourcesInserted != 23 || report.EntriesInserted != 14740 || report.AlreadyInstalled {
		t.Fatalf("incomplete first install: %+v", report)
	}
	stats, err := svc.EcommerceKnowledgeStats()
	if err != nil {
		t.Fatal(err)
	}
	if stats["entryCount"] != int64(14740) || stats["approvedCount"] != int64(14739) || stats["rejectedCount"] != int64(1) || stats["sourceCount"] != 23 {
		t.Fatalf("screenshot knowledge is missing: %+v", stats)
	}
	domains := stats["domainCoverage"].(map[string]int64)
	for domain, count := range domains {
		expected := int64(10)
		if domain == "KB01" {
			expected = 11
		}
		if count != expected {
			t.Fatalf("%s has %d entries, want %d", domain, count, expected)
		}
	}
	if len(domains) != 10 {
		t.Fatalf("missing knowledge domains: %+v", domains)
	}
	var entry model.EcommerceKnowledgeEntry
	if err := db.Where("source_id = ?", "meiye-kb01").First(&entry).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&entry).Updates(map[string]any{"title": "管理员自定义知识", "review_status": "rejected"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SetEcommerceKnowledgeSourceStatus("meiye-kb02", "disabled"); err != nil {
		t.Fatal(err)
	}
	second, err := svc.EnsureBundledEcommerceKnowledge()
	if err != nil || !second.AlreadyInstalled || second.EntriesInserted != 0 || second.SourcesInserted != 0 {
		t.Fatalf("restart repeated initialization: %+v, %v", second, err)
	}
	// A later bundle installation merges missing rows without undoing local edits.
	if err := svc.repo.DeleteSystemSetting(ecommerceKnowledgeBundleReceiptKey); err != nil {
		t.Fatal(err)
	}
	merged, err := svc.EnsureBundledEcommerceKnowledge()
	if err != nil || merged.EntriesInserted != 0 || merged.SourcesInserted != 0 {
		t.Fatalf("merge duplicated existing rows: %+v, %v", merged, err)
	}
	stored, err := svc.repo.EcommerceKnowledgeEntryByID(entry.ID)
	if err != nil || stored.Title != "管理员自定义知识" || stored.ReviewStatus != "rejected" {
		t.Fatalf("administrator decision overwritten: %+v, %v", stored, err)
	}
	source, err := svc.repo.EcommerceKnowledgeSource("meiye-kb02")
	if err != nil || source.Status != "disabled" {
		t.Fatalf("disabled source reenabled: %+v, %v", source, err)
	}
	// Rejected entries remain in the audit list and never enter Agent retrieval.
	active, err := svc.repo.SearchEcommerceKnowledgeEntries("general", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range active {
		if item.ReviewStatus != "approved" {
			t.Fatalf("rejected knowledge entered retrieval: %s", item.ID)
		}
	}
}

func TestBundledEcommerceKnowledgeInstallationRollsBackWithItsReceipt(t *testing.T) {
	svc, db := knowledgeTestService(t)
	failure := errors.New("bundle insert interrupted")
	const callback = "test:interrupt_ecommerce_bundle"
	if err := db.Callback().Create().Before("gorm:create").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == "ecommerce_knowledge_entries" {
			tx.AddError(failure)
		}
	}); err != nil {
		t.Fatal(err)
	}
	defer db.Callback().Create().Remove(callback)
	if _, err := svc.EnsureBundledEcommerceKnowledge(); !errors.Is(err, failure) {
		t.Fatalf("unexpected import error: %v", err)
	}
	var sources, entries int64
	db.Model(&model.EcommerceKnowledgeSource{}).Count(&sources)
	db.Model(&model.EcommerceKnowledgeEntry{}).Count(&entries)
	receipt, err := svc.repo.SystemSettingOptional(ecommerceKnowledgeBundleReceiptKey)
	if err != nil || receipt != nil || sources != 0 || entries != 0 {
		t.Fatalf("partial install escaped transaction: sources=%d entries=%d receipt=%+v err=%v", sources, entries, receipt, err)
	}
}
