package repository

import (
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func uploadReservationTestDB(t *testing.T) (*gorm.DB, *Repository, *Repository) {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "uploads.db") + "?_busy_timeout=5000&_journal_mode=WAL"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.UploadReservation{}, &model.UserDailyUploadUsage{}, &model.Resource{}); err != nil {
		t.Fatal(err)
	}
	peer, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	for _, conn := range []*gorm.DB{db, peer} {
		sqlDB, _ := conn.DB()
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	return db, New(db), New(peer)
}

func TestUploadReservationConcurrentAdmission(t *testing.T) {
	for _, tc := range []struct {
		name                     string
		size, daily, stored      int64
		sessions, attempts, want int
		denied                   error
	}{
		{"sessions", 1, 1000, 1000, 32, 40, 32, ErrUploadSessionLimit},
		{"storage", 60, 1000, 100, 32, 2, 1, ErrUploadStorageLimit},
		{"daily", 60, 100, 1000, 32, 2, 1, ErrDailyUploadLimitExceeded},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, first, second := uploadReservationTestDB(t)
			start := make(chan struct{})
			results := make(chan error, tc.attempts)
			var wg sync.WaitGroup
			for i := 0; i < tc.attempts; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					repo := []*Repository{first, second}[i%2]
					results <- repo.ReserveUploadSession(&model.UploadReservation{ID: fmt.Sprint(i), UserID: "user", Size: tc.size, ExpiresAt: time.Now().Add(time.Hour)}, tc.daily, tc.stored, tc.sessions)
				}()
			}
			close(start)
			wg.Wait()
			close(results)
			accepted := 0
			for err := range results {
				if err == nil {
					accepted++
				} else if !errors.Is(err, tc.denied) {
					t.Fatalf("unexpected denial: %v", err)
				}
			}
			if accepted != tc.want {
				t.Fatalf("accepted=%d want=%d", accepted, tc.want)
			}
			if used, err := first.DailyUploadBytes("user", time.Now().UTC().Format("2006-01-02")); err != nil || used != int64(tc.want)*tc.size {
				t.Fatalf("reserved bytes=%d err=%v", used, err)
			}
		})
	}
}

func TestUploadReservationAtomicCapacityCommit(t *testing.T) {
	db, first, second := uploadReservationTestDB(t)
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i, repo := range []*Repository{first, second} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			results <- repo.SaveResourceWithinStorageLimit(&model.Resource{ID: fmt.Sprint(i), UserID: "user", ObjectKey: fmt.Sprint(i), Status: model.ResourceStatusReady, Size: 60}, 100, 1000, "")
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	accepted := 0
	for err := range results {
		if err == nil {
			accepted++
		} else if !errors.Is(err, ErrUploadStorageLimit) {
			t.Fatal(err)
		}
	}
	if accepted != 1 {
		t.Fatalf("committed=%d want=1", accepted)
	}
	var count int64
	if err := db.Model(&model.Resource{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("resource rows=%d err=%v", count, err)
	}
}

func TestUploadReservationCommitAndExpiry(t *testing.T) {
	db, r, peer := uploadReservationTestDB(t)
	old := model.UploadReservation{ID: "old", UserID: "user", Size: 60, Day: "2026-10-04", ExpiresAt: time.Now().Add(-time.Hour)}
	if err := db.Create(&old).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.ReserveDailyUpload("user", old.Day, 60, 1000); err != nil {
		t.Fatal(err)
	}
	lease := model.UploadReservation{ID: "new", UserID: "user", Size: 60, Day: "2026-10-05", ExpiresAt: time.Now().Add(time.Hour)}
	if err := peer.ReserveUploadSession(&lease, 1000, 100, 1); err != nil {
		t.Fatal(err)
	}
	if used, _ := r.DailyUploadBytes("user", old.Day); used != 0 {
		t.Fatalf("expired previous-day bytes=%d", used)
	}
	if err := r.ReleaseUploadSession("other", lease.ID); err != nil {
		t.Fatal(err)
	}
	other := model.Resource{ID: "other", UserID: "user", Size: 40, Status: model.ResourceStatusReady, ObjectKey: "other"}
	if err := r.SaveResourceWithinStorageLimit(&other, 100, 1000, ""); !errors.Is(err, ErrUploadStorageLimit) {
		t.Fatalf("ordinary upload ignored reserved capacity: %v", err)
	}
	resource := model.Resource{ID: "resource", UserID: "user", Size: 59, Status: model.ResourceStatusReady, ObjectKey: "resource"}
	if err := r.SaveResourceWithinStorageLimit(&resource, 100, 1000, lease.ID); !errors.Is(err, ErrUploadReservationExpired) {
		t.Fatalf("mismatched lease: %v", err)
	}
	resource.Size = 60
	if err := r.SaveResourceWithinStorageLimit(&resource, 100, 1000, lease.ID); err != nil {
		t.Fatal(err)
	}
	if err := peer.ReleaseUploadSession("user", lease.ID); err != nil {
		t.Fatal(err)
	}
	if used, _ := r.DailyUploadBytes("user", lease.Day); used != 60 {
		t.Fatalf("committed daily bytes=%d", used)
	}
	if err := r.SaveResourceWithinStorageLimit(&resource, 100, 1000, lease.ID); !errors.Is(err, ErrUploadReservationExpired) {
		t.Fatalf("lease reused: %v", err)
	}
	resource.ID = "expired"
	if err := r.SaveResourceWithinStorageLimit(&resource, 100, 1000, old.ID); !errors.Is(err, ErrUploadReservationExpired) {
		t.Fatalf("expired lease accepted: %v", err)
	}
}

func TestUploadReservationCommitAcrossUTCDay(t *testing.T) {
	db, r, _ := uploadReservationTestDB(t)
	today := time.Now().UTC().Format("2006-01-02")
	yesterday := time.Now().UTC().Add(-24 * time.Hour).Format("2006-01-02")
	lease := model.UploadReservation{ID: "midnight", UserID: "user", Size: 15, Day: yesterday, ExpiresAt: time.Now().Add(time.Hour)}
	if err := db.Create(&lease).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.ReserveDailyUpload("user", yesterday, 15, 100); err != nil {
		t.Fatal(err)
	}
	if err := r.ReserveDailyUpload("user", today, 90, 100); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "midnight", UserID: "user", Size: 15, ObjectKey: "midnight", Status: model.ResourceStatusReady}
	if err := r.SaveResourceWithinStorageLimit(&resource, 1000, 100, lease.ID); !errors.Is(err, ErrDailyUploadLimitExceeded) {
		t.Fatalf("new-day quota bypassed: %v", err)
	}
	if used, _ := r.DailyUploadBytes("user", yesterday); used != 15 {
		t.Fatalf("failed commit refunded reservation: %d", used)
	}
	if err := r.ReleaseDailyUpload("user", today, 90); err != nil {
		t.Fatal(err)
	}
	if err := r.SaveResourceWithinStorageLimit(&resource, 1000, 100, lease.ID); err != nil {
		t.Fatal(err)
	}
	if used, _ := r.DailyUploadBytes("user", today); used != 15 {
		t.Fatalf("new-day usage=%d", used)
	}
	if used, _ := r.DailyUploadBytes("user", yesterday); used != 0 {
		t.Fatalf("old-day reservation=%d", used)
	}
}
