package handler

import (
	"net/http"
	"strings"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterJimengRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/canvas-projects/:id/import/jimeng", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if user == nil {
			failService(c, service.Unauthorized("请先登录"))
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.JimengImportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.ImportJimeng(user.ID, c.Param("id"), strings.TrimSpace(req.ProjectID))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	// 转存单独成一步：即梦的视频地址约一小时失效，读取画布后必须现取地址并逐批落盘，
	// 放在读取接口里会撞上反向代理的超时。
	r.POST("/canvas-projects/:id/import/jimeng/media", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if user == nil {
			failService(c, service.Unauthorized("请先登录"))
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.JimengMediaRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.StoreJimengImportMedia(c.Request.Context(), user.ID, c.Param("id"), service.JimengMediaRequest{
			ProjectID:   strings.TrimSpace(req.ProjectID),
			ResourceIDs: req.ResourceIDs,
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}
