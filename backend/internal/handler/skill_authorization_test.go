package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func skillAuthorizationFixture(t *testing.T) (*gin.Engine, *gorm.DB, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "authorization.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.UserIdentity{}, &model.AuthSession{},
		&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}, &model.UserSkillState{}, &model.SkillLibraryCategory{},
		&model.SkillCurationSetting{}, &model.SkillCurationRoot{}, &model.SkillCurationCategory{}, &model.SkillCurationRootAssignment{}, &model.SkillCurationAssignment{},
		&model.CloudAgentExecution{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SkillCurationSetting{ID: 1}).Error; err != nil {
		t.Fatal(err)
	}
	for _, actor := range []model.User{
		{ID: "skill-admin", Username: "skill-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive},
		{ID: "skill-member", Username: "skill-member", Role: model.UserRoleUser, Status: model.UserStatusActive},
	} {
		if err := db.Create(&actor).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: actor.ID, UserID: actor.ID, TokenHash: auth.HashToken("skill-access-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), dir)
	t.Cleanup(func() { _ = svc.Close() })
	skill, err := svc.CreateSkill("skill-admin", service.SkillMutationRequest{SkillName: "Public skill", Description: "Reusable workflow", Instruction: "# Workflow\n\nUse a clear storyboard.", Tag: "drama"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Skill{ID: "legacy-owned-skill", OwnerID: "skill-member", Name: "Legacy skill", Description: "Previous upload", Instruction: "# Old workflow", IsPrivate: true, Status: 1}).Error; err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	api := router.Group("/api")
	RegisterSkillRoutes(api, svc)
	RegisterAdminSkillRoutes(api, svc)
	RegisterAgentRoutes(api, svc)
	RegisterEcommerceRoutes(api, svc)
	return router, db, skill.SkillID
}

type skillBodyReadProbe struct{ read bool }

func (b *skillBodyReadProbe) Read(_ []byte) (int, error) {
	b.read = true
	return 0, io.EOF
}

func skillAuthorizationRequest(router *gin.Engine, method, target, actor string, body io.Reader) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, body)
	req.Header.Set("Content-Type", "application/json")
	if actor != "" {
		req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: actor + ".skill-access-token"})
	}
	out := httptest.NewRecorder()
	router.ServeHTTP(out, req)
	return out
}

func TestSkillRoutesRejectUnauthorizedRequestsBeforeReadingInput(t *testing.T) {
	router, _, _ := skillAuthorizationFixture(t)
	management := map[string]bool{
		"POST /api/skills":                true,
		"POST /api/skills/install":        true,
		"POST /api/skills/install/github": true,
		"PUT /api/skills/:id":             true,
		"DELETE /api/skills/:id":          true,
		"PUT /api/skills/:id/files":       true,
		"POST /api/skills/:id/sync":       true,
	}
	critical := map[string]bool{
		"POST /api/skills/install":                 false,
		"POST /api/skills/install/github":          false,
		"GET /api/skills/:id/file/raw":             false,
		"GET /api/skills/:id/bundle":               false,
		"PUT /api/skills/:id/files":                false,
		"POST /api/skills/:id/sync":                false,
		"GET /api/admin/skills":                    false,
		"GET /api/skills/curation":                 false,
		"GET /api/skills/presets":                  false,
		"GET /api/agent/skills/usage":              false,
		"POST /api/ecommerce/skills/prompt":        false,
		"POST /api/admin/ecommerce/skills/install": false,
	}
	for _, route := range router.Routes() {
		if !strings.HasPrefix(route.Path, "/api/skills") && !strings.HasPrefix(route.Path, "/api/admin/skills") && !strings.HasPrefix(route.Path, "/api/admin/skill-curation") && !strings.HasPrefix(route.Path, "/api/admin/ecommerce/skills") && route.Path != "/api/agent/skills/usage" && route.Path != "/api/ecommerce/skills/prompt" {
			continue
		}
		key := route.Method + " " + route.Path
		if _, exists := critical[key]; exists {
			critical[key] = true
		}
		target := strings.NewReplacer(":industryId", "drama", ":id", "legacy-owned-skill").Replace(route.Path)
		actors := []struct {
			id     string
			status int
		}{{"", http.StatusUnauthorized}, {"skill-member", http.StatusForbidden}}
		if !management[key] && !strings.HasPrefix(route.Path, "/api/admin/") {
			actors = actors[:1]
		}
		for _, actor := range actors {
			t.Run(key+"/"+actor.id, func(t *testing.T) {
				probe := &skillBodyReadProbe{}
				out := skillAuthorizationRequest(router, route.Method, target, actor.id, probe)
				if out.Code != actor.status {
					t.Fatalf("status=%d, want %d; body=%s", out.Code, actor.status, out.Body.String())
				}
				if probe.read {
					t.Fatal("unauthorized skill request consumed its body")
				}
				var envelope struct {
					Code int `json:"code"`
				}
				if err := json.Unmarshal(out.Body.Bytes(), &envelope); err != nil || envelope.Code == 0 {
					t.Fatalf("permission denial must be a failed API envelope: %s", out.Body.String())
				}
			})
		}
	}
	for route, covered := range critical {
		if !covered {
			t.Errorf("missing required permission case: %s", route)
		}
	}
}

