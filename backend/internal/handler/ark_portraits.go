package handler

import (
	"net/http"
	"time"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterArkPortraitRoutes 挂载方舟真人素材库接口。除认证回调外都要求登录，归属校验在 service。
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
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req struct {
			Name string `json:"name"`
			Lang string `json:"lang"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		session, err := svc.CreateArkPortraitSession(c.Request.Context(), user, req.Name, req.Lang)
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
	// 认证页完成后由终端用户浏览器打开（可能是未登录的手机），只凭一次性 state 识别会话。
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
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req struct {
			Name    string `json:"name"`
			GroupID string `json:"groupId"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		group, err := svc.BindArkPortraitGroup(c.Request.Context(), user, req.Name, req.GroupID)
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
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req struct {
			Name string `json:"name"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		group, err := svc.RenameArkPortraitGroup(user, c.Param("id"), req.Name)
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
		if err := svc.DeleteArkPortraitGroup(c.Request.Context(), user, c.Param("id")); err != nil {
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
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req struct {
			ResourceID string `json:"resourceId"`
			Name       string `json:"name"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		asset, err := svc.CreateArkPortraitAsset(c.Request.Context(), user, c.Param("id"), req.ResourceID, req.Name)
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
}

// 真人认证与素材上传会调用方舟控制面（账号级 3-10 QPS），沿用资源导入的每分钟限额。
func enforceArkPortraitRate(c *gin.Context, svc *service.Service, key string) bool {
	policy, available := loadRuntimePolicy(c, svc)
	return available && enforceRateLimit(c, key, policy.Request.ResourceImportPerMinute, time.Minute)
}
