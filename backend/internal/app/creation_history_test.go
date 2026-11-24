package app

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func historyTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "history.db")+"?_journal_mode=WAL&_busy_timeout=5000"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&model.CreationConversation{}, &model.CreationConversationMessage{}, &model.CreationConversationResource{}, &model.Resource{}, &model.Task{}, &model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	return &Service{repo: repository.New(db)}, db
}

func historyMessage(id, text string, revision int64) CreationHistoryMessage {
	return CreationHistoryMessage{ID: id, Revision: revision, Data: map[string]any{"id": id, "role": "assistant", "content": text, "createdAt": "2026-10-24T01:00:00Z", "status": "done"}}
}
func syncHistory(t *testing.T, s *Service, id string, req CreationHistoryMutation) *CreationHistoryDetail {
	t.Helper()
	value, err := s.SyncCreationHistory("u1", id, req)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func TestCreationHistoryMigrationRetryAndConcurrentAppend(t *testing.T) {
	s, _ := historyTestService(t)
	verifyHistoryConcurrentAppend(t, s)
}

func verifyHistoryConcurrentAppend(t *testing.T, s *Service) {
	t.Helper()
	req := CreationHistoryMutation{Metadata: &CreationHistoryMetadata{Title: "历史"}, Messages: []CreationHistoryMessage{historyMessage("m1", "原记录", 0)}}
	first := syncHistory(t, s, "c1", req)
	retry := syncHistory(t, s, "c1", req)
	if first.Revision != retry.Revision || len(retry.Messages) != 1 || retry.Messages[0].Revision != 1 {
		t.Fatal("retry duplicated history or revisions")
	}
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := s.SyncCreationHistory("u1", "c1", CreationHistoryMutation{Messages: []CreationHistoryMessage{historyMessage(fmt.Sprintf("append-%d", i), "追加", 0)}})
			errs <- err
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	all, err := s.GetCreationHistory("u1", "c1")
	if err != nil || len(all.Messages) != 9 {
		t.Fatalf("concurrent append lost messages: %v", err)
	}
	other, _ := s.ListCreationHistory("u2", "")
	if len(other["items"].([]model.CreationConversation)) != 0 {
		t.Fatal("list leaked another user")
	}
	if _, err := s.GetCreationHistory("u2", "c1"); err == nil {
		t.Fatal("get leaked another user")
	}
}

func TestCreationHistoryPostgresConcurrency(t *testing.T) {
	dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
	}
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, _ := base.DB()
	t.Cleanup(func() { _ = baseSQL.Close() })
	schema := fmt.Sprintf("conversation_sync_%d", time.Now().UnixNano())
	if err := base.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := base.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
			t.Error(err)
		}
	})
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.CreationConversation{}, &model.CreationConversationMessage{}, &model.CreationConversationResource{}, &model.Resource{}, &model.Task{}, &model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	verifyHistoryConcurrentAppend(t, &Service{repo: repository.New(db)})
}

func TestCreationHistoryMessageTombstoneAndAtomicRollback(t *testing.T) {
	s, db := historyTestService(t)
	first := syncHistory(t, s, "c", CreationHistoryMutation{Messages: []CreationHistoryMessage{historyMessage("m1", "keep", 0), historyMessage("m2", "remove", 0)}})
	deleted := syncHistory(t, s, "c", CreationHistoryMutation{Messages: []CreationHistoryMessage{{ID: "m2", Revision: first.Messages[1].Revision, Deleted: true}}})
	retry := syncHistory(t, s, "c", CreationHistoryMutation{Messages: []CreationHistoryMessage{{ID: "m2", Revision: first.Messages[1].Revision, Deleted: true}}})
	if deleted.Revision != retry.Revision || !retry.Messages[1].Deleted {
		t.Fatal("message delete retry is not idempotent")
	}
	stale := syncHistory(t, s, "c", CreationHistoryMutation{Messages: []CreationHistoryMessage{historyMessage("m2", "stale", 1)}})
	if !stale.Messages[1].Deleted || len(stale.Conflicts) != 1 {
		t.Fatal("stale device revived deleted message")
	}
	var row model.CreationConversationMessage
	if err := db.First(&row, "id = ?", "m2").Error; err != nil || row.PayloadJSON != "" {
		t.Fatal("deleted message retained payload")
	}
	bad := historyMessage("bad", "bad", 0)
	bad.Data["config"] = "must reject"
	if _, err := s.SyncCreationHistory("u1", "rollback", CreationHistoryMutation{Metadata: &CreationHistoryMetadata{Title: "rollback"}, Messages: []CreationHistoryMessage{historyMessage("valid", "valid", 0), bad}}); err == nil {
		t.Fatal("invalid batch accepted")
	}
	if _, err := s.GetCreationHistory("u1", "rollback"); err == nil {
		t.Fatal("invalid batch was partially committed")
	}
}

