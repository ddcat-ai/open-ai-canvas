package handler

import (
	"net/http"
	"strconv"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterToolRoutes 注册画布工具 API：查询、收藏、新增、删除。
func RegisterToolRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/tools", func(c *gin.Context) {
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
		result, err := svc.Tools(user.ID, service.ToolListRequest{
			Page:     page,
			PageSize: pageSize,
			Scope:    c.DefaultQuery("scope", "public"),
			Type:     c.Query("type"),
			Tag:      c.Query("tag"),
			Search:   c.Query("search"),
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/tools/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		toolID, err := parseToolID(c)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		item, err := svc.ToolDetail(user.ID, toolID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, item)
	})

	r.POST("/tools", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.ToolMutationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("请求体格式无效"))
			return
		}
		item, err := svc.CreateTool(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, item)
	})

	r.POST("/tools/:id/favorite", func(c *gin.Context) {
		setToolFavorite(c, svc, true)
	})

	r.DELETE("/tools/:id/favorite", func(c *gin.Context) {
		setToolFavorite(c, svc, false)
	})

	r.DELETE("/tools/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		toolID, err := parseToolID(c)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := svc.DeleteTool(user.ID, toolID); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": true})
	})
}

func setToolFavorite(c *gin.Context, svc *service.Service, favorite bool) {
	user, err := currentUser(c, svc)
	if err != nil {
		failService(c, err)
		return
	}
	toolID, err := parseToolID(c)
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	item, err := svc.SetToolFavorite(user.ID, toolID, favorite)
	if err != nil {
		failService(c, err)
		return
	}
	ok(c, item)
}

func parseToolID(c *gin.Context) (int64, error) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, errInvalidToolID
	}
	return id, nil
}

type toolIDError string

func (e toolIDError) Error() string { return string(e) }

const errInvalidToolID = toolIDError("工具 ID 无效")
