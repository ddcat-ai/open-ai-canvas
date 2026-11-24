// 官方素材库 handler 测试（迁移 v61）。
//
// 前置条件（必读）：
//   - 步骤 1 已落地：v61 迁移与 OfficialAsset / OfficialAssetImport 模型
//     在模块里（database.MigrateSchema 会建 official_assets /
//     official_asset_imports 两张表）。
//   - 步骤 3 已落地：plugin_management.go 的 officialApplicationPolicies
//     里有 official-asset-library 的策略条目。未落地时用户侧接口会
//     返回 500“插件不存在”，本文件先用 TestOfficialAssetPluginGate
//     把这一点显式测出来，其余测试都会先调 gate 校验并直接失败，
//     避免把“步骤 3 未落地”误读成“步骤 2 有 bug”。
//
// 本文件只测 HTTP 层面的行为契约（可见性、权限、幂等、状态机），
// 不测前端、不测真实对象存储。
package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type officialAssetTestEnv struct {
	db          *gorm.DB
	router      *gin.Engine
	adminCookie string
	userCookie  string
}

func setupOfficialAssetTestEnv(t *testing.T) *officialAssetTestEnv {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatalf("migrate schema: %v", err)
	}
	now := time.Now().UTC()
	users := []model.User{
		{ID: "admin-user", Username: "official-admin", Email: "official-admin@example.test", Role: "admin", Status: model.UserStatusActive},
		{ID: "normal-user", Username: "official-user", Email: "official-user@example.test", Role: "user", Status: model.UserStatusActive},
	}
	for _, user := range users {
		if err := db.Create(&user).Error; err != nil {
			t.Fatalf("seed user %s: %v", user.ID, err)
		}
	}
	sessions := []model.AuthSession{
		{ID: "admin-session", UserID: "admin-user", TokenHash: auth.HashToken("test-token"), ExpiresAt: now.Add(time.Hour)},
		{ID: "user-session", UserID: "normal-user", TokenHash: auth.HashToken("test-token"), ExpiresAt: now.Add(time.Hour)},
	}
	for _, session := range sessions {
		if err := db.Create(&session).Error; err != nil {
			t.Fatalf("seed session %s: %v", session.ID, err)
		}
	}
	resources := []model.Resource{
		{ID: "res-image", UserID: "admin-user", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "test/image.png", MimeType: "image/png", Size: 12345, Width: 800, Height: 600},
		{ID: "res-video", UserID: "admin-user", Kind: "video", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "test/video.mp4", MimeType: "video/mp4", Size: 54321, Width: 1280, Height: 720, DurationMs: 5000},
	}
	for _, resource := range resources {
		if err := db.Create(&resource).Error; err != nil {
			t.Fatalf("seed resource %s: %v", resource.ID, err)
		}
	}
	imageTags, err := model.EncodeOfficialAssetTags([]string{"测试", "红枸杞"})
	if err != nil {
		t.Fatalf("encode tags: %v", err)
	}
	publishedAt := now.Add(-time.Hour)
	assets := []model.OfficialAsset{
		{ID: "oa-draft", ResourceID: "res-image", Title: "草稿图", MediaType: model.OfficialAssetMediaTypeImage, Category: model.AssetCategoryMaterial, TagsJSON: imageTags, Status: model.OfficialAssetStatusDraft, SortOrder: 1, CreatedBy: "admin-user", CreatedAt: now, UpdatedAt: now},
		{ID: "oa-published-image", ResourceID: "res-image", Title: "已发布图片", Description: "红枸杞鲜果", MediaType: model.OfficialAssetMediaTypeImage, Category: model.AssetCategoryMaterial, TagsJSON: imageTags, SourceName: "出彩团队", LicenseNote: "官方出品", UsageNote: "可商用", Status: model.OfficialAssetStatusPublished, SortOrder: 2, CreatedBy: "admin-user", CreatedAt: now, UpdatedAt: now, PublishedAt: &publishedAt},
		{ID: "oa-published-video", ResourceID: "res-video", Title: "已发布视频", MediaType: model.OfficialAssetMediaTypeVideo, Category: model.AssetCategoryEnvironment, TagsJSON: `[]`, Status: model.OfficialAssetStatusPublished, SortOrder: 3, CreatedBy: "admin-user", CreatedAt: now, UpdatedAt: now, PublishedAt: &publishedAt},
		{ID: "oa-unpublished", ResourceID: "res-image", Title: "已下架图片", MediaType: model.OfficialAssetMediaTypeImage, Category: model.AssetCategoryMaterial, TagsJSON: `[]`, Status: model.OfficialAssetStatusUnpublished, SortOrder: 4, CreatedBy: "admin-user", CreatedAt: now, UpdatedAt: now, PublishedAt: &publishedAt},
		// 被引用过的草稿：API 流程里到不了这个状态（草稿不可导入），
		// 这里直接写库，验证删除守卫本身。
		{ID: "oa-referenced-draft", ResourceID: "res-image", Title: "被引用的草稿", MediaType: model.OfficialAssetMediaTypeImage, Category: model.AssetCategoryMaterial, TagsJSON: `[]`, Status: model.OfficialAssetStatusDraft, SortOrder: 5, CreatedBy: "admin-user", CreatedAt: now, UpdatedAt: now},
		{ID: "oa-deletable-draft", ResourceID: "res-image", Title: "可删除的草稿", MediaType: model.OfficialAssetMediaTypeImage, Category: model.AssetCategoryMaterial, TagsJSON: `[]`, Status: model.OfficialAssetStatusDraft, SortOrder: 6, CreatedBy: "admin-user", CreatedAt: now, UpdatedAt: now},
	}
	for _, asset := range assets {
		if err := db.Create(&asset).Error; err != nil {
			t.Fatalf("seed official asset %s: %v", asset.ID, err)
		}
	}
	if err := db.Create(&model.OfficialAssetImport{ID: "import-seed-1", OfficialAssetID: "oa-referenced-draft", Scope: model.OfficialAssetImportScopeLibrary, OwnerID: "normal-user", AssetID: "asset-seed-1", CreatedAt: now}).Error; err != nil {
		t.Fatalf("seed import record: %v", err)
	}
	if err := db.Create(&model.Project{ID: "project-1", UserID: "normal-user", Name: "测试项目", Type: "video", Status: model.ProjectStatusActive, Revision: 1, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatalf("seed project: %v", err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	router := gin.New()
	RegisterOfficialAssetRoutes(router.Group("/api"), svc)
	return &officialAssetTestEnv{
		db: db, router: router,
		adminCookie: "admin-session.test-token",
		userCookie:  "user-session.test-token",
	}
}

type officialAssetEnvelope struct {
	Code int             `json:"code"`
	Data json.RawMessage `json:"data"`
	Msg  string          `json:"msg"`
}

func (env *officialAssetTestEnv) call(t *testing.T, method string, path string, body any, cookie string) (int, officialAssetEnvelope) {
	t.Helper()
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request body: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: cookie})
	}
	recorder := httptest.NewRecorder()
	env.router.ServeHTTP(recorder, req)
	var envelope officialAssetEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response for %s %s: %v (body: %s)", method, path, err, recorder.Body.String())
	}
	return recorder.Code, envelope
}

