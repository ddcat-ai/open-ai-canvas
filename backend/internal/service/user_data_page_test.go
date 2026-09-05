package service

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestUserCanvasLibraryPageIsBoundedAndScoped(t *testing.T) {
	service, db := newProjectWorkbenchReadTestService(t)
	for index := 0; index < 55; index++ {
		project := model.CanvasProject{ID: fmt.Sprintf("canvas-%02d", index), UserID: "owner", Title: fmt.Sprintf("Title %02d", index), PayloadJSON: `{"nodes":[{"id":"image","type":"image","metadata":{"storageKey":"resource:preview","content":"secret-inline-media","prompt":"secret-prompt"}}],"chatSessions":["secret-chat"]}`}
		if err := db.Create(&project).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.CanvasProject{ID: "foreign", UserID: "other", Title: "Foreign", PayloadJSON: `{}`}).Error; err != nil {
		t.Fatal(err)
	}
	page, err := service.UserCanvasProjectsPage("owner", 1, 999, "", "", "name")
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Projects) != 50 || page.Total != 55 || !page.HasMore || page.PageSize != 50 {
		t.Fatalf("unexpected pagination: %+v", page)
	}
	encoded, err := json.Marshal(page)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "secret") || strings.Contains(string(encoded), "foreign") {
		t.Fatal("page exposed full payload or another account")
	}
	last, err := service.UserCanvasProjectsPage("owner", 2, 50, "", "", "name")
	if err != nil || len(last.Projects) != 5 || last.HasMore {
		t.Fatalf("last page: %+v %v", last, err)
	}
	filtered, err := service.UserCanvasProjectsPage("owner", 1, 40, "", "Title 04", "name")
	if err != nil || filtered.Total != 1 || filtered.Projects[0].NodeCount != 1 {
		t.Fatalf("filter: %+v %v", filtered, err)
	}
}

func TestUserAssetsBatchIsBoundedAndScoped(t *testing.T) {
	service, db := newProjectWorkbenchReadTestService(t)
	for _, owner := range []string{"owner", "other"} {
		if err := db.Create(&model.Asset{ID: owner, UserID: owner, PayloadJSON: fmt.Sprintf(`{"id":%q}`, owner)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	assets, err := service.UserAssetsByIDs("owner", []string{"owner", "owner", "other", "missing"})
	if err != nil || len(assets) != 1 || string(assets[0]) != `{"id":"owner"}` {
		t.Fatalf("unexpected assets: %s %v", assets, err)
	}
	empty, err := service.UserAssetsByIDs("owner", nil)
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty IDs must not list account: %s %v", empty, err)
	}
	if _, err := service.UserAssetsByIDs("owner", make([]string, 101)); err == nil {
		t.Fatal("expected batch limit")
	}
	if _, err := service.UserAssetsByIDs("owner", []string{" "}); err == nil {
		t.Fatal("expected invalid ID error")
	}
}
