package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

func registerMembershipRoutes(api, admin *gin.RouterGroup, svc *service.Service) {
	api.GET("/payments/membership", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		state, err := svc.MembershipStatus(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, state)
	})
	admin.PUT("/membership/sales", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var in struct {
			Enabled *bool `json:"enabled" binding:"required"`
		}
		if err := c.ShouldBindJSON(&in); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := svc.SetMembershipSales(user, *in.Enabled); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"enabled": *in.Enabled})
	})
	admin.PUT("/membership/cards/:term", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var in struct {
			Enabled   *bool  `json:"enabled" binding:"required"`
			Credits   *int64 `json:"creditsMicrocredits" binding:"required"`
			Currency  string `json:"currency" binding:"required"`
			AmountFen int64  `json:"amountFen" binding:"required"`
			Group     string `json:"membershipGroup" binding:"required"`
		}
		if err := c.ShouldBindJSON(&in); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		card := model.MembershipCardInput{Enabled: *in.Enabled, CreditsMicrocredits: *in.Credits, Currency: in.Currency, AmountFen: in.AmountFen, MembershipGroup: in.Group}
		if err := svc.SaveMembershipCard(user, c.Param("term"), card); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
}