// requireOfficialAssetPluginGate 先确认步骤 3 的插件策略已落地。
// 未落地时用户侧接口返回 500“插件不存在”——这是步骤 3 的缺失，
// 不是步骤 2 的 bug；这里直接失败并指明原因。
func (env *officialAssetTestEnv) requireOfficialAssetPluginGate(t *testing.T) {
	t.Helper()
	status, envelope := env.call(t, http.MethodGet, "/api/official-assets", nil, env.userCookie)
	if status != http.StatusOK {
		t.Fatalf("官方素材库插件未就绪（步骤 3 的策略条目未落地）: GET /api/official-assets 返回 %d，msg=%q；请先按步骤 3 在 plugin_management.go 的 officialApplicationPolicies 里加 official-asset-library", status, envelope.Msg)
	}
}

func TestOfficialAssetPluginGate(t *testing.T) {
	env := setupOfficialAssetTestEnv(t)
	env.requireOfficialAssetPluginGate(t)
}

func TestCopyOfficialCharacterPreservesDataAndRejectsStaleVersion(t *testing.T) {
	t.Skip("官方角色卡另存暂缓，接口未开放")
	env := setupOfficialAssetTestEnv(t)
	env.requireOfficialAssetPluginGate(t)
	for _, res := range []model.Resource{
		{ID: "copy-image", UserID: "admin-user", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "image", MimeType: "image/png"},
		{ID: "copy-audio", UserID: "admin-user", Kind: "audio", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "audio", MimeType: "audio/mpeg"},
	} {
		if err := env.db.Create(&res).Error; err != nil {
			t.Fatal(err)
		}
	}
	snapshot := `{"versionId":"original-version","definition":{"role":"原角色"},"visualStatus":"ready","voiceStatus":"ready","representations":[{"resourceId":"copy-image","role":"turnaround_sheet","mediaType":"image","status":"ready"}],"voice":{"profile":{"name":"声音","voiceKey":"voice-key","sampleResourceId":"copy-audio","compatibleModels":[]},"instructions":"轻声"}}`
	asset := model.OfficialAsset{ID: "copy-official", ResourceID: "copy-image", Title: "原角色", MediaType: model.OfficialAssetMediaTypeEntity, Category: model.AssetCategoryCharacter, TagsJSON: `[]`, Status: model.OfficialAssetStatusPublished, CharacterSnapshotJSON: snapshot}
	if err := env.db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	request := map[string]any{"name": "新角色", "definition": map[string]any{"role": "新角色设定"}, "sourceVersionId": "old"}
	status, _ := env.call(t, http.MethodPost, "/api/official-assets/copy-official/copy-character", request, env.userCookie)
	if status == http.StatusOK {
		t.Fatal("stale version accepted")
	}
	request["sourceVersionId"] = "original-version"
	for i := 0; i < 2; i++ {
		status, result := env.call(t, http.MethodPost, "/api/official-assets/copy-official/copy-character", request, env.userCookie)
		if status != http.StatusOK {
			t.Fatalf("copy: %d %s", status, result.Msg)
		}
		var out struct {
			Character struct {
				Definition      map[string]any `json:"definition"`
				Representations []struct {
					ResourceID string `json:"resourceId"`
				} `json:"representations"`
				Voice struct {
					Profile struct {
						SampleResourceID string `json:"sampleResourceId"`
						VoiceKey         string `json:"voiceKey"`
					} `json:"profile"`
				} `json:"voice"`
			} `json:"character"`
		}
		if err := json.Unmarshal(result.Data, &out); err != nil {
			t.Fatal(err)
		}
		if out.Character.Definition["role"] != "新角色设定" || len(out.Character.Representations) != 1 || out.Character.Representations[0].ResourceID != "copy-image" || out.Character.Voice.Profile.SampleResourceID != "copy-audio" || out.Character.Voice.Profile.VoiceKey != "voice-key" {
			t.Fatalf("incomplete card: %+v", out.Character)
		}
	}
}

