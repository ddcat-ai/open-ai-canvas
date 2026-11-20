package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSkillPackageFilesEditHTTP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.UserIdentity{}, &model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}, &model.UserSkillState{}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"owner", "other"} {
		role := model.UserRoleUser
		if id == "owner" {
			role = model.UserRoleAdmin
		}
		db.Create(&model.User{ID: id, Username: id, Role: role, Status: model.UserStatusActive})
		db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)})
	}
	svc := service.New(repository.New(db), t.TempDir())
	skill, err := svc.CreateSkill("owner", service.SkillMutationRequest{SkillName: "分镜助手", Description: "把剧本拆成镜头", Instruction: "# 分镜助手\n\n正文\n", Tag: "creative"})
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	RegisterSkillRoutes(router.Group("/api"), svc)
	send := func(user string, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPut, "/api/skills/"+skill.SkillID+"/files", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if user != "" {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: user + ".test-token"})
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out
	}
	body := `{"baseVersionId":"` + skill.VersionID + `","operations":[{"op":"write","path":"references/camera.md","content":"# 镜头"}]}`
	if out := send("", body); out.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d %s", out.Code, out.Body.String())
	}
	if out := send("other", body); out.Code != http.StatusForbidden {
		t.Fatalf("non-owner: %d %s", out.Code, out.Body.String())
	}
	if out := send("owner", `{"baseVersionId":"`+skill.VersionID+`","operations":[{"op":"write","path":"../x.md","content":"x"}]}`); out.Code != http.StatusBadRequest {
		t.Fatalf("traversal: %d %s", out.Code, out.Body.String())
	}
	out := send("owner", body)
	if out.Code != http.StatusOK {
		t.Fatalf("owner: %d %s", out.Code, out.Body.String())
	}
	var success struct {
		Code int `json:"code"`
		Data struct {
			Changed bool `json:"changed"`
			Skill   struct {
				VersionID string `json:"versionId"`
			} `json:"skill"`
			Files []struct {
				Path string `json:"path"`
			} `json:"files"`
		} `json:"data"`
	}
	if err := json.Unmarshal(out.Body.Bytes(), &success); err != nil {
		t.Fatal(err)
	}
	if success.Code != 0 || !success.Data.Changed || success.Data.Skill.VersionID == skill.VersionID || len(success.Data.Files) != 2 {
		t.Fatalf("unexpected success body: %s", out.Body.String())
	}
	stale := send("owner", body)
	if stale.Code != http.StatusConflict || !strings.Contains(stale.Body.String(), `"reason":"skill_version_conflict"`) || !strings.Contains(stale.Body.String(), success.Data.Skill.VersionID) {
		t.Fatalf("stale base: %d %s", stale.Code, stale.Body.String())
	}
}
