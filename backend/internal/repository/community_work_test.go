package repository

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestCommunityWorkUniqueConflictsTranslateWithoutGlobalTranslateError(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.CommunityWork{}); err != nil {
		t.Fatal(err)
	}
	key := "owner:finished"
	first := model.CommunityWork{ID: "work-first", UserID: "owner", ActiveKey: &key}
	if err := db.Create(&first).Error; err != nil {
		t.Fatal(err)
	}
	second := model.CommunityWork{ID: "work-second", UserID: "owner", ActiveKey: &key}
	constraintErr := db.Create(&second).Error
	if constraintErr == nil || errors.Is(constraintErr, gorm.ErrDuplicatedKey) {
		t.Fatalf("expected native constraint error with TranslateError disabled: %v", constraintErr)
	}
	repo := New(db)
	if err := repo.communityWorkWriteError(constraintErr); !errors.Is(err, ErrCommunityWorkConflict) {
		t.Fatalf("SQLite conflict leaked as a server error: %v", err)
	}
	pgRepo := New(&gorm.DB{Config: &gorm.Config{Dialector: postgres.New(postgres.Config{})}})
	if err := pgRepo.communityWorkWriteError(&pgconn.PgError{Code: "23505", ConstraintName: "idx_community_works_active_key"}); !errors.Is(err, ErrCommunityWorkConflict) {
		t.Fatalf("PostgreSQL native conflict not mapped: %v", err)
	}
}
