package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"yingce/backend/internal/model"
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
	if err != nil || len(assets) != 1 {
		t.Fatalf("unexpected assets: %s %v", assets, err)
	}
	var payload map[string]any
	if err := json.Unmarshal(assets[0], &payload); err != nil || payload["id"] != "owner" {
		t.Fatalf("unexpected asset payload: %s %v", assets[0], err)
	}
	if _, ok := payload["tags"]; !ok {
		t.Fatalf("client payload missing tags: %s", assets[0])
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

func TestUploadedProjectAssetReadPathsReturnWritableDocument(t *testing.T) {
	service, db := newProjectWorkbenchReadTestService(t)
	asset := model.Asset{
		ID: "uploaded-video", UserID: "owner", Kind: "video", Title: "上传视频",
		Category: model.AssetCategoryMaterial, Status: model.AssetVersionStatusConfirmed,
		PrimaryVersionID: "version-1",
		PayloadJSON:      `{"data":{"storageKey":"resource:uploaded-video","mimeType":"video/mp4","kind":"video","size":1024,"width":1920,"height":1080}}`,
	}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	paths := map[string]func() ([]json.RawMessage, error){
		"detail": func() ([]json.RawMessage, error) {
			raw, err := service.UserAsset("owner", asset.ID)
			return []json.RawMessage{raw}, err
		},
		"batch": func() ([]json.RawMessage, error) { return service.UserAssetsByIDs("owner", []string{asset.ID}) },
		"snapshot": func() ([]json.RawMessage, error) {
			snapshot, err := service.UserDataSnapshot("owner")
			return snapshot.Assets, err
		},
		"page": func() ([]json.RawMessage, error) {
			page, err := service.UserAssetsPage("owner", 1, 40, UserAssetPageFilter{})
			return page.Assets, err
		},
	}
	for name, read := range paths {
		t.Run(name, func(t *testing.T) {
			items, err := read()
			if err != nil || len(items) != 1 {
				t.Fatalf("read assets: %s, %v", items, err)
			}
			parsed, err := assetFromJSON("owner", items[0])
			if err != nil {
				t.Fatalf("returned asset cannot be saved: %v; %s", err, items[0])
			}
			if parsed.ID != "uploaded-video" || parsed.Kind != "video" || parsed.Title != "上传视频" || parsed.PrimaryVersionID != "version-1" || parsed.Category != model.AssetCategoryMaterial {
				t.Fatalf("lost asset identity: %+v", parsed)
			}
			var payload struct {
				Data struct {
					Bytes int64 `json:"bytes"`
				} `json:"data"`
			}
			if err := json.Unmarshal(items[0], &payload); err != nil || payload.Data.Bytes != 1024 {
				t.Fatalf("lost resource byte size: %s, %v", items[0], err)
			}
		})
	}
}
