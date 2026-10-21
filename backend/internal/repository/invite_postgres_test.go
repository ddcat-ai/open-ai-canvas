package repository

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPostgresConcurrentWithdrawDailyLimit(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
	}
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, err := base.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer baseSQL.Close()
	schema := fmt.Sprintf("invite_v131_%d", time.Now().UnixNano())
	if err := base.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := base.Exec(`DROP SCHEMA "` + schema + `" CASCADE`).Error; err != nil {
			t.Errorf("drop test schema: %v", err)
		}
	}()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	if err := db.AutoMigrate(&model.RewardAccount{}, &model.WithdrawRequest{}, &model.WithdrawAccount{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.RewardAccount{UserID: "user-1", TotalMicroYuan: 1_000_000,
		AvailableMicroYuan: 1_000_000}).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	const attempts = 4
	start := make(chan struct{})
	results := make(chan error, attempts)
	var group sync.WaitGroup
	for i := 0; i < attempts; i++ {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			<-start
			results <- repo.CreateWithdrawRequest(&model.WithdrawRequest{
				ID: fmt.Sprintf("withdraw-%d", i), UserID: "user-1", AmountMicroYuan: 100_000,
				ActualMicroYuan: 100_000, Method: model.WithdrawMethodWechat,
				Status: model.WithdrawStatusPending, CreatedAt: time.Now(),
			}, 1, nil)
		}(i)
	}
	close(start)
	group.Wait()
	close(results)
	success, limited := 0, 0
	for err := range results {
		switch {
		case err == nil:
			success++
		case errors.Is(err, ErrWithdrawDailyLimit):
			limited++
		default:
			t.Fatalf("unexpected withdrawal error: %v", err)
		}
	}
	if success != 1 || limited != attempts-1 {
		t.Fatalf("success=%d limited=%d", success, limited)
	}
	account, err := repo.RewardAccount("user-1")
	if err != nil || account.AvailableMicroYuan != 900_000 || account.FrozenMicroYuan != 100_000 || account.TotalMicroYuan != 1_000_000 {
		t.Fatalf("account=%+v err=%v", account, err)
	}
}
