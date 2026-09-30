package handler

import (
	"fmt"

	"strconv"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterProjectRoutes(r *gin.RouterGroup, svc *service.Service) {
	RegisterStyleProfileRoutes(r, svc)
	r.GET("/voice-profiles", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		profiles, err := svc.ListVoiceProfiles(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"profiles": profiles})
	})
	registerProjectCoreRoutes(r, svc)
	registerProjectUnitRoutes(r, svc)
	registerProjectAssetRoutes(r, svc)
	registerProjectWorkflowRoutes(r, svc)
}

// parsePositiveQueryInt 解析列表查询里的正整数。分页和筛选查询名统一用 camelCase：page、pageSize、projectId、folderId、mediaType、unitId。
func parsePositiveQueryInt(value string, fallback int) (int, error) {
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 1 {
		return 0, fmt.Errorf("query parameter must be a positive integer")
	}
	return parsed, nil
}

// parsePaginationQuery 统一解析列表分页参数。
// 缺省值由具体接口声明；显式传入非正整数属于请求错误，不能悄悄变成服务层默认值，
// 否则客户端的协议问题会被掩盖，分页行为也会随服务层实现变化。
func parsePaginationQuery(c *gin.Context, fallbackPageSize int) (int, int, error) {
	page, err := parsePositiveQueryInt(c.Query("page"), 1)
	if err != nil {
		return 0, 0, fmt.Errorf("page: %w", err)
	}
	pageSize, err := parsePositiveQueryInt(c.Query("pageSize"), fallbackPageSize)
	if err != nil {
		return 0, 0, fmt.Errorf("pageSize: %w", err)
	}
	return page, pageSize, nil
}
