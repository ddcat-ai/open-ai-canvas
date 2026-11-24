// 官方素材库 handler（迁移 v61）。
//
// 分层约定（仓库 AGENTS.md §3）：handler 只做三件事——解析入参、
// 取 currentUser、调 service、按 ok / failService 返回。
// 不做权限判断（RequireAdmin 在 service 层）、不做状态机、
// 不做“用户能不能看”的判断。写失败直接透传 service 的错误，
// 绝不返回默认成功。
//
// 路由注册：RegisterCanvasAPI（backend/internal/handler/api.go:12）里
// 加一行 RegisterOfficialAssetRoutes(api, svc)，见文件尾注释。
package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

var errEmptyProjectID = errors.New("请选择要导入的项目")

// RegisterOfficialAssetRoutes 注册官方素材库的全部路由。
func RegisterOfficialAssetRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/official-assets", listOfficialAssetsHandler(svc))
	r.GET("/official-assets/:id", getOfficialAssetHandler(svc))
	r.POST("/official-assets/:id/import", importOfficialAssetToLibraryHandler(svc))
	r.POST("/official-assets/:id/import-to-project", importOfficialAssetToProjectHandler(svc))
	r.GET("/official-assets/:id/reference", getOfficialAssetReferenceHandler(svc))

	admin := r.Group("/admin/official-assets")
	admin.POST("", createOfficialAssetHandler(svc))
	admin.GET("", listAdminOfficialAssetsHandler(svc))
	admin.GET("/:id", getAdminOfficialAssetHandler(svc))
	admin.PATCH("/:id", updateOfficialAssetHandler(svc))
	admin.PATCH("/:id/publish", publishOfficialAssetHandler(svc))
	admin.PATCH("/:id/unpublish", unpublishOfficialAssetHandler(svc))
	admin.PATCH("/:id/sort", sortOfficialAssetHandler(svc))
	admin.DELETE("/:id", deleteOfficialAssetHandler(svc))
}

func copyOfficialCharacterHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.CopyOfficialCharacterRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("请求格式无效"))
			return
		}
		result, err := svc.CopyOfficialCharacter(user.ID, strings.TrimSpace(c.Param("id")), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	}
}

func listOfficialAssetsHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, pageSize, err := parsePaginationQuery(c, 20)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		filter := service.OfficialAssetPageFilter{
			MediaType: c.Query("mediaType"),
			Category:  c.Query("category"),
			Tag:       c.Query("tag"),
			Query:     c.Query("q"),
		}
		result, err := svc.OfficialAssetsPage(user.ID, page, pageSize, filter)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	}
}

func getOfficialAssetHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		detail, err := svc.OfficialAssetDetail(user.ID, strings.TrimSpace(c.Param("id")))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, detail)
	}
}

func importOfficialAssetToLibraryHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.ImportOfficialAssetToLibrary(user.ID, strings.TrimSpace(c.Param("id")))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	}
}

type importOfficialAssetToProjectRequest struct {
	ProjectID string `json:"projectId"`
}

func importOfficialAssetToProjectHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req importOfficialAssetToProjectRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if strings.TrimSpace(req.ProjectID) == "" {
			fail(c, http.StatusBadRequest, errEmptyProjectID)
			return
		}
		result, err := svc.ImportOfficialAssetToProject(user.ID, req.ProjectID, strings.TrimSpace(c.Param("id")))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	}
}

// getOfficialAssetReferenceHandler 返回路径 B（画布直接引用）的引用载荷。
// 本步骤只提供读取端：画布是否接受非 Asset 的引用载荷取决于 v1692 的
// 插入契约，待 Mac 核对后再决定是否启用。选择器先走路径 A（导入）。
func getOfficialAssetReferenceHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		reference, err := svc.OfficialAssetReferenceForUser(user.ID, strings.TrimSpace(c.Param("id")))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, reference)
	}
}

func listAdminOfficialAssetsHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, pageSize, err := parsePaginationQuery(c, 20)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		filter := service.OfficialAssetPageFilter{
			MediaType: c.Query("mediaType"),
			Category:  c.Query("category"),
			Tag:       c.Query("tag"),
			Query:     c.Query("q"),
			Status:    c.Query("status"),
		}
		result, err := svc.AdminOfficialAssetsPage(user, page, pageSize, filter)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	}
}

func getAdminOfficialAssetHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		detail, err := svc.AdminOfficialAssetDetail(user, strings.TrimSpace(c.Param("id")))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, detail)
	}
}

func createOfficialAssetHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.CreateOfficialAssetRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		detail, err := svc.CreateOfficialAsset(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, detail)
	}
}

func updateOfficialAssetHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.UpdateOfficialAssetRequest
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(body, &raw); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := json.Unmarshal(body, &req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		// tags 字段是否出现过要区分“没传”和“传了空数组”：
		// 显式传 [] 表示清空标签；没传表示不动。
		// ShouldBindJSON 无法区分，因此这里用原始 JSON 探测。
		if _, present := raw["tags"]; present {
			req.TagsSet = true
		}
		detail, err := svc.UpdateOfficialAsset(user, strings.TrimSpace(c.Param("id")), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, detail)
	}
}

type sortOfficialAssetRequest struct {
	SortOrder int `json:"sortOrder"`
}

func sortOfficialAssetHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req sortOfficialAssetRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := svc.UpdateOfficialAssetSortOrder(user, strings.TrimSpace(c.Param("id")), req.SortOrder); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	}
}

func publishOfficialAssetHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.PublishOfficialAsset(user, strings.TrimSpace(c.Param("id"))); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	}
}

func unpublishOfficialAssetHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.UnpublishOfficialAsset(user, strings.TrimSpace(c.Param("id"))); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	}
}

func deleteOfficialAssetHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteOfficialAsset(user, strings.TrimSpace(c.Param("id"))); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	}
}

// api.go 注册（一行，放到 RegisterCanvasAPI 里，RegisterAdminRoutes 附近）：
//
//	RegisterOfficialAssetRoutes(api, svc)
//
// 待 Mac 核对：v1692 的 RegisterCanvasAPI 签名与 api 变量名
// （快照里是 RegisterCanvasAPI(api *gin.RouterGroup, svc *service.Service)）。
