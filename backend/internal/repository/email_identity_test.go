package repository

import (
	"path/filepath"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func TestGmailMailboxRegistrationConcurrent(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "users.db") + "?_busy_timeout=5000&_journal_mode=WAL"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.EmailVerificationCode{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	for _, id := range []string{"one", "two"} {
		if err := db.Create(&model.EmailVerificationCode{ID: id, Email: id + "@gmail.com", ExpiresAt: now.Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	start := make(chan struct{})
	for i, email := range []string{"a.b+first@gmail.com", "ab+second@googlemail.com"} {
		id := []string{"one", "two"}[i]
		peer, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, _ := peer.DB()
		t.Cleanup(func() { _ = sqlDB.Close() })
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			errs <- New(peer).CreateUserWithEmailVerification(&model.User{ID: id, Username: id, Email: email}, id, now)
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	success := 0
	for err := range errs {
		if err == nil {
			success++
		} else if err.Error() != "邮箱已被注册" {
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if success != 1 {
		t.Fatalf("successful registrations=%d want 1", success)
	}
	var consumed int64
	if err := db.Model(&model.EmailVerificationCode{}).Where("used_at IS NOT NULL").Count(&consumed).Error; err != nil || consumed != 1 {
		t.Fatalf("consumed=%d err=%v", consumed, err)
	}
}

func TestGmailMailboxLegacyLookupsRemainExact(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}); err != nil {
		t.Fatal(err)
	}
	r := New(db)
	for _, user := range []model.User{{ID: "one", Username: "one", Email: "a.b+old@gmail.com"}, {ID: "two", Username: "two", Email: "ab@gmail.com"}} {
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
		got, err := r.UserByEmail(user.Email)
		if err != nil || got.ID != user.ID {
			t.Fatalf("lookup %q=%v err=%v", user.Email, got, err)
		}
	}
	if err := r.CheckEmailAvailable("ab+new@googlemail.com", ""); err == nil {
		t.Fatal("legacy alias collision not detected")
	}
	if err := r.CheckEmailAvailable("a.b+new@example.com", ""); err != nil {
		t.Fatal(err)
	}
}

func TestGmailMailboxVerificationEntryPoints(t *testing.T) {
	for _, mode := range []string{"ticket", "oauth", "bind", "first-user"} {
		t.Run(mode, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			sqlDB, _ := db.DB()
			t.Cleanup(func() { _ = sqlDB.Close() })
			if err := db.AutoMigrate(&model.User{}, &model.AuthVerification{}, &model.UserIdentity{}, &model.CreditAccount{}); err != nil {
				t.Fatal(err)
			}
			r := New(db)
			if err := db.Create(&model.User{ID: "owner", Username: "owner", Email: "a.b@gmail.com"}).Error; err != nil {
				t.Fatal(err)
			}
			user := model.User{ID: "new", Username: "new", Email: "ab+tag@googlemail.com", Status: model.UserStatusActive}
			v := model.AuthVerification{ID: "ticket", UserID: "new", Email: user.Email, Ready: true, ExpiresAt: time.Now().Add(time.Hour)}
			if err := db.Create(&v).Error; err != nil {
				t.Fatal(err)
			}
			switch mode {
			case "ticket":
				err = r.CreateUserWithVerification(&user, v.ID)
			case "oauth":
				err = r.CreateOAuthUser(&user, &model.UserIdentity{ID: "identity", UserID: user.ID, Provider: "linuxdo", Subject: "subject"})
			case "first-user":
				err = r.CreateRegisteredUser(&user)
			case "bind":
				user.Email = ""
				if err := db.Create(&user).Error; err != nil {
					t.Fatal(err)
				}
				_, err = r.CompleteAuthVerification(&v, true)
			}
			if err == nil || err.Error() != "邮箱已被注册" {
				t.Fatalf("alias accepted or unexpected error: %v", err)
			}
			stored, err := r.AuthVerification(v.ID)
			if err != nil || stored.UsedAt != nil {
				t.Fatalf("rejected collision consumed ticket: %v err=%v", stored, err)
			}
		})
	}
}
