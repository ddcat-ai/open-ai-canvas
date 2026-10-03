package skills

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestSkillsReturnsPublicCategoryCountsAcrossFilters(t *testing.T) {
	svc, db := newSkillLibraryCategoryTestService(t)
	rows := []model.Skill{
		{ID: "drama-1", Name: "First", OwnerID: "author", Status: 1, Tag: "drama"},
		{ID: "drama-2", Name: "Second", OwnerID: "author", Status: 1, Tag: "drama"},
		{ID: "ecommerce", OwnerID: "author", Status: 1, Tag: "ecommerce"},
		{ID: "private", OwnerID: "viewer", Status: 1, Tag: "drama", IsPrivate: true},
		{ID: "disabled", OwnerID: "author", Status: -1, Tag: "creative"},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	for _, req := range []SkillListRequest{
		{Scope: "public", PageSize: 1},
		{Scope: "public", Page: 2, PageSize: 1, Tag: "drama"},
		{Scope: "public", Search: "First"},
		{Scope: "public", Search: "no-match"},
		{Scope: "mine"},
		{Scope: "created"},
		{Scope: "favorites"},
	} {
		result, err := svc.Skills("viewer", req)
		if err != nil {
			t.Fatal(err)
		}
		body, err := json.Marshal(result)
		if err != nil {
			t.Fatal(err)
		}
		var decoded struct {
			Categories []struct {
				Value string `json:"value"`
				Count *int64 `json:"count"`
			} `json:"categories"`
		}
		if err := json.Unmarshal(body, &decoded); err != nil {
			t.Fatal(err)
		}
		if len(decoded.Categories) != 5 {
			t.Fatalf("categories = %s", body)
		}
		want := map[string]int64{"drama": 2, "ecommerce": 1, "creative": 0, "social": 0, "others": 0}
		for _, category := range decoded.Categories {
			if category.Count == nil || *category.Count != want[category.Value] {
				t.Fatalf("request %+v: category %s count = %v, want %d", req, category.Value, category.Count, want[category.Value])
			}
		}
	}
}
