package handler

import (
	"errors"
	"net/http"
	"time"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterChannelModelRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/ai/models", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "channel-models:"+user.ID, 30, time.Minute) {
			return
		}
		var input service.ChannelModelsRequest
		if err := c.ShouldBindJSON(&input); err != nil {
			fail(c, http.StatusBadRequest, errors.New("模型渠道参数格式错误"))
			return
		}
		// handler 不接触上游响应细节，密钥校验和模型目录解析统一收敛到 service。
		models, err := svc.FetchChannelModels(c.Request.Context(), user, input)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"models": models})
	})
}
