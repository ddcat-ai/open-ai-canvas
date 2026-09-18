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

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestCanvasRevision(t *testing.T) {
	t.Run("sqlite", func(t *testing.T) {
		db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "canvas.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, _ := db.DB()
		sqlDB.SetMaxOpenConns(1)
		t.Cleanup(func() { _ = sqlDB.Close() })
		testCanvasRevision(t, db)
	})
	t.Run("postgres", func(t *testing.T) {
		dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
		}
		config := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
		admin, err := gorm.Open(postgres.Open(dsn), config)
		if err != nil {
			t.Fatal(err)
		}
		schema := fmt.Sprintf("canvas_revision_%d", time.Now().UnixNano())
		if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_ = admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error
			connection, _ := admin.DB()
			_ = connection.Close()
		})
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatal(err)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		db, err := gorm.Open(postgres.Open(parsed.String()), config)
		if err != nil {
			t.Fatal(err)
		}
		connection, _ := db.DB()
		t.Cleanup(func() { _ = connection.Close() })
		testCanvasRevision(t, db)
	})
}

func testCanvasRevision(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&model.CanvasProject{}, &model.CanvasUnitLink{}, &model.Project{}); err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	initial := model.CanvasProject{ID: "canvas", UserID: "owner", Title: "initial", PayloadJSON: `{"nodes":[{"id":"old"}]}`}
	if err := repo.UpsertCanvasProject(&initial); err != nil {
		t.Fatal(err)
	}
	if initial.Revision != 1 {
		t.Fatalf("initial revision = %d", initial.Revision)
	}

	start := make(chan struct{})
	results := make(chan error, 2)
	var workers sync.WaitGroup
	for _, title := range []string{"editor A", "editor B"} {
		workers.Add(1)
		go func(title string) {
			defer workers.Done()
			copy := initial
			copy.Title = title
			copy.PayloadJSON = fmt.Sprintf(`{"nodes":[{"id":%q}]}`, title)
			<-start
			results <- repo.UpsertCanvasProject(&copy)
		}(title)
	}
	close(start)
	workers.Wait()
	close(results)
	successes, conflicts := 0, 0
	for err := range results {
		if err == nil {
			successes++
		} else if errors.Is(err, ErrCanvasRevisionConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("successes=%d conflicts=%d", successes, conflicts)
	}
	winner, err := repo.CanvasProjectForUser("owner", initial.ID)
	if err != nil {
		t.Fatal(err)
	}
	if winner.Revision != 2 {
		t.Fatalf("winner revision = %d", winner.Revision)
	}
	old := initial
	old.UpdatedAt = time.Now().Add(time.Hour)
	if err := repo.UpsertCanvasProject(&old); !errors.Is(err, ErrCanvasRevisionConflict) {
		t.Fatalf("stale write = %v", err)
	}
	wrongOwner := *winner
	wrongOwner.UserID = "another-user"
	if err := repo.UpsertCanvasProject(&wrongOwner); !errors.Is(err, ErrCanvasRevisionConflict) {
		t.Fatalf("wrong owner = %v", err)
	}
	createCollision := initial
	createCollision.Revision = 0
	if err := repo.UpsertCanvasProject(&createCollision); !errors.Is(err, ErrCanvasRevisionConflict) {
		t.Fatalf("create collision = %v", err)
	}
	stored, _ := repo.CanvasProjectForUser("owner", initial.ID)
	if stored.PayloadJSON != winner.PayloadJSON || stored.Revision != 2 {
		t.Fatal("rejected save changed the canvas")
	}

	if err := repo.AssignCanvasToProject("owner", initial.ID, "project"); err != nil {
		t.Fatal(err)
	}
	if err := repo.UpsertCanvasProject(winner); !errors.Is(err, ErrCanvasRevisionConflict) {
		t.Fatalf("association did not invalidate old content: %v", err)
	}
	if err := repo.UnassignCanvasFromProject("owner", "project", initial.ID, `{"nodes":[]}`, time.Now(), 2); err == nil {
		t.Fatal("stale unassignment replaced canvas content")
	}
	stored, _ = repo.CanvasProjectForUser("owner", initial.ID)
	if stored.PayloadJSON != winner.PayloadJSON || stored.Revision != 3 {
		t.Fatal("stale unassignment changed the canvas")
	}
	if err := db.Delete(&model.CanvasProject{}, "id = ?", initial.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.UpsertCanvasProject(stored); !errors.Is(err, ErrCanvasRevisionConflict) {
		t.Fatalf("deleted canvas was recreated: %v", err)
	}
	t.Run("history", func(t *testing.T) { testCanvasHistory(t, db) })
}