func TestOfficialAssetsUserVisibility(t *testing.T) {
	env := setupOfficialAssetTestEnv(t)
	env.requireOfficialAssetPluginGate(t)

	status, envelope := env.call(t, http.MethodGet, "/api/official-assets", nil, env.userCookie)
	if status != http.StatusOK {
		t.Fatalf("list official assets: want 200, got %d (%s)", status, envelope.Msg)
	}
	var page struct {
		Items []struct {
			ID        string `json:"id"`
			MediaType string `json:"mediaType"`
			Status    string `json:"status"`
		} `json:"items"`
		Total int64 `json:"total"`
	}
	if err := json.Unmarshal(envelope.Data, &page); err != nil {
		t.Fatalf("decode page: %v", err)
	}
	if page.Total != 2 {
		t.Fatalf("list total: want 2 published only, got %d", page.Total)
	}
	for _, item := range page.Items {
		if item.Status != string(model.OfficialAssetStatusPublished) {
			t.Fatalf("list item %s: want published only, got status %q", item.ID, item.Status)
		}
	}

	// 草稿与已下架对普通用户一律按不存在处理（404，不泄露存在性）。
	for _, id := range []string{"oa-draft", "oa-unpublished", "oa-missing"} {
		status, envelope := env.call(t, http.MethodGet, "/api/official-assets/"+id, nil, env.userCookie)
		if status != http.StatusNotFound {
			t.Fatalf("GET /api/official-assets/%s: want 404, got %d (%s)", id, status, envelope.Msg)
		}
	}

	// 非法筛选值直接 400，不静默返回全量。
	status, _ = env.call(t, http.MethodGet, "/api/official-assets?mediaType=audio", nil, env.userCookie)
	if status != http.StatusBadRequest {
		t.Fatalf("invalid mediaType filter: want 400, got %d", status)
	}

	// 关键词与标签筛选只在已发布范围内命中。
	status, envelope = env.call(t, http.MethodGet, "/api/official-assets?q=红枸杞", nil, env.userCookie)
	if status != http.StatusOK {
		t.Fatalf("keyword search: want 200, got %d", status)
	}
	if err := json.Unmarshal(envelope.Data, &page); err != nil {
		t.Fatalf("decode search page: %v", err)
	}
	if page.Total != 1 || page.Items[0].ID != "oa-published-image" {
		t.Fatalf("keyword search: want only oa-published-image, got total=%d", page.Total)
	}
	status, envelope = env.call(t, http.MethodGet, "/api/official-assets?tag=红枸杞", nil, env.userCookie)
	if status != http.StatusOK {
		t.Fatalf("tag filter: want 200, got %d", status)
	}
	if err := json.Unmarshal(envelope.Data, &page); err != nil {
		t.Fatalf("decode tag page: %v", err)
	}
	if page.Total != 1 || page.Items[0].ID != "oa-published-image" {
		t.Fatalf("tag filter: want only oa-published-image, got total=%d", page.Total)
	}
}

