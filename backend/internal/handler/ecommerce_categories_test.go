package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestEcommerceCategoriesHTTPRequiresAdministratorAndBrowsesHierarchy(t *testing.T) {
	router, db, dir := newGitHubSkillHTTPTest(t)
	if err := db.AutoMigrate(&model.EcommerceKnowledgeEntry{}); err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dir)
	t.Cleanup(func() { _ = svc.Close() })
	RegisterEcommerceRoutes(router.Group("/api"), svc)
	const endpoint = "/api/admin/ecommerce/categories"
	githubSkillHTTPRequest(t, router, http.MethodGet, endpoint, "", false, http.StatusUnauthorized)
	githubSkillHTTPRequest(t, router, http.MethodGet, endpoint, "", true, http.StatusForbidden)
	if err := db.Model(&model.User{}).Where("id = ?", "github-owner").Update("role", model.UserRoleAdmin).Error; err != nil {
		t.Fatal(err)
	}
	var response struct {
		Data struct {
			Total int `json:"total"`
			Nodes []struct {
				MethodScope string `json:"methodScope"`
			} `json:"nodes"`
		} `json:"data"`
	}
	if err := json.Unmarshal(githubSkillHTTPRequest(t, router, http.MethodGet, endpoint, "", true, http.StatusOK), &response); err != nil {
		t.Fatal(err)
	}
	if response.Data.Total != 26 || len(response.Data.Nodes) != 26 {
		t.Fatalf("missing industry roots: %+v", response)
	}
	githubSkillHTTPRequest(t, router, http.MethodGet, endpoint+"?parentId=missing", "", true, http.StatusBadRequest)
	if err := json.Unmarshal(githubSkillHTTPRequest(t, router, http.MethodGet, endpoint+"?parentId=hg-11-7-29", "", true, http.StatusOK), &response); err != nil {
		t.Fatal(err)
	}
	if response.Data.Total == 0 {
		t.Fatal("subcategory children missing")
	}
}