func TestCreationHistoryStaleMigrationRenameAndDeleteWins(t *testing.T) {
	s, db := historyTestService(t)
	first := syncHistory(t, s, "c1", CreationHistoryMutation{Metadata: &CreationHistoryMetadata{Title: "original"}, Messages: []CreationHistoryMessage{historyMessage("m1", "new cloud", 0)}})
	stale := syncHistory(t, s, "c1", CreationHistoryMutation{Metadata: &CreationHistoryMetadata{Title: "old cache"}, Messages: []CreationHistoryMessage{historyMessage("m1", "old cache", 0), historyMessage("m2", "missing on cloud", 0)}})
	if len(stale.Conflicts) != 2 || stale.Title != "original" || len(stale.Messages) != 2 {
		t.Fatal("legacy cache overwrote cloud or lost distinct message")
	}
	renamed := syncHistory(t, s, "c1", CreationHistoryMutation{Metadata: &CreationHistoryMetadata{Revision: first.MetadataRevision, Title: "new title"}})
	lost := syncHistory(t, s, "c1", CreationHistoryMutation{Metadata: &CreationHistoryMetadata{Revision: first.MetadataRevision, Title: "other title"}})
	if lost.Title != renamed.Title || len(lost.Conflicts) != 1 {
		t.Fatal("stale rename overwrote cloud")
	}
	deleted := syncHistory(t, s, "c1", CreationHistoryMutation{Delete: true})
	revived := syncHistory(t, s, "c1", CreationHistoryMutation{Metadata: &CreationHistoryMetadata{Title: "resurrect"}, Messages: []CreationHistoryMessage{historyMessage("m3", "offline", 0)}})
	if !revived.Deleted || revived.Revision != deleted.Revision || len(revived.Messages) != 0 {
		t.Fatal("old device resurrected deleted history")
	}
	var n int64
	db.Model(&model.CreationConversationMessage{}).Count(&n)
	if n != 0 {
		t.Fatal("deleted history retained message payload")
	}
	// Delete before an offline conversation ever uploads must also create a tombstone.
	syncHistory(t, s, "offline", CreationHistoryMutation{Delete: true})
	if !syncHistory(t, s, "offline", CreationHistoryMutation{Messages: []CreationHistoryMessage{historyMessage("m", "late upload", 0)}}).Deleted {
		t.Fatal("missing-row tombstone ignored")
	}
}

