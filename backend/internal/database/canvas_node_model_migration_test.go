package database

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	canvasdoc "yingce/backend/internal/canvas/document"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func canvasNodeMigrationDB(t *testing.T, driver string) *gorm.DB {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "canvas-nodes.db")
	if driver == "postgres" {
		dsn = strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
		if dsn == "" {
			t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
		}
		admin, err := Open(Config{Driver: driver, DSN: dsn})
		if err != nil {
			t.Fatal(err)
		}
		schema := fmt.Sprintf("canvas_node_migration_%d", time.Now().UnixNano())
		if err := admin.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := admin.Exec(`DROP SCHEMA "` + schema + `" CASCADE`).Error; err != nil {
				t.Error(err)
			}
			if sqlDB, err := admin.DB(); err == nil {
				sqlDB.Close()
			}
		})
		if strings.Contains(dsn, "://") {
			parsed, err := url.Parse(dsn)
			if err != nil {
				t.Fatal(err)
			}
			query := parsed.Query()
			query.Set("search_path", schema)
			parsed.RawQuery = query.Encode()
			dsn = parsed.String()
		} else {
			dsn += " search_path=" + schema
		}
	}
	db, err := Open(Config{Driver: driver, DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { sqlDB.Close() })
	}
	if err := db.AutoMigrate(&model.CanvasProject{}, &model.CanvasSnapshot{}, &model.CanvasSnapshotResource{}, &model.CanvasShare{}, &model.CloudAgentCanvasMutation{}, &model.CreationRun{}, &model.CanvasMutationReceipt{}, &model.CloudAgentEventRecord{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func migrationCanvas(t *testing.T, content string) string {
	t.Helper()
	doc := map[string]any{
		"id": "canvas", "title": "作品", "revision": 7, "remoteContentHash": "stale-browser-hash",
		"nodes": []any{
			map[string]any{"id": "a", "type": "markdown", "title": "参考", "position": map[string]any{"x": 2, "y": 3}, "metadata": map[string]any{"content": content, "assetId": "asset-keep", "storageKey": "resource:res-keep"}},
			map[string]any{"id": "b", "type": "compare", "width": 420, "height": 320},
			map[string]any{"id": "p", "type": "plugin:chart", "metadata": map[string]any{"chartKind": "custom", "payload": map[string]any{"type": "html"}}},
		},
		"connections":  []any{map[string]any{"id": "edge", "fromNodeId": "a", "toNodeId": "b"}},
		"previsScenes": []any{map[string]any{"type": "compare"}},
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
func migrationHash(t *testing.T, raw string) string {
	t.Helper()
	var doc map[string]any
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		t.Fatal(err)
	}
	return canvasdoc.SnapshotHash(doc)
}

func TestCanvasUnifiedNodeMigration(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			db := canvasNodeMigrationDB(t, driver)
			at := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
			current, history := migrationCanvas(t, "# 最新原文"), migrationCanvas(t, "# 历史原文")
			project := model.CanvasProject{ID: "canvas", UserID: "owner", Title: "作品", Revision: 7, PayloadJSON: current, CreatedAt: at, UpdatedAt: at}
			snapshot := model.CanvasSnapshot{ID: "snap", UserID: "owner", CanvasID: "canvas", Revision: 4, PayloadJSON: history, PayloadBytes: len([]byte(history)), NodeCount: 3, ConnectionCount: 1, Reason: "automatic", CreatedAt: at, ContentUpdatedAt: at}
			share := model.CanvasShare{ID: "share", UserID: "owner", ProjectID: "canvas", TokenHash: "kept-token-hash", TokenCipher: "kept-cipher", Enabled: true, CreatedAt: at, UpdatedAt: at}
			undo := model.CloudAgentCanvasMutation{ID: "undo", UserID: "owner", CanvasID: "canvas", RunID: "run", StepID: "step", Status: "applied", BeforeJSON: history, BeforeSnapshotHash: migrationHash(t, history), AfterSnapshotHash: migrationHash(t, current), CreatedAt: at}
			unknownAfter := undo
			unknownAfter.ID = "unprovable"
			unknownAfter.AfterSnapshotHash = strings.Repeat("f", 64)
			baseline := model.CreationRun{ID: "creation", UserID: "owner", ClientKey: "key", CreateHash: "immutable-request", ApprovedProposalHash: "immutable-approval", ApprovedOperationsJSON: `[{"type":"update_node","patch":{"type":"markdown"}}]`, ApprovedCanvasJSON: history, Revision: 8, CreatedAt: at, UpdatedAt: at}
			receipt := model.CanvasMutationReceipt{ID: "receipt", UserID: "owner", CanvasID: "canvas", MutationID: "original-request", PayloadDigest: "immutable-digest", ResultJSON: `{"summary":{"id":"canvas","revision":7},"document":{"nodes":[{"type":"markdown"}]}}`, Revision: 7, CreatedAt: at}
			event := model.CloudAgentEventRecord{RunID: "run", UserID: "owner", Sequence: 1, EventJSON: `{"payload":{"node":{"type":"chart"}}}`, CreatedAt: at}
			unchanged := model.CanvasProject{ID: "unchanged", UserID: "owner", Revision: 3, PayloadJSON: `{"nodes":[{"id":"t","type":"text","metadata":{"content":"same"}}]}`, CreatedAt: at, UpdatedAt: at}
			resource := model.Resource{ID: "res-keep", UserID: "owner", Status: model.ResourceStatusReady}
			ref := model.CanvasSnapshotResource{SnapshotID: "snap", ResourceID: resource.ID}
			for _, row := range []any{&project, &snapshot, &share, &undo, &unknownAfter, &baseline, &receipt, &event, &unchanged, &resource, &ref} {
				if err := db.Create(row).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := db.Transaction(migrateCanvasNodeModel); err != nil {
				t.Fatal(err)
			}
			var got model.CanvasProject
			db.First(&got, "id = ?", "canvas")
			if got.Revision != 8 || !got.UpdatedAt.After(at) || !got.CreatedAt.Equal(at) {
				t.Fatalf("project metadata = %+v", got)
			}
			var body map[string]any
			json.Unmarshal([]byte(got.PayloadJSON), &body)
			if body["revision"] != nil || body["remoteContentHash"] != nil {
				t.Fatal("stale row projection/hash retained")
			}
			nodes := body["nodes"].([]any)
			if nodes[0].(map[string]any)["type"] != "text" || nodes[1].(map[string]any)["metadata"].(map[string]any)["content"] != "对比参考：\n参考 @[node:a]" {
				t.Fatalf("bad migration: %s", got.PayloadJSON)
			}
			if nodes[2].(map[string]any)["type"] != "plugin:chart" {
				t.Fatal("plugin was modified")
			}
			var saved model.CanvasSnapshot
			db.First(&saved, "id = ?", "snap")
			if saved.Revision != 4 || saved.PayloadBytes != len([]byte(saved.PayloadJSON)) || !saved.CreatedAt.Equal(at) || !saved.ContentUpdatedAt.Equal(at) || saved.NodeCount != 3 || saved.ConnectionCount != 1 {
				t.Fatalf("history identity changed: %+v", saved)
			}
			var savedUndo model.CloudAgentCanvasMutation
			db.First(&savedUndo, "id = ?", "undo")
			if savedUndo.Status != "applied" || savedUndo.BeforeSnapshotHash != migrationHash(t, savedUndo.BeforeJSON) || savedUndo.AfterSnapshotHash != migrationHash(t, got.PayloadJSON) {
				t.Fatalf("undo proof invalid: %+v", savedUndo)
			}
			var blocked model.CloudAgentCanvasMutation
			db.First(&blocked, "id = ?", "unprovable")
			if blocked.Status != "not_undoable" || blocked.BeforeJSON == "" || blocked.AfterSnapshotHash != unknownAfter.AfterSnapshotHash {
				t.Fatal("unprovable undo fabricated or snapshot lost")
			}
			var savedCreation model.CreationRun
			db.First(&savedCreation, "id = ?", "creation")
			if savedCreation.Revision != 9 || savedCreation.CreateHash != baseline.CreateHash || savedCreation.ApprovedProposalHash != baseline.ApprovedProposalHash || savedCreation.ApprovedOperationsJSON != baseline.ApprovedOperationsJSON {
				t.Fatal("approval/request authority rewritten")
			}
			for _, pair := range []struct{ original, loaded any }{{&share, &model.CanvasShare{}}, {&receipt, &model.CanvasMutationReceipt{}}, {&event, &model.CloudAgentEventRecord{}}, {&unchanged, &model.CanvasProject{}}, {&ref, &model.CanvasSnapshotResource{}}} {
				switch loaded := pair.loaded.(type) {
				case *model.CanvasShare:
					db.First(loaded, "id = ?", "share")
				case *model.CanvasMutationReceipt:
					db.First(loaded, "id = ?", "receipt")
				case *model.CloudAgentEventRecord:
					db.First(loaded, "run_id = ? AND sequence = ?", "run", 1)
				case *model.CanvasProject:
					db.First(loaded, "id = ?", "unchanged")
				case *model.CanvasSnapshotResource:
					db.First(loaded, "snapshot_id = ?", "snap")
				}
				// Time zone locations vary by SQL driver; compare serialized values.
				a, _ := json.Marshal(pair.original)
				b, _ := json.Marshal(pair.loaded)
				var x, y any
				json.Unmarshal(a, &x)
				json.Unmarshal(b, &y)
				if !reflect.DeepEqual(x, y) {
					t.Fatalf("unrelated record changed: %T\n%s\n%s", pair.original, a, b)
				}
			}
			if err := db.Transaction(migrateCanvasNodeModel); err != nil {
				t.Fatal(err)
			}
			var repeated model.CanvasProject
			db.First(&repeated, "id = ?", "canvas")
			if !reflect.DeepEqual(got, repeated) {
				t.Fatal("second migration changed document or revision")
			}
		})
	}
}

func TestCanvasUnifiedNodeMigrationRollsBackOnInvalidSnapshot(t *testing.T) {
	for _, stage := range []string{"project", "history", "undo-hash", "approval"} {
		t.Run(stage, func(t *testing.T) {
			db := canvasNodeMigrationDB(t, "sqlite")
			raw := migrationCanvas(t, "original")
			project := model.CanvasProject{ID: "a", UserID: "owner", Revision: 6, PayloadJSON: raw}
			if err := db.Create(&project).Error; err != nil {
				t.Fatal(err)
			}
			switch stage {
			case "project":
				db.Create(&model.CanvasProject{ID: "z", UserID: "owner", Revision: 2, PayloadJSON: `{"nodes":[{"type":"html","metadata":{"content":55}}]}`})
			case "history":
				db.Create(&model.CanvasSnapshot{ID: "bad", CanvasID: "z", UserID: "owner", Revision: 2, PayloadJSON: `{"nodes":broken}`})
			case "undo-hash":
				db.Create(&model.CloudAgentCanvasMutation{ID: "bad", UserID: "owner", CanvasID: "z", BeforeJSON: raw, BeforeSnapshotHash: "wrong", Status: "applied"})
			case "approval":
				db.Create(&model.CreationRun{ID: "bad", UserID: "owner", ClientKey: "bad", ApprovedCanvasJSON: `{"nodes":[{"type":"chart","metadata":[]}]}`})
			}
			if err := db.Transaction(migrateCanvasNodeModel); err == nil {
				t.Fatal("migration silently accepted bad data")
			}
			var got model.CanvasProject
			db.First(&got, "id = ?", "a")
			if got.PayloadJSON != project.PayloadJSON || got.Revision != project.Revision || !got.UpdatedAt.Equal(project.UpdatedAt) {
				t.Fatal("failed migration partially committed")
			}
		})
	}
}

func TestCanvasUnifiedNodeMigrationPagesAllDocuments(t *testing.T) {
	db := canvasNodeMigrationDB(t, "sqlite")
	for i := 0; i < canvasMigrationBatch+3; i++ {
		if err := db.Create(&model.CanvasProject{ID: fmt.Sprintf("canvas-%03d", i), UserID: "owner", Revision: 2, PayloadJSON: `{"nodes":[{"id":"n","type":"svg","metadata":{"content":"<svg/>"}}]}`}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Transaction(migrateCanvasNodeModel); err != nil {
		t.Fatal(err)
	}
	var rows []model.CanvasProject
	db.Find(&rows)
	if len(rows) != canvasMigrationBatch+3 {
		t.Fatal("lost documents")
	}
	for _, row := range rows {
		if row.Revision != 3 || !strings.Contains(row.PayloadJSON, `"textFormat":"plain"`) {
			t.Fatalf("page skipped %s", row.ID)
		}
	}
}
