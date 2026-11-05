package handler

import (
	"net/http"
	"strings"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// 只读期间仍允许的写请求：账号、支付扩容、管理、删除腾空间，以及只读语义的 POST 查询。
// 其余非 GET 请求一律视为内容写入；新增写接口默认受只读约束，确需放行时在此登记。
var storageReadOnlyExemptPrefixes = []string{
	"/auth/",
	"/payments/",
	"/wallet/",
	"/admin/",
	"/settings/",
	"/diagnostics/",
	"/model-catalog/",
}

var storageReadOnlyExemptRoutes = map[string]struct{}{
	"/assets/batch-delete":            {},
	"/assets/batch":                   {},
	"/resources/access":               {},
	"/announcements/read":             {},
	"/models/available":               {},
	"/models/:id/quote":               {},
	"/ai/models":                      {},
	"/runninghub/workflow-info":       {},
	"/runninghub/app-info":            {},
	"/canvas-projects/:id/edit-lease": {},
	"/feedbacks":                      {},
	"/feedbacks/attachments":          {},
	"/tasks/:id/cancel":               {},
	"/tasks/:id/query-provider":       {},
	"/tasks/:id/recover-media":        {},
	"/tasks/:id/text-deltas":          {},
	"/tasks/:id/text-replay-complete": {},
	"/agent/runs/:id/cancel":          {},
	"/dramas/:id/pause":               {},
	// 导出只读取已有资源，超容量只读时仍允许用户把作品带走。
	"/dramas/:id/episodes/:episodeId/jianying-draft": {},
	"/dramas/:id/asset-package":                      {},
	"/creation-runs/:id/release":                     {},
	"/creation-runs/:id/heartbeat":                   {},
}

func storageReadOnlyExempt(method, fullPath string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodDelete:
		return true
	}
	route := strings.TrimPrefix(fullPath, "/api")
	if route == "" {
		// 未匹配路由交给 404 处理。
		return true
	}
	if _, ok := storageReadOnlyExemptRoutes[route]; ok {
		return true
	}
	for _, prefix := range storageReadOnlyExemptPrefixes {
		if strings.HasPrefix(route, prefix) {
			return true
		}
	}
	return false
}

// StorageReadOnlyGuard 在账号超出文件容量且 7 天宽限期结束后拒绝内容写入。
// 未登录请求直接放行，由具体 handler 返回 401。
func StorageReadOnlyGuard(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if storageReadOnlyExempt(c.Request.Method, c.FullPath()) {
			c.Next()
			return
		}
		user, err := currentUser(c, svc)
		if err != nil || user == nil {
			c.Next()
			return
		}
		if err := svc.RequireStorageWritable(user.ID); err != nil {
			failService(c, err)
			c.Abort()
			return
		}
		c.Next()
	}
}
