package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestResourceDeliveryCancelsDatabaseConnectionWait(t *testing.T) {
	storageDB, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := storageDB.AutoMigrate(&model.Resource{}); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(storageDB), dataDir: t.TempDir()}
	resource := model.Resource{ID: "image", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "image.png", MimeType: "image/png"}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	db, err := storageDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	conn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	finished := make(chan error, 1)
	go func() {
		_, err := svc.PrepareResourceDelivery(ctx, "owner", resource.ID, ResourceAccessOptions{DescribeOnly: true}, "")
		finished <- err
	}()
	select {
	case err := <-finished:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("database wait error = %v", err)
		}
	case <-time.After(2 * time.Second):
		conn.Close()
		<-finished
		t.Fatal("resource query ignored the request deadline")
	}
}
