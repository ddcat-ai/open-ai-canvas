package main

import (
	"reflect"
	"testing"

	"yingce/backend/internal/model"

	"github.com/google/uuid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
)

func TestSiteTrafficCrossDatabaseListAndRowProjection(t *testing.T) {
	registered := 0
	for _, migration := range migrations() {
		if migration.name == "site_traffic_events" {
			registered++
		}
	}
	if registered != 1 {
		t.Fatalf("traffic table migrations registered %d times", registered)
	}
	open := func() *gorm.DB {
		db, err := gorm.Open(sqlite.Dialector{DriverName: "sqlite", DSN: ":memory:"}, &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		connection, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		connection.SetMaxOpenConns(1)
		t.Cleanup(func() { _ = connection.Close() })
		if err := db.AutoMigrate(&model.SiteTrafficEvent{}); err != nil {
			t.Fatal(err)
		}
		return db
	}
	source, target := open(), open()
	want := model.SiteTrafficEvent{
		ID: uuid.NewString(), VisitorHash: "visitor-digest", SessionHash: "session-digest",
		ReceivedAtEpoch: 1790000000, Type: "action", Page: "create", Action: "creation_submit_image",
	}
	if err := source.Create(&want).Error; err != nil {
		t.Fatal(err)
	}
	for _, copyRows := range []bool{true, false} {
		count, err := migrateTable[model.SiteTrafficEvent]("site_traffic_events").run(source, target, copyRows)
		if err != nil || count != 1 {
			t.Fatalf("copy=%v: rows=%d, %v", copyRows, count, err)
		}
	}
	var got model.SiteTrafficEvent
	if err := target.First(&got, "id = ?", want.ID).Error; err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("traffic row projection changed: %+v, %v", got, err)
	}
}
