package handler

import (
	"net/http"
	"time"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterArkPortraitRoutes 挂载方舟素材库接口：用户自建素材组、平台授权素材组与管理员管理。
// 除认证回调外都要求登录，归属与管理员权限都在 service 校验。
func RegisterArkPortraitRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/ark-portraits", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		overview, err := svc.ArkPortraitOverview(c.Request.Context(), user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, overview)
	})
	r.POST("/ark-portraits/sessions", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceArkPortraitRate(c, svc, "ark-portrait-session:"+user.ID) {
			return
		}
		var req struct {
			Name string `json:"name"`
			Lang string `json:"lang"`
		}
		if !bindArkJSON(c, &req) {
			return
		}
		session, err := svc.CreateArkPortraitSession(c.Request.Context(), user, req.Name, req.Lang)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"session": session})
	})
	r.GET("/ark-portraits/sessions/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		session, err := svc.ArkPortraitSessionStatus(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"session": session})
	})
	r.POST("/ark-portraits/sessions/:id/check", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceArkPortraitRate(c, svc, "ark-portrait-check:"+user.ID) {
			return
		}
		session, err := svc.CheckArkPortraitSession(c.Request.Context(), user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"session": session})
	})
	r.POST("/ark-portraits/sessions/:id/cancel", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		session, err := svc.CancelArkPortraitSession(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"session": session})
	})
	// 认证页完成后由终端用户浏览器打开（多为未登录的手机），只凭一次性 state 识别会话。
	r.GET("/ark-portraits/callback/:state", func(c *gin.Context) {
		if !enforceArkPortraitRate(c, svc, "ark-portrait-callback:"+c.ClientIP()) {
			return
		}
		target := svc.HandleArkPortraitCallback(c.Request.Context(), c.Param("state"), c.Request.URL.Query())
		c.Header("Cache-Control", "no-store")
		c.Header("Referrer-Policy", "no-referrer")
		c.Redirect(http.StatusFound, target)
	})
	r.POST("/ark-portraits/groups", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceArkPortraitRate(c, svc, "ark-portrait-group:"+user.ID) {
			return
		}
		var req struct {
			Kind        string `json:"kind"`
			Name        string `json:"name"`
			Description string `json:"description"`
		}
		if !bindArkJSON(c, &req) {
			return
		}
		if req.Kind != "virtual" {
			failService(c, service.BadAuthRequest("真人素材组需要通过 H5 认证创建，版权 IP 由管理员分配"))
			return
		}
		group, err := svc.CreateArkVirtualGroup(c.Request.Context(), user, service.ArkGroupInput{Name: req.Name, Description: req.Description})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"group": group})
	})
	r.PATCH("/ark-portraits/groups/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.ArkGroupInput
		if !bindArkJSON(c, &req) {
			return
		}
		group, err := svc.UpdateArkGroup(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"group": group})
	})
	r.DELETE("/ark-portraits/groups/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteArkGroup(c.Request.Context(), user, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id")})
	})
	r.POST("/ark-portraits/groups/:id/assets", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceArkPortraitRate(c, svc, "ark-portrait-asset:"+user.ID) {
			return
		}
		var req service.ArkAssetUploadInput
		if !bindArkJSON(c, &req) {
			return
		}
		asset, err := svc.CreateArkPortraitAsset(c.Request.Context(), user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"asset": asset})
	})
	r.POST("/ark-portraits/assets/:id/refresh", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceArkPortraitRate(c, svc, "ark-portrait-refresh:"+user.ID) {
			return
		}
		asset, err := svc.RefreshArkPortraitAsset(c.Request.Context(), user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"asset": asset})
	})
	r.DELETE("/ark-portraits/assets/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteArkPortraitAsset(c.Request.Context(), user, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id")})
	})
	r.POST("/ark-portraits/assets/:id/library", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		assetID, err := svc.AddArkPortraitAssetToLibrary(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"assetId": assetID})
	})
	r.GET("/ark-portraits/assets/:id/file", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		delivery, err := svc.PrepareArkPortraitAssetDelivery(user, c.Param("id"), resourceAccessOptions(c), c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		serveResourceDelivery(c, delivery, "private, no-cache", "")
	})
	registerAdminArkPortraitRoutes(r, svc)
}

func registerAdminArkPortraitRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/ark-portraits/groups", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, pageSize, err := parsePaginationQuery(c, 20)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.AdminArkGroups(user, service.AdminArkGroupQuery{
			Kind: c.Query("kind"), Scope: c.Query("scope"), Expiry: c.Query("expiry"), Keyword: c.Query("keyword"), Page: page, PageSize: pageSize,
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/admin/ark-portraits/groups", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.AdminArkGroupCreateRequest
		if !bindArkJSON(c, &req) {
			return
		}
		group, err := svc.AdminCreateArkGroup(c.Request.Context(), user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"group": group})
	})
	r.GET("/admin/ark-portraits/groups/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		group, err := svc.AdminArkGroup(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"group": group})
	})
	r.PATCH("/admin/ark-portraits/groups/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.AdminArkGroupUpdateRequest
		if !bindArkJSON(c, &req) {
			return
		}
		group, err := svc.AdminUpdateArkGroup(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"group": group})
	})
	r.DELETE("/admin/ark-portraits/groups/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.AdminDeleteArkGroup(c.Request.Context(), user, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id")})
	})
	r.POST("/admin/ark-portraits/groups/:id/assets", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceArkPortraitRate(c, svc, "ark-portrait-admin-asset:"+user.ID) {
			return
		}
		var req service.ArkAssetUploadInput
		if !bindArkJSON(c, &req) {
			return
		}
		asset, err := svc.AdminCreateArkPortraitAsset(c.Request.Context(), user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"asset": asset})
	})
	r.DELETE("/admin/ark-portraits/assets/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.AdminDeleteArkPortraitAsset(c.Request.Context(), user, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id")})
	})
	r.POST("/admin/ark-portraits/sessions", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceArkPortraitRate(c, svc, "ark-portrait-session:"+user.ID) {
			return
		}
		var req struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			Lang        string `json:"lang"`
		}
		if !bindArkJSON(c, &req) {
			return
		}
		session, err := svc.AdminCreateArkPortraitSession(c.Request.Context(), user, req.Name, req.Description, req.Lang)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"session": session})
	})
	r.GET("/admin/ark-portraits/reviews", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, pageSize, err := parsePaginationQuery(c, 20)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.AdminArkReviewQueue(user, c.Query("status"), page, pageSize)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/admin/ark-portraits/reviews/approve", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceArkPortraitRate(c, svc, "ark-portrait-review:"+user.ID) {
			return
		}
		var req struct {
			IDs []string `json:"ids"`
		}
		if !bindArkJSON(c, &req) {
			return
		}
		result, err := svc.AdminApproveArkAssets(c.Request.Context(), user, req.IDs)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/admin/ark-portraits/reviews/reject", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			IDs    []string `json:"ids"`
			Reason string   `json:"reason"`
		}
		if !bindArkJSON(c, &req) {
			return
		}
		result, err := svc.AdminRejectArkAssets(user, req.IDs, req.Reason)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}

// bindArkJSON 限制请求体大小并解析 JSON；解析失败时已写入 400 响应。
func bindArkJSON(c *gin.Context, target any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
	if err := c.ShouldBindJSON(target); err != nil {
		fail(c, http.StatusBadRequest, err)
		return false
	}
	return true
}

// 真人认证与素材上传会调用方舟控制面（账号级 3-10 QPS），沿用资源导入的每分钟限额。
func enforceArkPortraitRate(c *gin.Context, svc *service.Service, key string) bool {
	policy, available := loadRuntimePolicy(c, svc)
	return available && enforceRateLimit(c, key, policy.Request.ResourceImportPerMinute, time.Minute)
}