func TestOfficialAssetsAdminForbidden(t *testing.T) {
	env := setupOfficialAssetTestEnv(t)
	env.requireOfficialAssetPluginGate(t)

	createBody := map[string]any{
		"resourceId": "res-image", "title": "越权新建", "mediaType": "image",
	}
	for _, tc := range []struct {
		method string
		path   string
		body   any
	}{
		{http.MethodPost, "/api/admin/official-assets", createBody},
		{http.MethodGet, "/api/admin/official-assets", nil},
		{http.MethodPatch, "/api/admin/official-assets/oa-draft/publish", nil},
		{http.MethodPatch, "/api/admin/official-assets/oa-draft/unpublish", nil},
		{http.MethodDelete, "/api/admin/official-assets/oa-draft", nil},
	} {
		status, _ := env.call(t, tc.method, tc.path, tc.body, env.userCookie)
		if status != http.StatusForbidden {
			t.Fatalf("%s %s as normal user: want 403, got %d", tc.method, tc.path, status)
		}
	}

	// 越权调用后数据未被改动。
	var count int64
	if err := env.db.Model(&model.OfficialAsset{}).Where("id = ? AND deleted_at IS NULL", "oa-draft").Count(&count).Error; err != nil {
		t.Fatalf("count draft: %v", err)
	}
	if count != 1 {
		t.Fatalf("draft oa-draft must still exist after forbidden calls, count=%d", count)
	}
}

