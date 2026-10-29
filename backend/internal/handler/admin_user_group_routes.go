package handler

import (
	"errors"
	"net/http"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// registerAdminUserGroupRoutes 注册用户分组管理接口；权限在 service 层校验。
func registerAdminUserGroupRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/user-groups", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		groups, err := svc.AdminUserGroups(actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"groups": groups})
	})
	r.POST("/admin/user-groups", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.UserGroupRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, errors.New("用户分组参数格式错误"))
			return
		}
		group, err := svc.CreateUserGroup(actor, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"group": group})
	})
	r.PATCH("/admin/user-groups/:id", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.UserGroupRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, errors.New("用户分组参数格式错误"))
			return
		}
		group, err := svc.UpdateUserGroup(actor, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"group": group})
	})
	r.DELETE("/admin/user-groups/:id", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteUserGroup(actor, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
}
