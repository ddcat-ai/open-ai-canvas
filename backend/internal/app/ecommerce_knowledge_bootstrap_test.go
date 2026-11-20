package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
)

// knowledgeTestService runs the production schema migrations on an isolated
// sqlite file before seeding the usual creation fixtures.
func knowledgeTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	options := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	var db *gorm.DB
	var err error
	if dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN"); dsn != "" {
		// Isolated schema on a throwaway test database; dropped afterwards.
		admin, openErr := gorm.Open(postgres.Open(dsn), options)
		if openErr != nil {
			t.Fatal(openErr)
		}
		schema := "kb_test_" + strings.ReplaceAll(newID(), "-", "")[:16]
		if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_ = admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error
			if sqlDB, err := admin.DB(); err == nil {
				_ = sqlDB.Close()
			}
		})
		separator := "?"
		if strings.Contains(dsn, "?") {
			separator = "&"
		}
		db, err = gorm.Open(postgres.Open(dsn+separator+"search_path="+schema), options)
	} else {
		db, err = gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "knowledge.db")+"?_journal_mode=WAL&_busy_timeout=5000"), options)
	}
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := database.RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
	svc, db, _, _ := creationTestServiceOnDatabase(t, db)
	if err := db.Create(&model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	return svc, db
}

func builtinRowCounts(t *testing.T, db *gorm.DB) (int64, map[string]int64) {
	t.Helper()
	var total int64
	if err := db.Model(&model.EcommerceKnowledgeEntry{}).Where("source_id LIKE ?", "meiye-kb%").Count(&total).Error; err != nil {
		t.Fatal(err)
	}
	var rows []struct {
		KnowledgeDomain string
		Count           int64
	}
	if err := db.Model(&model.EcommerceKnowledgeEntry{}).Select("knowledge_domain, count(*) AS count").Where("source_id LIKE ?", "meiye-kb%").Group("knowledge_domain").Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	byDomain := map[string]int64{}
	for _, row := range rows {
		byDomain[row.KnowledgeDomain] = row.Count
	}
	return total, byDomain
}

func shippedWith(t *testing.T, change func(entries []model.EcommerceKnowledgeEntry) []model.EcommerceKnowledgeEntry) []model.EcommerceKnowledgeEntry {
	t.Helper()
	entries := change(ecommerceBuiltinKnowledgeEntries())
	for i := range entries {
		entries[i].DedupHash = ecommerceKnowledgeContentHash(entries[i])
	}
	return entries
}

func indexOfEntry(t *testing.T, entries []model.EcommerceKnowledgeEntry, id string) int {
	t.Helper()
	for i, entry := range entries {
		if entry.ID == id {
			return i
		}
	}
	t.Fatalf("shipped entry %s missing", id)
	return -1
}

func bumpEntry(entry *model.EcommerceKnowledgeEntry, version, guidance string) {
	content, _ := json.Marshal(map[string]string{"guidance": guidance, "domain": entry.KnowledgeDomain})
	entry.ContentJSON, entry.Version = string(content), version
}