func TestSkillRoutesPreserveUsageAndRejectManagementAfterDemotion(t *testing.T) {
	router, db, skillID := skillAuthorizationFixture(t)
	out := skillAuthorizationRequest(router, http.MethodGet, "/api/skills/presets", "skill-admin", nil)
	if out.Code != http.StatusOK || !strings.Contains(out.Body.String(), `"presets"`) {
		t.Fatalf("admin could not read presets: %d %s", out.Code, out.Body.String())
	}
	if err := db.Model(&model.User{}).Where("id = ?", "skill-admin").Update("role", model.UserRoleUser).Error; err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{"/api/skills/presets", "/api/skills/" + skillID + "/file/raw?path=SKILL.md", "/api/skills/curation"} {
		out := skillAuthorizationRequest(router, http.MethodGet, target, "skill-admin", nil)
		if out.Code != http.StatusOK {
			t.Fatalf("demoted admin lost skill usage: %s %d %s", target, out.Code, out.Body.String())
		}
	}
	for _, request := range []struct{ method, path string }{
		{http.MethodGet, "/api/admin/skills"},
		{http.MethodPost, "/api/skills/install"},
		{http.MethodPut, "/api/skills/" + skillID},
		{http.MethodPut, "/api/skills/" + skillID + "/files"},
		{http.MethodDelete, "/api/skills/" + skillID},
	} {
		out := skillAuthorizationRequest(router, request.method, request.path, "skill-admin", nil)
		if out.Code != http.StatusForbidden {
			t.Fatalf("demoted admin retained management: %s %s %d %s", request.method, request.path, out.Code, out.Body.String())
		}
	}
	if err := db.Model(&model.User{}).Where("id = ?", "skill-admin").Update("status", model.UserStatusDisabled).Error; err != nil {
		t.Fatal(err)
	}
	out = skillAuthorizationRequest(router, http.MethodGet, "/api/skills/"+skillID+"/file/raw?path=SKILL.md", "skill-admin", nil)
	if out.Code != http.StatusForbidden {
		t.Fatalf("disabled user retained skill usage: %d %s", out.Code, out.Body.String())
	}
}

