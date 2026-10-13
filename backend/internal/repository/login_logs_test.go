package repository

import (
	"fmt"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"path/filepath"
	"sync"
	"testing"
	"time"
	"yingce/backend/internal/model"
)

func TestRevokeAuthSessionConcurrentWritesSingleLogout(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "logout.db")+"?_busy_timeout=5000&_journal_mode=WAL"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.LoginLog{}); err != nil {
		t.Fatal(err)
	}
	u := model.User{ID: "concurrent-user", Username: "concurrent-user", DisplayName: "Creator"}
	now := time.Now()
	if err := db.Create(&u).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AuthSession{ID: "session", UserID: u.ID, TokenHash: "token-hash", ExpiresAt: now.Add(time.Hour), UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.LoginLog{ID: "login", UserID: &u.ID, Event: "login", Result: "success", Method: "email", SessionRef: "session-ref", CreatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	r := New(db)
	start := make(chan struct{})
	errs := make(chan error, 4)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			errs <- r.RevokeAuthSessionWithLog("session", "token-hash", &model.LoginLog{ID: fmt.Sprintf("logout-%d", i), Event: "logout", Result: "success", Method: "unknown", Source: "logout", SessionRef: "session-ref", CreatedAt: time.Now()})
		}(i)
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal("concurrent logout failed", err)
		}
	}
	var events []model.LoginLog
	if err := db.Where("event = ?", "logout").Find(&events).Error; err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Method != "email" || events[0].Username != u.Username {
		t.Fatalf("concurrent logout logs: %#v", events)
	}
}

func TestLoginLogFiltersKeepHistoricalSnapshots(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.LoginLog{}); err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	id := "historical-user"
	for _, event := range []model.LoginLog{
		{ID: "first", UserID: &id, Username: "Creator", DisplayName: "历史昵称", Event: "login", Method: "password", Result: "success", IP: "192.0.2.5", CreatedAt: at},
		{ID: "second", Username: "Another", Event: "login", Method: "email", Result: "failed", IP: "192.0.2.6", CreatedAt: at.Add(time.Hour)},
	} {
		if err := db.Create(&event).Error; err != nil {
			t.Fatal(err)
		}
	}
	r := New(db)
	filter := LoginLogFilter{Keyword: "creator", Event: "login", Method: "password", Result: "success", IP: "192.0.2.5", From: &at, To: &at}
	logs, total, err := r.LoginLogs(filter, 20, 0)
	if err != nil || total != 1 || len(logs) != 1 || logs[0].DisplayName != "历史昵称" {
		t.Fatalf("boundary filter: %#v %d %v", logs, total, err)
	}
	offsetBound := at.In(time.FixedZone("UTC+8", 8*60*60))
	filter.From, filter.To = &offsetBound, &offsetBound
	logs, total, err = r.LoginLogs(filter, 20, 0)
	if err != nil || total != 1 || len(logs) != 1 {
		t.Fatalf("same instant in another timezone: %#v %d %v", logs, total, err)
	}
	logs, total, err = r.LoginLogs(LoginLogFilter{}, 1, 0)
	if err != nil || total != 2 || len(logs) != 1 || logs[0].ID != "second" {
		t.Fatalf("descending page: %#v %d %v", logs, total, err)
	}
	logs, total, err = r.LoginLogs(LoginLogFilter{Keyword: "missing"}, 20, 0)
	if err != nil || total != 0 || logs == nil || len(logs) != 0 {
		t.Fatalf("empty array: %#v %d %v", logs, total, err)
	}
}

func TestLogoutExpirationUsesInstantAcrossTimezones(t *testing.T) {
	for _, valid := range []bool{true, false} {
		t.Run(fmt.Sprintf("valid=%t", valid), func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			sqlDB, _ := db.DB()
			t.Cleanup(func() { _ = sqlDB.Close() })
			if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.LoginLog{}); err != nil {
				t.Fatal(err)
			}
			u := model.User{ID: "timezone-user", Username: "timezone-user"}
			if err := db.Create(&u).Error; err != nil {
				t.Fatal(err)
			}
			now := time.Now().UTC()
			expires, eventTime := now.Add(-time.Hour).In(time.FixedZone("UTC+8", 8*60*60)), now
			if valid {
				expires = now.Add(time.Hour)
				eventTime = now.In(time.FixedZone("UTC+8", 8*60*60))
			}
			if err := db.Create(&model.AuthSession{ID: "timezone-session", UserID: u.ID, TokenHash: "token", ExpiresAt: expires}).Error; err != nil {
				t.Fatal(err)
			}
			event := &model.LoginLog{ID: "timezone-log", Event: "logout", Result: "success", Method: "unknown", CreatedAt: eventTime}
			if err := New(db).RevokeAuthSessionWithLog("timezone-session", "token", event); err != nil {
				t.Fatal(err)
			}
			var count int64
			if err := db.Model(&model.LoginLog{}).Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if (count == 1) != valid {
				t.Fatalf("expiration is compared by wall clock rather than instant: logs=%d, valid=%t", count, valid)
			}
		})
	}
}
