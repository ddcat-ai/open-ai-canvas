package skills

import (
	"bytes"
	"context"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

func createSkillTestUser(t *testing.T, db *gorm.DB, id string, role model.UserRole, status model.UserStatus) *model.User {
	t.Helper()
	user := &model.User{ID: id, Username: id, Role: role, Status: status}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	return user
}

func newSkillAuthorizationTest(t *testing.T) (*Service, *gorm.DB, *model.User, *model.User, *SkillItem) {
	t.Helper()
	svc, db, admin := newCurationTest(t)
	if err := db.AutoMigrate(&model.SkillVersion{}, &model.SkillFile{}, &model.BuiltinSkillTombstone{}); err != nil {
		t.Fatal(err)
	}
	member := createSkillTestUser(t, db, "legacy-owner", model.UserRoleUser, model.UserStatusActive)
	created := createEditableSkill(t, svc, admin.ID, false)
	legacy := &model.Skill{ID: "legacy-skill", OwnerID: member.ID, Name: "Legacy skill", Description: "Old member upload", Instruction: "# Secret legacy content", Tag: "drama", Source: skillSourceUser, SourceType: "markdown", Status: skillStatusEnabled, IsPrivate: true}
	if err := db.Create(legacy).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.UserSkillState{ID: "legacy-added", UserID: member.ID, SkillID: created.SkillID, Added: true}).Error; err != nil {
		t.Fatal(err)
	}
	return svc, db, admin, member, created
}