func TestEnsureBuiltinEcommerceKnowledgeImportVersioningAndRollback(t *testing.T) {
	svc, db := knowledgeTestService(t)
	shipped := ecommerceBuiltinKnowledgeEntries()

	// 1. First import writes every shipped entry and one source per domain.
	first, err := svc.EnsureBuiltinEcommerceKnowledge()
	if err != nil {
		t.Fatal(err)
	}
	total, byDomain := builtinRowCounts(t, db)
	t.Logf("first import: shipped=%d inserted=%d sources=%d rows=%d byDomain=%v", first.Shipped, len(first.Inserted), len(first.SourcesCreated), total, byDomain)
	if first.Shipped != len(shipped) || len(first.Inserted) != len(shipped) || total != int64(len(shipped)) || len(first.SourcesCreated) != len(ecommerceBuiltinSourceSpecs) {
		t.Fatalf("first import incomplete: report=%+v rows=%d", first, total)
	}
	for _, domain := range []string{"KB01", "KB02", "KB03", "KB04", "KB05", "KB06", "KB07", "KB08", "KB09", "KB10"} {
		if byDomain[domain] < 10 {
			t.Fatalf("%s has %d rows", domain, byDomain[domain])
		}
	}
	var ready int64
	db.Model(&model.EcommerceKnowledgeSource{}).Where("id LIKE ? AND status = ?", "meiye-kb%", "ready").Count(&ready)
	if ready != int64(len(ecommerceBuiltinSourceSpecs)) {
		t.Fatalf("ready builtin sources = %d", ready)
	}

	// 2. A repeated run is a no-op.
	second, err := svc.EnsureBuiltinEcommerceKnowledge()
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := builtinRowCounts(t, db); again != total || len(second.Inserted) != 0 || len(second.Updated) != 0 || second.Unchanged != len(shipped) {
		t.Fatalf("repeat import changed data: rows=%d report=%+v", again, second)
	}

	// 3. Administrator actions: reject one entry, edit another, disable a source.
	admin, _ := svc.repo.User("admin")
	rejected, edited, pristine := "kb06-white-background-technique", "kb05-headline-writing", "kb03-color-theory"
	for _, id := range []string{rejected, edited, pristine} {
		indexOfEntry(t, shipped, id)
	}
	if err := svc.ReviewEcommerceKnowledgeEntry(admin, rejected, "rejected"); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.EcommerceKnowledgeEntry{}).Where("id = ?", edited).Update("content_json", `{"guidance":"管理员改写的标题方法"}`).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.SetEcommerceKnowledgeSourceEnabled(admin, "meiye-kb09", false); err != nil {
		t.Fatal(err)
	}

	// 4. A newer shipped version upgrades pristine rows only.
	upgrade := shippedWith(t, func(entries []model.EcommerceKnowledgeEntry) []model.EcommerceKnowledgeEntry {
		for _, id := range []string{rejected, edited, pristine} {
			i := indexOfEntry(t, entries, id)
			bumpEntry(&entries[i], strings.Replace(entries[i].Version, "-v1-", "-v2-", 1), "升级后的方法 "+id)
		}
		added := entries[indexOfEntry(t, entries, pristine)]
		added.ID, added.Title = "kb03-upgrade-added-entry", "升级新增的视觉方法"
		return append(entries, added)
	})
	report, err := svc.ensureBuiltinEcommerceKnowledge(upgrade)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("upgrade report: inserted=%v updated=%v preservedLocal=%v unchanged=%d", report.Inserted, report.Updated, report.PreservedLocal, report.Unchanged)
	if strings.Join(report.Inserted, ",") != "kb03-upgrade-added-entry" || strings.Join(report.PreservedLocal, ",") != edited || len(report.Updated) != 2 {
		t.Fatalf("unexpected upgrade report: %+v", report)
	}
	load := func(id string) model.EcommerceKnowledgeEntry {
		entry, err := svc.repo.EcommerceKnowledgeEntryByID(id)
		if err != nil {
			t.Fatal(err)
		}
		return *entry
	}
	if got := load(pristine); !strings.Contains(got.ContentJSON, "升级后的方法") || !strings.Contains(got.Version, "-v2-") || got.ReviewStatus != "approved" {
		t.Fatalf("pristine entry not upgraded: %+v", got)
	}
	if got := load(rejected); !strings.Contains(got.ContentJSON, "升级后的方法") || got.ReviewStatus != "rejected" {
		t.Fatalf("rejected entry lost its review status: %+v", got)
	}
	if got := load(edited); got.ContentJSON != `{"guidance":"管理员改写的标题方法"}` || strings.Contains(got.Version, "-v2-") {
		t.Fatalf("administrator edit was overwritten: %+v", got)
	}
	if source, _ := svc.repo.EcommerceKnowledgeSource("meiye-kb09"); source.Status != "disabled" {
		t.Fatalf("bootstrap re-enabled a disabled source: %s", source.Status)
	}

	// 5. An older binary does not downgrade upgraded rows.
	if _, err := svc.EnsureBuiltinEcommerceKnowledge(); err != nil {
		t.Fatal(err)
	}
	if got := load(pristine); !strings.Contains(got.Version, "-v2-") {
		t.Fatalf("older shipped version downgraded the row: %s", got.Version)
	}

	// 6. A failure in the middle rolls back every change of that run.
	before, _ := builtinRowCounts(t, db)
	failing := shippedWith(t, func(entries []model.EcommerceKnowledgeEntry) []model.EcommerceKnowledgeEntry {
		i := indexOfEntry(t, entries, pristine)
		bumpEntry(&entries[i], strings.Replace(entries[i].Version, "-v1-", "-v3-", 1), "不应提交的第三版")
		fresh := entries[i]
		fresh.ID, fresh.Title = "kb03-rollback-probe", "回滚探针"
		return append(entries, fresh)
	})
	collider := failing[len(failing)-1]
	collider.ID = "kb03-rollback-collider"
	collider.DedupHash = load("kb02-usp-framework").DedupHash // violates the unique hash index
	failing = append(failing, collider)
	if _, err := svc.ensureBuiltinEcommerceKnowledge(failing); err == nil {
		t.Fatal("unique violation was not reported")
	} else {
		t.Logf("expected failure: %v", err)
	}
	after, _ := builtinRowCounts(t, db)
	if after != before {
		t.Fatalf("failed run changed row count %d -> %d", before, after)
	}
	if _, err := svc.repo.EcommerceKnowledgeEntryByID("kb03-rollback-probe"); err == nil {
		t.Fatal("insert before the failure was committed")
	}
	if got := load(pristine); strings.Contains(got.ContentJSON, "第三版") || !strings.Contains(got.Version, "-v2-") {
		t.Fatalf("update before the failure was committed: %+v", got)
	}
}

func TestBuiltinKnowledgeFallbackOnlyForMissingSources(t *testing.T) {
	all := ecommerceBuiltinKnowledgeEntries()
	if got := len(ecommerceBuiltinKnowledgeFallback(nil)); got != len(all) {
		t.Fatalf("fresh database fallback = %d, want %d", got, len(all))
	}
	fallback := ecommerceBuiltinKnowledgeFallback([]model.EcommerceKnowledgeSource{{ID: "meiye-kb06", Status: "disabled"}})
	for _, entry := range fallback {
		if entry.SourceID == "meiye-kb06" {
			t.Fatal("a bootstrapped (even disabled) source must not fall back to shipped entries")
		}
	}
}
