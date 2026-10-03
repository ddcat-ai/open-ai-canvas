package repository

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
)

const task3SQLiteFixtureRelativePath = ".local/cache/upstream-v1.6.0/task3-sqlite-20261001T105404Z/common35.db"

func task3SQLiteFixtureAllowed(worktreeRoot, dsn string) bool {
	if !filepath.IsAbs(dsn) {
		return false
	}
	expected := filepath.Join(worktreeRoot, task3SQLiteFixtureRelativePath)
	if filepath.Clean(dsn) != expected {
		return false
	}
	rootReal, rootErr := filepath.EvalSymlinks(worktreeRoot)
	expectedReal, expectedErr := filepath.EvalSymlinks(expected)
	dsnReal, dsnErr := filepath.EvalSymlinks(dsn)
	return rootErr == nil && expectedErr == nil && dsnErr == nil &&
		expectedReal == filepath.Join(rootReal, task3SQLiteFixtureRelativePath) && dsnReal == expectedReal
}

func TestTask3SQLiteFixturePathCannotEscapeWorktree(t *testing.T) {
	root := t.TempDir()
	fixture := filepath.Join(root, task3SQLiteFixtureRelativePath)
	if err := os.MkdirAll(filepath.Dir(fixture), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fixture, []byte("synthetic fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	if !task3SQLiteFixtureAllowed(root, fixture) {
		t.Fatal("fixture under the worktree was rejected")
	}
	lookalike := filepath.Join(t.TempDir(), task3SQLiteFixtureRelativePath)
	if err := os.MkdirAll(filepath.Dir(lookalike), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(lookalike, []byte("unrelated database"), 0o600); err != nil {
		t.Fatal(err)
	}
	if task3SQLiteFixtureAllowed(root, lookalike) || task3SQLiteFixtureAllowed(root, "common35.db") {
		t.Fatal("outside or relative fixture path accepted")
	}
	if err := os.Remove(fixture); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(lookalike, fixture); err != nil {
		t.Fatal(err)
	}
	if task3SQLiteFixtureAllowed(root, fixture) {
		t.Fatal("fixture symlink escaping the worktree was accepted")
	}
}

// This acceptance test is opt-in because it writes one synthetic order into a
// dedicated, previously migrated Task 3 fixture database.
func TestTask3MigratedLegacyProductRemainsUnlimited(t *testing.T) {
	for _, fixture := range []struct {
		name, driver, envName, productID string
	}{
		{"sqlite", "sqlite", "CANVAS_TEST_TASK3_SQLITE_DSN", "synthetic-task3-common35-product"},
		{"postgres", "postgres", "CANVAS_TEST_TASK3_PG_DSN", "s3-c35-product"},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			dsn := os.Getenv(fixture.envName)
			if dsn == "" {
				t.Skip("dedicated Task 3 fixture DSN not set")
			}
			if fixture.driver == "sqlite" {
				_, source, _, ok := runtime.Caller(0)
				if !ok || !task3SQLiteFixtureAllowed(filepath.Clean(filepath.Join(filepath.Dir(source), "../../..")), dsn) {
					t.Fatal("refusing non-fixture SQLite path")
				}
			} else {
				parsed, err := url.Parse(dsn)
				if err != nil || parsed.Hostname() != "127.0.0.1" || parsed.Port() != "15432" || !strings.HasPrefix(strings.TrimPrefix(parsed.Path, "/"), "upgrade_task3_") || parsed.Query().Get("sslmode") != "disable" {
					t.Fatal("refusing non-fixture PostgreSQL DSN")
				}
			}
			db, err := database.Open(database.Config{Driver: fixture.driver, DSN: dsn})
			if err != nil {
				t.Fatal(err)
			}
			sqlDB, err := db.DB()
			if err != nil {
				t.Fatal(err)
			}
			defer sqlDB.Close()
			if err := database.RequireSchemaVersion(db); err != nil {
				t.Fatal(err)
			}
			repo := New(db)
			product, err := repo.TopupProduct(fixture.productID)
			if err != nil {
				t.Fatal(err)
			}
			if product.SaleStrategy != "" || product.AmountFen != 990 || product.CreditsMicrocredits != 123000 || !product.Enabled {
				t.Fatalf("legacy product changed on read: %+v", product)
			}
			token := fmt.Sprintf("t3-%x", time.Now().UnixNano())
			order := &model.PaymentOrder{ID: token, UserID: "task3-legacy-buyer", IdempotencyKey: token, MerchantOrderNo: token, ProductID: product.ID, ProductName: product.Name, AmountFen: product.AmountFen, CreditsMicrocredits: product.CreditsMicrocredits, Currency: "CNY", Status: model.PaymentOrderCreated, ExpiresAt: time.Now().Add(time.Hour)}
			createdOrder, created, err := repo.CreatePaymentOrderWithProductReservation(order)
			if err != nil || !created || createdOrder == nil || createdOrder.StockReserved {
				t.Fatalf("legacy empty strategy did not allow unlimited order: created=%v order=%+v err=%v", created, createdOrder, err)
			}
		})
	}
}
