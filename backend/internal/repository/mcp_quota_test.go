package repository

import (
	"errors"
	"sync"
	"testing"

	"yingce/backend/internal/model"
)

func TestMCPReceiptBudgetAcrossDatabaseConnections(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			a, b := agentLifecycleRepositories(t, driver)
			if err := a.db.AutoMigrate(&model.MCPConnection{}, &model.MCPConnectionGrant{}, &model.MCPToolExecution{}, &model.MCPStorageUsage{}); err != nil {
				t.Fatal(err)
			}
			initial := MCPStorageLimitBytes - MCPResultLimitBytes - 1024
			if err := a.db.Create(&model.MCPStorageUsage{UserID: "user", Bytes: initial}).Error; err != nil {
				t.Fatal(err)
			}
			start := make(chan struct{})
			results := make(chan error, 2)
			var wg sync.WaitGroup
			for i, repo := range []*Repository{a, b} {
				wg.Go(func() {
					<-start
					results <- repo.Transaction(func(tx *Repository) error {
						if err := tx.LockMCPQuota("user"); err != nil {
							return err
						}
						_, _, err := tx.ClaimMCPExecution(&model.MCPToolExecution{ID: string(rune('a' + i)), UserID: "user", RunID: "run", ConnectionID: "connection", Status: "running"})
						return err
					})
				})
			}
			close(start)
			wg.Wait()
			close(results)
			var succeeded, rejected int
			for err := range results {
				if err == nil {
					succeeded++
				} else if errors.Is(err, ErrMCPStorageQuota) {
					rejected++
				} else {
					t.Fatal(err)
				}
			}
			var count int64
			if err := a.db.Model(&model.MCPToolExecution{}).Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			used, err := a.MCPStoredBytes("user")
			if err != nil || succeeded != 1 || rejected != 1 || count != 1 || used != MCPStorageLimitBytes {
				t.Fatalf("budget race: successful=%d rejected=%d count=%d used=%d err=%v", succeeded, rejected, count, used, err)
			}
		})
	}
}
