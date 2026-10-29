package handler

import (
	"net/http"
	"strconv"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// dramaRoute 统一短剧接口的鉴权、请求体上限和响应封装；业务校验与归属检查全部在 service 内完成。
func dramaRoute(svc *service.Service, bodyLimit int64, fn func(c *gin.Context, userID string) (any, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if bodyLimit > 0 {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, bodyLimit)
		}
		data, err := fn(c, user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, data)
	}
}

func bindDramaJSON(c *gin.Context, target any) error {
	if err := c.ShouldBindJSON(target); err != nil {
		return service.BadAuthRequest("请求格式错误")
	}
	return nil
}

func registerDramaRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/dramas", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		page, err := parsePositiveQueryInt(c.Query("page"), 1)
		if err != nil {
			return nil, service.BadAuthRequest("页码无效")
		}
		pageSize, err := parsePositiveQueryInt(c.Query("pageSize"), 24)
		if err != nil || pageSize > 100 {
			return nil, service.BadAuthRequest("每页数量无效")
		}
		return svc.ListDramas(userID, service.DramaListRequest{Page: page, PageSize: pageSize, Query: c.Query("q"), Status: c.Query("status")})
	}))
	r.GET("/dramas/asset-schemes", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		return svc.DramaAssetSchemes(), nil
	}))
	r.GET("/dramas/models", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		return svc.DramaModelCatalog(userID)
	}))
	r.POST("/dramas/estimate", dramaRoute(svc, 64<<10, func(c *gin.Context, userID string) (any, error) {
		var req service.DramaEstimateRequest
		if err := bindDramaJSON(c, &req); err != nil {
			return nil, err
		}
		return svc.EstimateDrama(userID, req)
	}))
	// 小说正文随创建请求一次提交；600 万字 UTF-8 约 18MB，留出 JSON 转义余量。
	r.POST("/dramas", dramaRoute(svc, 32<<20, func(c *gin.Context, userID string) (any, error) {
		var req service.CreateDramaRequest
		if err := bindDramaJSON(c, &req); err != nil {
			return nil, err
		}
		return svc.CreateDrama(userID, req)
	}))
	r.DELETE("/dramas/:id", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		return gin.H{"deleted": true}, svc.DeleteDrama(userID, c.Param("id"))
	}))
	r.GET("/dramas/:id", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		return svc.DramaSummary(userID, c.Param("id"))
	}))
	r.PATCH("/dramas/:id/settings", dramaRoute(svc, 64<<10, func(c *gin.Context, userID string) (any, error) {
		var req service.UpdateDramaSettingsRequest
		if err := bindDramaJSON(c, &req); err != nil {
			return nil, err
		}
		return svc.UpdateDramaSettings(userID, c.Param("id"), req)
	}))
	r.POST("/dramas/:id/start", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		return svc.SetDramaRunning(userID, c.Param("id"), true)
	}))
	r.POST("/dramas/:id/pause", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		return svc.SetDramaRunning(userID, c.Param("id"), false)
	}))
	r.POST("/dramas/:id/retry-failed", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		return svc.RetryFailedDrama(userID, c.Param("id"))
	}))
	r.GET("/dramas/:id/jobs", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		limit, err := parsePositiveQueryInt(c.Query("limit"), 60)
		if err != nil {
			return nil, service.BadAuthRequest("数量无效")
		}
		jobs, err := svc.DramaJobs(userID, c.Param("id"), limit)
		return gin.H{"jobs": jobs}, err
	}))
	r.POST("/dramas/:id/media/release", dramaRoute(svc, 16<<10, func(c *gin.Context, userID string) (any, error) {
		var req service.ReleaseDramaMediaRequest
		if err := bindDramaJSON(c, &req); err != nil {
			return nil, err
		}
		return svc.ReleaseDramaMedia(userID, c.Param("id"), req)
	}))
	r.GET("/dramas/:id/jobs/:jobId", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		return svc.DramaJobDetail(userID, c.Param("id"), c.Param("jobId"))
	}))
	r.POST("/dramas/:id/cast/regenerate-all", dramaRoute(svc, 16<<10, func(c *gin.Context, userID string) (any, error) {
		var req service.RegenerateDramaCastsRequest
		if err := bindDramaJSON(c, &req); err != nil {
			return nil, err
		}
		return svc.RegenerateDramaCasts(userID, c.Param("id"), req)
	}))
	r.GET("/dramas/:id/chapters/:chapterId", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		chapter, err := svc.DramaChapter(userID, c.Param("id"), c.Param("chapterId"))
		return gin.H{"chapter": chapter}, err
	}))
	r.PATCH("/dramas/:id/chapters/:chapterId", dramaRoute(svc, 1<<20, func(c *gin.Context, userID string) (any, error) {
		var req service.UpdateDramaChapterRequest
		if err := bindDramaJSON(c, &req); err != nil {
			return nil, err
		}
		chapter, err := svc.UpdateDramaChapter(userID, c.Param("id"), c.Param("chapterId"), req)
		return gin.H{"chapter": chapter}, err
	}))
	// 逐集追加：单集原文上限 1.2 万字，UTF-8 加 JSON 转义留足余量。
	r.POST("/dramas/:id/episodes", dramaRoute(svc, 1<<20, func(c *gin.Context, userID string) (any, error) {
		var req service.AddDramaEpisodeRequest
		if err := bindDramaJSON(c, &req); err != nil {
			return nil, err
		}
		return svc.AddDramaEpisode(userID, c.Param("id"), req)
	}))
	r.GET("/dramas/:id/episodes/:episodeId", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		return svc.DramaEpisodeDetail(userID, c.Param("id"), c.Param("episodeId"))
	}))
	r.PATCH("/dramas/:id/episodes/:episodeId", dramaRoute(svc, 16<<10, func(c *gin.Context, userID string) (any, error) {
		var req service.UpdateDramaEpisodeRequest
		if err := bindDramaJSON(c, &req); err != nil {
			return nil, err
		}
		episode, err := svc.UpdateDramaEpisode(userID, c.Param("id"), c.Param("episodeId"), req)
		return gin.H{"episode": episode}, err
	}))
	r.POST("/dramas/:id/episodes/:episodeId/approve", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		return svc.ApproveDramaEpisode(userID, c.Param("id"), c.Param("episodeId"))
	}))
	r.POST("/dramas/:id/episodes/:episodeId/rescript", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		return svc.RescriptDramaEpisode(userID, c.Param("id"), c.Param("episodeId"))
	}))
	r.POST("/dramas/:id/episodes/:episodeId/segments/generate", dramaRoute(svc, 16<<10, func(c *gin.Context, userID string) (any, error) {
		var req service.GenerateDramaSegmentsRequest
		if err := bindDramaJSON(c, &req); err != nil {
			return nil, err
		}
		return svc.GenerateDramaSegments(userID, c.Param("id"), c.Param("episodeId"), req)
	}))
	r.POST("/dramas/:id/episodes/:episodeId/segments/prompts", dramaRoute(svc, 16<<10, func(c *gin.Context, userID string) (any, error) {
		var req service.GenerateDramaSegmentsRequest
		if err := bindDramaJSON(c, &req); err != nil {
			return nil, err
		}
		return svc.RequestDramaSegmentPrompts(userID, c.Param("id"), c.Param("episodeId"), req)
	}))
	r.POST("/dramas/:id/episodes/:episodeId/segments/:index/reprocess", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		index, err := strconv.Atoi(c.Param("index"))
		if err != nil || index < 0 {
			return nil, service.BadAuthRequest("剧情段序号无效")
		}
		return svc.ReprocessDramaSegmentVideo(userID, c.Param("id"), c.Param("episodeId"), index)
	}))
	r.PATCH("/dramas/:id/episodes/:episodeId/segments/:index", dramaRoute(svc, 64<<10, func(c *gin.Context, userID string) (any, error) {
		index, err := strconv.Atoi(c.Param("index"))
		if err != nil || index < 0 {
			return nil, service.BadAuthRequest("剧情段序号无效")
		}
		var req service.UpdateDramaSegmentRequest
		if err := bindDramaJSON(c, &req); err != nil {
			return nil, err
		}
		return gin.H{"saved": true}, svc.UpdateDramaSegment(userID, c.Param("id"), c.Param("episodeId"), index, req)
	}))
	// 把精修画布上的视频采用为本段当前视频：默认只换本段，cascade 时后续已生成的段重新排队。
	r.PUT("/dramas/:id/episodes/:episodeId/segments/:index/video", dramaRoute(svc, 4<<10, func(c *gin.Context, userID string) (any, error) {
		index, err := strconv.Atoi(c.Param("index"))
		if err != nil || index < 0 {
			return nil, service.BadAuthRequest("剧情段序号无效")
		}
		var req service.AdoptDramaSegmentVideoRequest
		if err := bindDramaJSON(c, &req); err != nil {
			return nil, err
		}
		return svc.AdoptDramaSegmentVideo(userID, c.Param("id"), c.Param("episodeId"), index, req)
	}))
	// 作品的精修画布：返回最近使用的关联画布，没有时由前端新建。
	r.GET("/dramas/:id/canvas", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		return svc.DramaCanvas(userID, c.Param("id"))
	}))
	// 为投送到画布的短剧媒体登记素材记录（只建入口，不复制媒体）。
	r.POST("/dramas/:id/canvas-assets", dramaRoute(svc, 32<<10, func(c *gin.Context, userID string) (any, error) {
		var req service.DramaCanvasAssetsRequest
		if err := bindDramaJSON(c, &req); err != nil {
			return nil, err
		}
		return svc.DramaCanvasAssets(userID, c.Param("id"), req)
	}))
	// 产物版本：kind=cast|video|final，ownerId 为设定、剧情段或集 ID。
	r.GET("/dramas/:id/takes", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		return svc.DramaTakes(userID, c.Param("id"), c.Query("ownerId"), c.Query("kind"))
	}))
	r.PATCH("/dramas/:id/shots/:shotId", dramaRoute(svc, 64<<10, func(c *gin.Context, userID string) (any, error) {
		var req service.UpdateDramaShotRequest
		if err := bindDramaJSON(c, &req); err != nil {
			return nil, err
		}
		shot, err := svc.UpdateDramaShot(userID, c.Param("id"), c.Param("shotId"), req)
		return gin.H{"shot": shot}, err
	}))
	r.POST("/dramas/:id/shots/:shotId/insert", dramaRoute(svc, 4<<10, func(c *gin.Context, userID string) (any, error) {
		var req service.InsertDramaShotRequest
		if err := bindDramaJSON(c, &req); err != nil {
			return nil, err
		}
		shot, err := svc.InsertDramaShot(userID, c.Param("id"), c.Param("shotId"), req)
		return gin.H{"shot": shot}, err
	}))
	r.DELETE("/dramas/:id/shots/:shotId", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		return gin.H{"deleted": true}, svc.DeleteDramaShot(userID, c.Param("id"), c.Param("shotId"))
	}))
	r.GET("/dramas/:id/cast", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		casts, err := svc.DramaCasts(userID, c.Param("id"))
		return gin.H{"cast": casts}, err
	}))
	r.PATCH("/dramas/:id/cast/:castId", dramaRoute(svc, 64<<10, func(c *gin.Context, userID string) (any, error) {
		var req service.UpdateDramaCastRequest
		if err := bindDramaJSON(c, &req); err != nil {
			return nil, err
		}
		cast, err := svc.UpdateDramaCast(userID, c.Param("id"), c.Param("castId"), req)
		return gin.H{"cast": cast}, err
	}))
	r.PUT("/dramas/:id/cast/:castId/image", dramaRoute(svc, 4<<10, func(c *gin.Context, userID string) (any, error) {
		var req service.SetDramaCastImageRequest
		if err := bindDramaJSON(c, &req); err != nil {
			return nil, err
		}
		return svc.SetDramaCastImage(userID, c.Param("id"), c.Param("castId"), req)
	}))
	r.GET("/dramas/:id/cast/:castId/impact", dramaRoute(svc, 0, func(c *gin.Context, userID string) (any, error) {
		return svc.DramaCastImpact(userID, c.Param("id"), c.Param("castId"))
	}))
	r.POST("/dramas/:id/cast/:castId/regenerate", dramaRoute(svc, 16<<10, func(c *gin.Context, userID string) (any, error) {
		var req struct {
			RestyleSegments bool `json:"restyleSegments"`
		}
		if err := bindDramaJSON(c, &req); err != nil {
			return nil, err
		}
		return svc.RegenerateDramaCast(userID, c.Param("id"), c.Param("castId"), req.RestyleSegments)
	}))
}
