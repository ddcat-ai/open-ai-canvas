package app

import (
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func canvasStorageTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db := agentPermissionsDB(t)
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.Asset{}, &model.CanvasEditLease{}, &model.CanvasMutationReceipt{}); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db)}, db
}

func TestCanvasStorageSavesCoordinateByContentOwner(t *testing.T) {
	for _, sameOwner := range []bool{false, true} {
		name := "different_owners"
		if sameOwner {
			name = "same_team_owner"
		}
		t.Run(name, func(t *testing.T) {
			svc, db := canvasStorageTestService(t)
			aOwner, bOwner := "owner-a", "owner-b"
			if sameOwner {
				aOwner, bOwner = model.TeamContentKey("shared"), model.TeamContentKey("shared")
			}
			for _, c := range []model.CanvasProject{
				{ID: "a", UserID: aOwner, Title: "before", Revision: 1, PayloadJSON: `{"title":"before","nodes":[],"connections":[]}`},
				{ID: "b", UserID: bOwner, Title: "before", Revision: 1, PayloadJSON: `{"title":"before","nodes":[],"connections":[]}`},
			} {
				if err := db.Create(&c).Error; err != nil {
					t.Fatal(err)
				}
			}
			entered, release := make(chan struct{}), make(chan struct{})
			var paused atomic.Bool
			if err := db.Callback().Update().Before("gorm:update").Register("pause_canvas_save", func(tx *gorm.DB) {
				if tx.Statement.Table == "canvas_projects" && paused.CompareAndSwap(false, true) {
					close(entered)
					<-release
				}
			}); err != nil {
				t.Fatal(err)
			}
			defer db.Callback().Update().Remove("pause_canvas_save")
			var released atomic.Bool
			unpause := func() {
				if released.CompareAndSwap(false, true) {
					close(release)
				}
			}
			defer unpause()
			request := func(id string) CanvasOperationsRequest {
				return CanvasOperationsRequest{
					MutationID: id,
					Operations: []CanvasOperation{{Type: "set_field", Field: "title", Value: json.RawMessage(`"after"`), BeforeValue: json.RawMessage(`"before"`)}},
				}
			}
			aDone, bDone := make(chan error, 1), make(chan error, 1)
			go func() { _, err := svc.ApplyUserCanvasOperations(aOwner, "a", request("a")); aDone <- err }()
			select {
			case <-entered:
			case <-time.After(3 * time.Second):
				t.Fatal("first save did not reach write path")
			}
			go func() { _, err := svc.ApplyUserCanvasOperations(bOwner, "b", request("b")); bDone <- err }()
			bFinished, problem := false, ""
			var bErr error
			if sameOwner {
				select {
				case bErr = <-bDone:
					bFinished, problem = true, "same-owner save bypassed quota coordination"
				case <-time.After(50 * time.Millisecond):
				}
			} else {
				select {
				case bErr = <-bDone:
					bFinished = true
				case <-time.After(3 * time.Second):
					problem = "unrelated canvas save waited for another owner"
				}
			}
			unpause()
			if err := <-aDone; err != nil {
				t.Fatal(err)
			}
			if !bFinished {
				bErr = <-bDone
			}
			if bErr != nil {
				t.Fatal(bErr)
			}
			if problem != "" {
				t.Fatal(problem)
			}
			for _, item := range []struct{ owner, id string }{{aOwner, "a"}, {bOwner, "b"}} {
				stored, err := svc.repo.CanvasProjectForUser(item.owner, item.id)
				if err != nil || stored.Revision != 2 || stored.Title != "after" {
					t.Fatalf("bad saved document: %#v err=%v", stored, err)
				}
			}
		})
	}
}

func TestCanvasStorageConcurrentCreatesKeepOwnerQuota(t *testing.T) {
	svc, db := canvasStorageTestService(t)
	policy := defaultRuntimePolicy()
	policy.Resource.CanvasCount = 1
	encoded, err := json.Marshal(policy)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: model.RuntimePolicySettingKey, ValueJSON: string(encoded)}).Error; err != nil {
		t.Fatal(err)
	}
	start, done := make(chan struct{}), make(chan error, 2)
	for _, id := range []string{"a", "b"} {
		go func(id string) {
			<-start
			_, err := svc.ApplyUserCanvasOperations("owner", id, CanvasOperationsRequest{MutationID: id, Operations: []CanvasOperation{{Type: "create_canvas", ID: id}}})
			done <- err
		}(id)
	}
	close(start)
	succeeded, rejected := 0, 0
	for i := 0; i < 2; i++ {
		err := <-done
		if err == nil {
			succeeded++
			continue
		}
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Code != CodeQuotaExceeded {
			t.Fatal(err)
		}
		rejected++
	}
	if succeeded != 1 || rejected != 1 {
		t.Fatalf("success=%d rejected=%d", succeeded, rejected)
	}
	var count int64
	if err := db.Model(&model.CanvasProject{}).Where("user_id = ?", "owner").Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("count=%d err=%v", count, err)
	}
}
