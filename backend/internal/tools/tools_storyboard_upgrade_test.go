package tools_test

import (
	"fmt"
	"path/filepath"
	"reflect"
	"testing"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/tools"
)

func TestStoryboardUpgradePreservesExistingToolsAndReferences(t *testing.T) {
	for _, source := range []string{tools.ToolSourceUser, tools.ToolSourceBuiltin} {
		t.Run(source, func(t *testing.T) {
			db, err := database.Open(database.Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "upgrade.db")})
			if err != nil {
				t.Fatal(err)
			}
			sqlDB, _ := db.DB()
			defer sqlDB.Close()
			if err := database.MigrateSchema(db); err != nil {
				t.Fatal(err)
			}
			repo := repository.New(db)
			svc := tools.New(repo)
			for i, key := range []string{"short_storyboard", "blocking_storyboard"} {
				tool := model.Tool{ID: int64(90 + i), Type: tools.ToolTypeNineGrid, LabelEn: key, Label: "Existing tool", Prompt: fmt.Sprintf("Existing prompt %d", i), Source: source, Enabled: true, Visibility: tools.ToolVisibilityPublic}
				if source == tools.ToolSourceUser {
					tool.OwnerID, tool.Visibility, tool.LabelEn = "owner", tools.ToolVisibilityPrivate, "custom_tool"
				}
				if err := db.Create(&tool).Error; err != nil {
					t.Fatal(err)
				}
				if _, err := svc.SetFavorite("owner", tool.ID, true); err != nil {
					t.Fatal(err)
				}
			}
			var before, after []model.Tool
			var favoritesBefore, favoritesAfter []model.ToolFavorite
			if err := db.Where("id IN ?", []int64{90, 91}).Order("id").Find(&before).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Order("id").Find(&favoritesBefore).Error; err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if err := tools.EnsureBuiltinTools(repo); err != nil {
					t.Fatal(err)
				}
			}
			if err := db.Where("id IN ?", []int64{90, 91}).Order("id").Find(&after).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Order("id").Find(&favoritesAfter).Error; err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, after) || !reflect.DeepEqual(favoritesBefore, favoritesAfter) {
				t.Fatal("upgrade changed existing tools or favorites")
			}
			for _, tool := range before {
				token := fmt.Sprintf("@[tool:nine_grid:%d:Existing:Grid3x3]", tool.ID)
				got, err := svc.ResolveToolMentionTokens("owner", "image", token)
				if err != nil || got != tool.Prompt {
					t.Fatalf("existing reference changed: %q, %v", got, err)
				}
				if source == tools.ToolSourceUser {
					if _, err := svc.ResolveToolMentionTokens("other", "image", token); err == nil {
						t.Fatal("private tool exposed")
					}
				}
			}
			for i, key := range []string{"short_storyboard", "blocking_storyboard"} {
				item, err := svc.Detail("other", int64(1000090+i))
				if err != nil {
					t.Fatal(err)
				}
				if item.Source != tools.ToolSourceBuiltin || item.LabelEn != key {
					t.Fatalf("incorrect storyboard: %+v", item)
				}
			}
		})
	}
}
