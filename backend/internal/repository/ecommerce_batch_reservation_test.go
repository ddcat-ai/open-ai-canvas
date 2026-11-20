package repository

import (
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

func TestEcommerceBatchReservationsCompeteForSameBalance(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "batch.db")+"?_journal_mode=WAL&_busy_timeout=5000"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	testEcommerceBatchReservationsCompete(t, db)
}

func TestEcommerceBatchReservationsCompetePostgres(t *testing.T) {
	testEcommerceBatchReservationsCompete(t, ecommerceBatchTestPostgres(t))
}

func ecommerceBatchTestPostgres(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
	}
	config := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	admin, err := gorm.Open(postgres.Open(dsn), config)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("ecommerce_batch_test_%d", time.Now().UnixNano())
	if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
			t.Error(err)
		}
		conn, _ := admin.DB()
		_ = conn.Close()
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
	conn, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return db
}

func testEcommerceBatchReservationsCompete(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&model.CreditAccount{}, &model.BillingOrder{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CreditAccount{UserID: "user", AvailableMicrocredits: 1500}).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for batch := 0; batch < 2; batch++ {
		wg.Add(1)
		go func(batch int) {
			defer wg.Done()
			results <- repo.Transaction(func(tx *Repository) error {
				for page := 0; page < 9; page++ {
					order := &model.BillingOrder{ID: fmt.Sprintf("order-%d-%d", batch, page), UserID: "user", IdempotencyKey: fmt.Sprintf("key-%d-%d", batch, page), TaskID: fmt.Sprintf("task-%d-%d", batch, page), Status: model.BillingStatusReserved, BillingMode: "fixed_request", AmountMicrocredits: 100, ChargeLimitSet: true, ChargeLimitMicrocredits: 100}
					if err := tx.ReserveBillingOrder(order); err != nil {
						return err
					}
				}
				return nil
			})
		}(batch)
	}
	wg.Wait()
	close(results)
	successes := 0
	for err := range results {
		if err == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("expected exactly one complete batch; got %d", successes)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user").Error; err != nil || account.AvailableMicrocredits != 600 || account.ReservedMicrocredits != 900 {
		t.Fatalf("incorrect account: %+v %v", account, err)
	}
	var orders, entries int64
	if err := db.Model(&model.BillingOrder{}).Count(&orders).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CreditLedgerEntry{}).Count(&entries).Error; err != nil {
		t.Fatal(err)
	}
	if orders != 9 || entries != 9 {
		t.Fatalf("partial batch committed: orders=%d entries=%d", orders, entries)
	}
}
