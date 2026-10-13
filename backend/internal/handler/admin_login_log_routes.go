package handler

import (
	"log"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func loginRequestContext(c *gin.Context) service.LoginContext {
	return service.LoginContext{IP: c.ClientIP(), UserAgent: c.Request.UserAgent()}
}

// 补充 JSON 校验和频控等在认证域调用之前被拒绝的请求；不读取或保存原始请求正文。
func rejectedLoginAudit(svc *service.Service, method string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		if c.Writer.Status() < 400 || c.GetBool("login_audit_handled") {
			return
		}
		if err := svc.RecordRejectedLogin(method, loginRequestContext(c), c.Writer.Status()); err != nil {
			log.Printf("rejected login audit write failed: method=%s status=%d error=%v", method, c.Writer.Status(), err)
		}
	}
}

func registerAdminLoginLogRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/login-logs", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(actor); err != nil {
			failService(c, err)
			return
		}
		page, limit, err := parsePaginationQuery(c, 20)
		if err != nil {
			fail(c, 400, err)
			return
		}
		query := service.LoginLogQuery{Keyword: c.Query("keyword"), Event: c.Query("event"), Method: c.Query("method"), Result: c.Query("result"), IP: c.Query("ip"), From: c.Query("from"), To: c.Query("to")}
		result, err := svc.AdminLoginLogs(actor, query, page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/admin/login-logs/:id", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		event, err := svc.AdminLoginLog(actor, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"log": event})
	})
}
