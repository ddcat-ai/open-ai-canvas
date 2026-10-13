package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

func registerAuthProfileRoutes(r *gin.RouterGroup, svc *service.Service) {
	profile := r.Group("/auth/profile")
	profile.Use(func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			c.Abort()
			return
		}
		c.Set("profileActor", actor)
	})
	actor := func(c *gin.Context) *model.User { return c.MustGet("profileActor").(*model.User) }
	securityWrite := func(c *gin.Context) bool {
		policy, available := loadRuntimePolicy(c, svc)
		return available && enforceRateLimit(c, "profile-security-ip:"+c.ClientIP(), policy.Request.LoginIPPerTenMinutes, 10*time.Minute) &&
			enforceRateLimit(c, "profile-security-user:"+actor(c).ID, policy.Request.LoginAccountPerTenMinutes, 10*time.Minute)
	}
	profile.GET("", func(c *gin.Context) {
		result, err := svc.UserProfile(actor(c), sessionCookie(c))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	profile.PUT("/avatar", func(c *gin.Context) {
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "profile-avatar:"+actor(c).ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, (5<<20)+(64<<10))
		file, err := c.FormFile("file")
		if c.Request.MultipartForm != nil {
			defer c.Request.MultipartForm.RemoveAll()
		}
		if err != nil {
			failService(c, service.BadAuthRequest("请选择不超过 5 MiB 的 PNG 或 JPEG 头像"))
			return
		}
		result, err := svc.UpdateProfileAvatar(actor(c), file)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"user": result})
	})
	profile.DELETE("/avatar", func(c *gin.Context) {
		if !enforceRateLimit(c, "profile-avatar-default:"+actor(c).ID, 30, time.Minute) {
			return
		}
		result, err := svc.UseDefaultProfileAvatar(actor(c))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"user": result})
	})
	profile.GET("/avatar/:userId", func(c *gin.Context) {
		data, err := svc.ProfileAvatarContent(actor(c), c.Param("userId"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Data(http.StatusOK, "image/png", data)
	})
	profile.POST("/avatar/default", func(c *gin.Context) {
		if !enforceRateLimit(c, "profile-avatar-default:"+actor(c).ID, 30, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<10)
		var req struct {
			Preset string `json:"preset"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("系统头像选择参数无效"))
			return
		}
		result, err := svc.SelectDefaultProfileAvatar(actor(c), req.Preset)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"user": result})
	})
	profile.POST("/password", func(c *gin.Context) {
		if !securityWrite(c) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.ProfilePasswordRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("密码修改参数无效"))
			return
		}
		if err := svc.ChangeProfilePassword(actor(c), sessionCookie(c), req); err != nil {
			failService(c, err)
			return
		}
		clearSessionCookie(c)
		ok(c, gin.H{"changed": true})
	})
	profile.POST("/email-code", func(c *gin.Context) {
		if !securityWrite(c) {
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "profile-email-code:"+actor(c).ID, policy.Request.EmailCodePerHour, time.Hour) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.ProfileEmailCodeRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("邮箱验证参数无效"))
			return
		}
		result, err := svc.SendProfileEmailCode(c.Request.Context(), actor(c), sessionCookie(c), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	profile.POST("/email", func(c *gin.Context) {
		if !securityWrite(c) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.ProfileEmailChangeRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("邮箱修改参数无效"))
			return
		}
		result, err := svc.ChangeProfileEmail(actor(c), sessionCookie(c), req)
		if err != nil {
			failService(c, err)
			return
		}
		clearSessionCookie(c)
		ok(c, result)
	})
	profile.GET("/linuxdo/start", func(c *gin.Context) {
		if !enforceRateLimit(c, "profile-linuxdo-reauth:"+actor(c).ID, 10, 10*time.Minute) {
			return
		}
		target, err := svc.BeginLinuxDOReauthentication(actor(c), sessionCookie(c))
		if err != nil {
			failService(c, err)
			return
		}
		c.Redirect(http.StatusFound, target)
	})
}
