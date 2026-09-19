package handler

import (
	"net/http"
	"strings"
	"time"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterPromotionRoutes 注册推广中心接口：用户侧查看邀请、转入与提现，管理侧配置策略与审核提现。
func RegisterPromotionRoutes(r *gin.RouterGroup, svc *service.Service) {
	// 注册页在未登录状态需要判断推广邀请是否可用、以及邀请码是否真实存在。
	// 只返回布尔值，不含邀请人身份；同时限流，避免被用来批量枚举邀请码。
	r.GET("/public/promotion-status", func(c *gin.Context) {
		enabled, err := svc.PublicPromotionEnabled()
		if err != nil {
			failService(c, err)
			return
		}
		code := strings.TrimSpace(c.Query("code"))
		codeValid := false
		if code != "" {
			if !enforceRateLimit(c, "promotion-code-check:"+c.ClientIP(), 60, time.Hour) {
				return
			}
			codeValid, err = svc.PublicInviteCodeValid(code)
			if err != nil {
				failService(c, err)
				return
			}
		}
		ok(c, gin.H{"enabled": enabled, "inviteCodeValid": codeValid})
	})

	r.GET("/promotion/overview", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		overview, err := svc.PromotionOverview(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"overview": overview})
	})

	r.GET("/promotion/invitations", func(c *gin.Context) {
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
		result, err := svc.PromotionInvitations(user, page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/promotion/commissions", func(c *gin.Context) {
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
		result, err := svc.PromotionCommissions(user, c.Query("status"), page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.POST("/promotion/transfer", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		// 转入积分是真实资金动作，限流避免脚本反复试探额度边界。
		if !enforceRateLimit(c, "promotion-transfer:"+user.ID, 30, time.Hour) {
			return
		}
		var req service.PromotionTransferRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		account, err := svc.TransferPromotionCommission(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"account": account})
	})

	r.GET("/promotion/withdrawals", func(c *gin.Context) {
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
		result, err := svc.PromotionWithdrawals(user, page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.POST("/promotion/withdrawals", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "promotion-withdrawal:"+user.ID, 10, time.Hour) {
			return
		}
		var req service.PromotionWithdrawalRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		request, err := svc.CreatePromotionWithdrawal(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"request": request})
	})

	r.GET("/admin/promotion/policy", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, err := svc.AdminPromotionPolicy(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"policy": policy})
	})

	r.PATCH("/admin/promotion/policy", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.PromotionPolicy
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		policy, err := svc.UpdatePromotionPolicy(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"policy": policy})
	})

	r.GET("/admin/promotion/withdrawals", func(c *gin.Context) {
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
		result, err := svc.AdminPromotionWithdrawals(user, c.Query("status"), page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.POST("/admin/promotion/withdrawals/:id/review", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			Approve bool   `json:"approve"`
			Note    string `json:"note"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		request, err := svc.AdminReviewPromotionWithdrawal(user, c.Param("id"), req.Approve, req.Note)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"request": request})
	})
}
