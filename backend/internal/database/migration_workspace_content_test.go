package database

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestTeamMigrationConvertsWorkspaceWithoutReplayingOrders(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CANVAS_BACKEND_DATA_DIR", dir)
	db, err := Open(Config{Driver: "sqlite", DataDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	conn, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if err := db.AutoMigrate(Models()...); err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`CREATE TABLE team_canvases (id TEXT PRIMARY KEY,team_id TEXT,title TEXT,revision INTEGER,nodes TEXT,created_at datetime,updated_at datetime)`,
		`INSERT INTO team_canvases VALUES ('board','studio','初稿',7,'[{"id":"note","text":"推镜头","x":-16,"y":201},{"id":"photo","assetId":"a","versionId":"v1","x":22,"y":31}]',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
		`CREATE TABLE team_assets (id TEXT PRIMARY KEY,team_id TEXT,published_by TEXT,title TEXT,kind TEXT,status TEXT,current_version_id TEXT,created_at datetime,updated_at datetime)`,
		`INSERT INTO team_assets VALUES ('a','studio','author','参考图','image','archived','v2',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
		`CREATE TABLE team_asset_versions (id TEXT PRIMARY KEY,team_id TEXT,asset_id TEXT,title TEXT,kind TEXT,text_content TEXT,resource_id TEXT,version INTEGER,created_at datetime)`,
		`INSERT INTO team_asset_versions VALUES ('v1','studio','a','旧图','image','','r1',1,CURRENT_TIMESTAMP),('v2','studio','a','新图','image','','r2',2,CURRENT_TIMESTAMP)`,
		`CREATE TABLE team_asset_resources (id TEXT PRIMARY KEY,team_id TEXT,asset_id TEXT,version_id TEXT,object_key TEXT,size INTEGER,mime_type TEXT,created_at datetime)`,
		`INSERT INTO team_asset_resources VALUES ('r1','studio','a','v1','old.png',3,'image/png',CURRENT_TIMESTAMP),('r2','studio','a','v2','new.png',3,'image/png',CURRENT_TIMESTAMP)`,
		`CREATE TABLE team_asset_references (holder_type TEXT,holder_id TEXT,binding_id TEXT,asset_id TEXT,version_id TEXT,team_id TEXT)`,
		`INSERT INTO team_asset_references VALUES ('canvas','board','photo','a','v1','studio'),('generation','job','ref','a','v1','studio')`,
		`CREATE TABLE team_text_generations (id TEXT,team_id TEXT,user_id TEXT,membership_id TEXT,canvas_id TEXT,billing_order_id TEXT,status TEXT,model TEXT,prompt TEXT,result_text TEXT,created_at datetime,updated_at datetime)`,
		`INSERT INTO team_text_generations VALUES ('job','studio','author','member','board','paid','running','model','镜头','分镜正文',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.BillingOrder{ID: "paid", UserID: "author", TeamID: "studio", MembershipID: "member", BillingAccountID: model.TeamMemberCreditAccountID("member"), Status: model.BillingStatusSettled, ActualAmountMicrocredits: 17}).Error; err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "team-assets"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"old.png", "new.png"} {
		if err := os.WriteFile(filepath.Join(dir, "team-assets", name), []byte(name[:3]), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Transaction(migrateSharedWorkspaceContent); err == nil || !strings.Contains(err.Error(), "尚未对账") {
		t.Fatalf("unresolved charge: %v", err)
	}
	var count int64
	if err := db.Model(&model.CanvasProject{}).Count(&count).Error; err != nil || count != 0 || !db.Migrator().HasTable("team_canvases") {
		t.Fatal("partial migration", err)
	}
	if err := db.Exec("UPDATE team_text_generations SET status='succeeded'").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Transaction(migrateSharedWorkspaceContent); err != nil {
		t.Fatal(err)
	}
	var board model.CanvasProject
	if err := db.Take(&board, "id = ? AND user_id = ?", "board", model.TeamContentKey("studio")).Error; err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Nodes []struct {
			Metadata struct{ Content, StorageKey string }
			Position struct{ X, Y float64 }
		}
	}
	if err := json.Unmarshal([]byte(board.PayloadJSON), &doc); err != nil {
		t.Fatal(err)
	}
	if board.Title != "初稿" || board.Revision != 7 || len(doc.Nodes) != 2 || doc.Nodes[0].Metadata.Content != "推镜头" || doc.Nodes[0].Position.X != -16 || doc.Nodes[0].Position.Y != 201 || doc.Nodes[1].Metadata.StorageKey != "resource:r1" {
		t.Fatal("lost canvas or pinned revision", board.PayloadJSON)
	}
	var asset model.Asset
	if err := db.Take(&asset, "id = ?", "a").Error; err != nil || asset.PrimaryVersionID != "v2" || asset.Status != model.AssetVersionStatusArchived || asset.CreatedBy != "author" {
		t.Fatal("lost asset", err)
	}
	var resource model.Resource
	if err := db.Take(&resource, "id = ?", "r1").Error; err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "resources", resource.ObjectKey))
	if err != nil || string(data) != "old" {
		t.Fatal("lost file", err)
	}
	var task model.Task
	if err := db.Take(&task, "id = ?", "job").Error; err != nil || task.Status != model.TaskStatusSucceeded || task.BillingOrderID != "paid" || !strings.Contains(task.InputJSON, "v1") || !strings.Contains(task.ResultJSON, "分镜正文") {
		t.Fatal("lost task", err)
	}
	var order model.BillingOrder
	if err := db.Take(&order, "id = ?", "paid").Error; err != nil || order.ActualAmountMicrocredits != 17 || order.TaskID != task.ID {
		t.Fatal("old charge changed", err)
	}
	if db.Migrator().HasTable("team_canvases") || db.Migrator().HasTable("team_text_generations") || db.Migrator().HasTable("team_asset_resources") {
		t.Fatal("retired content tables remain")
	}
	if err := db.Transaction(migrateSharedWorkspaceContent); err != nil {
		t.Fatal(err)
	}
}