func TestCreationHistoryMediaTaskOwnershipAndNoCascade(t *testing.T) {
	s, db := historyTestService(t)
	for _, row := range []any{&model.Resource{ID: "r1", UserID: "u1", Status: model.ResourceStatusReady}, &model.Resource{ID: "r2", UserID: "u2", Status: model.ResourceStatusReady}, &model.Task{ID: "t1", UserID: "u1"}, &model.Task{ID: "t2", UserID: "u2"}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	message := historyMessage("m1", "result", 0)
	message.Data["resultStorageKeys"] = []any{"resource:r2"}
	if _, err := s.SyncCreationHistory("u1", "c1", CreationHistoryMutation{Messages: []CreationHistoryMessage{message}}); err == nil {
		t.Fatal("foreign resource accepted")
	}
	message.Data["resultStorageKeys"] = []any{"resource:r1"}
	message.Data["taskIds"] = []any{"t2"}
	if _, err := s.SyncCreationHistory("u1", "c1", CreationHistoryMutation{Messages: []CreationHistoryMessage{message}}); err == nil {
		t.Fatal("foreign task accepted")
	}
	message.Data["taskIds"] = []any{"t1"}
	result := syncHistory(t, s, "c1", CreationHistoryMutation{Messages: []CreationHistoryMessage{message}})
	if result.Messages[0].Data["taskIds"].([]any)[0] != "t1" {
		t.Fatal("lost task recovery association")
	}
	var links int64
	db.Model(&model.CreationConversationResource{}).Count(&links)
	if links != 1 {
		t.Fatal("missing media reference protection")
	}
	syncHistory(t, s, "c1", CreationHistoryMutation{Delete: true})
	var resources, tasks int64
	db.Model(&model.Resource{}).Count(&resources)
	db.Model(&model.Task{}).Count(&tasks)
	if resources != 2 || tasks != 2 {
		t.Fatal("history delete cascaded into tasks or resources")
	}
	db.Model(&model.CreationConversationResource{}).Count(&links)
	if links != 0 {
		t.Fatal("history reference retained after delete")
	}
}

func TestCreationHistoryRejectsTransientAndCredentialPayloads(t *testing.T) {
	s, _ := historyTestService(t)
	for _, bad := range []map[string]any{{"resultUrls": []any{"blob:local"}}, {"config": map[string]any{"apiKey": "test-only"}}, {"attachments": []any{map[string]any{"storageKey": "image:local", "url": "data:image/png;base64,AA=="}}}, {"references": []any{map[string]any{"storageKey": "resource:r1", "skill": map[string]any{"config": "x"}}}}} {
		message := historyMessage("m1", "test", 0)
		for key, value := range bad {
			message.Data[key] = value
		}
		if _, err := s.SyncCreationHistory("u1", "bad", CreationHistoryMutation{Messages: []CreationHistoryMessage{message}}); err == nil {
			encoded, _ := json.Marshal(bad)
			t.Fatalf("accepted invalid schema: %s", encoded)
		}
	}
	if _, err := s.SyncCreationHistory("", "c1", CreationHistoryMutation{Delete: true}); err == nil {
		t.Fatal("empty user accepted")
	}
}

func TestCreationHistorySameTimestampOrderAndTerminalMonotonicity(t *testing.T) {
	s, _ := historyTestService(t)
	first := syncHistory(t, s, "ordered", CreationHistoryMutation{Messages: []CreationHistoryMessage{historyMessage("z-user", "first", 0), historyMessage("a-reply", "second", 0)}})
	if first.Messages[0].ID != "z-user" || first.Messages[1].ID != "a-reply" {
		t.Fatal("random IDs reordered same-timestamp messages")
	}
	regression := historyMessage("a-reply", "", first.Messages[1].Revision)
	regression.Data["status"] = "pending"
	result := syncHistory(t, s, "ordered", CreationHistoryMutation{Messages: []CreationHistoryMessage{regression}})
	if len(result.Conflicts) != 1 || result.Messages[1].Data["status"] != "done" {
		t.Fatal("completed message regressed to generating")
	}
}

func TestCreationHistoryProtectsMediaFromDetachedCleanup(t *testing.T) {
	svc, db, _ := newResourceDeletionTestService(t)
	resource := model.Resource{ID: "history-only-resource", UserID: "u1", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "users/u1/image/history-only.png"}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	message := historyMessage("m1", "history only", 0)
	message.Data["resultStorageKeys"] = []any{"resource:history-only-resource"}
	syncHistory(t, svc, "media-history", CreationHistoryMutation{Messages: []CreationHistoryMessage{message}})
	if err := svc.cleanupDetachedUserResources("u1", []model.Resource{resource}); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.Resource{}).Where("id = ?", resource.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("history media was collected: %v", err)
	}
}
