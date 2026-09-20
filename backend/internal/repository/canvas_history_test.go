package repository

import (
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func testCanvasHistory(t *testing.T, db *gorm.DB) {
	t.Helper()
	if db.Dialector.Name() == "sqlite" {
		if err := db.Exec("PRAGMA foreign_keys = ON").Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.AutoMigrate(&model.CanvasSnapshot{}, &model.CanvasSnapshotResource{}, &model.CanvasShare{}, &model.Task{}, &model.CanvasMediaGrant{}, &model.CanvasCollaborator{}, &model.CanvasCollaborationNode{}, &model.CanvasCollaborationOperation{}); err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	now := time.Now().UTC().Truncate(time.Millisecond)
	project := model.CanvasProject{ID: "history-canvas", UserID: "owner", Title: "original", PayloadJSON: `{"nodes":[{"id":"video"}]}`, UpdatedAt: now}
	if err := repo.UpsertCanvasProject(&project); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "history-video", UserID: "owner", Status: model.ResourceStatusReady}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	snapshot := func(p model.CanvasProject, at time.Time) *model.CanvasSnapshot {
		return &model.CanvasSnapshot{ID: fmt.Sprintf("history-%d", p.Revision), CanvasID: p.ID, UserID: p.UserID, Revision: p.Revision, Title: p.Title, PayloadJSON: p.PayloadJSON, NodeCount: 1, CreatedAt: at}
	}
	save := func(at time.Time, force bool) {
		t.Helper()
		old := project
		project.Title = fmt.Sprintf("edit-%d", old.Revision)
		if err := repo.SaveCanvasWithSnapshot(&project, snapshot(old, at), []string{resource.ID}, nil, at.Add(-5*time.Minute), 20, force); err != nil {
			t.Fatal(err)
		}
	}
	save(now, false)
	save(now.Add(4*time.Minute), false)
	metadata, err := repo.CanvasProjectMetadata(project.UserID, project.ID)
	if err != nil || metadata.Revision != project.Revision || metadata.UserID != project.UserID || metadata.PayloadJSON != "" {
		t.Fatalf("canvas metadata: %#v %v", metadata, err)
	}
	items, err := repo.CanvasSnapshots("owner", project.ID, 20)
	if err != nil || len(items) != 1 || items[0].PayloadJSON != "" {
		t.Fatalf("summary/throttle: %#v %v", items, err)
	}
	save(now.Add(5*time.Minute), false)
	items, _ = repo.CanvasSnapshots("owner", project.ID, 20)
	if len(items) != 2 {
		t.Fatalf("5 minute boundary = %d", len(items))
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		return New(tx).RequireNoCanvasHistoryReferences([]string{resource.ID})
	}); !errors.Is(err, ErrCanvasHistoryResourceReferenced) {
		t.Fatalf("history protection = %v", err)
	}
	refs, err := repo.CanvasHistoryResourceReferences([]string{resource.ID})
	if err != nil || len(refs) == 0 || refs[0].Kind != "画布历史版本" {
		t.Fatalf("references = %#v %v", refs, err)
	}
	if err := db.Delete(&resource).Error; err == nil {
		t.Fatal("database allowed deletion of a history resource")
	}
	if _, err := repo.CanvasSnapshot("other", project.ID, items[0].ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("wrong owner = %v", err)
	}

	// Snapshot failure must roll back the successful content CAS as well.
	before := project
	failed := project
	failed.Title = "must rollback"
	err = repo.SaveCanvasWithSnapshot(&failed, snapshot(project, now.Add(10*time.Minute)), []string{"missing"}, nil, now, 20, true)
	if !errors.Is(err, ErrCanvasHistoryResourceMissing) {
		t.Fatalf("missing resource = %v", err)
	}
	stored, _ := repo.CanvasProjectForUser("owner", project.ID)
	if stored.Revision != before.Revision || stored.Title != before.Title || failed.Revision != before.Revision {
		t.Fatal("failed snapshot changed content/revision")
	}

	// Concurrent writers create exactly one history entry along with one new revision.
	start := make(chan struct{})
	results := make(chan error, 2)
	var workers sync.WaitGroup
	for i := 0; i < 2; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			copy := project
			<-start
			results <- repo.SaveCanvasWithSnapshot(&copy, snapshot(project, now.Add(10*time.Minute)), []string{resource.ID}, nil, now, 20, true)
		}()
	}
	close(start)
	workers.Wait()
	close(results)
	success, conflict := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, ErrCanvasRevisionConflict) {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("concurrent saves: success=%d conflict=%d", success, conflict)
	}
	stored, _ = repo.CanvasProjectForUser("owner", project.ID)
	project = *stored
	for i := 0; i < 23; i++ {
		save(now.Add(time.Duration(20+i*5)*time.Minute), false)
	}
	var count, refCount int64
	db.Model(&model.CanvasSnapshot{}).Where("canvas_id = ?", project.ID).Count(&count)
	db.Model(&model.CanvasSnapshotResource{}).Count(&refCount)
	if count != 20 || refCount != 20 {
		t.Fatalf("retention: snapshots=%d refs=%d", count, refCount)
	}
	save(now.Add(131*time.Minute), true)
	items, _ = repo.CanvasSnapshots("owner", project.ID, 20)
	if items[0].Revision != project.Revision-1 || len(items) != 20 {
		t.Fatal("forced pre-restore backup missing or retention exceeded")
	}
	if err := repo.DeleteCanvasProject("owner", project.ID); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.CanvasSnapshot{}).Where("canvas_id = ?", project.ID).Count(&count)
	db.Model(&model.CanvasSnapshotResource{}).Count(&refCount)
	if count != 0 || refCount != 0 {
		t.Fatal("canvas deletion left orphan history")
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		return New(tx).RequireNoCanvasHistoryReferences([]string{resource.ID})
	}); err != nil {
		t.Fatalf("expired reference not released: %v", err)
	}
	if err := db.Delete(&resource).Error; err != nil {
		t.Fatalf("expired foreign key not released: %v", err)
	}
}