func TestSkillRoutesAllowMembersToBrowseAndUseSkills(t *testing.T) {
	router, _, skillID := skillAuthorizationFixture(t)
	base := "/api/skills/" + skillID
	for _, request := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/skills", ""},
		{http.MethodGet, "/api/skills/presets", ""},
		{http.MethodGet, "/api/skills/recommendations", ""},
		{http.MethodPost, "/api/skills/recommendations/drama/install", `{"skillIds":[]}`},
		{http.MethodGet, "/api/skills/curation", ""},
		{http.MethodGet, "/api/skills/library-categories", ""},
		{http.MethodGet, base, ""},
		{http.MethodGet, base + "/files", ""},
		{http.MethodGet, base + "/file?path=SKILL.md", ""},
		{http.MethodGet, base + "/file/raw?path=SKILL.md", ""},
		{http.MethodGet, base + "/bundle", ""},
		{http.MethodGet, base + "/search?q=storyboard", ""},
		{http.MethodGet, "/api/skills/legacy-owned-skill/file?path=SKILL.md", ""},
		{http.MethodPost, base + "/add", ""},
		{http.MethodGet, "/api/skills/added", ""},
		{http.MethodPost, base + "/like", ""},
		{http.MethodPatch, base + "/agent-mode", `{"mode":"manual"}`},
		{http.MethodPatch, base + "/library-category", `{"categoryId":""}`},
		{http.MethodPost, "/api/ecommerce/skills/prompt", `{"skillIds":["` + skillID + `"]}`},
		{http.MethodGet, "/api/agent/skills/usage", ""},
		{http.MethodDelete, base + "/like", ""},
		{http.MethodDelete, base + "/add", ""},
	} {
		t.Run(request.method+" "+request.path, func(t *testing.T) {
			out := skillAuthorizationRequest(router, request.method, request.path, "skill-member", strings.NewReader(request.body))
			if out.Code != http.StatusOK {
				t.Fatalf("member usage refused: %d %s", out.Code, out.Body.String())
			}
			if out.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatalf("skill response missing private cache policy: %v", out.Header())
			}
		})
	}
	created := skillAuthorizationRequest(router, http.MethodPost, "/api/skills/library-categories", "skill-member", strings.NewReader(`{"name":"Personal"}`))
	var category struct {
		Data struct {
			Category struct{ ID string } `json:"category"`
		} `json:"data"`
	}
	if created.Code != http.StatusOK || json.Unmarshal(created.Body.Bytes(), &category) != nil || category.Data.Category.ID == "" {
		t.Fatalf("create personal category: %d %s", created.Code, created.Body.String())
	}
	deleted := skillAuthorizationRequest(router, http.MethodDelete, "/api/skills/library-categories/"+category.Data.Category.ID, "skill-member", nil)
	if deleted.Code != http.StatusOK {
		t.Fatalf("delete personal category: %d %s", deleted.Code, deleted.Body.String())
	}
	platform := skillAuthorizationRequest(router, http.MethodPost, "/api/skills/library-categories", "skill-member", strings.NewReader(`{"name":"Platform","scope":"platform"}`))
	if platform.Code != http.StatusForbidden {
		t.Fatalf("member created platform category: %d %s", platform.Code, platform.Body.String())
	}
}

func TestAgentCapabilitiesAdvertiseSkillToolsToActiveMembers(t *testing.T) {
	router, _, _ := skillAuthorizationFixture(t)
	for _, actor := range []string{"skill-admin", "skill-member"} {
		out := skillAuthorizationRequest(router, http.MethodGet, "/api/agent/capabilities", actor, nil)
		if out.Code != http.StatusOK {
			t.Fatalf("capabilities: %d %s", out.Code, out.Body.String())
		}
		var result struct {
			Data struct {
				Skills bool     `json:"skills"`
				Tools  []string `json:"tools"`
			} `json:"data"`
		}
		if err := json.Unmarshal(out.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if !result.Data.Skills || len(result.Data.Tools) == 0 {
			t.Fatalf("unexpected agent capabilities: %#v", result.Data)
		}
		foundSkill := false
		for _, name := range result.Data.Tools {
			if strings.HasPrefix(name, "skill_") || name == "skills_load" {
				foundSkill = true
			}
		}
		if !foundSkill {
			t.Fatalf("skill tools for %s: %v", actor, result.Data.Tools)
		}
	}
}
