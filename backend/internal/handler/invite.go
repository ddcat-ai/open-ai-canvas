package handler

import (
	"net/http"
	"strconv"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterInviteRoutes 邀请奖励与提现域路由。
func RegisterInviteRoutes(r *gin.RouterGroup, svc *service.Service) {
	// 匿名策略：注册页据此决定邀请码输入框，邀请页/积分中心据此渲染。
	r.GET("/invites/policy", func(c *gin.Context) {
		policy, err := svc.InvitePublicPolicy()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"policy": policy})
	})

	r.GET("/invites/me/overview", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		overview, err := svc.InviteOverview(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, overview)
	})

	r.GET("/invites/me/records", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, limit, err := parsePaginationQuery(c, 20)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.InviteRecordsPage(user, page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/invites/me/withdrawals", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, limit, err := parsePaginationQuery(c, 20)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.UserWithdrawals(user, page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.POST("/invites/me/withdrawals", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.WithdrawalCreateRequest
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		request, err := svc.CreateWithdrawal(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"request": request})
	})

	r.GET("/invites/me/withdraw-account", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		account, err := svc.GetWithdrawAccount(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"account": account})
	})

	r.PUT("/invites/me/withdraw-account", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.WithdrawAccountView
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := svc.SaveWithdrawAccount(user, req.Method, req.Info); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"saved": true})
	})

	r.GET("/invites/me/transfers", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, limit, err := parsePaginationQuery(c, 20)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.UserTransfers(user, page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.POST("/invites/me/transfers", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.TransferCreateRequest
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		record, account, err := svc.CreateTransfer(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"record": record, "account": account})
	})

	// ===== 管理端 =====

	r.GET("/admin/settings/invite", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		setting, err := svc.AdminInviteSetting(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})

	r.PATCH("/admin/settings/invite", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.InvitePolicy
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		setting, err := svc.UpdateInviteSetting(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})

	r.GET("/admin/invites", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, limit, err := parsePaginationQuery(c, 20)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.AdminInviteRecordsPage(user, service.AdminInviteListQuery{
			Status: c.Query("status"), Keyword: c.Query("keyword"), Page: page, PageSize: limit,
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/admin/invites/:userId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		detail, err := svc.AdminInviteRecordDetail(user, c.Param("userId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, detail)
	})

	r.POST("/admin/invites/:userId/approve", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		record, err := svc.ApproveInviteRecord(user, c.Param("userId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"record": record})
	})

	r.POST("/admin/invites/:userId/freeze", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		record, err := svc.FreezeInviteRecord(user, c.Param("userId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"record": record})
	})

	r.PATCH("/admin/invites/:userId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.InviteInvitersUpdateRequest
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		record, err := svc.UpdateInviteInviters(user, c.Param("userId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"record": record})
	})

	r.DELETE("/admin/invites/:userId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteInviteRecord(user, c.Param("userId")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": true})
	})

	r.GET("/admin/withdrawals", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, limit, err := parsePaginationQuery(c, 20)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		query := service.AdminWithdrawListQuery{
			Method: c.Query("method"), Keyword: c.Query("keyword"),
			From: c.Query("from"), Until: c.Query("until"), Page: page, PageSize: limit,
		}
		if raw := c.Query("status"); raw != "" {
			status, parseErr := strconv.Atoi(raw)
			if parseErr != nil {
				fail(c, http.StatusBadRequest, service.BadAuthRequest("提现状态格式无效"))
				return
			}
			query.Status = &status
		}
		result, err := svc.AdminWithdrawalsPage(user, query)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/admin/withdrawals/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		detail, err := svc.AdminWithdrawalDetail(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, detail)
	})

	r.POST("/admin/withdrawals/:id/approve", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		request, err := svc.ApproveWithdrawal(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"request": request})
	})

	r.POST("/admin/withdrawals/:id/reject", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			Reason string `json:"reason"`
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		request, err := svc.RejectWithdrawal(user, c.Param("id"), req.Reason)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"request": request})
	})
}
