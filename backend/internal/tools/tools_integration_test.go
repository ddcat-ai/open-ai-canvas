package tools_test

import (
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/tools"
	"path/filepath"
	"strings"
	"testing"
)

func TestToolsVisibilityTokensSeedAndReferences(t *testing.T) {
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "tools.db")})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	if err = database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	repo := repository.New(db)
	svc := tools.New(repo)
	for range 2 {
		if err := tools.EnsureBuiltinTools(repo); err != nil {
			t.Fatal(err)
		}
	}
	list, err := svc.List("alice", tools.ToolListRequest{PageSize: 80})
	if err != nil || list.TotalCount != 87 || !list.HasMore {
		t.Fatalf("seed/pagination: %+v %v", list, err)
	}
	custom, err := svc.Create("alice", tools.ToolMutationRequest{Type: "style", Label: "private", Prompt: "private style"})
	if err != nil || custom.ID <= 87 {
		t.Fatalf("custom: %+v %v", custom, err)
	}
	if _, err := svc.Detail("bob", custom.ID); err == nil {
		t.Fatal("private tool leaked")
	}
	if _, err := svc.SetFavorite("bob", custom.ID, true); err == nil {
		t.Fatal("private favorite accepted")
	}
	if err := svc.Delete("bob", custom.ID); err == nil {
		t.Fatal("cross-user delete accepted")
	}
	if _, err := svc.SetFavorite("alice", custom.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetFavorite("alice", custom.ID, true); err != nil {
		t.Fatal(err)
	}
	for _, scope := range []string{"", "public", "favorites", "custom"} {
		got, err := svc.List("bob", tools.ToolListRequest{Scope: scope, Search: "private"})
		if err != nil || got.TotalCount != 0 {
			t.Fatalf("scope %q leaked: %+v %v", scope, got, err)
		}
	}
	valid := "scene @[tool:style:1:label:Palette]"
	expanded, err := svc.ResolveToolMentionTokens("alice", "image", valid)
	if err != nil || strings.Contains(expanded, "@[tool:") {
		t.Fatalf("expand: %s %v", expanded, err)
	}
	for _, token := range []string{"@[tool:style:0:x:X]", "@[tool:effect:1:x:X]", "@[tool:style:999999:x:X]", "@[tool:bogus:1:x:X]", "@[tool:style:1:broken]"} {
		if _, err := svc.ResolveToolMentionTokens("alice", "image", token); err == nil {
			t.Fatalf("accepted %s", token)
		}
	}
	if _, err := svc.ResolveToolMentionTokens("alice", "video", valid); err == nil {
		t.Fatal("wrong mode accepted")
	}
	if _, err := svc.ResolveToolMentionTokens("", "image", valid); err == nil {
		t.Fatal("anonymous accepted")
	}
	if err := db.Model(&model.Tool{}).Where("id = ?", 1).Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ResolveToolMentionTokens("alice", "image", valid); err == nil {
		t.Fatal("disabled accepted")
	}
	if err := svc.Delete("alice", custom.ID); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&model.ToolFavorite{}).Where("tool_id = ?", custom.ID).Count(&count)
	if count != 0 {
		t.Fatal("orphan favorites")
	}
	if err := db.Model(&model.Tool{}).Where("id = ?", 1).Updates(map[string]any{"source": "user", "owner_id": "alice", "label": "keep"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := tools.EnsureBuiltinTools(repo); err == nil {
		t.Fatal("seed collision accepted")
	}
	var preserved model.Tool
	db.First(&preserved, 1)
	if preserved.Label != "keep" {
		t.Fatal("user tool overwritten")
	}
}
