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

func TestDramaCastMaterialRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.SystemSetting{}, &model.UserStorageGrant{}, &model.UserStorageState{}, &model.Project{}, &model.DramaProduction{}, &model.DramaCast{}, &model.DramaTake{}, &model.DramaJob{}, &model.DramaEpisode{}, &model.DramaShot{}, &model.DramaSegment{}, &model.Resource{}, &model.VoiceProfile{}); err != nil {
		t.Fatal(err)
	}
	for _, record := range []any{
		&model.User{ID: "owner", Username: "owner", Email: "drama-owner@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "owner", UserID: "owner", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.Project{ID: "source", UserID: "owner", Name: "第一季", Type: "short-drama"},
		&model.Project{ID: "target", UserID: "owner", Name: "第二季", Type: "short-drama"},
		&model.Project{ID: "foreign", UserID: "another", Name: "其他作品", Type: "short-drama"},
		&model.Project{ID: "non-drama", UserID: "owner", Name: "普通项目"},
		&model.DramaCast{ID: "foreign-cast", ProjectID: "foreign", Kind: "character", Name: "别人的角色", ImageStatus: model.DramaMediaDraft},
		&model.DramaProduction{ProjectID: "source", UserID: "owner", Status: model.DramaStatusDraft, SettingsJSON: `{"assets":{"mode":"turnaround"},"stylePrompt":"玄幻"}`},
		&model.DramaProduction{ProjectID: "target", UserID: "owner", Status: model.DramaStatusDraft},
		&model.DramaProduction{ProjectID: "foreign", UserID: "another", Status: model.DramaStatusDraft},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), t.TempDir())
	router := gin.New()
	registerDramaRoutes(router.Group("/api"), svc)
	callMethod := func(method, path, body string, authenticated bool, status int) json.RawMessage {
		t.Helper()
		req := httptest.NewRequest(method, "/api"+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if authenticated {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "owner.test-token"})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != status {
			t.Fatalf("%s %s: %d wanted %d: %s", method, path, w.Code, status, w.Body.String())
		}
		var envelope struct {
			Code    int             `json:"code"`
			Data    json.RawMessage `json:"data"`
			Reason  string          `json:"reason"`
			Message string          `json:"msg"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		if status == http.StatusOK && envelope.Code != 0 {
			t.Fatalf("unsuccessful envelope: %s", w.Body.String())
		}
		if status == http.StatusNotFound && (envelope.Code != http.StatusNotFound || envelope.Reason != "not_found" || envelope.Message != "短剧作品或素材不存在") {
			t.Fatalf("not-found must have a uniform public response: %s", w.Body.String())
		}
		return envelope.Data
	}
	call := func(path, body string, authenticated bool, status int) json.RawMessage {
		t.Helper()
		return callMethod(http.MethodPost, path, body, authenticated, status)
	}
	create := `{"kind":"character","name":"林逸","appearance":"白衬衫"}`
	call("/dramas/source/cast", create, false, http.StatusUnauthorized)
	for _, projectID := range []string{"foreign", "missing", "non-drama"} {
		call("/dramas/"+projectID+"/cast", create, true, http.StatusNotFound)
		callMethod(http.MethodGet, "/dramas/"+projectID+"/cast", "", true, http.StatusNotFound)
	}
	call("/dramas/source/cast", `{"kind":"invalid","name":"林逸","appearance":"白衬衫"}`, true, http.StatusBadRequest)
	var created struct {
		Cast model.DramaCast `json:"cast"`
	}
	if err := json.Unmarshal(call("/dramas/source/cast", create, true, http.StatusOK), &created); err != nil {
		t.Fatal(err)
	}
	if created.Cast.ID == "" || created.Cast.ImageStatus != model.DramaMediaDraft {
		t.Fatalf("create contract: %+v", created)
	}
	for _, path := range []string{
		"/dramas/source/cast/missing/image-prompt",
		"/dramas/source/cast/foreign-cast/image-prompt",
		"/dramas/target/cast/" + created.Cast.ID + "/image-prompt",
		"/dramas/foreign/cast/foreign-cast/image-prompt",
		"/dramas/missing/cast/" + created.Cast.ID + "/image-prompt",
		"/dramas/source/cast/missing/looks",
		"/dramas/source/cast/foreign-cast/looks",
	} {
		call(path, `{}`, true, http.StatusNotFound)
	}
	for _, castID := range []string{"missing", "foreign-cast"} {
		callMethod(http.MethodPatch, "/dramas/source/cast/"+castID, `{}`, true, http.StatusNotFound)
		callMethod(http.MethodPatch, "/dramas/source/looks/"+castID, `{}`, true, http.StatusNotFound)
	}
	var preview struct {
		ImagePrompt string `json:"imagePrompt"`
	}
	if err := json.Unmarshal(call("/dramas/source/cast/"+created.Cast.ID+"/image-prompt", `{"appearance":"六岁儿童","imageStylePrompt":"都市写实"}`, true, http.StatusOK), &preview); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(preview.ImagePrompt, "三视图") || !strings.Contains(preview.ImagePrompt, "六岁儿童") || strings.Contains(preview.ImagePrompt, "玄幻") {
		t.Fatalf("preview contract: %+v", preview)
	}
	for _, test := range []struct{ target, source, castID string }{
		{"foreign", "source", created.Cast.ID},
		{"missing", "source", created.Cast.ID},
		{"target", "foreign", "foreign-cast"},
		{"target", "missing", created.Cast.ID},
		{"target", "source", "missing"},
		{"target", "source", "foreign-cast"},
	} {
		invalid, _ := json.Marshal(map[string]any{"sourceProjectId": test.source, "castIds": []string{test.castID}})
		call("/dramas/"+test.target+"/cast/import", string(invalid), true, http.StatusNotFound)
	}
	body, _ := json.Marshal(map[string]any{"sourceProjectId": "source", "castIds": []string{created.Cast.ID}})
	var imported service.ImportDramaCastResult
	if err := json.Unmarshal(call("/dramas/target/cast/import", string(body), true, http.StatusOK), &imported); err != nil {
		t.Fatal(err)
	}
	if imported.Imported != 1 || imported.Skipped != 0 || len(imported.Cast) != 1 || imported.Cast[0].SourceCastID != created.Cast.ID {
		t.Fatalf("import contract: %+v", imported)
	}
	var jobs int64
	if err := db.Model(&model.DramaJob{}).Count(&jobs).Error; err != nil || jobs != 0 {
		t.Fatalf("draft endpoints queued jobs: %d %v", jobs, err)
	}
}
