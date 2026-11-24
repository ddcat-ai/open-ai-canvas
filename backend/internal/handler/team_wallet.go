package handler

import (
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func registerTeamWalletRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/teams/credit-overview", teamEndpoint(svc, func(c *gin.Context, userID string) (any, error) {
		return svc.MySpaceCreditOverview(userID)
	}))
	t := r.Group("/teams/:teamId")
	read := t.Group("", RequireFeature(svc, service.FeatureCredits))
	read.GET("/wallet", teamEndpoint(svc, func(c *gin.Context, userID string) (any, error) { return svc.GetTeamWallet(userID, c.Param("teamId")) }))
	read.GET("/wallet/ledger", teamEndpoint(svc, func(c *gin.Context, userID string) (any, error) {
		page, limit, err := parsePaginationQuery(c, 30)
		if err != nil {
			return nil, err
		}
		return svc.GetTeamWalletLedger(userID, c.Param("teamId"), page, limit)
	}))
	for path, operation := range map[string]string{"/wallet/fund": "fund", "/wallet/withdraw": "withdraw", "/members/:membershipId/allocate": "allocate", "/members/:membershipId/reclaim": "reclaim"} {
		t.POST(path, teamEndpoint(svc, func(c *gin.Context, userID string) (any, error) {
			if !enforceRateLimit(c, "team-wallet:"+userID, 60, time.Minute) {
				return nil, nil
			}
			var req struct {
				AmountMicrocredits int64  `json:"amountMicrocredits"`
				IdempotencyKey     string `json:"idempotencyKey"`
			}
			if err := teamBody(c, &req, 4<<10); err != nil {
				return nil, err
			}
			return svc.TransferTeamCredits(userID, c.Param("teamId"), c.Param("membershipId"), operation, req.AmountMicrocredits, req.IdempotencyKey)
		}))
	}
}
