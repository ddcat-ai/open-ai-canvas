package handler

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"yingce/backend/internal/service"
)

func registerSkillCurationRoutes(r *gin.RouterGroup, svc *service.Service) {
	read := func(admin bool) gin.HandlerFunc {
		return func(c *gin.Context) {
			actor, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			result, err := svc.SkillCuration(actor, admin)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, result)
		}
	}
	r.GET("/skills/curation", read(false))
	r.GET("/admin/skill-curation", read(true))
	r.PUT("/admin/skill-curation", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		dec := json.NewDecoder(c.Request.Body)
		dec.DisallowUnknownFields()
		var req service.SkillCurationUpdate
		if err := dec.Decode(&req); err != nil {
			failService(c, service.BadAuthRequest("分类请求格式无效"))
			return
		}
		if err := dec.Decode(new(any)); err != io.EOF {
			failService(c, service.BadAuthRequest("只允许一个请求对象"))
			return
		}
		result, err := svc.UpdateSkillCuration(actor, req, RequestID(c))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}