func TestSkillAdministratorAuthorizationUsesPersistedAccount(t *testing.T) {
	svc, db, admin, member, _ := newSkillAuthorizationTest(t)
	createSkillTestUser(t, db, "disabled-admin", model.UserRoleAdmin, model.UserStatusDisabled)
	for _, test := range []struct {
		id     string
		admin  bool
		status int
	}{
		{"", false, http.StatusUnauthorized},
		{" \t", false, http.StatusUnauthorized},
		{"missing-user", false, http.StatusUnauthorized},
		{member.ID, false, 0},
		{"disabled-admin", false, http.StatusForbidden},
		{admin.ID, true, 0},
	} {
		t.Run(test.id, func(t *testing.T) {
			isAdmin, err := svc.IsAdministrator(test.id)
			if isAdmin != test.admin || appErrorStatus(err) != test.status || (test.status == 0 && err != nil) {
				t.Fatalf("IsAdministrator = %v, %v; want %v / %d", isAdmin, err, test.admin, test.status)
			}
			err = svc.RequireAdministrator(test.id)
			want := test.status
			if !test.admin && want == 0 {
				want = http.StatusForbidden
			}
			if appErrorStatus(err) != want || (want == 0 && err != nil) {
				t.Fatalf("RequireAdministrator = %v; want %d", err, want)
			}
		})
	}
	injected := errors.New("user repository unavailable")
	if err := db.Callback().Query().Before("gorm:query").Register("skill-user-failure", func(tx *gorm.DB) {
		if tx.Statement.Table == "users" {
			tx.AddError(injected)
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Callback().Query().Remove("skill-user-failure") })
	if _, err := svc.IsAdministrator(admin.ID); !errors.Is(err, injected) {
		t.Fatalf("lost repository error: %v", err)
	}
	if err := svc.RequireAdministrator(admin.ID); !errors.Is(err, injected) {
		t.Fatalf("lost repository error: %v", err)
	}
	if _, err := svc.SkillDetail(admin.ID, "anything"); !errors.Is(err, injected) {
		t.Fatalf("detail swallowed repository error: %v", err)
	}
}

func TestSkillManagementRejectsOrdinaryOwnersBeforeReadingContent(t *testing.T) {
	svc, db, _, member, created := newSkillAuthorizationTest(t)
	// Every skill read would fail independently; authorization must run first.
	var skillReads int
	if err := db.Callback().Query().Before("gorm:query").Register("reject-skill-read", func(tx *gorm.DB) {
		if tx.Statement.Table != "users" {
			skillReads++
			tx.AddError(errors.New("skill data must not be read"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Callback().Query().Remove("reject-skill-read") })
	originalTransport := http.DefaultTransport
	var requests int
	http.DefaultTransport = githubRoundTripFunc(func(*http.Request) (*http.Response, error) {
		requests++
		return nil, errors.New("unauthorized network access")
	})
	t.Cleanup(func() { http.DefaultTransport = originalTransport })
	forged := &model.User{ID: member.ID, Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	operations := []struct {
		name string
		run  func() error
	}{
		{"list", func() error { _, e := svc.Skills(member.ID, SkillListRequest{}); return e }},
		{"added", func() error { _, e := svc.AddedSkills(member.ID); return e }},
		{"detail-public", func() error { _, e := svc.SkillDetail(member.ID, created.SkillID); return e }},
		{"detail-old-owned", func() error { _, e := svc.SkillDetail(member.ID, "legacy-skill"); return e }},
		{"visible", func() error { _, e := svc.visibleSkill(member.ID, "legacy-skill"); return e }},
		{"owned", func() error { _, e := svc.ownedSkill(member.ID, "legacy-skill"); return e }},
		{"create", func() error { _, e := svc.CreateSkill(member.ID, SkillMutationRequest{}); return e }},
		{"update", func() error { _, e := svc.UpdateSkill(member.ID, "legacy-skill", SkillMutationRequest{}); return e }},
		{"delete", func() error { return svc.DeleteSkill(member.ID, "legacy-skill") }},
		{"add", func() error { _, e := svc.SetSkillAdded(member.ID, created.SkillID, true); return e }},
		{"like", func() error { _, e := svc.SetSkillLiked(member.ID, created.SkillID, true); return e }},
		{"agent-mode", func() error { _, e := svc.SetSkillAgentMode(member.ID, "legacy-skill", "auto"); return e }},
		{"agent-mode-invalid", func() error { _, e := svc.SetSkillAgentMode(member.ID, "legacy-skill", "invalid"); return e }},
		{"agent-use", func() error { return svc.RecordSkillAgentUse(member.ID, []string{"legacy-skill"}) }},
		{"catalog-by-ids", func() error { _, e := svc.AgentSkillCatalogByIDs(member.ID, []string{"legacy-skill"}); return e }},
		{"catalog-empty-ids", func() error { _, e := svc.AgentSkillCatalogByIDs(member.ID, nil); return e }},
		{"file-list", func() error { _, e := svc.SkillPackageFiles(member.ID, "legacy-skill"); return e }},
		{"file", func() error { _, e := svc.SkillPackageFile(member.ID, "legacy-skill", "SKILL.md"); return e }},
		{"raw-file", func() error { _, _, _, e := svc.SkillPackageRawFile(member.ID, "legacy-skill", "SKILL.md"); return e }},
		{"bundle", func() error { _, e := svc.SkillPackageBundle(member.ID, "legacy-skill"); return e }},
		{"search", func() error { _, e := svc.SearchSkillPackage(member.ID, "legacy-skill", "Secret"); return e }},
		{"file-edit", func() error {
			_, e := svc.EditSkillPackageFiles(member.ID, "legacy-skill", SkillPackageEditRequest{})
			return e
		}},
		// This header cannot be opened, so 403 proves the gate precedes file access.
		{"upload-before-open", func() error {
			_, e := svc.InstallSkillUpload(member.ID, "zip", &multipart.FileHeader{Filename: "skill.zip", Size: 12}, SkillInstallRequest{})
			return e
		}},
		{"upload-before-parse", func() error {
			_, e := svc.InstallSkillUpload(member.ID, "invalid", nil, SkillInstallRequest{})
			return e
		}},
		{"github-install", func() error {
			_, e := svc.InstallGitHubSkill(member.ID, SkillGitHubInstallRequest{URL: "https://github.com/owner/repo"})
			return e
		}},
		{"github-discover", func() error {
			_, e := svc.DiscoverGitHubSkills(context.Background(), member.ID, SkillGitHubDiscoverRequest{URL: "https://github.com/owner/repo"})
			return e
		}},
		{"github-invalid-url", func() error {
			_, e := svc.InstallGitHubSkill(member.ID, SkillGitHubInstallRequest{URL: "invalid"})
			return e
		}},
		{"github-sync", func() error { _, e := svc.SyncGitHubSkill(member.ID, "legacy-skill"); return e }},
		{"recommendations", func() error { _, e := svc.SkillRecommendations(member.ID); return e }},
		{"recommendation-install", func() error {
			_, e := svc.InstallSkillRecommendations(member.ID, "drama", SkillRecommendationInstallRequest{})
			return e
		}},
		{"category-read", func() error { _, e := svc.SkillLibraryCategories(member.ID, "mine"); return e }},
		{"category-create", func() error {
			_, e := svc.CreateSkillLibraryCategory(forged, SkillLibraryCategoryMutationRequest{Name: "Personal"})
			return e
		}},
		{"category-delete", func() error { return svc.DeleteSkillLibraryCategory(forged, "old-category") }},
		{"category-assign", func() error { _, e := svc.SetSkillLibraryCategory(member.ID, "legacy-skill", ""); return e }},
		{"curation-public", func() error { _, e := svc.SkillCuration(forged, false); return e }},
		{"curation-admin", func() error { _, e := svc.SkillCuration(forged, true); return e }},
		{"curation-write", func() error { _, e := svc.UpdateSkillCuration(forged, SkillCurationUpdate{}, ""); return e }},
		{"admin-list", func() error { _, e := svc.AdminSkills(forged, AdminSkillListRequest{}); return e }},
		{"admin-detail", func() error { _, e := svc.AdminSkillDetail(forged, "legacy-skill"); return e }},
		{"admin-update", func() error {
			_, e := svc.AdminUpdateSkillInfo(forged, "legacy-skill", AdminSkillInfoRequest{})
			return e
		}},
		{"admin-enable", func() error { _, e := svc.AdminSetSkillEnabled(forged, "legacy-skill", true); return e }},
		{"admin-delete", func() error { _, e := svc.AdminDeleteSkill(forged, "legacy-skill"); return e }},
		{"builtin-delete", func() error { return svc.DeleteBuiltinSkill(forged, "legacy-skill") }},
		{"admin-files", func() error { _, e := svc.AdminSkillPackageFiles(forged, "legacy-skill"); return e }},
		{"admin-file", func() error { _, e := svc.AdminSkillPackageFile(forged, "legacy-skill", "SKILL.md"); return e }},
		{"admin-raw", func() error { _, _, _, e := svc.AdminSkillPackageRawFile(forged, "legacy-skill", "SKILL.md"); return e }},
		{"admin-edit", func() error {
			_, e := svc.AdminEditSkillPackageFiles(forged, "legacy-skill", SkillPackageEditRequest{})
			return e
		}},
	}
	for _, operation := range operations {
		t.Run(operation.name, func(t *testing.T) { requireAppError(t, operation.run(), http.StatusForbidden, kernel.ReasonForbidden) })
	}
	for _, catalog := range []func(string) ([]AgentSkillCatalogEntry, error){svc.AgentSkillCatalog, svc.MarketSkillCatalog} {
		items, err := catalog(member.ID)
		if err != nil || items == nil || len(items) != 0 {
			t.Fatalf("ordinary catalog=%#v, err=%v", items, err)
		}
	}
	if requests != 0 || skillReads != 0 {
		t.Fatalf("unauthorized side effects: HTTP=%d skill reads=%d", requests, skillReads)
	}
}

func TestSkillManagementRejectsRevokedAndDisabledPersistedAdmin(t *testing.T) {
	svc, db, actor, _, created := newSkillAuthorizationTest(t)
	for _, change := range []map[string]any{{"role": model.UserRoleUser}, {"role": model.UserRoleAdmin, "status": model.UserStatusDisabled}} {
		if err := db.Model(&model.User{}).Where("id = ?", actor.ID).Updates(change).Error; err != nil {
			t.Fatal(err)
		}
		_, err := svc.SkillDetail(actor.ID, created.SkillID)
		requireAppError(t, err, http.StatusForbidden, kernel.ReasonForbidden)
		_, err = svc.AdminSkillDetail(actor, created.SkillID)
		requireAppError(t, err, http.StatusForbidden, kernel.ReasonForbidden)
		_, err = svc.AdminSetSkillEnabled(actor, created.SkillID, false)
		requireAppError(t, err, http.StatusForbidden, kernel.ReasonForbidden)
		_, err = svc.SkillCuration(actor, false)
		requireAppError(t, err, http.StatusForbidden, kernel.ReasonForbidden)
		_, err = svc.CreateSkillLibraryCategory(actor, SkillLibraryCategoryMutationRequest{Name: "Revoked"})
		requireAppError(t, err, http.StatusForbidden, kernel.ReasonForbidden)
		if change["status"] == model.UserStatusDisabled {
			for _, catalog := range []func(string) ([]AgentSkillCatalogEntry, error){svc.AgentSkillCatalog, svc.MarketSkillCatalog} {
				_, err := catalog(actor.ID)
				requireAppError(t, err, http.StatusForbidden, kernel.ReasonForbidden)
			}
		}
	}
	if err := db.Delete(&model.User{}, "id = ?", actor.ID).Error; err != nil {
		t.Fatal(err)
	}
	_, err := svc.AdminSkillDetail(actor, created.SkillID)
	requireAppError(t, err, http.StatusUnauthorized, kernel.ReasonUnauthorized)
}

func TestActiveAdministratorSkillLifecycleAndIsolation(t *testing.T) {
	svc, db, admin, _, created := newSkillAuthorizationTest(t)
	other := createSkillTestUser(t, db, "other-admin", model.UserRoleAdmin, model.UserStatusActive)
	private := createEditableSkill(t, svc, admin.ID, true)
	_, err := svc.SkillDetail(other.ID, private.SkillID)
	requireAppError(t, err, http.StatusForbidden, kernel.ReasonForbidden)
	_, err = svc.UpdateSkill(other.ID, created.SkillID, SkillMutationRequest{})
	requireAppError(t, err, http.StatusForbidden, kernel.ReasonForbidden)
	if _, err := svc.SetSkillAdded(other.ID, created.SkillID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetSkillAgentMode(other.ID, created.SkillID, "manual"); err != nil {
		t.Fatal(err)
	}
	if err := svc.RecordSkillAgentUse(other.ID, []string{created.SkillID}); err != nil {
		t.Fatal(err)
	}
	if rows, err := svc.AddedSkills(other.ID); err != nil || len(rows) != 1 {
		t.Fatalf("added=%v,err=%v", rows, err)
	}
	if rows, err := svc.AgentSkillCatalog(other.ID); err != nil || len(rows) != 1 {
		t.Fatalf("catalog=%v,err=%v", rows, err)
	}
	if _, err := svc.AdminSkillDetail(&model.User{ID: other.ID, Role: model.UserRoleUser}, private.SkillID); err != nil {
		t.Fatalf("persisted admin must win over caller role: %v", err)
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write([]byte("# Uploaded\n\nAdmin uploads a skill.\n"))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/skills", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if err := request.ParseMultipartForm(1 << 20); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { request.MultipartForm.RemoveAll() })
	installed, err := svc.InstallSkillUpload(admin.ID, "markdown", request.MultipartForm.File["file"][0], SkillInstallRequest{Tag: "drama"})
	if err != nil {
		t.Fatal(err)
	}
	file, err := svc.SkillPackageFile(admin.ID, installed.SkillID, "SKILL.md")
	if err != nil || !strings.Contains(file.Content, "Admin uploads") {
		t.Fatalf("file=%v,err=%v", file, err)
	}
	if err := svc.DeleteSkill(admin.ID, installed.SkillID); err != nil {
		t.Fatal(err)
	}

	recommendations, err := loadSkillRecommendations()
	if err != nil {
		t.Fatal(err)
	}
	industry := recommendations.Industries[0]
	seed := industry.Skills[0]
	if err := db.Create(&model.Skill{ID: seed.SkillID, OwnerID: "system", Name: "Recommendation", Description: "Builtin", Instruction: "# Builtin", Status: skillStatusEnabled, Source: 3, SourceType: "builtin", CurrentVersionID: "recommendation-version"}).Error; err != nil {
		t.Fatal(err)
	}
	if result, err := svc.SkillRecommendations(admin.ID); err != nil || len(result.Industries) == 0 {
		t.Fatalf("recommendations=%v err=%v", result, err)
	}
	result, err := svc.InstallSkillRecommendations(admin.ID, industry.IndustryID, SkillRecommendationInstallRequest{SkillIDs: []string{seed.SkillID}})
	if err != nil || len(result.Installed) != 1 {
		t.Fatalf("install recommendation=%v err=%v", result, err)
	}
}

func TestGitHubSyncSkipsOwnersWithoutCurrentActiveAdminAccess(t *testing.T) {
	svc, db, admin, member, _ := newSkillAuthorizationTest(t)
	createSkillTestUser(t, db, "disabled-owner", model.UserRoleAdmin, model.UserStatusDisabled)
	originalTransport := http.DefaultTransport
	requests := 0
	http.DefaultTransport = githubRoundTripFunc(func(*http.Request) (*http.Response, error) {
		requests++
		return nil, errors.New("sync network must not be reached")
	})
	t.Cleanup(func() { http.DefaultTransport = originalTransport })
	for _, owner := range []string{member.ID, "disabled-owner", "missing-owner", admin.ID} {
		skill := &model.Skill{ID: "github-" + owner, OwnerID: owner, Name: "Github", Description: "Existing package", SourceType: "github", SourceURL: "https://github.com/owner/repo", Status: skillStatusEnabled, AutoUpdate: true, SyncStatus: "synced", SourceCommit: "old-commit"}
		if err := db.Create(skill).Error; err != nil {
			t.Fatal(err)
		}
		file := filepath.Join(svc.dataDir, "skill-packages", skill.ID, "old.zip")
		if err := os.MkdirAll(filepath.Dir(file), 0750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte("keep original package"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Model(&model.User{}).Where("id = ?", admin.ID).Update("role", model.UserRoleUser).Error; err != nil {
		t.Fatal(err)
	}
	// Exercise the exact rows and shared sync function used by StartSyncWorker.
	rows, err := svc.repo.AutoUpdatingGitHubSkills()
	if err != nil || len(rows) != 4 {
		t.Fatalf("auto-updating rows=%d err=%v", len(rows), err)
	}
	for index := range rows {
		err := svc.syncGitHubSkillWithContext(context.Background(), &rows[index])
		status := http.StatusForbidden
		if rows[index].OwnerID == "missing-owner" {
			status = http.StatusUnauthorized
		}
		requireAppError(t, err, status, "")
		saved, err := svc.repo.Skill(rows[index].ID)
		if err != nil || saved.SourceCommit != "old-commit" || saved.SyncStatus != "synced" || saved.LastCheckedAt != nil {
			t.Fatalf("sync changed denied owner data: %#v %v", saved, err)
		}
		data, err := os.ReadFile(filepath.Join(svc.dataDir, "skill-packages", rows[index].ID, "old.zip"))
		if err != nil || string(data) != "keep original package" {
			t.Fatalf("old package changed: %q %v", data, err)
		}
	}
	if requests != 0 {
		t.Fatalf("unauthorized sync HTTP requests=%d", requests)
	}
}
