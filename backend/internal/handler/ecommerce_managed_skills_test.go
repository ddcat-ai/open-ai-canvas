package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestEcommerceManagedSkillsHTTPRequiresAdministratorAndPersistsSwitch(t *testing.T) {
	router, db, dir := newGitHubSkillHTTPTest(t)
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dir)
	t.Cleanup(func() { _ = svc.Close() })
	RegisterEcommerceRoutes(router.Group("/api"), svc)
	const endpoint = "/api/admin/ecommerce/skills"
	githubSkillHTTPRequest(t, router, http.MethodGet, endpoint, "", false, http.StatusUnauthorized)
	githubSkillHTTPRequest(t, router, http.MethodGet, endpoint, "", true, http.StatusForbidden)
	githubSkillHTTPRequest(t, router, http.MethodPost, endpoint+"/install", "", false, http.StatusUnauthorized)
	githubSkillHTTPRequest(t, router, http.MethodPost, endpoint+"/install", "", true, http.StatusForbidden)
	githubSkillHTTPRequest(t, router, http.MethodPost, endpoint+"/install/github", `{"url":"https://github.com/example/repo"}`, true, http.StatusForbidden)
	githubSkillHTTPRequest(t, router, http.MethodPatch, endpoint+"/unknown/name", `{"name":"test"}`, true, http.StatusForbidden)
	githubSkillHTTPRequest(t, router, http.MethodPatch, endpoint+"/ecom-copywriting", `{"enabled":false}`, true, http.StatusForbidden)
	if err := db.Model(&model.User{}).Where("id = ?", "github-owner").Update("role", model.UserRoleAdmin).Error; err != nil {
		t.Fatal(err)
	}
	var page struct {
		Data struct {
			Skills []struct {
				ID      string `json:"id"`
				Enabled bool   `json:"enabled"`
			} `json:"skills"`
		} `json:"data"`
	}
	if err := json.Unmarshal(githubSkillHTTPRequest(t, router, http.MethodGet, endpoint, "", true, http.StatusOK), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Data.Skills) != 61 {
		t.Fatal("installed skill catalog missing")
	}
	githubSkillHTTPRequest(t, router, http.MethodPatch, endpoint+"/ecom-copywriting", `{}`, true, http.StatusBadRequest)
	githubSkillHTTPRequest(t, router, http.MethodPatch, endpoint+"/unknown", `{"enabled":true}`, true, http.StatusBadRequest)
	githubSkillHTTPRequest(t, router, http.MethodPatch, endpoint+"/ecom-copywriting", `{"enabled":false}`, true, http.StatusOK)
	if err := json.Unmarshal(githubSkillHTTPRequest(t, router, http.MethodGet, endpoint, "", true, http.StatusOK), &page); err != nil {
		t.Fatal(err)
	}
	for _, skill := range page.Data.Skills {
		if skill.ID == "ecom-copywriting" && skill.Enabled {
			t.Fatal("disabled state did not survive reload")
		}
	}
	var audit int64
	db.Model(&model.AdminAuditEvent{}).Where("action = ?", "ecommerce_skill.enabled").Count(&audit)
	if audit != 1 {
		t.Fatalf("audit records=%d", audit)
	}
}