func TestOfficialAssetImportIdempotent(t *testing.T) {
	env := setupOfficialAssetTestEnv(t)
	env.requireOfficialAssetPluginGate(t)

	var importResult struct {
		Asset           json.RawMessage `json:"asset"`
		AlreadyImported bool            `json:"alreadyImported"`
	}
	status, envelope := env.call(t, http.MethodPost, "/api/official-assets/oa-published-image/import", nil, env.userCookie)
	if status != http.StatusOK {
		t.Fatalf("first import: want 200, got %d (%s)", status, envelope.Msg)
	}
	if err := json.Unmarshal(envelope.Data, &importResult); err != nil {
		t.Fatalf("decode import result: %v", err)
	}
	if importResult.AlreadyImported {
		t.Fatalf("first import: want alreadyImported=false")
	}
	var firstAsset struct {
		ID   string `json:"id"`
		Data struct {
			OfficialAssetID string `json:"officialAssetId"`
			OfficialTitle   string `json:"officialTitle"`
			LicenseNote     string `json:"licenseNote"`
		} `json:"data"`
	}
	if err := json.Unmarshal(importResult.Asset, &firstAsset); err != nil {
		t.Fatalf("decode imported asset: %v", err)
	}
	if firstAsset.Data.OfficialAssetID != "oa-published-image" || firstAsset.Data.OfficialTitle != "已发布图片" || firstAsset.Data.LicenseNote != "官方出品" {
		t.Fatalf("imported asset snapshot wrong: %+v", firstAsset.Data)
	}

	// 第二次导入同一素材：返回同一条资产，不新建。
	status, envelope = env.call(t, http.MethodPost, "/api/official-assets/oa-published-image/import", nil, env.userCookie)
	if status != http.StatusOK {
		t.Fatalf("second import: want 200, got %d (%s)", status, envelope.Msg)
	}
	if err := json.Unmarshal(envelope.Data, &importResult); err != nil {
		t.Fatalf("decode second import result: %v", err)
	}
	if !importResult.AlreadyImported {
		t.Fatalf("second import: want alreadyImported=true")
	}
	var secondAsset struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(importResult.Asset, &secondAsset); err != nil {
		t.Fatalf("decode second imported asset: %v", err)
	}
	if secondAsset.ID != firstAsset.ID {
		t.Fatalf("repeat import: want same asset id %s, got %s", firstAsset.ID, secondAsset.ID)
	}
	var assetCount int64
	if err := env.db.Model(&model.Asset{}).Where("user_id = ?", "normal-user").Count(&assetCount).Error; err != nil {
		t.Fatalf("count user assets: %v", err)
	}
	if assetCount != 1 {
		t.Fatalf("repeat import must not create a second asset, user asset count=%d", assetCount)
	}
	var importCount int64
	if err := env.db.Model(&model.OfficialAssetImport{}).Where("official_asset_id = ?", "oa-published-image").Count(&importCount).Error; err != nil {
		t.Fatalf("count import records: %v", err)
	}
	if importCount != 1 {
		t.Fatalf("repeat import must not create a second import record, count=%d", importCount)
	}

	// 导入到项目：视频素材同样可导入；重复导入不重复建链接。
	status, envelope = env.call(t, http.MethodPost, "/api/official-assets/oa-published-video/import-to-project", map[string]any{"projectId": "project-1"}, env.userCookie)
	if status != http.StatusOK {
		t.Fatalf("import to project: want 200, got %d (%s)", status, envelope.Msg)
	}
	if err := json.Unmarshal(envelope.Data, &importResult); err != nil {
		t.Fatalf("decode project import result: %v", err)
	}
	if importResult.AlreadyImported {
		t.Fatalf("first project import: want alreadyImported=false")
	}
	var projectAsset struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(importResult.Asset, &projectAsset); err != nil {
		t.Fatalf("decode project imported asset: %v", err)
	}
	status, envelope = env.call(t, http.MethodPost, "/api/official-assets/oa-published-video/import-to-project", map[string]any{"projectId": "project-1"}, env.userCookie)
	if status != http.StatusOK {
		t.Fatalf("second project import: want 200, got %d (%s)", status, envelope.Msg)
	}
	if err := json.Unmarshal(envelope.Data, &importResult); err != nil {
		t.Fatalf("decode second project import result: %v", err)
	}
	if !importResult.AlreadyImported {
		t.Fatalf("second project import: want alreadyImported=true")
	}
	var linkCount int64
	if err := env.db.Model(&model.ProjectAssetLink{}).Where("project_id = ? AND asset_id = ?", "project-1", projectAsset.ID).Count(&linkCount).Error; err != nil {
		t.Fatalf("count project links: %v", err)
	}
	if linkCount != 1 {
		t.Fatalf("repeat project import must not create a second link, count=%d", linkCount)
	}
	// 不是本人项目按不存在处理。
	status, _ = env.call(t, http.MethodPost, "/api/official-assets/oa-published-video/import-to-project", map[string]any{"projectId": "project-1"}, env.adminCookie)
	if status != http.StatusNotFound {
		t.Fatalf("import to another user's project: want 404, got %d", status)
	}
}

