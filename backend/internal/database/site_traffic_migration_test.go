package database

import (
	"reflect"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"github.com/google/uuid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
)

func TestSiteTrafficMigration99IsAdditiveAndPreservesPublishedLedger(t *testing.T) {
	if CurrentSchemaVersion != 100 {
		t.Fatalf("schema version/plan = %d/%d", CurrentSchemaVersion, len(schemaMigrations))
	}
	migration := schemaMigrations[len(schemaMigrations)-2]
	if migration.version != 99 || migration.name != "site_traffic_events" || migration.checksum != "sha256:site-traffic-events-v99-20261111" || migration.apply == nil {
		t.Fatalf("unexpected traffic migration: %+v", migration)
	}
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
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	// 仅登记上游截至 v98 的真实迁移身份，隔离验证 v99，不重跑历史业务转换。
	records := make([]schemaMigration, 0, len(schemaMigrations)-1)
	for _, item := range schemaMigrations[:len(schemaMigrations)-2] {
		records = append(records, schemaMigration{
			Version: item.version, Name: item.name, Checksum: item.checksum,
			AppliedAt: time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC),
		})
	}
	if err := db.Create(&records).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TABLE traffic_unrelated (id TEXT PRIMARY KEY, value TEXT NOT NULL)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO traffic_unrelated (id, value) VALUES ('keep', 'unchanged')").Error; err != nil {
		t.Fatal(err)
	}
	var before []schemaMigration
	if err := db.Order("version").Find(&before).Error; err != nil {
		t.Fatal(err)
	}
	if db.Migrator().HasTable(&model.SiteTrafficEvent{}) {
		t.Fatal("v98 fixture already contains traffic table")
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	var after []schemaMigration
	if err := db.Order("version").Find(&after).Error; err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before)+2 || !reflect.DeepEqual(after[:len(before)], before) {
		t.Fatal("v99 changed published migration identities or applied timestamps")
	}
	if !db.Migrator().HasTable(&model.SiteTrafficEvent{}) {
		t.Fatal("missing traffic table")
	}
	for _, index := range []string{"idx_site_traffic_received_at", "idx_site_traffic_type_received_at"} {
		if !db.Migrator().HasIndex(&model.SiteTrafficEvent{}, index) {
			t.Fatalf("missing traffic index %s", index)
		}
	}
	columns, err := db.Migrator().ColumnTypes(&model.SiteTrafficEvent{})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{"id": false, "visitor_hash": false, "session_hash": false, "received_at_epoch": false, "type": false, "page": false, "action": false}
	for _, column := range columns {
		if _, exists := want[column.Name()]; !exists {
			t.Fatalf("traffic table contains unexpected identifying/property column %s", column.Name())
		}
		want[column.Name()] = true
	}
	for column, found := range want {
		if !found {
			t.Fatalf("traffic table missing %s", column)
		}
	}
	var value string
	if err := db.Raw("SELECT value FROM traffic_unrelated WHERE id = 'keep'").Scan(&value).Error; err != nil || value != "unchanged" {
		t.Fatalf("unrelated data changed: %q, %v", value, err)
	}
	registered := 0
	for _, entity := range Models() {
		if _, ok := entity.(*model.SiteTrafficEvent); ok {
			registered++
		}
	}
	if registered != 1 {
		t.Fatalf("traffic Models registrations = %d", registered)
	}
	event := model.SiteTrafficEvent{ID: uuid.NewString(), VisitorHash: "visitor-digest", SessionHash: "session-digest", ReceivedAtEpoch: time.Now().Unix(), Type: "page_view", Page: "welcome"}
	if err := db.Create(&event).Error; err != nil {
		t.Fatal(err)
	}
	if err := migration.apply(db); err != nil {
		t.Fatal(err)
	}
	var saved model.SiteTrafficEvent
	if err := db.First(&saved, "id = ?", event.ID).Error; err != nil || !reflect.DeepEqual(saved, event) {
		t.Fatalf("repeat traffic DDL changed events: %+v, %v", saved, err)
	}
}
