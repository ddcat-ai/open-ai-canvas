package repository

import (
	"errors"
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
)

func TestCreationAgentAdmissionAcrossConnections(t *testing.T) {
	t.Run("sqlite", func(t *testing.T) { testCreationAgentAdmissionAcrossConnections(t, "sqlite") })
	t.Run("postgres", func(t *testing.T) { testCreationAgentAdmissionAcrossConnections(t, "postgres") })
}

func testCreationAgentAdmissionAcrossConnections(t *testing.T, driver string) {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "creation-admission.db") + "?_journal_mode=WAL&_busy_timeout=5000"
	var dialector gorm.Dialector = sqlite.Open(dsn)
	if driver == "postgres" {
		dsn = os.Getenv("CANVAS_TEST_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
		}
		admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
		if err != nil {
			t.Fatal(err)
		}
		schema := fmt.Sprintf("creation_admission_%d", time.Now().UnixNano())
		if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
				t.Error(err)
			}
			sqlDB, _ := admin.DB()
			_ = sqlDB.Close()
		})
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatal(err)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		dialector = postgres.Open(parsed.String())
	}
	open := func() *Repository {
		db, err := gorm.Open(dialector, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = sqlDB.Close() })
		return New(db)
	}
	a, b := open(), open()
	if err := a.db.AutoMigrate(&model.User{}, &model.Task{}, &model.CloudAgentExecution{}, &model.AgentSession{}, &model.CreditAccount{}, &model.BillingOrder{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.User{ID: "user", Username: "user", Status: "active"},
		&model.AgentSession{ID: "session", UserID: "user", Surface: "creation", Status: "active"},
		&model.CreditAccount{UserID: "user", AvailableMicrocredits: 10000},
	} {
		if err := a.db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	var parent string
	for round := range 2 {
		start, results := make(chan struct{}), make(chan error, 2)
		var wg sync.WaitGroup
		for i, repo := range []*Repository{a, b} {
			wg.Add(1)
			go func(i int, repo *Repository) {
				defer wg.Done()
				<-start
				// Neither new task has a checkpoint yet. The committed root
				// reservation must still block its sibling before billing.
				id := fmt.Sprintf("run-%d-%d", round, i)
				results <- repo.CreateTaskWithCreditReservation(&model.Task{ID: id, UserID: "user", Operation: "cloud_agent", Status: model.TaskStatusTextReplay,
					InputJSON: fmt.Sprintf(`{"cloudAgent":{"parentId":%q,"request":{"surface":"creation","sessionId":"session"}}}`, parent)},
					&model.BillingOrder{ID: "order-" + id, UserID: "user", TaskID: id, IdempotencyKey: "task:" + id, AmountMicrocredits: 100}, 100)
			}(i, repo)
		}
		close(start)
		wg.Wait()
		close(results)
		accepted, rejected := 0, 0
		for err := range results {
			if err == nil {
				accepted++
			} else {
				var conflict *AgentSessionContinuationError
				if !errors.As(err, &conflict) || conflict.SessionID != "session" || conflict.StaleParent || conflict.Activity.RunID == "" || conflict.Activity.Status != "queued" {
					t.Fatalf("unexpected admission failure: %+v", err)
				}
				rejected++
			}
		}
		if accepted != 1 || rejected != 1 {
			t.Fatalf("round %d forked one session: accepted=%d rejected=%d", round, accepted, rejected)
		}
		for _, table := range []any{&model.Task{}, &model.BillingOrder{}, &model.CreditLedgerEntry{}} {
			var count int64
			if err := a.db.Model(table).Count(&count).Error; err != nil || count != int64(round+1) {
				t.Fatalf("round %d unexpected %T count=%d err=%v", round, table, count, err)
			}
		}
		account, err := a.CreditAccount("user")
		if err != nil || account.AvailableMicrocredits != 10000-int64(round+1)*100 || account.ReservedMicrocredits != int64(round+1)*100 {
			t.Fatalf("rejected sibling reserved credits: account=%+v err=%v", account, err)
		}
		var winner model.Task
		if err := a.db.Order("created_at DESC, id DESC").First(&winner).Error; err != nil {
			t.Fatal(err)
		}
		if err := a.EnsureCloudAgent(&model.CloudAgentExecution{ID: winner.ID, UserID: "user", Surface: "creation", SessionID: "session", ParentID: parent, Status: "completed", CreatedAt: winner.CreatedAt}); err != nil {
			t.Fatal(err)
		}
		parent = winner.ID
	}
	if err := b.CreateTaskWithActiveLimit(&model.Task{ID: "ordinary-video", UserID: "user", Operation: "generate", Status: model.TaskStatusQueued}, 100); err != nil {
		t.Fatalf("ordinary media submission blocked: %v", err)
	}
	if err := b.db.Create(&model.AgentSession{ID: "other-session", UserID: "user", Surface: "creation", Status: "active"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := b.CreateTaskWithActiveLimit(&model.Task{ID: "other-agent", UserID: "user", Operation: "cloud_agent", Status: model.TaskStatusTextReplay,
		InputJSON: `{"cloudAgent":{"request":{"surface":"creation","sessionId":"other-session"}}}`}, 100); err != nil {
		t.Fatalf("another conversation blocked: %v", err)
	}
}
