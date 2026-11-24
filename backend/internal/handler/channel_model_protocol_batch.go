package handler

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func handleChannelModelBatchProtocol(c *gin.Context, svc *service.Service) {
	user, err := currentUser(c, svc)
	if err == nil {
		err = svc.RequireAdmin(user)
	}
	if err != nil {
		failService(c, err)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var req service.ChannelModelBatchProtocolRequest
	if err := decoder.Decode(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		failService(c, service.BadAuthRequest("请求只能包含一个 JSON 对象"))
		return
	}
	var updated int
	id := c.Param("id")
	switch {
	case req.Groups != nil && id != "":
		updated, err = svc.UpdateAdminChannelModelsProtocolGroups(user, id, req.Groups)
	case req.Groups != nil:
		updated, err = svc.UpdateAdminAllChannelModelsProtocolGroups(user, req.Groups)
	case id != "":
		updated, err = svc.UpdateAdminChannelModelsProtocol(user, id, req.ModelIDs, req.Protocol)
	default:
		updated, err = svc.UpdateAdminAllChannelModelsProtocol(user, req.ModelIDs, req.Protocol)
	}
	if err != nil {
		failService(c, err)
		return
	}
	ok(c, gin.H{"updated": updated})
}
