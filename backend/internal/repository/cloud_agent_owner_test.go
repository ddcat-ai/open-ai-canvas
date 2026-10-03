package repository

import (
	"errors"
	"fmt"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCloudAgentOwnerRejectsStaleWriter(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "owner.db") + "?_busy_timeout=5000&_journal_mode=WAL"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	other, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	verifyCloudAgentOwners(t, db, other)
}

func TestPostgresCloudAgentOwnerRejectsStaleWriter(t *testing.T) {
	dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("CANVAS_TEST_POSTGRES_DSN not configured")
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("agent_owner_%d", time.Now().UnixNano())
	if err := base.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatal(err)
	}
	// Keep this isolated schema as evidence; no production or shared table is touched.
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	other, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	verifyCloudAgentOwners(t, db, other)
	conn, _ := base.DB()
	_ = conn.Close()
}

func verifyCloudAgentOwners(t *testing.T, db, other *gorm.DB) {
	t.Helper()
	defer func() { a, _ := db.DB(); b, _ := other.DB(); _ = a.Close(); _ = b.Close() }()
	if err := db.AutoMigrate(&model.CloudAgentExecution{}, &model.CloudAgentPiSession{}, &model.CloudAgentEventRecord{}, &model.CloudAgentMessageRecord{}, &model.CloudAgentReceipt{}, &model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CloudAgentExecution{ID: "run", UserID: "user", Status: "running", Revision: 1, StateJSON: `{"keep":"unchanged"}`}).Error; err != nil {
		t.Fatal(err)
	}
	a, b := New(db), New(other)
	if err := db.Create(&model.CloudAgentExecution{ID: "race", UserID: "user", Status: "running", Revision: 1, StateJSON: `{}`}).Error; err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, repo := range []*Repository{a, b} {
		wg.Add(1)
		go func(repo *Repository) {
			defer wg.Done()
			<-start
			_, err := repo.ClaimCloudAgentOwner("user", "race")
			results <- err
		}(repo)
	}
	close(start)
	wg.Wait()
	close(results)
	wins := 0
	for err := range results {
		if err == nil {
			wins++
		} else if !errors.Is(err, ErrCloudAgentOwnerLost) && !errors.Is(err, ErrCreationConflict) {
			t.Fatalf("unexpected race failure: %v", err)
		}
	}
	if wins != 1 {
		t.Fatalf("concurrent owners=%d", wins)
	}
	fa, err := a.ClaimCloudAgentOwner("user", "run")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := b.ClaimCloudAgentOwner("user", "run"); !errors.Is(err, ErrCloudAgentOwnerLost) {
		t.Fatalf("duplicate owner: %v", err)
	}
	if err := a.RenewCloudAgentOwner("user", "run", fa); err != nil {
		t.Fatal(err)
	}
	run, err := a.CloudAgent("user", "run")
	if err != nil {
		t.Fatal(err)
	}
	if err := a.MutateCloudAgent("user", "run", run.Revision, func(current *model.CloudAgentExecution, repo *Repository) error {
		lease, err := cloudAgentLease(current)
		if err != nil {
			return err
		}
		lease.LeaseUntil = 1
		return setCloudAgentLease(current, lease)
	}); err != nil {
		t.Fatal(err)
	}
	fb, err := b.ClaimCloudAgentOwner("user", "run")
	if err != nil || fb.Epoch <= fa.Epoch || fb.Token == fa.Token {
		t.Fatalf("takeover=%+v err=%v", fb, err)
	}
	run, _ = a.CloudAgent("user", "run")
	run.ExecutionFence = fa
	called := false
	err = a.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, repo *Repository) error {
		called = true
		current.Status = "failed"
		return nil
	})
	if !errors.Is(err, ErrCloudAgentOwnerLost) || called {
		t.Fatalf("stale callback executed=%v err=%v", called, err)
	}
	if err := a.ReleaseCloudAgentOwner("user", "run", fa); !errors.Is(err, ErrCloudAgentOwnerLost) {
		t.Fatalf("old release=%v", err)
	}
	if err := b.RenewCloudAgentOwner("user", "run", fb); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CanvasProject{ID: "receipt-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	// An effect and its receipt must roll back together on both actual dialects.
	run, _ = b.CloudAgent("user", "run")
	run.ExecutionFence = fb
	receipt := &model.CloudAgentReceipt{RunID: "run", UserID: "user", Kind: "tool", OperationKey: "write", Name: "canvas_apply_ops", InputSHA256: strings.Repeat("a", 64), Status: "committed", Content: strings.Repeat("x", CloudAgentReceiptContentLimit+1)}
	err = b.MutateCloudAgentRun(run, func(_ *model.CloudAgentExecution, repo *Repository) error {
		if err := repo.db.Model(&model.CanvasProject{}).Where("id = ?", "receipt-canvas").Update("payload_json", `{"nodes":[{"id":"once"}]}`).Error; err != nil {
			return err
		}
		return repo.SaveCloudAgentReceipt(receipt)
	})
	var canvas model.CanvasProject
	if err == nil || db.First(&canvas, "id = ?", "receipt-canvas").Error != nil || canvas.PayloadJSON != `{"nodes":[]}` {
		t.Fatalf("receipt failure left effect: %v %+v", err, canvas)
	}
	var count int64
	if err := db.Model(&model.CloudAgentReceipt{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("receipt failure left rows: count=%d err=%v", count, err)
	}
	receipt.Content = `{"ok":true}`
	err = b.MutateCloudAgentRun(run, func(_ *model.CloudAgentExecution, repo *Repository) error {
		if err := repo.db.Model(&model.CanvasProject{}).Where("id = ?", "receipt-canvas").Update("payload_json", `{"nodes":[{"id":"once"}]}`).Error; err != nil {
			return err
		}
		return repo.SaveCloudAgentReceipt(receipt)
	})
	if err != nil {
		t.Fatal(err)
	}
	stored, err := a.CloudAgentReceipt("user", "run", "tool", "write")
	if err != nil || stored.Content != receipt.Content || db.First(&canvas, "id = ?", "receipt-canvas").Error != nil || canvas.PayloadJSON != `{"nodes":[{"id":"once"}]}` {
		t.Fatalf("receipt/effect commit not visible on second connection: %v", err)
	}
}
