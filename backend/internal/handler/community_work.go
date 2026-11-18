package handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"strconv"
	"time"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

func RegisterCommunityWorkRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/works", func(c *gin.Context) {
		actor, e := currentUser(c, svc)
		if e != nil {
			failService(c, e)
			return
		}
		page, size, e := communityRoutePage(c)
		if e != nil {
			failService(c, e)
			return
		}
		items, e := svc.CommunityWorks(actor, false, c.Query("status"), page, size)
		if e != nil {
			failService(c, e)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, items)
	})
	r.GET("/admin/works", func(c *gin.Context) {
		actor, e := currentUser(c, svc)
		if e != nil {
			failService(c, e)
			return
		}
		page, size, e := communityRoutePage(c)
		if e != nil {
			failService(c, e)
			return
		}
		items, e := svc.CommunityWorks(actor, true, c.Query("status"), page, size)
		if e != nil {
			failService(c, e)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, items)
	})
	r.GET("/public/works", func(c *gin.Context) {
		if !enforceRateLimit(c, "community-list:"+c.ClientIP(), 120, time.Minute) {
			return
		}
		if value := c.Query("featured"); value != "" && value != "true" && value != "false" {
			fail(c, http.StatusBadRequest, service.BadAuthRequest("精选筛选无效"))
			return
		}
		items, e := svc.PublicCommunityWorks(c.Query("featured") == "true")
		if e != nil {
			failService(c, e)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, gin.H{"items": items})
	})
	for _, private := range []bool{false, true} {
		prefix := "/public/works/:id"
		if private {
			prefix = "/works/:id"
		}
		r.GET(prefix, func(c *gin.Context) {
			actor, e := communityRouteActor(c, svc, private)
			if e != nil {
				failService(c, e)
				return
			}
			work, e := svc.CommunityWork(actor, c.Param("id"), !private)
			if e != nil {
				failService(c, e)
				return
			}
			c.Header("Cache-Control", "no-store")
			ok(c, work)
		})
		r.GET(prefix+"/project", func(c *gin.Context) {
			actor, e := communityRouteActor(c, svc, private)
			if e != nil {
				failService(c, e)
				return
			}
			project, e := svc.CommunityWorkProject(actor, c.Param("id"), !private)
			if e != nil {
				failService(c, e)
				return
			}
			c.Header("Cache-Control", "no-store")
			ok(c, project)
		})
		r.GET(prefix+"/reaction", func(c *gin.Context) {
			if !enforceRateLimit(c, "community-reaction:"+c.ClientIP(), 120, time.Minute) {
				return
			}
			actor, err := communityRouteActor(c, svc, private)
			if err != nil {
				failService(c, err)
				return
			}
			reaction, err := svc.CommunityWorkReaction(actor, c.Param("id"))
			if err != nil {
				failService(c, err)
				return
			}
			c.Header("Cache-Control", "private, no-store")
			ok(c, reaction)
		})
		r.GET(prefix+"/resources/:resourceId/file", func(c *gin.Context) {
			if !enforceRateLimit(c, "community-resource:"+c.ClientIP(), 300, time.Minute) {
				return
			}
			actor, e := communityRouteActor(c, svc, private)
			if e != nil {
				failService(c, e)
				return
			}
			delivery, e := svc.PrepareCommunityWorkResource(actor, c.Param("id"), c.Param("resourceId"), !private, resourceAccessOptions(c), c.GetHeader("Range"))
			if e != nil {
				failService(c, e)
				return
			}
			c.Header("Content-Security-Policy", "sandbox")
			serveResourceDelivery(c, delivery, "private, no-store", "")
		})
	}
	for _, method := range []string{"POST", "PUT"} {
		path := "/works"
		if method == "PUT" {
			path += "/:id"
		}
		r.Handle(method, path, func(c *gin.Context) {
			actor, e := currentUser(c, svc)
			if e != nil {
				failService(c, e)
				return
			}
			if !enforceRateLimit(c, "community-submit:"+actor.ID, 20, time.Minute) {
				return
			}
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
			var input service.CommunityWorkInput
			if e = c.ShouldBindJSON(&input); e != nil {
				fail(c, http.StatusBadRequest, service.BadAuthRequest("投稿数据无效"))
				return
			}
			work, e := svc.SubmitCommunityWork(actor, c.Param("id"), input)
			if e != nil {
				failService(c, e)
				return
			}
			ok(c, work)
		})
	}
	for _, method := range []string{http.MethodPut, http.MethodDelete} {
		r.Handle(method, "/works/:id/like", func(c *gin.Context) {
			actor, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			if !enforceRateLimit(c, "community-like:"+actor.ID, 60, time.Minute) {
				return
			}
			reaction, err := svc.SetCommunityWorkLiked(actor, c.Param("id"), method == http.MethodPut)
			if err != nil {
				failService(c, err)
				return
			}
			c.Header("Cache-Control", "private, no-store")
			ok(c, reaction)
		})
	}
	r.POST("/works/:id/withdraw", func(c *gin.Context) {
		actor, e := currentUser(c, svc)
		if e != nil {
			failService(c, e)
			return
		}
		work, e := svc.WithdrawCommunityWork(actor, c.Param("id"))
		if e != nil {
			failService(c, e)
			return
		}
		ok(c, work)
	})
	r.POST("/public/works/:id/copy", func(c *gin.Context) {
		actor, e := currentUser(c, svc)
		if e != nil {
			failService(c, e)
			return
		}
		if !enforceRateLimit(c, "community-copy:"+actor.ID, 6, time.Minute) {
			return
		}
		project, e := svc.CopyCommunityWork(c.Request.Context(), actor, c.Param("id"))
		if e != nil {
			failService(c, e)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, project)
	})
	r.PATCH("/admin/works/:id/review", func(c *gin.Context) {
		actor, e := currentUser(c, svc)
		if e != nil {
			failService(c, e)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		var input service.CommunityWorkReviewInput
		if e = c.ShouldBindJSON(&input); e != nil {
			fail(c, http.StatusBadRequest, service.BadAuthRequest("审核数据无效"))
			return
		}
		work, e := svc.ReviewCommunityWork(actor, c.Param("id"), input)
		if e != nil {
			failService(c, e)
			return
		}
		ok(c, work)
	})
}

func communityRoutePage(c *gin.Context) (int, int, error) {
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 {
		return 0, 0, service.BadAuthRequest("页码无效")
	}
	size, err := strconv.Atoi(c.DefaultQuery("pageSize", "24"))
	if err != nil || size < 1 || size > 100 {
		return 0, 0, service.BadAuthRequest("每页数量须为1–100")
	}
	return page, size, nil
}

func communityRouteActor(c *gin.Context, svc *service.Service, required bool) (*model.User, error) {
	if !required {
		return nil, nil
	}
	return currentUser(c, svc)
}