func TestOfficialAssetUnpublishBlocksNewImport(t *testing.T) {
	env := setupOfficialAssetTestEnv(t)
	env.requireOfficialAssetPluginGate(t)

	// 先导入图片（下架前），再下架视频。
	status, envelope := env.call(t, http.MethodPost, "/api/official-assets/oa-published-image/import", nil, env.userCookie)
	if status != http.StatusOK {
		t.Fatalf("import before unpublish: want 200, got %d (%s)", status, envelope.Msg)
	}
	var importResult struct {
		Asset json.RawMessage `json:"asset"`
	}
	if err := json.Unmarshal(envelope.Data, &importResult); err != nil {
		t.Fatalf("decode import result: %v", err)
	}
	var imported struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(importResult.Asset, &imported); err != nil {
		t.Fatalf("decode imported asset: %v", err)
	}

	status, _ = env.call(t, http.MethodPatch, "/api/admin/official-assets/oa-published-video/unpublish", nil, env.adminCookie)
	if status != http.StatusOK {
		t.Fatalf("unpublish: want 200, got %d", status)
	}
	// 下架后新导入被拒。
	status, _ = env.call(t, http.MethodPost, "/api/official-assets/oa-published-video/import", nil, env.userCookie)
	if status != http.StatusNotFound {
		t.Fatalf("import after unpublish: want 404, got %d", status)
	}
	// 下架前已导入的资产仍然存在、仍可读。
	var asset model.Asset
	if err := env.db.First(&asset, "id = ? AND user_id = ?", imported.ID, "normal-user").Error; err != nil {
		t.Fatalf("previously imported asset must remain usable after unpublish: %v", err)
	}
	if asset.Status != model.AssetVersionStatusConfirmed {
		t.Fatalf("previously imported asset status: want confirmed, got %q", asset.Status)
	}
}

