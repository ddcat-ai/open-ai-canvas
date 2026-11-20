package handler

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func registerChannelModelBatchRoutes(r *gin.RouterGroup, svc *service.Service) {
	handle := func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err == nil {
			err = svc.RequireAdmin(user)
		}
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		decoder := json.NewDecoder(c.Request.Body)
		decoder.DisallowUnknownFields()
		var req struct {
			Models []service.BatchChannelModelUpdate `json:"models"`
		}
		if err := decoder.Decode(&req); err != nil {
			fail(c, http.StatusBadRequest, service.BadAuthRequest("批量修改请求格式无效："+err.Error()))
			return
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			fail(c, http.StatusBadRequest, service.BadAuthRequest("请求只能包含一个 JSON 对象"))
			return
		}
		var updated int
		if id := c.Param("id"); id != "" {
			updated, err = svc.BatchUpdateAdminChannelModels(user, id, req.Models)
		} else {
			updated, err = svc.BatchUpdateAdminAllChannelModels(user, req.Models)
		}
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"updated": updated})
	}
	r.POST("/admin/channels/:id/models/batch-update", handle)
	r.POST("/admin/channel-models/batch-update", handle)
}
