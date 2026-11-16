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

func skillAuthorizationFixture(t *testing.T) (*gin.Engine, *gorm.DB) {
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
	if err := db.AutoMigrate(&model.User{}, &model.UserIdentity{}, &model.AuthSession{}); err != nil {
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
	router := gin.New()
	api := router.Group("/api")
	RegisterSkillRoutes(api, svc)
	RegisterAdminSkillRoutes(api, svc)
	RegisterAgentRoutes(api, svc)
	RegisterEcommerceRoutes(api, svc)
	return router, db
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

func TestSkillRoutesRejectNonAdminsBeforeReadingInput(t *testing.T) {
	router, _ := skillAuthorizationFixture(t)
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
		for _, actor := range []struct {
			id     string
			status int
		}{{"", http.StatusUnauthorized}, {"skill-member", http.StatusForbidden}} {
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

func TestSkillRoutesAllowAdminAndRejectSameSessionAfterDemotion(t *testing.T) {
	router, db := skillAuthorizationFixture(t)
	out := skillAuthorizationRequest(router, http.MethodGet, "/api/skills/presets", "skill-admin", nil)
	if out.Code != http.StatusOK || !strings.Contains(out.Body.String(), `"presets"`) {
		t.Fatalf("admin could not read presets: %d %s", out.Code, out.Body.String())
	}
	if err := db.Model(&model.User{}).Where("id = ?", "skill-admin").Update("role", model.UserRoleUser).Error; err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{"/api/skills/presets", "/api/skills/legacy-owned-skill/file/raw?path=SKILL.md", "/api/admin/skills"} {
		out := skillAuthorizationRequest(router, http.MethodGet, target, "skill-admin", nil)
		if out.Code != http.StatusForbidden {
			t.Fatalf("demoted admin retained skill access: %s %d %s", target, out.Code, out.Body.String())
		}
	}
}

func TestAgentCapabilitiesDoNotAdvertiseSkillToolsToMembers(t *testing.T) {
	router, _ := skillAuthorizationFixture(t)
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
		admin := actor == "skill-admin"
		if result.Data.Skills != admin || len(result.Data.Tools) == 0 {
			t.Fatalf("unexpected agent capabilities: %#v", result.Data)
		}
		foundSkill := false
		for _, name := range result.Data.Tools {
			if strings.HasPrefix(name, "skill_") || name == "skills_load" {
				foundSkill = true
			}
		}
		if foundSkill != admin {
			t.Fatalf("skill tools for %s: %v", actor, result.Data.Tools)
		}
	}
}