func TestOfficialAssetAdminLifecycle(t *testing.T) {
	env := setupOfficialAssetTestEnv(t)
	env.requireOfficialAssetPluginGate(t)

	// 新建默认 draft。
	status, envelope := env.call(t, http.MethodPost, "/api/admin/official-assets", map[string]any{
		"resourceId": "res-image", "title": "新官方图", "mediaType": "image",
		"category": "material", "tags": []string{"新品"}, "sortOrder": 10,
	}, env.adminCookie)
	if status != http.StatusOK {
		t.Fatalf("admin create: want 200, got %d (%s)", status, envelope.Msg)
	}
	var created struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(envelope.Data, &created); err != nil {
		t.Fatalf("decode created asset: %v", err)
	}
	if created.Status != string(model.OfficialAssetStatusDraft) {
		t.Fatalf("new official asset: want draft, got %q", created.Status)
	}
	id := created.ID

	// 普通用户看不到新建的草稿。
	status, _ = env.call(t, http.MethodGet, "/api/official-assets/"+id, nil, env.userCookie)
	if status != http.StatusNotFound {
		t.Fatalf("draft detail as user: want 404, got %d", status)
	}

	// 发布 → 下架 → 再发布；同状态重复发布被拒。
	for _, tc := range []struct {
		path string
		want int
	}{
		{"/api/admin/official-assets/" + id + "/publish", http.StatusOK},
		{"/api/admin/official-assets/" + id + "/publish", http.StatusBadRequest},
		{"/api/admin/official-assets/" + id + "/unpublish", http.StatusOK},
		{"/api/admin/official-assets/" + id + "/publish", http.StatusOK},
	} {
		status, _ := env.call(t, http.MethodPatch, tc.path, nil, env.adminCookie)
		if status != tc.want {
			t.Fatalf("PATCH %s: want %d, got %d", tc.path, tc.want, status)
		}
	}

	// 已发布不能删除；先下架也不能删除（只有草稿能删）。
	status, _ = env.call(t, http.MethodDelete, "/api/admin/official-assets/"+id, nil, env.adminCookie)
	if status != http.StatusBadRequest {
		t.Fatalf("delete published: want 400, got %d", status)
	}
	status, _ = env.call(t, http.MethodPatch, "/api/admin/official-assets/"+id+"/unpublish", nil, env.adminCookie)
	if status != http.StatusOK {
		t.Fatalf("unpublish before delete check: want 200, got %d", status)
	}
	status, _ = env.call(t, http.MethodDelete, "/api/admin/official-assets/"+id, nil, env.adminCookie)
	if status != http.StatusBadRequest {
		t.Fatalf("delete unpublished: want 400, got %d", status)
	}

	// 被引用过的草稿不能删除（409）。
	status, _ = env.call(t, http.MethodDelete, "/api/admin/official-assets/oa-referenced-draft", nil, env.adminCookie)
	if status != http.StatusConflict {
		t.Fatalf("delete referenced draft: want 409, got %d", status)
	}

	// 未被引用的草稿可以删除；删除后管理列表里也没有了。
	status, _ = env.call(t, http.MethodDelete, "/api/admin/official-assets/oa-deletable-draft", nil, env.adminCookie)
	if status != http.StatusOK {
		t.Fatalf("delete unreferenced draft: want 200, got %d", status)
	}
	status, envelope = env.call(t, http.MethodGet, "/api/admin/official-assets?status=draft", nil, env.adminCookie)
	if status != http.StatusOK {
		t.Fatalf("admin list drafts: want 200, got %d", status)
	}
	var page struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	if err := json.Unmarshal(envelope.Data, &page); err != nil {
		t.Fatalf("decode admin page: %v", err)
	}
	for _, item := range page.Items {
		if item.ID == "oa-deletable-draft" {
			t.Fatalf("deleted draft must not appear in admin list")
		}
	}
}

func TestOfficialAssetAdminCreateValidation(t *testing.T) {
	env := setupOfficialAssetTestEnv(t)
	env.requireOfficialAssetPluginGate(t)

	for _, tc := range []struct {
		name string
		body map[string]any
	}{
		{"bad media type", map[string]any{"resourceId": "res-image", "title": "x", "mediaType": "audio"}},
		{"empty title", map[string]any{"resourceId": "res-image", "title": "  ", "mediaType": "image"}},
		{"missing resource", map[string]any{"resourceId": "res-missing", "title": "x", "mediaType": "image"}},
		{"kind mismatch", map[string]any{"resourceId": "res-video", "title": "x", "mediaType": "image"}},
	} {
		status, _ := env.call(t, http.MethodPost, "/api/admin/official-assets", tc.body, env.adminCookie)
		if status != http.StatusBadRequest {
			t.Fatalf("%s: want 400, got %d", tc.name, status)
		}
	}
}
